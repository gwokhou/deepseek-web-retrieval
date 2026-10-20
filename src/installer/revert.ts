import { existsSync, readFileSync, rmdirSync, unlinkSync } from "node:fs"
import { dirname } from "node:path"
import { codecFor, writeConfig } from "./formats"
import type { HostName, RecordedFile, RulesEdit } from "./types"

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
 * Per-format work belongs to the codecs; this skeleton owns the early-outs, the
 * deletion decisions, the pruning, and the messages.
 */
export function revertRecordedFile(file: RecordedFile, host: HostName, opts: { label: string; whole: boolean }): string[] {
  const lines: string[] = []
  if (!existsSync(file.file)) {
    lines.push(`already absent: ${file.file}${opts.label}`)
    return lines
  }
  const codec = codecFor(file.format, host)
  const text = readFileSync(file.file, "utf8")
  if (file.format === "rules") {
    const edit: RulesEdit = { file: file.file, format: "rules", block: file.blockApplied ?? "" }
    if (!codec.verify(text, edit)) {
      lines.push(`no rules block${opts.label} in ${file.file}; left untouched`)
      return lines
    }
    const updated = codec.revert(text, file).text
    if (codec.isEffectivelyEmpty(updated)) {
      unlinkSync(file.file)
      pruneEmptyDir(dirname(file.file))
      lines.push(`deleted ${file.file} (installer-created, now empty)`)
    } else {
      writeConfig(file.file, updated)
      lines.push(`removed rules block${opts.label} from ${file.file}`)
    }
    return lines
  }
  const reverted = codec.revert(text, file)
  if (opts.whole && file.created && codec.isEffectivelyEmpty(reverted.text)) {
    unlinkSync(file.file)
    pruneEmptyDir(dirname(file.file))
    lines.push(`deleted ${file.file} (installer-created, now empty)`)
  } else {
    writeConfig(file.file, reverted.text)
    lines.push(`reverted artifacts${opts.label} in ${file.file}`)
  }
  lines.push(...reverted.notes.map((note) => `  note: ${note}`))
  return lines
}
