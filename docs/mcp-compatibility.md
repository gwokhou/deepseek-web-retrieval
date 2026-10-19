# MCP compatibility across hosts

This note answers one question for the planned MCP server: do the hosts in the
[support matrix](integration.md) speak the same MCP protocol standard? Short answer: they all
speak MCP, but not the same revision. MCP has split into two eras, hosts negotiate different
revisions, and one dual-era server covers them all.

The nine MCP-capable hosts in the matrix span **four different negotiated revisions**:
`2024-11-05` (Cline), `2025-06-18` (Codex, Gemini), `2025-11-25` (Continue, Pi), and
`2026-07-28` (Claude Code, Devin, GitHub Copilot) — plus Cursor, whose revision no primary
source pins. OpenCode is out of scope here: its shipped integration is the
[native plugin adapter](opencode-v2.md), not MCP.

**Research baseline:** 2026-10-19, using the same version locks as the host support matrix in
[integration.md](integration.md). Claims are cited to primary sources: the MCP specification,
official host docs and changelogs, npm registry manifests, and host source code at the locked
versions.

## Protocol revisions

MCP (Model Context Protocol) is an open specification, originally from Anthropic, now
developed in the open at [modelcontextprotocol.io](https://modelcontextprotocol.io). The
protocol version is a date string, not semver; a revision is published only for breaking
changes.

| Revision | Date | Key changes | Transports |
| --- | --- | --- | --- |
| `2024-11-05` | 2024-11-05 | Initial revision ("MCP 1.0"): `initialize` handshake, capabilities, tools/resources/prompts, sampling, roots, logging. | stdio, HTTP+SSE |
| `2025-03-26` | 2025-03-26 | OAuth 2.1 authorization; **Streamable HTTP replaces HTTP+SSE** (deprecated, not removed); JSON-RPC batching; tool annotations. | stdio, Streamable HTTP, HTTP+SSE (deprecated) |
| `2025-06-18` | 2025-06-18 | Structured tool output (`structuredContent`, `outputSchema`); servers are OAuth 2.1 resource servers (RFC 9728/8707); elicitation; `MCP-Protocol-Version` header required on HTTP; batching removed. | stdio, Streamable HTTP |
| `2025-11-25` | 2025-11-25 | OIDC discovery for auth servers; icons; elicitation rework; experimental tasks; JSON Schema 2020-12. | stdio, Streamable HTTP |
| `2026-07-28` (current) | 2026-07-28 | **Stateless core**: no `initialize` handshake, no sessions/`Mcp-Session-Id`; version and capabilities carried per-request in `_meta`; new mandatory `server/discover`; server-initiated requests (sampling/elicitation/roots) replaced by Multi Round-Trip Requests; Roots/Sampling/Logging and HTTP+SSE deprecated. | stdio, Streamable HTTP |

Sources: per-revision changelogs ([2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/changelog),
[2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/changelog),
[2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/changelog),
[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)) and the
[current version pointer](https://modelcontextprotocol.io/specification/versioning).

### Two eras

The spec now distinguishes
[Legacy (`2025-11-25` and earlier) and Modern (`2026-07-28`+)](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
versions:

- **Legacy** clients open with an `initialize` handshake and negotiate one version:
  ["If the server supports the requested protocol version, it MUST respond with the same
  version. Otherwise, the server MUST respond with another protocol version it
  supports."](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- **Modern** clients send no handshake; every request declares its version in `_meta` (and in
  the `MCP-Protocol-Version` HTTP header). An unsupported version gets
  `UnsupportedProtocolVersionError` with a `supported` list, and the client retries.
- A server MAY implement both behaviors; a dual-era server picks per connection from how the
  client opens. The published
  [compatibility matrix](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#compatibility-matrix)
  is the crux: **a legacy client fails against a modern-only server** (no fall-forward), while
  a modern client falls back to the legacy handshake (and, if needed, to deprecated HTTP+SSE).

### Official SDK support

Two release lines of the official TypeScript SDK ([docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md)):

- **v1.x** — [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
  (latest 1.32.1). Implements the spec up to `2025-11-25` and
  [will not gain `2026-07-28` support](https://www.npmjs.com/package/@modelcontextprotocol/sdk);
  receives fixes for at least six months after v2 shipped (2026-07-27). A v1 server echoes any
  client-requested version in its supported list
  (`2024-11-05` … `2025-11-25`, [source](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/server/index.ts)),
  so it auto-compatibles with older clients.
- **v2** — [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)
  and `@modelcontextprotocol/client` (latest 2.3.1). Implements `2026-07-28`; `createMcpHandler`
  / `serveStdio` **serve both eras from one entry point by default**
  ([migration doc](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)).

## What each host supports

| Host | Version | Negotiated revision | Transports | Evidence |
| --- | --- | --- | --- | --- |
| Cline | 0.0.13 | `2024-11-05` | stdio, Streamable HTTP, SSE | Custom client (no official SDK); `protocolVersion "2024-11-05"` extracted from the 0.0.13 platform binary; source repo not public |
| Codex | 0.163.0 | `2025-06-18`; `mcp_2026_07_28` feature flag opts into `2026-07-28` | stdio, Streamable HTTP (no SSE) | Git tag `rust-v0.163.0`: rmcp 3.5.1 pinned; initialize sends `V_2025_06_18` |
| Continue | 1.5.47 | `2025-11-25` | stdio, Streamable HTTP, SSE | 1.5.47 npm tarball: bundled TS SDK ≥ 1.24.1 (contains `2025-11-25` constants); no git tag exists |
| Gemini | 0.64.0 | `2025-06-18` | stdio, Streamable HTTP, SSE | Git tag `v0.64.0`: `@modelcontextprotocol/sdk` 1.23.0 pinned in package.json |
| Pi | 1.3.0 | `2025-11-25` | stdio, Streamable HTTP (SSE rejected) | Git tag `v1.3.0`: own `@earendil-works/pi-mcp` client, `LATEST_PROTOCOL_VERSION "2025-11-25"` |
| Claude Code | 2.1.303 | `2026-07-28` by default (`MCP_PROTOCOL_NEGOTIATION=legacy` opt-out) | stdio, Streamable HTTP, SSE, ws | Changelog 2.1.296+: "negotiate MCP protocol version 2026-07-28 by default"; docs: TS SDK 2.0 runtime |
| Cursor | 2026.10.08 | Unpinnable from primary sources (docs show ≥ `2025-06-18` features) | stdio, Streamable HTTP, SSE | Docs feature set only; no revision stated in docs or changelog |
| Devin | 3000.11.92 | `2026-07-28` | stdio, Streamable HTTP (SSE fallback), SSE | Changelog for 3000.11.92 itself: "Support for MCP protocol revision 2026-07-28" |
| GitHub Copilot | 1.0.98 | `2026-07-28` | stdio (`type: "local"`), Streamable HTTP, SSE | Changelog 1.0.81: "Ship MCP 2026-07-28 support to CLI, SDK, IDE, and in-memory clients" |

Open-source rows are verified at the exact locked versions (git tag, npm tarball, or binary
analysis); proprietary rows are verified from official docs and changelogs at the locked
versions. All nine support stdio and Streamable HTTP; legacy SSE is never required (and Codex
and Pi reject it).

### Open-source hosts

- **Cline** — Custom MCP client, no official SDK. Config at 0.0.13:
  `~/.cline/settings/cline_mcp_settings.json` (override with `CLINE_MCP_SETTINGS_PATH`),
  written by the `clite mcp` wizard in a nested form: `mcpServers.<name>.transport` with
  `type` (`stdio` | `sse` | `streamableHttp`), `command`/`args`/`env` or `url`/`headers`, plus
  `disabled` and `autoApprove`. Current docs describe a newer, flatter layout than the locked
  binary. The client declares no capabilities and requests `2024-11-05` — the protocol floor
  of the whole matrix; treat it as text-content-blocks-only.
- **Codex** — Rust client on the official rmcp crate. Config: `~/.codex/config.toml`
  `[mcp_servers.<name>]` — stdio `command`/`args`/`env`/`env_vars`; HTTP `url`,
  `bearer_token_env_var`, `http_headers`; `startup_timeout_sec` (10s), `tool_timeout_sec`
  (60s), `enabled_tools`/`disabled_tools`, per-tool approval modes and output limits.
  **stdio children do not inherit the parent environment** — only `HOME`, `PATH`, and a few
  system vars plus explicitly configured `env`, so `DEEPSEEK_API_KEY` must be passed
  explicitly. When a tool result has `structuredContent`, Codex replaces the content blocks
  with the serialized JSON. No SSE support.
- **Continue** — Config: `~/.continue/config.yaml` `mcpServers` list — `name`, `type`
  (`stdio` | `sse` | `streamable-http`), `command`/`args`/`env`/`cwd` or `url`/`apiKey`/
  `requestOptions`; `${{ secrets.NAME }}` interpolation; headless mode fails if any MCP
  server fails to connect. **Tool names are exposed raw, without a server prefix**, and
  matching is first-found across servers — avoid generic names like `search`.
  `structuredContent` is never read; content blocks are JSON-stringified for the model.
- **Gemini** — Config: `mcpServers` in `~/.gemini/settings.json` or `.gemini/settings.json` —
  `command`/`args`/`env`/`cwd`, or `url` with `type: "http" | "sse"` (at 0.64.0 a bare `url`
  defaults to Streamable HTTP), `headers`, `timeout`, `includeTools`/`excludeTools`; `env`
  values expand `$VAR`/`${VAR}`. Tools get an `mcp_{server}_{tool}` name truncated at 63
  chars, and underscores in the server name break its FQN parsing — keep the server name
  short and underscore-free. Reads only `content` blocks; `structuredContent` is ignored.
- **Pi** — Config: `~/.pi/agent/mcp.json` or `.pi/mcp.json` — stdio `command`/`args`/`env`/
  `cwd`, HTTP `url`/`headers`, plus `timeout`, `enabled`, `exposure`. **MCP tools are hidden
  from the model by default (`exposure: "codemode"`) — set `exposure: "direct"`** so the
  search/fetch tools are declared. SSE is explicitly rejected. Text results over 20 KB are
  middle-truncated with the full text saved to a file. Pi is the one open-source host that
  uses `structuredContent` and tool `outputSchema`.

### Proprietary hosts

All four locked versions happen to be the latest stable releases at the research date, so
current docs and changelogs apply to them directly. Notes relevant to a two-tool DeepSeek
search/fetch server:

- **Claude Code** — [MCP docs](https://code.claude.com/docs/en/mcp),
  [changelog](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md).
  Config: `.mcp.json` (`mcpServers` with `command`/`args`/`env`, or `type: "http"` + `url`).
  Env expansion `${VAR}` works in `command`/`args`/`env`/`url`/`headers`. Tool permission
  rules `mcp__<server>__<tool>`; tool descriptions capped at 4,096 chars (2.1.296+); tool
  output capped at 25k tokens by default (`MAX_MCP_OUTPUT_TOKENS`), oversized text saved to a
  file; 16 MiB message cap on HTTP transports.
- **Cursor** — [MCP docs](https://cursor.com/docs/mcp),
  [CLI MCP](https://cursor.com/docs/cli/mcp). Config: `.cursor/mcp.json` or
  `~/.cursor/mcp.json`; `command`/`args`/`env` for stdio (docs mark `type` as required),
  `url`/`headers` for remote; `${env:NAME}` interpolation. MCP tools need approval; the CLI
  has `--approve-mcps`, global-scope servers have been auto-approved since April 2026.
- **Devin** — [MCP config](https://docs.devin.ai/cli/extensibility/mcp/configuration),
  [changelog](https://docs.devin.ai/cli/changelog). Config: `.devin/mcp_config.local.json`
  (default), `.devin/mcp_config.json`, or `~/.config/devin/mcp_config.json`; same
  `mcpServers` shape; `devin mcp add <name> -- <cmd>` / `<URL>`. MCP tools prompt for
  approval by default, with `mcp__server__tool` allow/deny patterns in `permissions`.
- **GitHub Copilot** — [MCP docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers),
  [repo](https://github.com/github/copilot-cli). Config: `~/.copilot/mcp-config.json` or
  project `.mcp.json`; stdio entries use `"type": "local"` plus `command`/`args`/`env`; a
  per-server `tools` list gates which tools are exposed; runtime flags
  `--allow-tool`/`--deny-tool` accept `MCP_SERVER_NAME(tool)`.

## One server for all hosts

Yes — one MCP server implementation can serve every host in the matrix. The hosts do not
share one revision, but the protocol's negotiation rules and the official SDKs absorb the
differences:

1. **Tools only, text-first results.** Expose the retrieval as two tools via the `tools`
   capability; do not rely on resources, prompts, sampling, elicitation, or roots — the
   hosts' client capabilities are inconsistent (Codex has elicitation only; Gemini and Pi
   serve roots; Continue exposes nothing beyond tools and prompts). Always return readable
   text in `content` blocks, and mirror the same data in `structuredContent` for
   `2025-06-18`+ clients — the spec's own backwards-compat SHOULD. This split matters in
   practice: Codex *replaces* content with `structuredContent` when present, Gemini and
   Continue *ignore* `structuredContent`, Pi and Cline read content only.
2. **stdio is the universal transport.** Every host in the matrix launches stdio servers
   with the same conceptual JSON (`mcpServers` → `command`/`args`/`env`), differing only in
   file location and cosmetic field names. stdio needs no OAuth and no URL config, and the
   spec says clients SHOULD support it whenever possible. Legacy SSE is never required —
   Codex and Pi reject it anyway.
3. **Build on the official SDK v2 dual-era serving.** One build then serves the full range:
   the `2024-11-05` floor set by Cline (v2 legacy support spans `2024-10-07`–`2025-11-25`)
   up to the `2026-07-28` negotiators (Claude Code 2.1.296+, Devin 3000.11.92, Copilot CLI
   1.0.81+). A v1.x-built server still works today — modern clients fall back to the legacy
   handshake — but it can never offer the stateless era; v2 serves both from one entry
   point.
4. **Streamable HTTP only for a hosted deployment.** All nine hosts support it (with
   different `type` strings: `http`, `streamable-http`, `streamableHttp`), and OAuth 2.1
   resource-server behavior (RFC 9728 metadata) then applies; prefer pre-registered clients
   over the now-deprecated Dynamic Client Registration.
5. **Host quirks to design around.** Name tools distinctly (`deepseek_web_search`,
   `deepseek_fetch`): Continue exposes raw names with cross-server collisions, and Gemini
   truncates the `mcp_{server}_{tool}` name at 63 chars. Pass the API key explicitly in
   config — Codex's stdio children do not inherit the parent environment, while other hosts
   expand `${VAR}`-style references. Keep tool descriptions under Claude Code's 4,096-char
   cap and fetch output bounded (Claude Code caps tool output at 25k tokens by default; Pi
   truncates text over 20 KB). Document per-host approval: `mcp__deepseek__*` rules (Claude
   Code, Devin), `tools` lists and `--allow-tool` (Copilot), `--approve-mcps` (Cursor),
   `autoApprove` (Cline), `exposure: "direct"` (Pi).

## Sources

### Specification and SDKs

- MCP spec: [versioning](https://modelcontextprotocol.io/specification/versioning) ·
  [2026-07-28 versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) ·
  [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) ·
  [deprecated features](https://modelcontextprotocol.io/specification/2026-07-28/deprecated) ·
  [2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) ·
  [2025-06-18 tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- TypeScript SDK: [repo](https://github.com/modelcontextprotocol/typescript-sdk) ·
  [protocol versions doc](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md) ·
  [2026-07-28 support doc](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md) ·
  [v1.x server negotiation source](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/server/index.ts)
- npm: [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) ·
  [@modelcontextprotocol/server](https://www.npmjs.com/package/@modelcontextprotocol/server)
- [2026-07-28 spec announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28)

### Hosts

- Gemini CLI: [v0.64.0 tag](https://github.com/google-gemini/gemini-cli/tree/v0.64.0) —
  [package.json (SDK 1.23.0 pin)](https://github.com/google-gemini/gemini-cli/blob/v0.64.0/packages/core/package.json),
  [mcp-client.ts](https://github.com/google-gemini/gemini-cli/blob/v0.64.0/packages/core/src/tools/mcp-client.ts),
  [mcp-tool.ts (name handling, result rendering)](https://github.com/google-gemini/gemini-cli/blob/v0.64.0/packages/core/src/tools/mcp-tool.ts),
  [npm 0.64.0](https://registry.npmjs.org/@google/gemini-cli)
- Codex: [rust-v0.163.0 tag](https://github.com/openai/codex/tree/rust-v0.163.0) —
  [Cargo.toml (rmcp pin)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/Cargo.toml),
  [rmcp_client.rs (initialize params)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/rmcp_client.rs),
  [mcp_types.rs (config keys)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/mcp_types.rs),
  [utils.rs (stdio env allowlist)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/rmcp-client/src/utils.rs),
  [rust-sdk protocol constants at the pinned rev](https://github.com/modelcontextprotocol/rust-sdk/blob/4048ac40e958fb1a7d614617a2ae8d26666ee2fa/crates/rmcp/src/model.rs)
- Continue: [1.5.47 npm tarball](https://registry.npmjs.org/@continuedev/cli/-/cli-1.5.47.tgz)
  (MCPService.ts, mcpTransports.ts, bundled SDK protocol constants; no git tag exists),
  [current docs](https://docs.continue.dev/customize/deep-dives/mcp)
- Pi: [v1.3.0 tag](https://github.com/earendil-works/pi/tree/v1.3.0) —
  [pi-mcp protocol types](https://github.com/earendil-works/pi/blob/v1.3.0/packages/mcp/src/protocol/types.ts),
  [MCP docs at the tag](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/mcp.md),
  [tools.ts (result handling)](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/extensions/mcp/tools.ts),
  [npm](https://registry.npmjs.org/@earendil-works/pi-coding-agent)
- Cline: [npm @cline/cli 0.0.13](https://registry.npmjs.org/@cline/cli/0.0.13) and
  [platform binary](https://registry.npmjs.org/@cline/cli-linux-x64/0.0.13) (protocol
  strings extracted from the binary; [repo pointer](https://github.com/cline/sdk) returns
  404), [current docs](https://docs.cline.bot/mcp/mcp-overview) (newer layout than 0.0.13)
- Claude Code: [MCP docs](https://code.claude.com/docs/en/mcp),
  [changelog](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md),
  [npm 2.1.303 manifest](https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.303)
- Cursor: [MCP docs](https://cursor.com/docs/mcp),
  [CLI MCP](https://cursor.com/docs/cli/mcp),
  [CLI changelog](https://cursor.com/docs/cli/changelog)
- Devin: [MCP overview](https://docs.devin.ai/cli/extensibility/mcp/overview),
  [MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration),
  [CLI changelog](https://docs.devin.ai/cli/changelog)
- GitHub Copilot CLI: [MCP docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers),
  [repository](https://github.com/github/copilot-cli),
  [changelog](https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md)
