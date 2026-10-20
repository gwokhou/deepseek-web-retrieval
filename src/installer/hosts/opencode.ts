import { codecFor } from "../formats"
import { isPlainObject } from "../formats/value"
import { BOTH_CAPABILITIES_OFF, FORCED_COST_NOTE, competitorSteeringNote, findCompetitorSteering } from "../detect"
import { hostPaths } from "../paths"
import { buildRulesBlock } from "../formats/rules"
import { rulesLines } from "../rulesContent"
import { readRecord } from "../state"
import type { ConfigOp, FileEdit, InstallerInput, InstallPlan } from "../types"

export function planOpenCode(input: InstallerInput): InstallPlan {
  const paths = hostPaths("opencode", input)
  const loaded = codecFor("json", input.host).load(paths.config)
  const notes: string[] = []
  const errors: { message: string }[] = []
  const edits: FileEdit[] = []
  const tiers = { search: input.search, fetch: input.fetch }

  if (loaded.parseError) {
    errors.push({ message: `${paths.config} exists but does not parse as JSONC: ${loaded.parseError}` })
    return { host: "opencode", scope: input.scope, tiers, edits, notes, errors }
  }

  if (input.search === "preferred") {
    errors.push({
      message:
        "OpenCode search has no preferred tier: the websearch provider is host-level config, so the model never " +
        "chooses between engines. Use --search optional (provider registered, built-in stays default), " +
        "--search forced (replace the engine), or --search off.",
    })
  }
  if (input.search === "off" && input.fetch === "off") {
    errors.push({ message: BOTH_CAPABILITIES_OFF })
  }

  const steering = findCompetitorSteering("opencode", paths.rules)
  if (steering.length > 0) notes.push(competitorSteeringNote(paths.rules, steering))

  const plugins = Array.isArray(loaded.value.plugins) ? loaded.value.plugins : []
  const alreadyInstalled = plugins.some(
    (entry) => isPlainObject(entry) && typeof entry.package === "string" && entry.package.includes("deepseek-web-retrieval"),
  )
  if (alreadyInstalled && readRecord(input) === undefined) {
    errors.push({
      message:
        `${paths.config} already has a plugins entry referencing deepseek-web-retrieval that this installer did not ` +
        "write. Remove it (or run uninstall if it came from a previous init), then retry.",
    })
  }
  if (alreadyInstalled && errors.length === 0) {
    notes.push("A previous init wrote the plugins entry; re-applying updates it and carries the original snapshots over.")
  }
  if (errors.length > 0) {
    return { host: "opencode", scope: input.scope, tiers, edits, notes, errors }
  }

  const options: Record<string, unknown> = {}
  if (input.search === "forced") options.setDefaultWebsearch = true
  if (input.search === "off") options.searchEnabled = false
  if (input.fetch === "forced") options.fetchOverrideWebfetch = true
  if (input.fetch === "off") options.fetchEnabled = false

  const ops: ConfigOp[] = [
    {
      op: "append-array",
      path: ["plugins"],
      entries: [{ package: input.packageRef, options }],
      existingCount: plugins.length,
    },
  ]

  const permissions: Record<string, unknown>[] = []
  if (input.search !== "off") permissions.push({ action: "websearch", resource: "*", effect: "allow" })
  if (input.fetch !== "off") permissions.push({ action: "deepseek_fetch", resource: "*", effect: "allow" })
  if (input.fetch === "forced") permissions.push({ action: "webfetch", resource: "*", effect: "allow" })
  const existingPermissions = Array.isArray(loaded.value.permissions) ? loaded.value.permissions.length : 0
  if (permissions.length > 0) {
    ops.push({ op: "append-array", path: ["permissions"], entries: permissions, existingCount: existingPermissions })
  }

  if (input.search === "forced") {
    const currentProvider = isPlainObject(loaded.value.websearch) ? loaded.value.websearch.provider : undefined
    ops.push({ op: "set", path: ["websearch", "provider"], value: "deepseek", previous: currentProvider })
    notes.push(
      currentProvider === undefined
        ? "websearch.provider is being set to deepseek (no previous value existed)."
        : `websearch.provider is being set to deepseek; the previous value "${String(currentProvider)}" is snapshotted for uninstall.`,
    )
  }

  edits.push({ file: paths.config, format: "json", ops })

  notes.push(
    "The plugin entry uses the object form so options are honored; auto-discovered plugins cannot receive options.",
  )
  if (input.search === "optional") {
    notes.push(
      "Search tier optional: the deepseek provider is registered but the built-in provider stays the default engine; " +
        "set websearch.provider to deepseek (or rerun with --search forced) to route search through DeepSeek.",
    )
  }
  if (input.search === "forced" || input.fetch === "forced") {
    notes.push("Forced tier replaces built-in routing. " + FORCED_COST_NOTE)
  }

  if (input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      block: buildRulesBlock(input.host, rulesLines("opencode", input.search, input.fetch)),
    })
    notes.push(`Rules block upserted in ${paths.rules}; OpenCode loads AGENTS.md only (no CLAUDE.md fallback in v2).`)
  }

  return { host: "opencode", scope: input.scope, tiers, edits, notes, errors }
}
