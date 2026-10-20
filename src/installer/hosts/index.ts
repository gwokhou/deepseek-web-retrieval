import { planCodex } from "./codex"
import { planOpenCode } from "./opencode"
import { planPi } from "./pi"
import { API_KEY_ENV } from "../../core/constants"
import { claimedByOtherScope, readRecord } from "../state"
import type { HostName, InstallerInput, InstallPlan, RecordedFile } from "../types"

export type HostPlanner = (input: InstallerInput) => InstallPlan

export const HOST_PLANNERS: Readonly<Record<HostName, HostPlanner>> = {
  codex: planCodex,
  opencode: planOpenCode,
  pi: planPi,
}

export function planForHost(host: HostName, input: InstallerInput): InstallPlan {
  const planned = withCrossScopeGuard(HOST_PLANNERS[host](input), input)
  return withSecretGuard(withOrphanReverts(planned, input))
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
 * the ops whose paths the new plan does not touch.
 */
function withOrphanReverts(plan: InstallPlan, input: InstallerInput): InstallPlan {
  if (plan.errors.length > 0) return plan
  const previous = readRecord(input)
  if (previous === undefined) return plan
  const reverts: RecordedFile[] = []
  for (const file of previous.files) {
    const edit = plan.edits.find((candidate) => candidate.file === file.file)
    if (edit === undefined) {
      reverts.push(file)
      continue
    }
    if (file.format === "rules") continue // the new plan's block supersedes ours
    const orphanOps = file.ops.filter(
      (op) => !edit.ops.some((candidate) => candidate.op === op.op && candidate.path.join("\u0000") === op.path.join("\u0000")),
    )
    if (orphanOps.length > 0) reverts.push({ ...file, ops: orphanOps })
  }
  if (reverts.length === 0) return plan
  return { ...plan, reverts }
}
