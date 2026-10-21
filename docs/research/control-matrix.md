# Control levels across hosts

This note answers one question: for each host in the [support matrix](../integration.md), how
strongly can a user steer when the DeepSeek tools are called — optionally available,
preferentially used, or forcibly routed — independently for search and fetch? It is also
the per-host reference for setup facts: MCP registration, rules files, built-in web
competitors, and their kill switches. [integration.md](../integration.md) keeps the mechanism
taxonomy and host-support matrix; [mcp-compatibility.md](mcp-compatibility.md) keeps the
protocol research and its evidence.

**Research baseline:** 2026-10-20, using the same version locks as
[hosts.jsonc](../hosts.jsonc), the single source of truth for host facts. Open-source rows are
verified at exact git tags, npm tarballs, or binary analysis; proprietary rows from official
docs and changelogs at the locked versions. Version mentions inside the per-host sections
and the generated `key` strings are research-provenance anchors verified at the lock, not
restatements of it; they are re-verified on a baseline bump (see the drift list at the end).
The matrix below is generated — edit
hosts.jsonc, then run `bun run docs:matrix`.

## Tiers

| Tier | Meaning | Determinism |
| --- | --- | --- |
| Optional | Tools are declared to the model with no preference guidance; the model picks freely among available tools. | None |
| Preferred | Prompt-level rules (instruction files, system-prompt additions) steer the model toward the tools. | Probabilistic |
| Forced | Routing is deterministic **relative to the built-in competitor**; other web-capable MCP servers or a higher configuration layer can still break it (reading notes below). Three flavors: **replacement** (the built-in tool's implementation is swapped), **exclusion** (the built-in competitor is denied or disabled so the DeepSeek path is the only one), **de-facto** (the host ships no built-in web tool). | Deterministic (conditional) |

## Matrix

<!-- generated: control-matrix — edit docs/hosts.jsonc, then run `bun run docs:matrix` -->

| Host | Capability | Optional | Preferred | Forced | Mechanism |
| --- | --- | --- | --- | --- | --- |
| Cline | Search | Yes | Yes | Yes | De-facto — no built-in web-search tool at 0.0.13 (binary-verified) |
| Cline | Fetch | Yes | Yes | Yes | Exclusion — `disabledTools` in `~/.cline/data/settings/global-settings.json` |
| Codex | Search | Yes | Yes | Yes | Exclusion — `web_search = "disabled"` (top-level config.toml) |
| Codex | Fetch | Yes | Yes | Yes | De-facto — no built-in fetch tool at 0.163.0 |
| OpenCode | Search | n/a | n/a | Yes | Replacement — `websearch.provider: "deepseek"` or plugin `setDefaultWebsearch` |
| OpenCode | Fetch | Yes | Yes | Yes | Replacement — `fetchOverrideWebfetch: true` |
| Pi | Search | Yes | Yes | Yes | De-facto — no built-in web tool at 1.3.0 (source-verified) |
| Pi | Fetch | Yes | Yes | Yes | De-facto — no built-in web tool at 1.3.0 (source-verified) |
| Claude Code | Search | Yes | Yes | Yes | Exclusion — `permissions.deny: ["WebSearch"]` removes the tool from context |
| Claude Code | Fetch | Yes | Yes | Yes | Exclusion — `permissions.deny: ["WebFetch"]`, or `CLAUDE_CODE_DISABLE_WEB_FETCH=1` |
| Cursor | Search | Yes | Yes | No | — |
| Cursor | Fetch | Yes | Yes | Yes | Exclusion — `permissions.deny: ["WebFetch(*)"]` |
| Devin | Search | Yes | Yes | Yes | Exclusion — `disabled_tools` / `permissions.deny` in config.json |
| Devin | Fetch | Yes | Yes | Yes | Exclusion — `disabled_tools` / `permissions.deny` in config.json |
| GitHub Copilot | Search | Yes | Yes | Yes | Exclusion — `githubMcpTools` settings (competitor ships via the bundled GitHub MCP server) |
| GitHub Copilot | Fetch | Yes | Yes | Yes | Exclusion — `--deny-tool web_fetch` / `--excluded-tools` (session flags) |

<!-- /generated: control-matrix -->

Reading notes:

- `n/a` marks a structurally unreachable tier, not missing research: OpenCode's search
  provider is host-level config, not a model-selectable tool, so the model never chooses
  between engines — the only choice is replacement on or off.
- A `De-facto` Forced flavor needs no config: the host ships no built-in competitor, so the
  registered tools are the only web path.
- Cursor's search row is the one Forced-tier gap in the matrix: no documented deny token
  exists for its built-in web search.
- An `Exclusion` flavor forces routing **relative to the built-in competitor only**. If
  other web-capable MCP servers are already registered, they stay on the field and
  routing is not forced until they are excluded too; higher configuration layers
  (managed, enterprise, system) can also outrank the kill switch. Install-time handling
  of both conditions is specified in the
  [installer design](../design/installer-design.md).

## Per-host reference

One section per host, in hosts.jsonc order. Each carries what an install needs beyond the
matrix: the built-in competitors, their kill switches, how the MCP server is registered,
and which rules files steer preference. The `init` CLI implements these tiers for
OpenCode, Pi, and Codex (see [installer design](../design/installer-design.md)). Config
paths imply the available scopes; keys locked to a single scope are enumerated in the
[installer design](../design/installer-design.md#scope).

### Cline

- **Positioning** — VSCode-extension agent with an experimental lightweight CLI (`clite`,
  built on the Cline SDKs). Apache-2.0. MCP plus CLI/SDK custom tools; neither replaces the
  built-in `fetch_web_content`. Current docs.cline.bot describes the newer 3.x `cline`
  binary — the lock is 0.0.13 `clite`, and everything here is verified against that binary.
- **Built-in web tools** — `fetch_web_content` (fetch a URL and analyze it with a prompt);
  no built-in web search (the binary's `web_search` strings are Bedrock provider tool
  versions). Kill switch: `"disabledTools": ["fetch_web_content"]` in
  `~/.cline/data/settings/global-settings.json` (path overridable via
  `CLINE_GLOBAL_SETTINGS_PATH`); a disabled tool is dropped from the available set.
  `--yolo` mode also deactivates web fetch.
- **MCP registration** — `~/.cline/settings/cline_mcp_settings.json`
  (`CLINE_MCP_SETTINGS_PATH`), written by the `clite mcp` wizard in a nested form:
  `mcpServers.<name>.transport` with `type` (`stdio` | `sse` | `streamableHttp`) plus
  `command`/`args`/`env`, `disabled`, and `autoApprove`. Negotiates `2024-11-05` — the
  protocol floor of the matrix; treat it as text-content-blocks-only.
- **Rules** — `.clinerules` (file or directory) and `.cline/rules/` plus `AGENTS.md` at
  project scope; `~/.cline/rules` and `~/Documents/Cline/Rules` at user scope — all
  verified inside the 0.0.13 binary.

### Codex

- **Positioning** — OpenAI's official Rust CLI. Apache-2.0. MCP is the only integration
  path.
- **Built-in web tools** — a native Responses `web_search` tool. The default mode is
  `cached` (an OpenAI-maintained index, no external web access — the competitor exists
  silently by default); `live` requires opt-in (`--search`, `web_search = "live"`, or a
  full-access sandbox). No built-in fetch tool. Kill switch: top-level
  `web_search = "disabled"` in `~/.codex/config.toml`. Trap: the `[tools] web_search =
  <bool>` form parses but discards the value at 0.163.0 — a silent no-op
  ([config source at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/config_toml.rs)).
- **MCP registration** — `~/.codex/config.toml` `[mcp_servers.<name>]`: stdio
  `command`/`args`/`env`/`env_vars`; `startup_timeout_sec` (30 s) and `tool_timeout_sec`
  (300 s) defaults — the `DEFAULT_STARTUP_TIMEOUT`/`DEFAULT_TOOL_TIMEOUT` constants
  ([rmcp_client.rs at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/rmcp_client.rs));
  `enabled_tools`/`disabled_tools`, per-tool approval modes, and output limits.
  stdio children do not inherit the parent environment (only `HOME`, `PATH`, and explicit
  `env`), so `DEEPSEEK_API_KEY` must be passed explicitly. When a tool result has
  `structuredContent`, Codex replaces the content blocks with the serialized JSON. No SSE.
  Codex identifies itself in the initialize handshake as clientInfo name `codex-mcp-client`
  with title `Codex`
  ([rmcp_client.rs at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/rmcp_client.rs)).
- **Rules** — `~/.codex/AGENTS.md` (with `AGENTS.override.md` preferred) at user scope;
  every `AGENTS.md` from the project root down to the cwd, concatenated root→cwd.
  Extensible via `project_doc_fallback_filenames` and `developer_instructions`
  ([agents_md.rs at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/agents_md.rs)).

### OpenCode

- **Positioning** — the only host with both a native websearch provider and a native fetch
  override; the shipped adapter uses them, not MCP. See [OpenCode v2](../agents/opencode-v2.md).
- **Built-in web tools** — `websearch` (bundled providers: exa, firecrawl, parallel,
  tavily, tinyfish, or `"random"`) and `webfetch`. `"websearch": false` removes the search
  tool from model requests entirely; `webfetch` has no disable config key at 2.0.32 — the
  deterministic paths are a permissions deny (`action: "webfetch"`) or a plugin
  tool-transform removal, the latter being what `fetchOverrideWebfetch` does.
- **MCP registration** — out of scope for this host: the shipped path is the plugin
  adapter, and OpenCode's MCP support is not part of it.
- **Rules** — `AGENTS.md` only (no CLAUDE.md fallback in v2): global
  `~/.config/opencode/AGENTS.md`, then project files from the workspace toward home,
  nested files injected when the agent reads into that subtree. The `instructions` config
  key adds files, globs, or URLs ([docs](https://opencode.ai/v2/docs/instructions)).

### Pi

- **Positioning** — minimal, fully customizable agent (earendil-works). MIT. A TypeScript
  extension API plus MCP. See [Pi](../agents/pi.md); the shipped adapter is the native
  extension (`src/pi/`), with the MCP server as the fallback path.
- **Built-in web tools** — none at 1.3.0. The built-in set is exactly `bash, edit, find,
  grep, ls, powershell, read, write` (default-active: `read, bash, edit, write`); web
  search/fetch arrive via MCP or extensions
  ([tools index at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/tools/index.ts)).
- **Extension registration** — `packages` in settings.json (`~/.pi/agent/settings.json` or
  `.pi/settings.json`): source strings (`npm:<pkg>`, `git:…`, local paths) resolved at
  session start; `pi install <source>` appends them, and a package's `pi` manifest field
  names its entry files (loaded via jiti, TypeScript directly). Extension tools default to
  `exposure: "direct"` — no codemode trap — and run in-process: the key is read from
  `process.env` (no forwarding), and results bypass the MCP layer entirely, so neither the
  20 KB truncation nor the 60 s request timeout applies. There is no per-extension options
  channel: the runtime config surface is the `DEEPSEEK_*` environment (the same pipeline as
  the MCP server) plus a `deepseekWebRetrieval` settings namespace the installer writes for
  the off tier — Pi preserves unknown settings keys on read and on its own rewrites
  (`pi install`), verified at 1.3.0. Action methods such as `getSettings()` cannot be
  called during extension loading, so the adapter reads the settings files itself.
- **MCP registration** — `~/.pi/agent/mcp.json` or `.pi/mcp.json`: stdio
  `command`/`args`/`env`/`cwd`, HTTP `url`/`headers`, plus `timeout`, `enabled`,
  `exposure`. MCP tools are hidden from the model by default
  (`exposure: "codemode"`); `"exposure": "direct"` declares them like built-ins — the
  prerequisite for every tier. SSE is rejected. Text results over 20 KB are
  middle-truncated with the full text saved to a file, and the per-request default
  timeout is 60 s. Pi is content-first for the model, with a `structuredContent`
  fallback used only when a result has no content blocks — the one open-source host that
  touches `structuredContent` at all — and a re-declared (not validated) tool
  `outputSchema`.
- **Rules** — `AGENTS.md`/`CLAUDE.md` context files from the agent dir, the working
  directory, and its parents; `SYSTEM.md` replaces the system prompt and `APPEND_SYSTEM.md`
  adds to it; extensions can replace the whole prompt via `before_agent_start`
  ([configuration.md at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/configuration.md)).

### Claude Code

- **Positioning** — Anthropic's official CLI. Proprietary. MCP adds tools; built-ins are
  not replaceable.
- **Built-in web tools** — `WebSearch` and `WebFetch`. Kill switch: bare deny rules —
  `"permissions": {"deny": ["WebSearch", "WebFetch"]}` — remove the tools from the model's
  context entirely; deny outranks allow at every settings level and cannot be carved out.
  `--disallowedTools` is the flag form. `CLAUDE_CODE_DISABLE_WEB_FETCH=1` (2.1.285+) kills
  WebFetch only; there is no env equivalent for WebSearch
  ([tools](https://code.claude.com/docs/en/tools),
  [permissions](https://code.claude.com/docs/en/permissions)).
- **MCP registration** — `.mcp.json` (`mcpServers` with `command`/`args`/`env`, or
  `type: "http"` + `url`); `${VAR}` expansion in `command`/`args`/`env`/`url`/`headers`.
  Tool permission rules use `mcp__<server>__<tool>`. Tool descriptions are capped at 4,096
  chars (2.1.296+) and tool output at 25k tokens by default (`MAX_MCP_OUTPUT_TOKENS`),
  with oversized text saved to a file; 16 MiB message cap on HTTP transports.
- **Rules** — `CLAUDE.md` hierarchy (managed → user `~/.claude/CLAUDE.md` → project →
  `CLAUDE.local.md`) with `@import`; `AGENTS.md` is read instead only when no CLAUDE.md
  exists anywhere above the cwd (since 2.1.277)
  ([memory](https://code.claude.com/docs/en/memory)).

### Cursor

- **Positioning** — AI-first editor plus a same-family CLI. Proprietary. MCP is the CLI
  path.
- **Built-in web tools** — web search and `WebFetch`. Fetch kill switch:
  `"permissions.deny": ["WebFetch(*)"]` in `~/.cursor/cli-config.json` (global) or
  `.cursor/cli.json` (project — only `permissions` is project-configurable); deny wins
  over allow. Web search has no documented deny token; the only control is
  `autoAcceptWebSearch` (a per-call approval prompt, not a hard deny). This is the
  matrix's one Forced-tier gap
  ([CLI permissions](https://cursor.com/docs/cli/reference/permissions),
  [changelog](https://cursor.com/docs/cli/changelog)).
- **MCP registration** — the same `mcp.json` servers as the editor (`.cursor/mcp.json` or
  `~/.cursor/mcp.json`): `command`/`args`/`env` for stdio, `url`/`headers` for remote;
  `${env:NAME}` interpolation. MCP tools prompt for approval; `--approve-mcps` bypasses,
  and global-scope servers have been auto-approved since April 2026.
- **Rules** — `.cursor/rules/*.mdc` (with `description`/`globs`/`alwaysApply` frontmatter —
  a plain `.md` file there is ignored), `AGENTS.md` at the root and in subdirectories, and
  `CLAUDE.md`; "The CLI agent supports the same rules system as the editor"
  ([CLI using](https://cursor.com/docs/cli/using)).

### Devin

- **Positioning** — Cognition's autonomous-agent CLI. Proprietary. Plugins bundle skills,
  rules, hooks, and MCP servers — not arbitrary custom tools — so MCP is the tool path.
- **Built-in web tools** — `web_search` (v2026.5.6-1) and `webfetch` (v2026.5.26-0). Kill
  switch: `"disabled_tools": ["webfetch", "web_search"]` in user `config.json`, and
  `web_search` is accepted as a tool name in `permissions.deny`/`ask`/`allow` (both
  changelog-documented at v3000.10.21, not yet on the reference pages); PreToolUse hooks
  block calls by exiting with code 2; an enterprise "Enable Web Search" team setting
  exists ([changelog](https://docs.devin.ai/cli/changelog)).
- **MCP registration** — `.devin/mcp_config.local.json` (default),
  `.devin/mcp_config.json`, or `~/.config/devin/mcp_config.json`, all with the same
  `mcpServers` shape; `devin mcp add <name> -- <cmd>` / `<URL>`. MCP tools prompt for
  approval by default; `mcp__server__tool` allow/deny patterns in `permissions`.
- **Rules** — `AGENTS.md` (root, nested, and global `~/.config/devin/AGENTS.md`),
  `AGENTS.local.md`, `.devin/rules/*.md` with `trigger` frontmatter,
  `.devin/global_rules.md`, and plugin-shipped rules; imports other tools' rules via
  `read_config_from` ([rules](https://docs.devin.ai/cli/extensibility/rules)).

### GitHub Copilot

- **Positioning** — GitHub's official CLI. Proprietary. MCP servers, optionally bundled in
  plugins.
- **Built-in web tools** — `web_fetch` (since 0.0.374) and `web_search` via the bundled
  GitHub MCP server (which exposes only that tool since 1.0.57). Kill switch, session
  scoped: `--deny-tool web_fetch,web_search` or `--excluded-tools` — the docs' own example
  for avoiding web search entirely; deny wins even under `--allow-all`. Persistent:
  `web_search` via `githubMcpToolsets`/`githubMcpTools` settings, and
  `network.allowOutbound: false` blocks fetch egress at the network layer; a persistent
  key for the built-in `web_fetch` itself is unconfirmed at 1.0.98
  ([allowing tools](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools),
  [changelog](https://github.com/github/copilot-cli/blob/main/changelog.md)).
- **MCP registration** — `~/.copilot/mcp-config.json` or project `.mcp.json`; stdio
  entries use `"type": "local"` plus `command`/`args`/`env`; a per-server `tools` list
  gates which tools are exposed — per-tool control at registration time.
- **Rules** — `~/.copilot/copilot-instructions.md` (user),
  `.github/copilot-instructions.md` (repo) and `.github/instructions/**/*.instructions.md`
  (path-scoped via `applyTo` globs); `AGENTS.md`/`CLAUDE.md` discovery (changelog-dated
  ≤1.0.86; `GEMINI.md` could not be dated to the lock);
  `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` adds directories
  ([custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)).

## Cross-cutting observations

- **AGENTS.md is the de-facto rules standard.** Seven of the eight hosts read it
  natively (Codex, Cline, Cursor, Devin, Copilot, Pi, OpenCode); Claude Code reads it as
  a fallback. One rules file works nearly everywhere; the exception: OpenCode v2 has no
  CLAUDE.md fallback.
- **Replacement is exclusive to native extension points** — only OpenCode. Exclusion is
  the general forced path on MCP hosts. The two structural limits: OpenCode search has no
  middle tier, and Cursor search cannot be forced at all.
- **Version drift to re-verify on the next baseline pass:** Cline's docs describe the 3.x
  `cline` binary while the lock is 0.0.13 `clite`; Codex's config docs have moved and
  describe a newer release; Copilot's `GEMINI.md` support could not be changelog-dated to
  ≤1.0.98. Protocol-revision evidence for every host lives in
  [mcp-compatibility.md](mcp-compatibility.md).
