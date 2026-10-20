import { existsSync, readFileSync } from "node:fs"
import { isPlainObject } from "./configValue"
import { removeBlock } from "./rules"
import type { HostName } from "./types"

/** Shared plan error: both capabilities off leaves nothing to install. */
export const BOTH_CAPABILITIES_OFF = "Both capabilities are off; nothing would be installed."

/**
 * Shared Forced-tier cost warning; the README's "Privacy and cost" section carries
 * the detail, so every host planner points at the same anchor.
 */
export const FORCED_COST_NOTE =
  "Forced routing is deterministic, and Search and Fetch are billed per successful request — " +
  'see the README\'s "Privacy and cost" section before applying.'

/** Shared note when a previous deepseek entry is being replaced. */
export function replacingExistingEntryNote(path: string): string {
  return `An existing ${path} entry is being replaced; its previous form is recorded for uninstall.`
}

/** Shared note for third-party servers left registered. */
export function othersStayRegisteredNote(others: readonly string[]): string {
  return `Other MCP servers stay registered (${others.join(", ")}); routing to DeepSeek is not exclusive while they offer web tools.`
}

const WEB_TOOL_HINT =
  /(web[_ -]?(search|fetch)|search|fetch|browse|scrape|crawl|tavily|brave|exa|perplexity|firecrawl|jina|serp|duckduckgo|reader)/i

/**
 * Heuristic web-capability test for a registered third-party MCP server, matching
 * the server's name plus its command/args/url. A false positive only costs a plan
 * note or an exclusion the user sees before --apply; a miss stays covered by the
 * "not exclusive while they offer web tools" note.
 */
export function looksWebCapable(name: string, entry: unknown): boolean {
  if (WEB_TOOL_HINT.test(name)) return true
  if (!isPlainObject(entry)) return false
  const command = typeof entry.command === "string" ? entry.command : ""
  const url = typeof entry.url === "string" ? entry.url : ""
  const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === "string").join(" ") : ""
  return WEB_TOOL_HINT.test(`${command} ${args} ${url}`)
}

const STEERING_HINT =
  /(web[_ ]?(search|fetch)|websearch|webfetch|tavily|exa|brave|perplexity|firecrawl|jina|serp|duckduckgo|google|bing)/i

/**
 * Detect-phase scan of the rules file the plan would write to: lines steering the
 * model toward another web tool. The installer's own marked block is excluded, and
 * deepseek mentions are ours to make, so both are ignored.
 */
export function findCompetitorSteering(host: HostName, file: string): string[] {
  if (!existsSync(file)) return []
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return []
  }
  return removeBlock(host, text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && STEERING_HINT.test(line) && !line.includes("deepseek"))
    .slice(0, 2)
}

/** Shared note for steering the detect phase found; conflicts are surfaced, not resolved. */
export function competitorSteeringNote(file: string, lines: readonly string[]): string {
  const quoted = lines.map((line) => `"${line}"`).join(", ")
  return `Existing rules in ${file} steer toward other web tools (${quoted}); the plan surfaces this conflict — it does not resolve it.`
}

/** Splits other registered servers into web-capable competitors and bystanders. */
export function splitCompetitors(
  servers: Record<string, unknown>,
): { readonly competitors: readonly string[]; readonly bystanders: readonly string[] } {
  const competitors: string[] = []
  const bystanders: string[] = []
  for (const [name, entry] of Object.entries(servers)) {
    if (name === "deepseek") continue
    ;(looksWebCapable(name, entry) ? competitors : bystanders).push(name)
  }
  return { competitors, bystanders }
}
