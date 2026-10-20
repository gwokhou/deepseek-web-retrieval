import { codecFor } from "../formats"
import { isPlainObject } from "../formats/value"
import {
  FORCED_COST_NOTE,
  othersStayRegisteredNote,
  replacingExistingEntryNote,
  splitCompetitors,
} from "../detect"
import { join } from "../paths"
import { API_KEY_ENV, ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../../core/constants"
import { buildRulesBlock } from "../formats/rules"
import { MCP_TOOL_IDS, rulesLines } from "../rulesContent"
import { planHeader } from "./shared"
import type { ConfigOp, FileEdit, HostPaths, InstallRecord, InstallerInput, InstallPlan } from "../types"

/** Pi config and rules files per scope; the host module owns this mapping. */
function piPaths(input: InstallerInput): HostPaths {
  return input.scope === "global"
    ? { config: join(input.home, ".pi/agent/mcp.json"), rules: join(input.home, ".pi/agent/AGENTS.md") }
    : { config: join(input.cwd, ".pi/mcp.json"), rules: join(input.cwd, "AGENTS.md") }
}

export function planPi(input: InstallerInput, _previous: InstallRecord | undefined): InstallPlan {
  const paths = piPaths(input)
  const loaded = codecFor("json", input.host).load(paths.config)
  const tiers = { search: input.search, fetch: input.fetch }
  const header = planHeader(input, paths, loaded, "JSON")
  if (header.abort) {
    return { host: "pi", scope: input.scope, tiers, edits: [], notes: header.notes, errors: header.errors }
  }
  const notes = [...header.notes]
  const errors = [...header.errors]
  const edits: FileEdit[] = []

  const env: Record<string, string> = { [API_KEY_ENV]: "\${DEEPSEEK_API_KEY}" }
  if (input.search === "off") env[ENABLE_SEARCH_ENV] = "false"
  if (input.fetch === "off") env[ENABLE_FETCH_ENV] = "false"
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
    `\`${API_KEY_ENV}\` is written as "\${${API_KEY_ENV}}" so the key expands from the shell that launches Pi and stays out of the file.`,
  )
  if (loaded.lossy) {
    notes.push(`${paths.config} contains comments; the JSON edit preserves them.`)
  }

  if (input.search === "preferred" || input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      block: buildRulesBlock(input.host, rulesLines(MCP_TOOL_IDS, input.search, input.fetch)),
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
