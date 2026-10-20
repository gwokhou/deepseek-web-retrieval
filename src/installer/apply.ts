import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { applyJsonOps, applyTomlOps, deepEqual, jsonGet, loadConfig, removeKeyAt, revertJsonOps, revertTomlOps, serializeConfig, valueAt, writeConfig } from "./configFile"
import { hasBlock, removeBlock, upsertBlock } from "./rules"
import { readRecord, writeRecord } from "./state"
import type { ConfigOp, FileEdit, InstallPlan, InstallRecord, InstallerInput, RecordedFile } from "./types"
import { pruneEmptyDir } from "./uninstall"

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
 * Applies a plan: prepares every edit in memory first (a malformed existing config
 * fails before any file is written), writes the files, reverts artifacts orphaned
 * by a tier change, records surgical-undo state, and verifies the result.
 */
export function applyPlan(plan: InstallPlan, input: InstallerInput): ApplyResult {
  if (plan.errors.length > 0) {
    throw new Error(`refusing to apply a plan with errors: ${plan.errors.map((error) => error.message).join("; ")}`)
  }
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
    lines.push(...applyReverts(plan.reverts ?? [], plan.host))
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

function prepareEdit(edit: FileEdit, host: InstallPlan["host"]): PreparedEdit {
  if (edit.format === "rules") {
    const existed = existsSync(edit.file)
    const text = existed ? readFileSync(edit.file, "utf8") : ""
    const updated = upsertBlock(host, text, edit.block ?? "")
    return {
      edit,
      recorded: { file: edit.file, format: "rules", created: !existed, ops: [], blockApplied: edit.block },
      write: () => {
        mkdirSync(dirname(edit.file), { recursive: true })
        writeFileSync(edit.file, updated)
      },
    }
  }
  const loaded = loadConfig(edit.file, edit.format)
  if (loaded.parseError) {
    throw new Error(`${edit.file} does not parse: ${loaded.parseError}`)
  }
  if (edit.format === "json") {
    const base = loaded.exists && loaded.text.trim().length > 0 ? loaded.text : "{}\n"
    const result = applyJsonOps(base, edit.ops)
    return {
      edit,
      recorded: { file: edit.file, format: "json", created: !loaded.exists, ops: result.recorded, createdParents: result.createdParents },
      write: () => writeConfig(edit.file, result.text),
    }
  }
  const result = applyTomlOps(loaded.value, edit.ops)
  const serialized = serializeConfig(result.value, "toml")
  return {
    edit,
    recorded: { file: edit.file, format: "toml", created: !loaded.exists, ops: result.recorded, createdParents: result.createdParents },
    write: () => writeConfig(edit.file, serialized),
  }
}

/** Reverts artifacts from a superseded init: shown in the plan, undone here, gone from the record. */
function applyReverts(reverts: readonly RecordedFile[], host: InstallPlan["host"]): string[] {
  const lines: string[] = []
  for (const revert of reverts) {
    if (!existsSync(revert.file)) {
      lines.push(`already absent: ${revert.file} (previous init)`)
      continue
    }
    if (revert.format === "rules") {
      const text = readFileSync(revert.file, "utf8")
      if (!hasBlock(host, text)) {
        lines.push(`no rules block from the previous init in ${revert.file}`)
        continue
      }
      const updated = removeBlock(host, text)
      if (updated.trim().length === 0) {
        unlinkSync(revert.file)
        pruneEmptyDir(dirname(revert.file))
      } else {
        writeFileSync(revert.file, updated)
      }
      lines.push(`removed the previous init's rules block from ${revert.file}`)
      continue
    }
    const text = readFileSync(revert.file, "utf8")
    if (revert.format === "json") {
      const result = revertJsonOps(text, revert.ops, revert.createdParents ?? [])
      writeFileSync(revert.file, result.text)
      lines.push(`reverted the previous init's artifacts in ${revert.file}`)
      lines.push(...result.notes.map((note) => `  note: ${note}`))
      continue
    }
    const value = parseToml(text) as Record<string, unknown>
    const notes = revertTomlOps(value, revert.ops)
    for (const parent of [...(revert.createdParents ?? [])].reverse()) {
      const current = valueAt(value, parent)
      if (typeof current === "object" && current !== null && !Array.isArray(current) && Object.keys(current).length === 0) {
        removeKeyAt(value, parent)
      }
    }
    writeFileSync(revert.file, `${stringifyToml(value)}\n`)
    lines.push(`reverted the previous init's artifacts in ${revert.file}`)
    lines.push(...notes.map((note) => `  note: ${note}`))
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
    if (edit.format === "rules") {
      const good = hasBlock(host, readFileSync(edit.file, "utf8"))
      lines.push(`${good ? "pass" : "FAIL"} ${edit.file}: rules block ${good ? "present" : "missing"}`)
      ok = ok && good
      continue
    }
    const text = readFileSync(edit.file, "utf8")
    for (const op of edit.ops) {
      const good = opHolds(edit.format, text, op)
      lines.push(`${good ? "pass" : "FAIL"} ${edit.file}: ${describeOp(op)} ${good ? "holds" : "missing"}`)
      ok = ok && good
    }
  }
  return { lines, ok }
}

function opHolds(format: "json" | "toml", text: string, op: ConfigOp): boolean {
  if (format === "json") {
    if (op.op === "set") return deepEqual(jsonGet(text, op.path), op.value)
    const list = jsonGet(text, op.path)
    return Array.isArray(list) && (op.entries ?? []).every((entry) => list.some((item) => deepEqual(item, entry)))
  }
  const value = parseToml(text) as Record<string, unknown>
  const current = valueAt(value, op.path)
  if (op.op === "set") return deepEqual(current, op.value)
  return Array.isArray(current) && (op.entries ?? []).every((entry) => current.some((item) => deepEqual(item, entry)))
}

function describeOp(op: ConfigOp): string {
  if (op.op === "set") return `set ${op.path.join(".")}`
  return `append ${op.path.join(".")}`
}
