import { existsSync, readFileSync } from "node:fs"
import type { HostName } from "../types"
import type { AppliedText, FormatCodec } from "./index"

/** Marked-block markers are per host, so multiple hosts can share one rules file. */
export function rulesMarkers(host: HostName): { readonly begin: string; readonly end: string } {
  return {
    begin: `<!-- deepseek-web-retrieval:${host}:rules:begin -->`,
    end: `<!-- deepseek-web-retrieval:${host}:rules:end -->`,
  }
}

/** Wraps rule lines in the host's marked block that apply upserts and uninstall remove. */
export function buildRulesBlock(host: HostName, lines: readonly string[]): string {
  const markers = rulesMarkers(host)
  return [markers.begin, ...lines, markers.end].join("\n")
}

/** Replaces the host's existing marked block, or appends one; keeps surrounding text intact. */
export function upsertBlock(host: HostName, text: string, block: string): string {
  const without = removeBlock(host, text)
  const trimmed = without.trimEnd()
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`
}

/** Removes the host's marked block if present; returns the text unchanged otherwise. */
export function removeBlock(host: HostName, text: string): string {
  const markers = rulesMarkers(host)
  const start = text.indexOf(markers.begin)
  if (start === -1) return text
  const end = text.indexOf(markers.end)
  if (end === -1) return text.slice(0, start)
  let after = text.slice(end + markers.end.length)
  // Drop the blank lines the upsert added around the block.
  after = after.replace(/^\n{1,2}/, "")
  const before = text.slice(0, start)
  return before.endsWith("\n\n") ? `${before.slice(0, -1)}${after}` : before + after
}

export function hasBlock(host: HostName, text: string): boolean {
  const markers = rulesMarkers(host)
  return text.includes(markers.begin) && text.includes(markers.end)
}

/** A rules codec is per host: its markers decide which block upsert, verify, and revert touch. */
export function rulesCodec(host: HostName): FormatCodec {
  return {
    format: "rules",
    load: (file) =>
      existsSync(file)
        ? { exists: true, text: readFileSync(file, "utf8"), value: {}, lossy: false }
        : { exists: false, text: "", value: {}, lossy: false },
    apply: (text, edit): AppliedText => {
      if (edit.format !== "rules") throw new Error(`rules codec cannot apply a ${edit.format} edit`)
      return { text: upsertBlock(host, text, edit.block), recorded: [], createdParents: [] }
    },
    // Rules files are markdown: the block's presence is the only postcondition.
    verify: (text) => hasBlock(host, text),
    revert: (text) => ({ text: removeBlock(host, text), notes: [] }),
    isEffectivelyEmpty: (text) => text.trim().length === 0,
  }
}
