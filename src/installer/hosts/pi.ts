import { loadConfig } from "../configFile"
import { hostPaths } from "../paths"
import { buildRulesBlock } from "../rules"
import { rulesLines } from "../rulesContent"
import type { FileEdit, InstallerInput, InstallPlan } from "../types"

const ENV_KEY = "DEEPSEEK_API_KEY"

export function planPi(input: InstallerInput): InstallPlan {
  const paths = hostPaths("pi", input)
  const loaded = loadConfig(paths.config, "json")
  const notes: string[] = []
  const errors: { message: string }[] = []
  const edits: FileEdit[] = []

  if (loaded.parseError) {
    errors.push({ message: `${paths.config} exists but does not parse as JSON: ${loaded.parseError}` })
    return { host: "pi", scope: input.scope, tiers: { search: input.search, fetch: input.fetch }, edits, notes, errors }
  }
  if (input.search === "off" && input.fetch === "off") {
    errors.push({ message: "Both capabilities are off; nothing would be installed." })
  }

  const env: Record<string, string> = { [ENV_KEY]: "\${DEEPSEEK_API_KEY}" }
  if (input.search === "off") env.DEEPSEEK_ENABLE_SEARCH = "false"
  if (input.fetch === "off") env.DEEPSEEK_ENABLE_FETCH = "false"
  const entry = {
    command: "npx",
    args: ["-y", input.packageRef],
    env,
    exposure: "direct",
    enabled: true,
  }

  const servers = loaded.value.mcpServers
  const existingEntry = isRecord(servers) ? servers.deepseek : undefined
  const ops = [
    { op: "set", path: ["mcpServers", "deepseek"], value: entry, previous: existingEntry } as const,
  ]
  edits.push({ file: paths.config, format: "json", ops })

  if (isRecord(servers)) {
    if (servers.deepseek !== undefined) {
      notes.push(
        "An existing mcpServers.deepseek entry is being replaced; its previous form is recorded for uninstall.",
      )
    }
    const others = Object.keys(servers).filter((name) => name !== "deepseek")
    if (others.length > 0) {
      notes.push(
        `Other MCP servers stay registered (${others.join(", ")}); routing to DeepSeek is not exclusive while they offer web tools.`,
      )
    }
  }
  notes.push('"exposure": "direct" is required: Pi 1.3.0 defaults MCP tools to codemode, which hides them from the model.')
  notes.push(
    `\`${ENV_KEY}\` is written as "\${${ENV_KEY}}" so the key expands from the shell that launches Pi and stays out of the file.`,
  )
  if (loaded.lossy) {
    notes.push(`${paths.config} contains comments; the JSON edit preserves them.`)
  }

  if (input.search === "preferred" || input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      ops: [],
      block: buildRulesBlock(input.host, rulesLines("pi", input.search, input.fetch)),
    })
    notes.push(`Rules block upserted in ${paths.rules}; Pi loads AGENTS.md context files from the working directory and its parents.`)
  }

  if (input.search === "forced" || input.fetch === "forced") {
    notes.push(
      "Forced tier: Pi 1.3.0 ships no built-in web tool, so the registered tools are the only web path (de-facto). " +
        "Search and Fetch are billed per successful request.",
    )
  }

  return { host: "pi", scope: input.scope, tiers: { search: input.search, fetch: input.fetch }, edits, notes, errors }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
