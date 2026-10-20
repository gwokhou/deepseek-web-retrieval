import { existsSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { revertJsonOps } from "./configFile"
import { pruneCreatedParents, revertTomlOps } from "./configValue"
import { hasBlock, removeBlock } from "./rules"
import type { HostName, RecordedFile } from "./types"

/** Removes a directory only when it is empty, so pre-existing dirs with content stay. */
export function pruneEmptyDir(dir: string): void {
  try {
    rmdirSync(dir)
  } catch {
    // Not empty or already gone — nothing to prune.
  }
}

/**
 * The single per-file revert, shared by uninstall (whole files, no label) and by
 * a superseding plan's orphan reverts (label names the previous init; `whole` is
 * false while the new plan still claims the file, so partial reverts never delete).
 */
export function revertRecordedFile(file: RecordedFile, host: HostName, opts: { label: string; whole: boolean }): string[] {
  const lines: string[] = []
  if (!existsSync(file.file)) {
    lines.push(`already absent: ${file.file}${opts.label}`)
    return lines
  }
  if (file.format === "rules") {
    const text = readFileSync(file.file, "utf8")
    if (!hasBlock(host, text)) {
      lines.push(`no rules block${opts.label} in ${file.file}; left untouched`)
      return lines
    }
    const updated = removeBlock(host, text)
    if (updated.trim().length === 0) {
      unlinkSync(file.file)
      pruneEmptyDir(dirname(file.file))
      lines.push(`deleted ${file.file} (installer-created, now empty)`)
    } else {
      writeFileSync(file.file, updated)
      lines.push(`removed rules block${opts.label} from ${file.file}`)
    }
    return lines
  }
  const text = readFileSync(file.file, "utf8")
  if (file.format === "json") {
    const result = revertJsonOps(text, file.ops, file.createdParents ?? [])
    if (opts.whole && file.created && result.text.replace(/[{}\s]/g, "").length === 0) {
      unlinkSync(file.file)
      pruneEmptyDir(dirname(file.file))
      lines.push(`deleted ${file.file} (installer-created, now empty)`)
    } else {
      writeFileSync(file.file, result.text)
      lines.push(`reverted artifacts${opts.label} in ${file.file}`)
    }
    lines.push(...result.notes.map((note) => `  note: ${note}`))
    return lines
  }
  const value = parseToml(text) as Record<string, unknown>
  const notes = revertTomlOps(value, file.ops)
  pruneCreatedParents(value, file.createdParents ?? [])
  if (opts.whole && file.created && Object.keys(value).length === 0) {
    unlinkSync(file.file)
    pruneEmptyDir(dirname(file.file))
    lines.push(`deleted ${file.file} (installer-created, now empty)`)
  } else {
    writeFileSync(file.file, `${stringifyToml(value)}\n`)
    lines.push(`reverted artifacts${opts.label} in ${file.file}`)
  }
  lines.push(...notes.map((note) => `  note: ${note}`))
  return lines
}
