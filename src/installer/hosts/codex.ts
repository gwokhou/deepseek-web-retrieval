import { spawnSync } from "node:child_process";
import { API_KEY_ENV } from "../../core/constants";
import { FORCED_COST_NOTE, othersStayRegisteredNote, replacingExistingEntryNote, splitCompetitors } from "../detect";
import { codecFor } from "../formats";
import { buildRulesBlock } from "../formats/rules";
import { isPlainObject } from "../formats/value";
import { join } from "../paths";
import { MCP_TOOL_IDS, RAW_MCP_TOOL_IDS, rulesLines } from "../rulesContent";
import type { ConfigOp, FileEdit, HostPaths, InstallerInput, InstallPlan, InstallRecord } from "../types";
import { planHeader } from "./shared";

/**
 * The Codex release this installer's facts are verified against — the lock in
 * docs/hosts.jsonc; the drift note fires when the probed CLI differs.
 */
export const CODEX_TESTED_VERSION = "0.163.0";

/**
 * The one subprocess the installer runs: `codex --version`, probed for the
 * version-drift note. A missing binary or unreadable output skips the check with
 * a stderr note and never blocks the plan — honor or report.
 */
export function probeCodexVersion(err: (line: string) => void): string | undefined {
  // env passed explicitly: runtime PATH edits (tests) must reach the lookup.
  const result = spawnSync("codex", ["--version"], { timeout: 5000, encoding: "utf8", env: process.env });
  const version = result.status === 0 ? parseCodexVersion(result.stdout ?? "") : undefined;
  if (version === undefined) {
    err("note: codex was not found on PATH or printed no version; the version-drift check was skipped");
  }
  return version;
}

/** Parses `codex --version` output (`codex-cli 0.163.0`) into the bare version. */
export function parseCodexVersion(output: string): string | undefined {
  return /\bcodex(?:-cli)?\s+(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
}

/** Codex config is user-level only; project scope keeps the rules file project-local. */
function codexPaths(input: InstallerInput): HostPaths {
  return {
    config: join(input.home, ".codex/config.toml"),
    rules: input.scope === "global" ? join(input.home, ".codex/AGENTS.md") : join(input.cwd, "AGENTS.md"),
  };
}

export function planCodex(input: InstallerInput, _previous: InstallRecord | undefined): InstallPlan {
  const paths = codexPaths(input);
  const loaded = codecFor("toml", input.host).load(paths.config);
  const tiers = { search: input.search, fetch: input.fetch };
  const header = planHeader(input, paths, loaded, "TOML");
  if (header.abort) {
    return { host: "codex", scope: input.scope, tiers, edits: [], notes: header.notes, errors: header.errors };
  }
  const notes = [...header.notes];
  const errors = [...header.errors];
  const edits: FileEdit[] = [];

  if (input.hostVersion !== undefined && input.hostVersion !== CODEX_TESTED_VERSION) {
    notes.push(
      `Codex ${input.hostVersion} is installed, but this installer's Codex facts are verified against ` +
        `${CODEX_TESTED_VERSION} (the docs/hosts.jsonc lock). Kill-switch and trap behavior may have drifted ` +
        "between the two — re-verify the tiers if routing misbehaves.",
    );
  }

  const tools = loaded.value.tools;
  if (isPlainObject(tools) && "web_search" in tools) {
    errors.push({
      message:
        `${paths.config} sets [tools] web_search, which is a silent no-op at Codex 0.163.0 (only the top-level ` +
        "web_search key controls the tool). Remove it first so the config cannot mislead.",
    });
  }

  const servers = loaded.value.mcp_servers;
  if (isPlainObject(servers)) {
    if ("deepseek" in servers) notes.push(replacingExistingEntryNote("mcp_servers.deepseek"));
    const { competitors, bystanders } = splitCompetitors(servers);
    if ((input.search === "forced" || input.fetch === "forced") && competitors.length > 0) {
      // Codex has no per-server kill switch (only per-tool enabled_tools/disabled_tools
      // inside a server), so a web-capable competitor cannot be excluded from the plan —
      // refuse the tier instead of promising routing that is not actually forced.
      errors.push({
        message:
          `Forced cannot deliver exclusive routing: [mcp_servers.${competitors.join("], [mcp_servers.")}] look(s) web-capable, ` +
          "and Codex offers no per-server kill switch. Remove the server(s), disable their tools by hand via their " +
          "disabled_tools key, or choose a lower tier.",
      });
    }
    const stayRegistered =
      input.search === "forced" || input.fetch === "forced" ? bystanders : [...competitors, ...bystanders];
    if (stayRegistered.length > 0) notes.push(othersStayRegisteredNote(stayRegistered));
  }

  const existingEntry = isPlainObject(servers) ? servers.deepseek : undefined;
  // The entry's disabled_tools key carries the user's own entries (ours filtered out)
  // plus the off tier's tool names, so re-inits and uninstall stay whole-entry ops —
  // an append inside a set op's subtree would break both verify and the drift check.
  const rawToolIds: readonly string[] = Object.values(RAW_MCP_TOOL_IDS);
  const keptDisabled =
    isPlainObject(existingEntry) && Array.isArray(existingEntry.disabled_tools)
      ? existingEntry.disabled_tools.filter(
          (name): name is string => typeof name === "string" && !rawToolIds.includes(name),
        )
      : [];
  const offDisabled = [
    ...(input.search === "off" ? [RAW_MCP_TOOL_IDS.search] : []),
    ...(input.fetch === "off" ? [RAW_MCP_TOOL_IDS.fetch] : []),
  ];
  const entry = {
    command: "npx",
    args: ["-y", input.packageRef],
    ...(keptDisabled.length > 0 || offDisabled.length > 0 ? { disabled_tools: [...keptDisabled, ...offDisabled] } : {}),
    env_vars: [API_KEY_ENV],
  };

  const ops: ConfigOp[] = [{ op: "set", path: ["mcp_servers", "deepseek"], value: entry, previous: existingEntry }];
  if (offDisabled.length > 0) {
    notes.push(
      `Off capabilities use Codex's own disabled_tools key (${offDisabled.join(", ")}): the tools are removed from ` +
        "the model's context while the server keeps running and stays re-enableable by deleting the entries.",
    );
  }
  if (input.search === "forced") {
    const previous = typeof loaded.value.web_search === "string" ? loaded.value.web_search : undefined;
    ops.push({ op: "set", path: ["web_search"], value: "disabled", previous });
    notes.push(
      previous === undefined
        ? 'web_search is being set to "disabled" (no previous value existed; the default is "cached").'
        : `web_search is being set to "disabled"; the previous value "${previous}" is snapshotted for uninstall.`,
    );
  }
  edits.push({ file: paths.config, format: "toml", shared: true, ops });

  notes.push(
    `Codex stdio children do not inherit the parent environment, so the entry forwards ${API_KEY_ENV} explicitly ` +
      "via env_vars; the key must be set in the shell that launches Codex.",
  );
  if (input.scope === "project") {
    notes.push(
      "Codex config lives in ~/.codex/config.toml only (user level), so the server registration and kill switch are " +
        "written there even for a project-scope install; the rules file stays project-local.",
    );
  }
  if (loaded.lossy) {
    notes.push(`${paths.config} contains comments; the TOML rewrite will drop them.`);
  }
  if (input.search === "forced" || input.fetch === "forced") {
    notes.push(
      `Forced search is exclusion: the built-in web_search tool is disabled ("disabled" mode). ${FORCED_COST_NOTE}`,
    );
  }
  if (input.search === "optional" || input.fetch === "optional") {
    notes.push(
      'Note: Codex ships a built-in web_search tool (default "cached" mode, an OpenAI index) that stays available ' +
        "alongside the DeepSeek tools under the optional tier.",
    );
  }

  if (input.search === "preferred" || input.fetch === "preferred") {
    edits.push({
      file: paths.rules,
      format: "rules",
      block: buildRulesBlock(input.host, rulesLines(MCP_TOOL_IDS, input.search, input.fetch)),
    });
    notes.push(
      input.scope === "global"
        ? `Rules block upserted in ${paths.rules}; Codex reads ~/.codex/AGENTS.md plus every AGENTS.md from the project root to the cwd.`
        : `Rules block upserted in ${paths.rules}; Codex reads every AGENTS.md from the project root to the cwd.`,
    );
  }

  return { host: "codex", scope: input.scope, tiers, edits, notes, errors };
}
