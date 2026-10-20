import { loadConfig } from "../configFile"
import { isPlainObject } from "../configValue"
import {
  BOTH_CAPABILITIES_OFF,
  FORCED_COST_NOTE,
  competitorSteeringNote,
  findCompetitorSteering,
  othersStayRegisteredNote,
  replacingExistingEntryNote,
  splitCompetitors,
} from "../detect"
import { hostPaths } from "../paths"
import { buildRulesBlock } from "../rules"
import { rulesLines } from "../rulesContent"
import type { ConfigOp, FileEdit, InstallerInput, InstallPlan } from "../types"

const ENV_KEY = "DEEPSEEK_API_KEY"

export function planPi(input: InstallerInput): InstallPlan {
  const paths = hostPaths("pi", input)
  const loaded = loadConfig(paths.config, "json")
  const notes: string[] = []
  const errors: { message: string }[] = []
  const edits: FileEdit[] = []
  const tiers = { search: input.search, fetch: input.fetch }

  if (loaded.parseError) {
    errors.push({ message: `${paths.config} exists but does not parse as JSON: ${loaded.parseError}` })
    return { host: "pi", scope: input.scope, tiers, edits, notes, errors }
  }
  if (input.search === "off" && input.fetch === "off") {
    errors.push({ message: BOTH_CAPABILITIES_OFF })
  }

  const steering = findCompetitorSteering("pi", paths.rules)
  if (steering.length > 0) notes.push(competitorSteeringNote(paths.rules, steering))

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
  const existingEntry = isPlainObject(servers) ? servers.deepseek : undefined
  const ops: ConfigOp[] = [
    { op: "set", path: ["mcpServers", "deepseek"], value: entry, previous: existingEntry },
  ]
  edits.push({ file: paths.config, format: "json", ops })

  if (isPlainObject(servers)) {
    if (servers.deepseek !== undefined) notes.push(replacingExistingEntryNote("mcpServers.deepseek"))
    const { competitors, bystanders } = splitCompetitors(servers)
    const forced = input.search === "forced" || input.fetch === "forced"
    if (forced) {
      // Forced demands exclusivity: disable the web-capable competitors (Pi entries
      // carry an `enabled` key), snapshotting each prior value for uninstall.
      const excluded: string[] = []
      const unexcludable: string[] = []
      for (const name of competitors) {
        const current = servers[name]
        if (!isPlainObject(current)) {
          unexcludable.push(name)
          continue
        }
        const previous = typeof current.enabled === "boolean" ? current.enabled : undefined
        if (previous === false) continue // already excluded
        ops.push({ op: "set", path: ["mcpServers", name, "enabled"], value: false, previous })
        excluded.push(name)
      }
      if (excluded.length > 0) {
        notes.push(
          `Forced tier: web-capable MCP servers are disabled so DeepSeek routing is exclusive (${excluded.join(", ")}; ` +
            "prior enabled values are snapshotted for uninstall).",
        )
      }
      if (unexcludable.length > 0) {
        errors.push({
          message:
            `Forced cannot deliver exclusive routing: mcpServers entries ${unexcludable.join(", ")} look web-capable ` +
            "but are not objects, so the plan cannot set their enabled key. Fix or remove them, or choose a lower tier.",
        })
      }
    }
    const stayRegistered = forced ? bystanders : [...competitors, ...bystanders]
    if (stayRegistered.length > 0) notes.push(othersStayRegisteredNote(stayRegistered))
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
        FORCED_COST_NOTE,
    )
  }

  return { host: "pi", scope: input.scope, tiers, edits, notes, errors }
}
