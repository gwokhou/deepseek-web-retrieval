import { API_KEY_ENV, ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../../core/constants";
import { SETTINGS_NAMESPACE } from "../../pi/settings";
import {
  FORCED_COST_NOTE,
  looksLikeOwnPackage,
  looksWebCapable,
  othersStayRegisteredNote,
  replacingExistingEntryNote,
  splitCompetitors,
} from "../detect";
import { codecFor } from "../formats";
import { buildRulesBlock } from "../formats/rules";
import { isPlainObject } from "../formats/value";
import { lineageMatcher } from "../ownership";
import { join } from "../paths";
import { appendedByPrevious } from "../record";
import { MCP_TOOL_IDS, RAW_MCP_TOOL_IDS, rulesLines } from "../rulesContent";
import type { ConfigOp, FileEdit, HostPaths, InstallerInput, InstallPlan, InstallRecord, PlanError } from "../types";
import { planHeader } from "./shared";

/** Pi config and rules files per scope and path; the host module owns this mapping. */
function piPaths(input: InstallerInput): HostPaths {
  const mcp = input.scope === "global" ? join(input.home, ".pi/agent/mcp.json") : join(input.cwd, ".pi/mcp.json");
  const settings =
    input.scope === "global" ? join(input.home, ".pi/agent/settings.json") : join(input.cwd, ".pi/settings.json");
  const rules = input.scope === "global" ? join(input.home, ".pi/agent/AGENTS.md") : join(input.cwd, "AGENTS.md");
  return { config: input.path === "mcp" ? mcp : settings, rules };
}

/**
 * The packages source this init writes: a ref that already carries Pi's `npm:`
 * source prefix goes through as-is (wrapping it again would produce the broken
 * `npm:npm:…` form); anything else — bare names, name@spec, npm specs like
 * `file:` or `github:` — becomes an npm source.
 */
function piSourceRef(packageRef: string): string {
  return packageRef.startsWith("npm:") ? packageRef : `npm:${packageRef}`;
}

/** Both Pi paths write the same rules note; one wording so the paths cannot drift. */
const rulesUpsertNote = (rules: string) =>
  `Rules block upserted in ${rules}; Pi loads AGENTS.md context files from the working directory and its parents.`;

/** Forced tier, both paths: with no built-in web tool to displace, routing is de-facto exclusive. */
const FORCED_NO_BUILTIN_NOTE =
  "Forced tier: Pi 1.3.0 ships no built-in web tool, so the registered tools are the only web path (de-facto). " +
  FORCED_COST_NOTE;

export function planPi(input: InstallerInput, previous: InstallRecord | undefined): InstallPlan {
  return input.path === "mcp" ? planPiMcp(input) : planPiExtension(input, previous);
}

/**
 * The native-extension path (Pi's default): registers the package in
 * settings.json's `packages` array; Pi resolves the source at session start
 * and loads `src/pi/extension.ts` through the package's `pi` manifest.
 */
function planPiExtension(input: InstallerInput, previous: InstallRecord | undefined): InstallPlan {
  const paths = piPaths(input);
  const loaded = codecFor("json", input.host).load(paths.config);
  const tiers = { search: input.search, fetch: input.fetch };
  const header = planHeader(input, paths, loaded, "JSON");
  if (header.abort) {
    return { host: "pi", scope: input.scope, tiers, edits: [], notes: header.notes, errors: header.errors };
  }
  const notes = [...header.notes];
  const errors = [...header.errors];
  const edits: FileEdit[] = [];

  const packages = Array.isArray(loaded.value.packages) ? loaded.value.packages : [];
  const source = piSourceRef(input.packageRef);
  // Precisely ours: what a tracked init appended, plus what this init would write.
  // Sources compare by package name (samePackageName), so a pinned source
  // excuses the unpinned lineage a previous init wrote and vice versa. Only a
  // tracked init can excuse a same-name source — without a record, even an
  // exact match is an untracked install this installer must not adopt silently.
  const trackedSources = appendedByPrevious(previous, ["packages"]).filter(
    (entry): entry is string => typeof entry === "string",
  );
  const sources = packages.filter((entry): entry is string => typeof entry === "string");
  const excusedSources = previous === undefined ? [] : [...trackedSources, source];
  const isExcusedSource = lineageMatcher(excusedSources);
  const foreignOwn = sources.filter((entry) => looksLikeOwnPackage(entry) && !isExcusedSource(entry));
  if (foreignOwn.length > 0) {
    errors.push({
      message:
        `${paths.config} already lists ${foreignOwn.join(", ")} — this package (or a fork of it) that this installer did not ` +
        "write. Remove it (pi remove <source>, or uninstall if it came from a previous init), then retry.",
    });
  }
  if (previous !== undefined && sources.some((entry) => isExcusedSource(entry))) {
    notes.push(
      "A previous init wrote the packages entry; re-applying reuses it (an unchanged source deduplicates, a changed " +
        "--package ref replaces the old source) and the original snapshots carry over.",
    );
  }

  const forced = input.search === "forced" || input.fetch === "forced";
  if (forced) {
    // Pi has no per-package kill switch in settings.json, so a web-capable
    // package or extension source cannot be excluded from the plan — refuse the
    // tier instead of promising routing that is not actually forced.
    const isOwnSource = lineageMatcher([...trackedSources, source]);
    const unexcludable = [...collectSources(loaded.value.packages), ...collectSources(loaded.value.extensions)].filter(
      (entry) => !isOwnSource(entry) && looksWebCapable(entry, undefined),
    );
    if (unexcludable.length > 0) {
      errors.push({
        message:
          `Forced cannot deliver exclusive routing: settings sources ${unexcludable.join(", ")} look web-capable, ` +
          "and Pi offers no per-package kill switch. Remove them (pi remove <source>) or choose a lower tier.",
      });
    }
  }

  if (errors.length > 0) {
    return { host: "pi", scope: input.scope, tiers, edits: [], notes, errors };
  }

  const ops: ConfigOp[] = [
    { op: "append-array", path: ["packages"], entries: [source], existingCount: packages.length },
  ];
  const namespace = isPlainObject(loaded.value[SETTINGS_NAMESPACE]) ? loaded.value[SETTINGS_NAMESPACE] : {};
  if (input.search === "off") {
    ops.push({
      op: "set",
      path: [SETTINGS_NAMESPACE, "enableSearch"],
      value: false,
      previous: typeof namespace.enableSearch === "boolean" ? namespace.enableSearch : undefined,
    });
  }
  if (input.fetch === "off") {
    ops.push({
      op: "set",
      path: [SETTINGS_NAMESPACE, "enableFetch"],
      value: false,
      previous: typeof namespace.enableFetch === "boolean" ? namespace.enableFetch : undefined,
    });
  }
  edits.push({
    file: paths.config,
    format: "json",
    // Global-scope files live outside the install record's config home, so they
    // need the owner sidecar that stops a second install (another project or
    // XDG_CONFIG_HOME) from claiming them — the codex topology.
    ...(input.scope === "global" ? { shared: true as const } : {}),
    ops,
  });

  notes.push(
    "Pi resolves the packages source at session start; the first launch after apply fetches the package from npm " +
      "(pi update --extensions refreshes it later).",
  );
  notes.push(
    `The extension reads ${API_KEY_ENV} from the Pi process environment; no env forwarding is needed. ` +
      "Set it in the shell that launches Pi.",
  );
  if (input.search === "off" || input.fetch === "off") {
    notes.push(
      `Off capability switches are written into the "${SETTINGS_NAMESPACE}" settings namespace; the extension ` +
        "reads them at load (they outrank the DEEPSEEK_ENABLE_* environment variables).",
    );
  }
  notes.push(
    'Extension tools are declared to the model with exposure "direct" by Pi\'s own default; no exposure key is needed.',
  );

  if (forced) {
    edits.push(...planMcpCompetitorDisables(input, notes, errors));
  }
  if (errors.length > 0) {
    return { host: "pi", scope: input.scope, tiers, edits: [], notes, errors };
  }

  if (input.search === "preferred" || input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      block: buildRulesBlock(input.host, rulesLines(RAW_MCP_TOOL_IDS, input.search, input.fetch)),
    });
    notes.push(rulesUpsertNote(paths.rules));
  }

  if (forced) {
    notes.push(FORCED_NO_BUILTIN_NOTE);
  }

  return { host: "pi", scope: input.scope, tiers, edits, notes, errors };
}

/**
 * Disables web-capable MCP competitors for the forced tier: one `enabled:
 * false` op per server (Pi entries carry an `enabled` key), each snapshotting
 * its prior value for uninstall. Shared by both Pi paths — the MCP path folds
 * the ops into its own mcp.json edit, the extension path opens a separate one.
 */
function planCompetitorDisables(
  servers: Record<string, unknown>,
  competitors: readonly string[],
  notes: string[],
  errors: PlanError[],
): readonly ConfigOp[] {
  const ops: ConfigOp[] = [];
  const excluded: string[] = [];
  const unexcludable: string[] = [];
  for (const name of competitors) {
    const current = servers[name];
    if (!isPlainObject(current)) {
      unexcludable.push(name);
      continue;
    }
    const previous = typeof current.enabled === "boolean" ? current.enabled : undefined;
    // Keep the op even when already disabled: a re-init must retain the claim
    // and original snapshot, otherwise orphan reverts would re-enable it.
    ops.push({ op: "set", path: ["mcpServers", name, "enabled"], value: false, previous });
    excluded.push(name);
  }
  if (excluded.length > 0) {
    notes.push(
      `Forced tier: web-capable MCP servers are disabled so DeepSeek routing is exclusive (${excluded.join(", ")}; ` +
        "prior enabled values are snapshotted for uninstall).",
    );
  }
  if (unexcludable.length > 0) {
    errors.push({
      message:
        `Forced cannot deliver exclusive routing: mcpServers entries ${unexcludable.join(", ")} look web-capable ` +
        "but are not objects, so the plan cannot set their enabled key. Fix or remove them, or choose a lower tier.",
    });
  }
  return ops;
}

/** Disables web-capable MCP servers for the forced tier; the extension path still shares the field with them. */
function planMcpCompetitorDisables(input: InstallerInput, notes: string[], errors: PlanError[]): FileEdit[] {
  const mcpFile = input.scope === "global" ? join(input.home, ".pi/agent/mcp.json") : join(input.cwd, ".pi/mcp.json");
  const loaded = codecFor("json", input.host).load(mcpFile);
  if (loaded.parseError) {
    errors.push({ message: `${mcpFile} does not parse: ${loaded.parseError}` });
    return [];
  }
  const servers = isPlainObject(loaded.value.mcpServers) ? loaded.value.mcpServers : undefined;
  if (!isPlainObject(servers)) return [];

  const { competitors, bystanders } = splitCompetitors(servers);
  const edits: FileEdit[] = [];
  if (competitors.length > 0) {
    const ops = planCompetitorDisables(servers, competitors, notes, errors);
    if (ops.length > 0) {
      edits.push({
        file: mcpFile,
        format: "json",
        ...(input.scope === "global" ? { shared: true as const } : {}),
        ops,
      });
    }
  }
  if (bystanders.length > 0) notes.push(othersStayRegisteredNote(bystanders));
  return edits;
}

/** The MCP-server path (`--path mcp`): registers the stdio server in mcp.json. */
function planPiMcp(input: InstallerInput): InstallPlan {
  const paths = piPaths(input);
  const loaded = codecFor("json", input.host).load(paths.config);
  const tiers = { search: input.search, fetch: input.fetch };
  const header = planHeader(input, paths, loaded, "JSON");
  if (header.abort) {
    return { host: "pi", scope: input.scope, tiers, edits: [], notes: header.notes, errors: header.errors };
  }
  const notes = [...header.notes];
  const errors = [...header.errors];
  const edits: FileEdit[] = [];

  const env: Record<string, string> = { [API_KEY_ENV]: `\${${API_KEY_ENV}}` };
  if (input.search === "off") env[ENABLE_SEARCH_ENV] = "false";
  if (input.fetch === "off") env[ENABLE_FETCH_ENV] = "false";
  const entry = {
    command: "npx",
    args: ["-y", input.packageRef],
    env,
    exposure: "direct",
    enabled: true,
  };

  const servers = loaded.value.mcpServers;
  const existingEntry = isPlainObject(servers) ? servers.deepseek : undefined;
  const ops: ConfigOp[] = [{ op: "set", path: ["mcpServers", "deepseek"], value: entry, previous: existingEntry }];
  edits.push({
    file: paths.config,
    format: "json",
    // Same shared-file reason as the extension path's settings.json above.
    ...(input.scope === "global" ? { shared: true as const } : {}),
    ops,
  });

  if (isPlainObject(servers)) {
    if (servers.deepseek !== undefined) notes.push(replacingExistingEntryNote("mcpServers.deepseek"));
    const { competitors, bystanders } = splitCompetitors(servers);
    const forced = input.search === "forced" || input.fetch === "forced";
    if (forced) {
      ops.push(...planCompetitorDisables(servers, competitors, notes, errors));
    }
    const stayRegistered = forced ? bystanders : [...competitors, ...bystanders];
    if (stayRegistered.length > 0) notes.push(othersStayRegisteredNote(stayRegistered));
  }
  notes.push(
    '"exposure": "direct" is required: Pi 1.3.0 defaults MCP tools to codemode, which hides them from the model.',
  );
  notes.push(
    `\`${API_KEY_ENV}\` is written as "\${${API_KEY_ENV}}" so the key expands from the shell that launches Pi and stays out of the file.`,
  );

  if (input.search === "preferred" || input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      block: buildRulesBlock(input.host, rulesLines(MCP_TOOL_IDS, input.search, input.fetch)),
    });
    notes.push(rulesUpsertNote(paths.rules));
  }

  if (input.search === "forced" || input.fetch === "forced") {
    notes.push(FORCED_NO_BUILTIN_NOTE);
  }

  return { host: "pi", scope: input.scope, tiers, edits, notes, errors };
}

/** Pulls the string sources out of a settings packages/extensions array. */
function collectSources(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
