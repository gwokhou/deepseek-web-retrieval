import { FORCED_COST_NOTE, looksLikeOwnPackage } from "../detect";
import { codecFor } from "../formats";
import { buildRulesBlock } from "../formats/rules";
import { isPlainObject } from "../formats/value";
import { lineageMatcher } from "../ownership";
import { configHome, join } from "../paths";
import { rulesLines } from "../rulesContent";
import { appendedByPrevious } from "../state";
import type { ConfigOp, FileEdit, HostPaths, InstallerInput, InstallPlan, InstallRecord } from "../types";
import { planHeader } from "./shared";

/** OpenCode's tools are named differently from the raw MCP ids. */
const OPENCODE_TOOL_IDS = { search: "websearch (provider deepseek)", fetch: "deepseek_fetch" } as const;

/** OpenCode config and rules files per scope; the host module owns this mapping. */
function opencodePaths(input: InstallerInput): HostPaths {
  return input.scope === "global"
    ? {
        config: join(configHome(input), "opencode/opencode.jsonc"),
        rules: join(configHome(input), "opencode/AGENTS.md"),
      }
    : { config: join(input.cwd, "opencode.jsonc"), rules: join(input.cwd, "AGENTS.md") };
}

export function planOpenCode(input: InstallerInput, previous: InstallRecord | undefined): InstallPlan {
  const paths = opencodePaths(input);
  const loaded = codecFor("json", input.host).load(paths.config);
  const tiers = { search: input.search, fetch: input.fetch };
  const header = planHeader(input, paths, loaded, "JSONC");
  if (header.abort) {
    return { host: "opencode", scope: input.scope, tiers, edits: [], notes: header.notes, errors: header.errors };
  }
  const notes = [...header.notes];
  const errors = [...header.errors];
  const edits: FileEdit[] = [];

  if (input.search === "preferred") {
    errors.push({
      message:
        "OpenCode search has no preferred tier: the websearch provider is host-level config, so the model never " +
        "chooses between engines. Use --search optional (provider registered, built-in stays default), " +
        "--search forced (replace the engine), or --search off.",
    });
  }

  const plugins = Array.isArray(loaded.value.plugins) ? loaded.value.plugins : [];
  // Precisely ours: plugin packages a tracked init appended, plus this init's ref.
  // Refs compare by package name (samePackageName), so a pinned ref excuses the
  // unpinned lineage a previous init wrote and vice versa. Without a record
  // nothing is excused — an untracked same-name plugin (a fork registers the
  // same tool ids and would collide) must be removed first.
  const trackedPackages = new Set(
    appendedByPrevious(previous, ["plugins"])
      .filter((entry): entry is { package: string } => isPlainObject(entry) && typeof entry.package === "string")
      .map((entry) => entry.package),
  );
  const pluginPackages = plugins.filter(
    (entry): entry is { package: string } => isPlainObject(entry) && typeof entry.package === "string",
  );
  const excusedRefs = previous === undefined ? [] : [...trackedPackages, input.packageRef];
  const isExcusedRef = lineageMatcher(excusedRefs);
  const foreignOwn = pluginPackages.filter(
    (entry) => looksLikeOwnPackage(entry.package) && !isExcusedRef(entry.package),
  );
  if (foreignOwn.length > 0) {
    errors.push({
      message:
        `${paths.config} already has a plugins entry referencing deepseek-web-retrieval that this installer did not ` +
        "write. Remove it (or run uninstall if it came from a previous init), then retry.",
    });
  }
  if (previous !== undefined && pluginPackages.some((entry) => isExcusedRef(entry.package))) {
    notes.push(
      "A previous init wrote the plugins entry; re-applying keeps it the only entry (a changed package ref or tier " +
        "options replace it, an unchanged one is a no-op) and the original snapshots carry over.",
    );
  }
  if (errors.length > 0) {
    return { host: "opencode", scope: input.scope, tiers, edits, notes, errors };
  }

  const options: Record<string, unknown> = {};
  if (input.search === "forced") options.setDefaultWebsearch = true;
  if (input.search === "off") options.searchEnabled = false;
  if (input.fetch === "forced") options.fetchOverrideWebfetch = true;
  if (input.fetch === "off") options.fetchEnabled = false;

  const ops: ConfigOp[] = [
    {
      op: "append-array",
      path: ["plugins"],
      entries: [{ package: input.packageRef, options }],
      existingCount: plugins.length,
    },
  ];

  const permissions: Record<string, unknown>[] = [];
  if (input.search !== "off") permissions.push({ action: "websearch", resource: "*", effect: "allow" });
  if (input.fetch !== "off") permissions.push({ action: "deepseek_fetch", resource: "*", effect: "allow" });
  if (input.fetch === "forced") permissions.push({ action: "webfetch", resource: "*", effect: "allow" });
  const existingPermissions = Array.isArray(loaded.value.permissions) ? loaded.value.permissions.length : 0;
  if (permissions.length > 0) {
    ops.push({ op: "append-array", path: ["permissions"], entries: permissions, existingCount: existingPermissions });
  }

  if (input.search === "forced") {
    const currentProvider = isPlainObject(loaded.value.websearch) ? loaded.value.websearch.provider : undefined;
    ops.push({ op: "set", path: ["websearch", "provider"], value: "deepseek", previous: currentProvider });
    notes.push(
      currentProvider === undefined
        ? "websearch.provider is being set to deepseek (no previous value existed)."
        : `websearch.provider is being set to deepseek; the previous value "${String(currentProvider)}" is snapshotted for uninstall.`,
    );
  }

  edits.push({ file: paths.config, format: "json", ops });

  notes.push(
    "The plugin entry uses the object form so options are honored; auto-discovered plugins cannot receive options.",
  );
  if (input.search === "optional") {
    notes.push(
      "Search tier optional: the deepseek provider is registered but the built-in provider stays the default engine; " +
        "set websearch.provider to deepseek (or rerun with --search forced) to route search through DeepSeek.",
    );
  }
  if (input.search === "forced" || input.fetch === "forced") {
    notes.push(`Forced tier replaces built-in routing. ${FORCED_COST_NOTE}`);
  }

  if (input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      block: buildRulesBlock(input.host, rulesLines(OPENCODE_TOOL_IDS, input.search, input.fetch)),
    });
    notes.push(`Rules block upserted in ${paths.rules}; OpenCode loads AGENTS.md only (no CLAUDE.md fallback in v2).`);
  }

  return { host: "opencode", scope: input.scope, tiers, edits, notes, errors };
}
