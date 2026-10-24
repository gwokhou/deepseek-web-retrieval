import { API_KEY_ENV } from "../../core/constants";
import { deepEqual, isPlainObject } from "../formats/value";
import { assertFileOwnership, fileOwnershipNotes } from "../ownership";
import { claimedByOtherScope, InstallRecordError, readRecord } from "../record";
import type { HostName, InstallerInput, InstallPlan, InstallRecord, RecordedFile } from "../types";
import { planClaudeCode, probeClaudeCodeVersion } from "./claude-code";
import { planCodex, probeCodexVersion } from "./codex";
import { planOpenCode } from "./opencode";
import { planPi } from "./pi";

/**
 * A host planner sees the previous install record for its scope, so it never reads
 * install state itself; planForHost is the one place a record read happens per plan.
 */
export type HostPlanner = (input: InstallerInput, previous: InstallRecord | undefined) => InstallPlan;

/**
 * The host registry. Key order feeds the CLI's usage string; a new host is one
 * module, one line here, one HostName union member, and one hosts.jsonc row
 * carrying the installer field — the two guards in test/hosts.test.ts hold all
 * four in sync.
 */
export const HOST_PLANNERS: Readonly<Record<HostName, HostPlanner>> = {
  opencode: planOpenCode,
  pi: planPi,
  codex: planCodex,
  "claude-code": planClaudeCode,
};

/**
 * Per-host version probes the CLI edge runs before planning, so "which host
 * needs a probe" is a host-module fact, not a CLI branch. A missing entry means
 * the host's plan never reads hostVersion.
 */
export const HOST_VERSION_PROBES: Partial<Record<HostName, (err: (line: string) => void) => string | undefined>> = {
  codex: probeCodexVersion,
  "claude-code": probeClaudeCodeVersion,
};

export function planForHost(host: HostName, input: InstallerInput): InstallPlan {
  try {
    const previous = readRecord(input);
    const planned = withCrossScopeGuard(HOST_PLANNERS[host](input, previous), input);
    return {
      ...withSecretGuard(withOrphanReverts(withLegacySharedConfigGuard(planned, previous), previous)),
      previousRecord: previous,
    };
  } catch (error) {
    if (!(error instanceof InstallRecordError)) throw error;
    return {
      host,
      scope: input.scope,
      tiers: { search: input.search, fetch: input.fetch },
      edits: [],
      notes: [],
      errors: [{ message: error.message }],
    };
  }
}

/**
 * One file must never be claimed by two scopes of the same host: Codex project-scope
 * config falls back to ~/.codex/config.toml, so a project install beside a global one
 * would let either uninstall clobber the other's registration. Refuse with guidance
 * instead. Hosts whose scope pairs map to disjoint files (Pi, OpenCode) pass through.
 */
function withCrossScopeGuard(plan: InstallPlan, input: InstallerInput): InstallPlan {
  if (plan.errors.length > 0) return plan;
  try {
    assertFileOwnership(input, plan.edits);
  } catch (error) {
    return { ...plan, edits: [], reverts: undefined, errors: [{ message: String(error) }] };
  }
  const other = input.scope === "global" ? "project" : "global";
  const overlap = claimedByOtherScope(
    input,
    plan.edits.map((edit) => edit.file),
  );
  if (overlap.length === 0) return { ...plan, notes: [...plan.notes, ...fileOwnershipNotes(input, plan.edits)] };
  return {
    ...plan,
    edits: [],
    reverts: undefined,
    errors: [
      {
        message:
          `A ${plan.host} install is already recorded at the ${other} scope and claims the same file(s): ${overlap.join(", ")}. ` +
          `Uninstall it first (deepseek-web-retrieval uninstall --host ${plan.host} --scope ${other}), ` +
          `or re-run with --scope ${other} to update it in place — two scopes must not edit one file.`,
      },
    ],
  };
}

/**
 * Old installers had no shared ownership sidecar. A generated registration
 * without this scope's record may belong to an unknown project; adopting it
 * would snapshot installed values and recreate the cross-project undo bug.
 */
function withLegacySharedConfigGuard(plan: InstallPlan, previous: InstallRecord | undefined): InstallPlan {
  if (plan.errors.length > 0 || previous !== undefined) return plan;
  for (const edit of plan.edits) {
    if (edit.format === "rules" || !edit.shared) continue;
    for (const op of edit.ops) {
      const old = op.previous;
      if (
        op.op !== "set" ||
        !isPlainObject(old) ||
        old.command !== "npx" ||
        !Array.isArray(old.args) ||
        old.args[0] !== "-y" ||
        !Array.isArray(old.env_vars) ||
        !old.env_vars.includes(API_KEY_ENV)
      )
        continue;
      return {
        ...plan,
        edits: [],
        reverts: undefined,
        errors: [
          {
            message:
              `${edit.file} contains an installer-style registration without an install record for this location. ` +
              "It may belong to an older install in another project. Re-run init or uninstall from that original project and scope first; " +
              "if the registration was created manually, remove it before retrying. No existing registration was adopted.",
          },
        ],
      };
    }
  }
  return plan;
}

/**
 * Refuses to snapshot values that look like credentials: replacing an existing entry
 * that carries a literal API key would copy that secret into the install record, so
 * the plan errors and asks the user to move the key to environment indirection first.
 * A pure `${VAR}` expansion is that indirection — including the form this installer
 * itself writes — so it is allowed through and re-init over our own output works.
 */
function withSecretGuard(plan: InstallPlan): InstallPlan {
  for (const edit of plan.edits) {
    if (edit.format === "rules") continue; // rules edits carry no values to snapshot
    for (const op of edit.ops) {
      if (op.op !== "set" || op.previous === undefined) continue;
      const offender = findSecretLike(op.previous, op.path.join("."));
      if (offender !== undefined) {
        return {
          ...plan,
          edits: [],
          reverts: undefined,
          errors: [
            {
              message:
                `${edit.file}: the existing value at ${op.path.join(".")} contains a credential-looking key ` +
                `(${offender}). The installer refuses to snapshot secrets into its install record. Move the key to ` +
                `environment indirection ("\${${API_KEY_ENV}}" expansion or env_vars) and re-run.`,
            },
          ],
        };
      }
    }
  }
  return plan;
}

function findSecretLike(value: unknown, at: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = `${at}.${key}`;
    if (
      /(api[_-]?key|token|secret|password|credential)/i.test(key) &&
      typeof child === "string" &&
      child.length > 0 &&
      !/^\$\{[^}]+\}$/.test(child)
    ) {
      return path;
    }
    const nested = findSecretLike(child, path);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * A re-init supersedes the previous record, so anything the previous init applied
 * that the new plan no longer wants must be reverted explicitly — otherwise it is
 * silently orphaned (and uninstall could never restore it). Whole files missing
 * from the new plan revert entirely; files shared with the new plan revert only
 * the ops whose paths the new plan does not touch — and for a same-path
 * append-array, only the entries the new plan no longer wants (a changed
 * --package ref, retired tier options) revert, so a replaced entry never
 * lingers beside its replacement.
 */
function withOrphanReverts(plan: InstallPlan, previous: InstallRecord | undefined): InstallPlan {
  if (plan.errors.length > 0) return plan;
  if (previous === undefined) return plan;
  const reverts: RecordedFile[] = [];
  for (const file of previous.files) {
    const edit = plan.edits.find((candidate) => candidate.file === file.file);
    if (edit === undefined) {
      reverts.push(file);
      continue;
    }
    if (edit.format === "rules" || file.format === "rules") continue; // the new plan's block supersedes ours
    const orphanOps = file.ops.flatMap((op) => {
      const claimed = edit.ops.find(
        (candidate) => candidate.op === op.op && candidate.path.join("\u0000") === op.path.join("\u0000"),
      );
      if (op.op !== "append-array" || claimed === undefined || claimed.op !== "append-array") {
        return claimed === undefined ? [op] : [];
      }
      const dropped = (Array.isArray(op.applied) ? op.applied : []).filter(
        (entry) => !(claimed.entries ?? []).some((wanted) => deepEqual(wanted, entry)),
      );
      return dropped.length > 0 ? [{ ...op, applied: dropped }] : [];
    });
    if (orphanOps.length > 0) reverts.push({ ...file, ops: orphanOps });
  }
  if (reverts.length === 0) return plan;
  return { ...plan, reverts };
}
