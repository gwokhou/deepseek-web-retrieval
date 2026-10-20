import type { HostName } from "./types"

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
