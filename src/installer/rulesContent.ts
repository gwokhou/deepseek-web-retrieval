import type { Tier } from "./types"

/** Full MCP tool ids, per the installer design's rules non-negotiables. */
export const MCP_TOOL_IDS = { search: "mcp__deepseek__deepseek_web_search", fetch: "mcp__deepseek__deepseek_fetch" } as const

/**
 * Builds the rules block lines for the preferred tier: names the full tool ids,
 * states trigger conditions rather than unconditional preference, and lists the
 * private-network exclusion. Only mentions capabilities that are not "off".
 * Hosts whose tools are named differently pass their own ids.
 */
export function rulesLines(ids: { readonly search: string; readonly fetch: string }, search: Tier, fetch: Tier): string[] {
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
