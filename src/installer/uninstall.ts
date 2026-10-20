import { existsSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { deepEqual, removeKeyAt, revertJsonOps, revertTomlOps, valueAt } from "./configFile"
import { stateDir } from "./paths"
import { hasBlock, removeBlock } from "./rules"
import { deleteRecord, readRecord } from "./state"
import type { HostName, InstallerInput, RecordedFile } from "./types"

/**
 * Reverses exactly what the plan applied: overwritten values restore their
 * snapshots (only when the current value still matches what the installer
 * wrote — user edits win), merged arrays lose only the installer's entries,
 * rules blocks are removed, and files the installer created are deleted.
 */
export function uninstall(input: InstallerInput): string[] {
  const record = readRecord(input)
  if (record === undefined) {
    throw new Error(`No ${input.host} install is recorded for the ${input.scope} scope.`)
  }
  const lines: string[] = []
  for (const file of [...record.files].reverse()) {
    lines.push(...uninstallFile(file, record.host))
  }
  deleteRecord(input)
  pruneEmptyDir(stateDir(input, input.scope))
  lines.push(`removed install record (${input.host}, ${input.scope})`)
  return lines
}

/** Removes a directory only when it is empty, so pre-existing dirs with content stay. */
export function pruneEmptyDir(dir: string): void {
  try {
    rmdirSync(dir)
  } catch {
    // Not empty or already gone — nothing to prune.
  }
}

function uninstallFile(file: RecordedFile, host: HostName): string[] {
  const lines: string[] = []
  if (!existsSync(file.file)) {
    lines.push(`already absent: ${file.file}`)
    return lines
  }
  if (file.format === "rules") {
    const text = readFileSync(file.file, "utf8")
    if (!hasBlock(host, text)) {
      lines.push(`no rules block found in ${file.file}; left untouched`)
      return lines
    }
    const updated = removeBlock(host, text)
    if (updated.trim().length === 0) {
      unlinkSync(file.file)
      pruneEmptyDir(dirname(file.file))
      lines.push(`deleted ${file.file} (installer-created, now empty)`)
    } else {
      writeFileSync(file.file, updated)
      lines.push(`removed rules block from ${file.file}`)
    }
    return lines
  }
  const text = readFileSync(file.file, "utf8")
  if (file.format === "json") {
    const result = revertJsonOps(text, file.ops, file.createdParents ?? [])
    if (file.created && result.text.replace(/[{}\s]/g, "").length === 0) {
      unlinkSync(file.file)
      pruneEmptyDir(dirname(file.file))
      lines.push(`deleted ${file.file} (installer-created, now empty)`)
    } else {
      writeFileSync(file.file, result.text)
      lines.push(`reverted ${file.file}`)
    }
    lines.push(...result.notes.map((note) => `  note: ${note}`))
    return lines
  }
  let value = parseToml(text) as Record<string, unknown>
  const notes = revertTomlOps(value, file.ops)
  for (const parent of [...(file.createdParents ?? [])].reverse()) {
    const current = valueAt(value, parent)
    if (typeof current === "object" && current !== null && !Array.isArray(current) && Object.keys(current).length === 0) {
      removeKeyAt(value, parent)
    }
  }
  if (file.created && Object.keys(value).length === 0) {
    unlinkSync(file.file)
    pruneEmptyDir(dirname(file.file))
    lines.push(`deleted ${file.file} (installer-created, now empty)`)
  } else {
    writeFileSync(file.file, `${stringifyToml(value)}\n`)
    lines.push(`reverted ${file.file}`)
  }
  lines.push(...notes.map((note) => `  note: ${note}`))
  return lines
}
