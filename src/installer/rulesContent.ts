import type { HostName, Tier } from "./types"

/** Full tool ids per host, per the installer design's rules non-negotiables. */
function toolIds(host: HostName): { search: string; fetch: string } {
  if (host === "opencode") return { search: "websearch (provider deepseek)", fetch: "deepseek_fetch" }
  return { search: "mcp__deepseek__deepseek_web_search", fetch: "mcp__deepseek__deepseek_fetch" }
}

/**
 * Builds the rules block lines for the preferred tier: names the full tool ids,
 * states trigger conditions rather than unconditional preference, and lists the
 * private-network exclusion. Only mentions capabilities that are not "off".
 */
export function rulesLines(host: HostName, search: Tier, fetch: Tier): string[] {
  const ids = toolIds(host)
  const lines: string[] = ["DeepSeek retrieval guidance:"]
  if (search !== "off") {
    lines.push(
      `- Use ${ids.search} when the task needs fresh external information: current docs, version numbers,`,
      "  changelogs, or anything you cannot know from the repository alone. Do not search for facts already",
      "  present locally.",
    )
  }
  if (fetch !== "off") {
    lines.push(
      `- Use ${ids.fetch} to read a specific public web page as Markdown when its content is needed.`,
    )
  }
  lines.push(
    "- Never send localhost or private-network URLs to the DeepSeek tools; use local tools for those (the",
    "  server blocks private hosts by default).",
    "- DeepSeek requests are billed per successful call; retrieve only what the task needs.",
  )
  return lines
}
