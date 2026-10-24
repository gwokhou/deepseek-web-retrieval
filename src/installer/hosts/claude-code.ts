import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { API_KEY_ENV } from "../../core/constants";
import { FORCED_COST_NOTE, othersStayRegisteredNote, replacingExistingEntryNote, splitCompetitors } from "../detect";
import { codecFor, type LoadedConfig } from "../formats";
import { buildRulesBlock } from "../formats/rules";
import { isPlainObject } from "../formats/value";
import { join } from "../paths";
import { MCP_TOOL_IDS, rulesLines } from "../rulesContent";
import type { ConfigOp, FileEdit, HostPaths, InstallerInput, InstallPlan, InstallRecord } from "../types";
import { planHeader } from "./shared";

/**
 * The Claude Code release this installer's facts are verified against — the lock in
 * docs/hosts.jsonc; the drift note fires when the probed CLI differs.
 */
export const CLAUDE_CODE_TESTED_VERSION = "2.1.303";

/** The built-in web tools the forced tier denies; bare names remove them from context. */
const BUILTIN_TOOL_IDS = { search: "WebSearch", fetch: "WebFetch" } as const;

/** Human name for a wrong-typed config value in plan errors ("an array", "a string"). */
function valueKind(value: unknown): string {
  return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}

/**
 * The one subprocess the installer runs: `claude --version`, probed for the
 * version-drift note. A missing binary or unreadable output skips the check with
 * a stderr note and never blocks the plan — honor or report.
 */
export function probeClaudeCodeVersion(err: (line: string) => void): string | undefined {
  // env passed explicitly: runtime PATH edits (tests) must reach the lookup.
  const result = spawnSync("claude", ["--version"], { timeout: 5000, encoding: "utf8", env: process.env });
  const version = result.status === 0 ? parseClaudeCodeVersion(result.stdout ?? "") : undefined;
  if (version === undefined) {
    err("note: claude was not found on PATH or printed no version; the version-drift check was skipped");
  }
  return version;
}

/**
 * Parses `claude --version` output (`2.1.303 (Claude Code)`) into the bare version.
 * The last semver wins: an update banner advertising a newer release must not
 * anchor the drift note on the wrong number.
 */
export function parseClaudeCodeVersion(output: string): string | undefined {
  return [...output.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((match) => match[0]).at(-1);
}

/**
 * Claude Code config, settings, and rules files per scope; the host module owns
 * this mapping. MCP registration and the settings file are disjoint per scope
 * (project: `.mcp.json` + `.claude/settings.json`; global: `~/.claude.json` +
 * `~/.claude/settings.json`), so the two scopes can coexist unlike Codex's.
 */
function claudeCodePaths(input: InstallerInput): HostPaths & { readonly settings: string } {
  return input.scope === "global"
    ? {
        config: join(input.home, ".claude.json"),
        settings: join(input.home, ".claude", "settings.json"),
        rules: join(input.home, ".claude", "CLAUDE.md"),
      }
    : {
        config: join(input.cwd, ".mcp.json"),
        settings: join(input.cwd, ".claude", "settings.json"),
        rules: join(input.cwd, "CLAUDE.md"),
      };
}

/**
 * The managed-policy layer, the one settings layer above the user. Its existence
 * (never its contents) is reported: deny and allow rules there outrank anything
 * this plan writes at either scope.
 */
function managedSettingsPath(input: InstallerInput): string {
  const platform = input.platform ?? process.platform;
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}

export function planClaudeCode(input: InstallerInput, _previous: InstallRecord | undefined): InstallPlan {
  const paths = claudeCodePaths(input);
  const loaded = codecFor("json", input.host).load(paths.config);
  const tiers = { search: input.search, fetch: input.fetch };
  const header = planHeader(input, paths, loaded, "JSON");
  if (header.abort) {
    return { host: "claude-code", scope: input.scope, tiers, edits: [], notes: header.notes, errors: header.errors };
  }
  const notes = [...header.notes];
  const errors = [...header.errors];
  const edits: FileEdit[] = [];

  if (input.hostVersion !== undefined && input.hostVersion !== CLAUDE_CODE_TESTED_VERSION) {
    notes.push(
      `Claude Code ${input.hostVersion} is installed, but this installer's Claude Code facts are verified against ` +
        `${CLAUDE_CODE_TESTED_VERSION} (the docs/hosts.jsonc lock). Deny-rule and tool-visibility behavior may have ` +
        "drifted between the two — re-verify the tiers if routing misbehaves.",
    );
  }
  const managed = managedSettingsPath(input);
  if (existsSync(managed)) {
    notes.push(
      `${managed} exists: the managed policy layer outranks every settings file this plan writes, so a deny or allow ` +
        "there overrides these changes. Check with your administrator if routing does not take effect.",
    );
  }

  // The server registration. `${VAR}` expansion is Claude Code's own mechanism, so
  // the key expands from the environment that launches Claude Code and never sits
  // in the file.
  const servers = loaded.value.mcpServers;
  if (servers !== undefined && !isPlainObject(servers)) {
    errors.push({
      message: `${paths.config}: mcpServers is ${valueKind(servers)}, not an object; fix it before installing.`,
    });
  }
  const existingEntry = isPlainObject(servers) ? servers.deepseek : undefined;
  const entry = {
    command: "npx",
    args: ["-y", input.packageRef],
    env: { [API_KEY_ENV]: `\${${API_KEY_ENV}}` },
  };
  const ops: ConfigOp[] = [{ op: "set", path: ["mcpServers", "deepseek"], value: entry, previous: existingEntry }];
  edits.push({
    file: paths.config,
    format: "json",
    // Global-scope files live outside the install record's config home, so they
    // need the owner sidecar that stops a second install (another project or
    // XDG_CONFIG_HOME) from claiming them — the codex topology.
    ...(input.scope === "global" ? { shared: true as const } : {}),
    ops,
  });

  if (isPlainObject(servers)) {
    if ("deepseek" in servers) notes.push(replacingExistingEntryNote("mcpServers.deepseek"));
  }
  notes.push(
    `\`${API_KEY_ENV}\` is written as "\${${API_KEY_ENV}}" in the server's env block, so the key expands from the ` +
      "environment that launches Claude Code and stays out of the file.",
  );
  if (input.scope === "project") {
    notes.push(
      "Claude Code asks once per project whether to use servers from .mcp.json; approve the deepseek server when " +
        "prompted (or via the /mcp menu), or its tools will not load in that project.",
    );
  } else {
    notes.push(
      `User-scope servers live in the mcpServers key of ${paths.config} — Claude Code's own user-level store, where ` +
        "`claude mcp add --scope user` writes too; every other key in the file is left untouched.",
    );
  }

  // Forced-tier competitor detection also scans the other stack's file — a project
  // install sees user-scope servers and a global install runs inside a cwd — since
  // a server-level deny rule in this scope's settings file excludes either origin.
  const forced = input.search === "forced" || input.fetch === "forced";
  const scanned: Record<string, unknown> = {};
  if (isPlainObject(servers)) Object.assign(scanned, servers);
  const otherFile = input.scope === "project" ? join(input.home, ".claude.json") : join(input.cwd, ".mcp.json");
  if (forced && existsSync(otherFile)) {
    let otherLoaded: LoadedConfig | undefined;
    try {
      otherLoaded = codecFor("json", input.host).load(otherFile);
    } catch (error) {
      // A directory or unreadable file (EISDIR/EACCES) must refuse the tier —
      // honor or report — instead of crashing on a file we never edit.
      errors.push({
        message: `${otherFile} exists but cannot be read (${error instanceof Error ? error.message : String(error)}); the forced-tier competitor scan requires it. Fix the file or its permissions, or choose a lower tier.`,
      });
    }
    if (otherLoaded?.parseError) {
      errors.push({ message: `${otherFile} exists but does not parse as JSON: ${otherLoaded.parseError}` });
    } else if (
      otherLoaded !== undefined &&
      otherLoaded.value.mcpServers !== undefined &&
      !isPlainObject(otherLoaded.value.mcpServers)
    ) {
      errors.push({
        message: `${otherFile}: mcpServers is ${valueKind(otherLoaded.value.mcpServers)}, not an object; the forced-tier competitor scan cannot read it. Fix the file or choose a lower tier.`,
      });
    } else if (otherLoaded !== undefined && isPlainObject(otherLoaded.value.mcpServers)) {
      const otherServers = otherLoaded.value.mcpServers;
      Object.assign(scanned, otherServers);
      if ("deepseek" in otherServers) {
        notes.push(
          `A deepseek server is also registered in ${otherFile}; Claude Code resolves the name local first, then ` +
            "project, then user scope, so consider uninstalling the other scope to keep one registration.",
        );
      }
    }
  }

  const denyEntries: string[] = [];
  const { competitors, bystanders } = splitCompetitors(scanned);
  if (forced && competitors.length > 0) {
    // Claude Code has a per-server kill switch: a bare `mcp__<server>` deny rule
    // denies every tool of that server, so detected web-capable competitors are
    // excluded instead of refusing the tier (unlike Codex).
    const rules = competitors.map((name) => `mcp__${name}`);
    denyEntries.push(...rules);
    notes.push(
      `Forced tier: web-capable MCP servers are denied by server-level rules (${rules.join(", ")}), so DeepSeek ` +
        "routing is exclusive while the entries stay." +
        (input.scope === "global"
          ? " These denies apply in every project on this machine and match by server name, so a same-named server in another project is denied too."
          : ""),
    );
  }
  const stayRegistered = forced ? bystanders : [...competitors, ...bystanders];
  if (stayRegistered.length > 0) notes.push(othersStayRegisteredNote(stayRegistered));

  if (input.search === "forced") denyEntries.push(BUILTIN_TOOL_IDS.search);
  if (input.fetch === "forced") denyEntries.push(BUILTIN_TOOL_IDS.fetch);
  if (input.search === "off") denyEntries.push(MCP_TOOL_IDS.search);
  if (input.fetch === "off") denyEntries.push(MCP_TOOL_IDS.fetch);

  if (denyEntries.length > 0) {
    const settingsLoaded = codecFor("json", input.host).load(paths.settings);
    if (settingsLoaded.parseError) {
      errors.push({ message: `${paths.settings} exists but does not parse as JSON: ${settingsLoaded.parseError}` });
    } else {
      const permissions = settingsLoaded.value.permissions;
      const deny = isPlainObject(permissions) ? permissions.deny : undefined;
      if (permissions !== undefined && !isPlainObject(permissions)) {
        errors.push({
          message: `${paths.settings}: the permissions key is ${valueKind(permissions)}, not an object; fix it before installing.`,
        });
      } else if (deny !== undefined && !Array.isArray(deny)) {
        errors.push({
          message: `${paths.settings}: permissions.deny is ${valueKind(deny)}, not an array; fix it before installing.`,
        });
      } else {
        const existingCount = Array.isArray(deny) ? deny.length : 0;
        const existingDeny = Array.isArray(deny) ? deny.filter((item): item is string => typeof item === "string") : [];
        const denyOps: ConfigOp[] = [
          {
            op: "append-array",
            path: ["permissions", "deny"],
            entries: denyEntries,
            existingCount,
          },
        ];
        edits.push({
          file: paths.settings,
          format: "json",
          ...(input.scope === "global" ? { shared: true as const } : {}),
          ops: denyOps,
        });
        if (existingCount > 0) {
          notes.push(
            `permissions.deny already holds ${existingCount} ${existingCount === 1 ? "entry" : "entries"}; ` +
              "the plan appends only its own and never removes yours.",
          );
        }
        const preexisting = denyEntries.filter((name) => existingDeny.includes(name));
        if (preexisting.length > 0) {
          notes.push(
            `${preexisting.join(", ")} ${preexisting.length === 1 ? "is" : "are"} already present in permissions.deny — present entries are not duplicated.`,
          );
        }
      }
    }
  }
  if (errors.length > 0) {
    return { host: "claude-code", scope: input.scope, tiers, edits: [], notes, errors };
  }

  const forcedIds = [
    ...(input.search === "forced" ? [BUILTIN_TOOL_IDS.search] : []),
    ...(input.fetch === "forced" ? [BUILTIN_TOOL_IDS.fetch] : []),
  ];
  if (forcedIds.length > 0) {
    notes.push(
      `Forced is exclusion: bare deny rules (${forcedIds.join(", ")}) in permissions.deny remove the built-in tool ` +
        "from the model's context entirely — deny outranks allow at every settings level and cannot be carved out, so " +
        `the exclusion also applies to every other workflow that relied on the tool ${
          input.scope === "global" ? "in every project on this machine" : "in this project"
        }. ` +
        FORCED_COST_NOTE,
    );
  }
  const offIds = [
    ...(input.search === "off" ? [MCP_TOOL_IDS.search] : []),
    ...(input.fetch === "off" ? [MCP_TOOL_IDS.fetch] : []),
  ];
  if (offIds.length > 0) {
    notes.push(
      `Off capabilities are written as their full tool ids (${offIds.join(", ")}) in permissions.deny: the tool ` +
        "leaves the model's context while the server keeps running; delete the entry to re-enable it.",
    );
  }
  if (input.search === "optional" || input.fetch === "optional") {
    notes.push(
      "Claude Code ships built-in WebSearch and WebFetch tools; under the optional tier they stay available " +
        "alongside the DeepSeek tools.",
    );
  }

  if (input.search === "preferred" || input.fetch === "preferred") {
    if (input.scope === "project" && !existsSync(paths.rules) && existsSync(join(input.cwd, "AGENTS.md"))) {
      notes.push(
        `This plan creates ${paths.rules} where none exists, and ${join(input.cwd, "AGENTS.md")} is present: Claude ` +
          "Code reads AGENTS.md only when no CLAUDE.md exists above the cwd, so the new CLAUDE.md takes precedence — " +
          "merge anything you rely on from AGENTS.md before applying.",
      );
    }
    edits.push({
      file: paths.rules,
      format: "rules",
      block: buildRulesBlock(input.host, rulesLines(MCP_TOOL_IDS, input.search, input.fetch)),
    });
    notes.push(
      input.scope === "global"
        ? `Rules block upserted in ${paths.rules}; Claude Code loads the user CLAUDE.md plus every CLAUDE.md from the cwd up the directory tree, concatenating the levels.`
        : `Rules block upserted in ${paths.rules}; Claude Code loads every CLAUDE.md from the cwd up the directory tree, concatenating the levels.`,
    );
  }

  return { host: "claude-code", scope: input.scope, tiers, edits, notes, errors };
}
