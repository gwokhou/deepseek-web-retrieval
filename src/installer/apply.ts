import { existsSync, readFileSync } from "node:fs"
import { codecFor, writeConfig } from "./formats"
import { deepEqual, valueAt } from "./formats/value"
import { revertRecordedFile } from "./revert"
import { readRecord, writeRecord } from "./state"
import type { ConfigOp, FileEdit, InstallPlan, InstallRecord, InstallerInput, RecordedFile } from "./types"

export interface ApplyResult {
  readonly lines: string[]
  readonly ok: boolean
}

interface PreparedEdit {
  readonly edit: FileEdit
  readonly recorded: RecordedFile
  readonly write: () => void
}

/**
 * Applies a plan: refuses first when the config drifted since the plan was
 * rendered (the plan and the record must describe one plan-time snapshot —
 * ADR-0001), prepares every edit in memory (a malformed existing config fails
 * before any file is written), writes the files, reverts artifacts orphaned by
 * a tier change, records surgical-undo state, and verifies the result.
 */
export function applyPlan(plan: InstallPlan, input: InstallerInput): ApplyResult {
  if (plan.errors.length > 0) {
    throw new Error(`refusing to apply a plan with errors: ${plan.errors.map((error) => error.message).join("; ")}`)
  }
  assertNoDrift(plan)
  const previous = readRecord(input)
  const prepared = plan.edits.map((edit) => prepareEdit(edit, plan.host))
  const files: RecordedFile[] = []
  const lines: string[] = []
  for (const item of prepared) {
    item.write()
    files.push(mergeRecorded(item.recorded, previous?.files.find((file) => file.file === item.edit.file)))
    lines.push(`${item.recorded.created ? "created" : "updated"} ${item.edit.file}`)
  }
  if ((plan.reverts ?? []).length > 0) {
    lines.push(...applyReverts(plan))
  }
  const record: InstallRecord = {
    version: 1,
    host: plan.host,
    scope: plan.scope,
    tiers: plan.tiers,
    createdAt: new Date().toISOString(),
    files,
  }
  writeRecord(input, record)
  const verification = verifyEdits(plan.edits, plan.host)
  lines.push(...verification.lines)
  return { lines, ok: verification.ok }
}

/**
 * ADR-0001: every set op the plan previewed must still find the value it showed.
 * A file that changed between plan review and apply refuses the whole apply with
 * re-run guidance, so an interim user edit is never silently overwritten and the
 * record's snapshots stay provably equal to what the user approved.
 */
function assertNoDrift(plan: InstallPlan): void {
  const drifts: string[] = []
  for (const edit of plan.edits) {
    if (edit.format === "rules") continue
    const loaded = codecFor(edit.format, plan.host).load(edit.file)
    if (loaded.parseError) {
      drifts.push(`${edit.file} no longer parses (${loaded.parseError})`)
      continue
    }
    for (const op of edit.ops) {
      if (op.op !== "set") continue
      const current = valueAt(loaded.value, op.path)
      if (!deepEqual(current, op.previous)) {
        drifts.push(`${edit.file}: ${op.path.join(".")} changed since the plan was rendered`)
      }
    }
  }
  if (drifts.length > 0) {
    throw new Error(
      `refusing to apply — the config changed since the plan was rendered: ${drifts.join("; ")}. ` +
        "Re-run init to re-plan against the current files.",
    )
  }
}

function prepareEdit(edit: FileEdit, host: InstallPlan["host"]): PreparedEdit {
  const codec = codecFor(edit.format, host)
  if (edit.format === "rules") {
    const existed = existsSync(edit.file)
    const text = existed ? readFileSync(edit.file, "utf8") : ""
    const updated = codec.apply(text, edit).text
    return {
      edit,
      recorded: { file: edit.file, format: "rules", created: !existed, ops: [], blockApplied: edit.block },
      write: () => writeConfig(edit.file, updated),
    }
  }
  const loaded = codec.load(edit.file)
  if (loaded.parseError) {
    throw new Error(`${edit.file} does not parse: ${loaded.parseError}`)
  }
  const applied = codec.apply(loaded.text, edit)
  return {
    edit,
    recorded: { file: edit.file, format: edit.format, created: !loaded.exists, ops: applied.recorded, createdParents: applied.createdParents },
    write: () => writeConfig(edit.file, applied.text),
  }
}

/**
 * Reverts artifacts from a superseded init: shown in the plan, undone here, gone
 * from the record. Files the new plan still claims revert partially (never
 * deleted); files it no longer wants revert wholly and are deleted when the
 * installer created them and they are left empty.
 */
function applyReverts(plan: InstallPlan): string[] {
  const lines: string[] = []
  for (const revert of plan.reverts ?? []) {
    const whole = !plan.edits.some((edit) => edit.file === revert.file)
    lines.push(...revertRecordedFile(revert, plan.host, { label: " (previous init)", whole }))
  }
  return lines
}

/**
 * Merges a re-apply with the record it supersedes: a set op whose previous value is
 * what an earlier run applied inherits that run's snapshot, appended arrays
 * accumulate, and the created flag keeps the first install's truth.
 */
function mergeRecorded(current: RecordedFile, before: RecordedFile | undefined): RecordedFile {
  if (before === undefined) return current
  const ops = current.ops.map((op) => {
    const old = before.ops.find((candidate) => candidate.op === op.op && candidate.path.join("\u0000") === op.path.join("\u0000"))
    if (old === undefined) return op
    if (op.op === "set" && old.op === "set" && deepEqual(op.previous, old.applied)) {
      return { ...op, previous: old.previous }
    }
    if (op.op === "append-array" && old.op === "append-array") {
      return { ...op, applied: [...(old.applied as unknown[]), ...(op.applied as unknown[])] }
    }
    return op
  })
  return {
    ...current,
    created: before.created,
    ops,
    createdParents: [...(before.createdParents ?? []), ...(current.createdParents ?? [])],
  }
}

function verifyEdits(edits: readonly FileEdit[], host: InstallPlan["host"]): { lines: string[]; ok: boolean } {
  const lines: string[] = []
  let ok = true
  for (const edit of edits) {
    if (!existsSync(edit.file)) {
      lines.push(`FAIL ${edit.file} does not exist after apply`)
      ok = false
      continue
    }
    const codec = codecFor(edit.format, host)
    const text = readFileSync(edit.file, "utf8")
    if (edit.format === "rules") {
      const good = codec.verify(text, edit)
      lines.push(`${good ? "pass" : "FAIL"} ${edit.file}: rules block ${good ? "present" : "missing"}`)
      ok = ok && good
      continue
    }
    for (const op of edit.ops) {
      const good = codec.verify(text, edit, op)
      lines.push(`${good ? "pass" : "FAIL"} ${edit.file}: ${describeOp(op)} ${good ? "holds" : "missing"}`)
      ok = ok && good
    }
  }
  return { lines, ok }
}

function describeOp(op: ConfigOp): string {
  if (op.op === "set") return `set ${op.path.join(".")}`
  return `append ${op.path.join(".")}`
}
