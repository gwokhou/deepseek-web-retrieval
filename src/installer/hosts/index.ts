import { planCodex } from "./codex"
import { planOpenCode } from "./opencode"
import { planPi } from "./pi"
import { API_KEY_ENV } from "../../core/constants"
import { deepEqual } from "../formats/value"
import { claimedByOtherScope, readRecord } from "../state"
import type { HostName, InstallRecord, InstallerInput, InstallPlan, RecordedFile } from "../types"

/**
 * A host planner sees the previous install record for its scope, so it never reads
 * install state itself; planForHost is the one place a record read happens per plan.
 */
export type HostPlanner = (input: InstallerInput, previous: InstallRecord | undefined) => InstallPlan

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
}

export function planForHost(host: HostName, input: InstallerInput): InstallPlan {
  const previous = readRecord(input)
  const planned = withCrossScopeGuard(HOST_PLANNERS[host](input, previous), input)
  return withSecretGuard(withOrphanReverts(planned, input, previous))
}

/**
 * One file must never be claimed by two scopes of the same host: Codex project-scope
 * config falls back to ~/.codex/config.toml, so a project install beside a global one
 * would let either uninstall clobber the other's registration. Refuse with guidance
 * instead. Hosts whose scope pairs map to disjoint files (Pi, OpenCode) pass through.
 */
function withCrossScopeGuard(plan: InstallPlan, input: InstallerInput): InstallPlan {
  if (plan.errors.length > 0) return plan
  const other = input.scope === "global" ? "project" : "global"
  const overlap = claimedByOtherScope(input, plan.edits.map((edit) => edit.file))
  if (overlap.length === 0) return plan
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
  }
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
    if (edit.format === "rules") continue // rules edits carry no values to snapshot
    for (const op of edit.ops) {
      if (op.op !== "set" || op.previous === undefined) continue
      const offender = findSecretLike(op.previous, op.path.join("."))
      if (offender !== undefined) {
        return {
          ...plan,
          edits: [],
          reverts: undefined,
          errors: [
            {
              message:
                `${edit.file}: the existing value at ${op.path.join(".")} contains a credential-looking key ` +
                `(${offender}). The installer refuses to snapshot secrets into its state file. Move the key to ` +
                `environment indirection ("\${${API_KEY_ENV}}" expansion or env_vars) and re-run.`,
            },
          ],
        }
      }
    }
  }
  return plan
}

function findSecretLike(value: unknown, at: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = `${at}.${key}`
    if (
      /(api[_-]?key|token|secret|password|credential)/i.test(key) &&
      typeof child === "string" &&
      child.length > 0 &&
      !/^\$\{[^}]+\}$/.test(child)
    ) {
      return path
    }
    const nested = findSecretLike(child, path)
    if (nested !== undefined) return nested
  }
  return undefined
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
function withOrphanReverts(plan: InstallPlan, input: InstallerInput, previous: InstallRecord | undefined): InstallPlan {
  if (plan.errors.length > 0) return plan
  if (previous === undefined) return plan
  const reverts: RecordedFile[] = []
  for (const file of previous.files) {
    const edit = plan.edits.find((candidate) => candidate.file === file.file)
    if (edit === undefined) {
      reverts.push(file)
      continue
    }
    if (edit.format === "rules" || file.format === "rules") continue // the new plan's block supersedes ours
    const orphanOps = file.ops.flatMap((op) => {
      const claimed = edit.ops.find(
        (candidate) => candidate.op === op.op && candidate.path.join("\u0000") === op.path.join("\u0000"),
      )
      if (op.op !== "append-array" || claimed === undefined || claimed.op !== "append-array") {
        return claimed === undefined ? [op] : []
      }
      const dropped = (Array.isArray(op.applied) ? op.applied : []).filter(
        (entry) => !(claimed.entries ?? []).some((wanted) => deepEqual(wanted, entry)),
      )
      return dropped.length > 0 ? [{ ...op, applied: dropped }] : []
    })
    if (orphanOps.length > 0) reverts.push({ ...file, ops: orphanOps })
  }
  if (reverts.length === 0) return plan
  return { ...plan, reverts }
}
