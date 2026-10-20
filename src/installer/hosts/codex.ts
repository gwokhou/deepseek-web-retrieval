import { loadConfig } from "../configFile"
import { hostPaths } from "../paths"
import { buildRulesBlock } from "../rules"
import { rulesLines } from "../rulesContent"
import type { ConfigOp, FileEdit, InstallerInput, InstallPlan } from "../types"

export function planCodex(input: InstallerInput): InstallPlan {
  const paths = hostPaths("codex", input)
  const loaded = loadConfig(paths.config, "toml")
  const notes: string[] = []
  const errors: { message: string }[] = []
  const edits: FileEdit[] = []
  const tiers = { search: input.search, fetch: input.fetch }

  if (loaded.parseError) {
    errors.push({ message: `${paths.config} exists but does not parse as TOML: ${loaded.parseError}` })
    return { host: "codex", scope: input.scope, tiers, edits, notes, errors }
  }
  if (input.search === "off" && input.fetch === "off") {
    errors.push({ message: "Both capabilities are off; nothing would be installed." })
  }

  const tools = loaded.value.tools
  if (typeof tools === "object" && tools !== null && !Array.isArray(tools) && "web_search" in tools) {
    errors.push({
      message:
        `${paths.config} sets [tools] web_search, which is a silent no-op at Codex 0.163.0 (only the top-level ` +
        "web_search key controls the tool). Remove it first so the config cannot mislead.",
    })
  }

  const servers = loaded.value.mcp_servers
  if (typeof servers === "object" && servers !== null && !Array.isArray(servers)) {
    if ("deepseek" in servers) {
      notes.push(
        "An existing mcp_servers.deepseek entry is being replaced; its previous form is recorded for uninstall.",
      )
    }
    const others = Object.keys(servers).filter((name) => name !== "deepseek")
    if (others.length > 0) {
      notes.push(
        `Other MCP servers stay registered (${others.join(", ")}); routing to DeepSeek is not exclusive while they offer web tools.`,
      )
    }
  }

  const env: Record<string, string> = {}
  if (input.search === "off") env.DEEPSEEK_ENABLE_SEARCH = "false"
  if (input.fetch === "off") env.DEEPSEEK_ENABLE_FETCH = "false"
  const entry = {
    command: "npx",
    args: ["-y", input.packageRef],
    ...(Object.keys(env).length > 0 ? { env } : {}),
    env_vars: ["DEEPSEEK_API_KEY"],
  }

  const existingEntry =
    typeof servers === "object" && servers !== null && !Array.isArray(servers)
      ? (servers as Record<string, unknown>).deepseek
      : undefined
  const ops: ConfigOp[] = [
    { op: "set", path: ["mcp_servers", "deepseek"], value: entry, previous: existingEntry },
  ]
  if (input.search === "forced") {
    const previous = typeof loaded.value.web_search === "string" ? loaded.value.web_search : undefined
    ops.push({ op: "set", path: ["web_search"], value: "disabled", previous })
    notes.push(
      previous === undefined
        ? "web_search is being set to \"disabled\" (no previous value existed; the default is \"cached\")."
        : `web_search is being set to "disabled"; the previous value "${previous}" is snapshotted for uninstall.`,
    )
  }
  edits.push({ file: paths.config, format: "toml", ops })

  notes.push(
    "Codex stdio children do not inherit the parent environment, so the entry forwards DEEPSEEK_API_KEY explicitly " +
      "via env_vars; the key must be set in the shell that launches Codex.",
  )
  if (input.scope === "project") {
    notes.push(
      "Codex config lives in ~/.codex/config.toml only (user level), so the server registration and kill switch are " +
      "written there even for a project-scope install; the rules file stays project-local.",
    )
  }
  if (loaded.lossy) {
    notes.push(`${paths.config} contains comments; the TOML rewrite will drop them.`)
  }
  if (input.search === "forced" || input.fetch === "forced") {
    notes.push(
      'Forced search is exclusion: the built-in web_search tool is disabled ("disabled" mode). Search and Fetch are ' +
        "billed per successful request.",
    )
  }
  if (input.search === "optional" || input.fetch === "optional") {
    notes.push(
      'Note: Codex ships a built-in web_search tool (default "cached" mode, an OpenAI index) that stays available ' +
        "alongside the DeepSeek tools under the optional tier.",
    )
  }

  if (input.search === "preferred" || input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      ops: [],
      block: buildRulesBlock(input.host, rulesLines("codex", input.search, input.fetch)),
    })
    notes.push(
      input.scope === "global"
        ? `Rules block upserted in ${paths.rules}; Codex reads ~/.codex/AGENTS.md plus every AGENTS.md from the project root to the cwd.`
        : `Rules block upserted in ${paths.rules}; Codex reads every AGENTS.md from the project root to the cwd.`,
    )
  }

  return { host: "codex", scope: input.scope, tiers, edits, notes, errors }
}
