# MCP compatibility across hosts

This note answers one question for the shipped MCP server: do the hosts in the
[support matrix](../integration.md) speak the same MCP protocol standard? Short answer: they all
speak MCP, but not the same revision. MCP has split into two eras, hosts negotiate different
revisions, and one dual-era server covers them all.

The seven MCP-capable hosts in the matrix span **four different negotiated revisions**:
`2024-11-05` (Cline), `2025-06-18` (Codex), `2025-11-25` (Pi), and
`2026-07-28` (Claude Code, Devin, GitHub Copilot) — plus Cursor, whose revision no primary
source pins. OpenCode is out of scope here: its shipped integration is the
[native plugin adapter](../agents/opencode-v2.md), not MCP.

**Research baseline:** 2026-10-19, using the same version locks as the host support matrix in
[integration.md](../integration.md). Claims are cited to primary sources: the MCP specification,
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

Host versions are locked in [`docs/hosts.jsonc`](../hosts.jsonc), the single source of truth for
host facts; each row below was verified against that lock on the research baseline.

| Host | Negotiated revision | Transports | Evidence |
| --- | --- | --- | --- |
| Cline | `2024-11-05` | stdio, Streamable HTTP, SSE | Custom client (no official SDK); `protocolVersion "2024-11-05"` extracted from the platform binary; source repo not public |
| Codex | `2025-06-18`; `mcp_2026_07_28` feature flag opts into `2026-07-28` | stdio, Streamable HTTP (no SSE) | Git tag `rust-v0.163.0`: rmcp 3.5.1 pinned; initialize sends `V_2025_06_18` |
| Pi | `2025-11-25` | stdio, Streamable HTTP (SSE rejected) | Git tag: own `@earendil-works/pi-mcp` client, `LATEST_PROTOCOL_VERSION "2025-11-25"` |
| Claude Code | `2026-07-28` by default (`MCP_PROTOCOL_NEGOTIATION=legacy` opt-out) | stdio, Streamable HTTP, SSE, ws | Docs: the v2 runtime (TS SDK 2.0) defaults from 2.1.274+ without flag fetching and "asks stdio servers for that revision by default"; changelog 2.1.299 extended the default to cloud session and Remote Control connectors |
| Cursor | Unpinnable from primary sources (docs show ≥ `2025-06-18` features) | stdio, Streamable HTTP, SSE | Docs feature set only; no revision stated in docs or changelog |
| Devin | `2026-07-28` | stdio, Streamable HTTP (SSE fallback), SSE | Changelog for the locked release itself: "Support for MCP protocol revision 2026-07-28" |
| GitHub Copilot | `2026-07-28` | stdio (`type: "local"`), Streamable HTTP, SSE | Changelog 1.0.81: "Ship MCP 2026-07-28 support to CLI, SDK, IDE, and in-memory clients" |

All seven support stdio and Streamable HTTP; legacy SSE is never required (and Codex
and Pi reject it). Verification methodology and provenance follow the
[per-host reference](control-matrix.md#per-host-reference); the Evidence column cites per-row
sources and Sources lists the file-level links.

Registration paths, config shapes, approval surfaces, and per-host quirks live in the
[per-host reference](control-matrix.md#per-host-reference) of the control-matrix note; they
are setup facts, not protocol facts. The table above carries the protocol evidence, and
source-level links follow in Sources.

## One server for all hosts

Yes — one MCP server implementation can serve every host in the matrix. The hosts do not
share one revision, but the protocol's negotiation rules and the official SDKs absorb the
differences:

1. **Tools only, text-first results.** Expose the retrieval as two tools via the `tools`
   capability; do not rely on resources, prompts, sampling, elicitation, or roots — the
   hosts' client capabilities are inconsistent (Codex has elicitation only; Pi serves
   roots). Always return readable
   text in `content` blocks, and mirror the same data in `structuredContent` — the
   spec's own backwards-compat SHOULD — except for clients that would replace the text
   with its serialized JSON: Codex *replaces* content with `structuredContent` when
   present, so the shipped server detects its `codex-mcp-client` identity (the
   initialize `clientInfo` on handshake-era connections, the per-request envelope on
   `2026-07-28`) and omits the mirror for it. Cline reads
   text content only; Pi is
   content-first, falling back to `structuredContent` only when a result has no content
   blocks (verified in `tools.ts` at v1.3.0). No `outputSchema` is declared: the SDK
   rejects text-only results for a tool with a declared schema, and no host in the
   matrix validates the schema anyway. The per-host model-channel facts behind this —
   which of `content`/`structuredContent` provably reaches the model on each host,
   native adapter paths included — are recorded in
   [result-quality-passthrough.md](result-quality-passthrough.md).
2. **stdio is the universal transport.** Every host in the matrix launches stdio servers
   with the same conceptual JSON (`mcpServers` → `command`/`args`/`env`), differing only in
   file location and cosmetic field names. stdio needs no OAuth and no URL config, and the
   spec says clients SHOULD support it whenever possible. Legacy SSE is never required —
   Codex and Pi reject it anyway.
3. **Build on the official SDK v2 dual-era serving.** One build then serves the full range:
   the `2024-11-05` floor set by Cline (v2 legacy support spans `2024-10-07`–`2025-11-25`)
   up to the `2026-07-28` negotiators (Claude Code 2.1.274+, Devin 3000.11.92, Copilot CLI
   1.0.81+). A v1.x-built server still works today — modern clients fall back to the legacy
   handshake — but it can never offer the stateless era; v2 serves both from one entry
   point.
4. **Streamable HTTP only for a hosted deployment.** All seven MCP hosts surveyed here support it (with
   different `type` strings: `http`, `streamable-http`, `streamableHttp`), and OAuth 2.1
   resource-server behavior (RFC 9728 metadata) then applies; prefer pre-registered clients
   over the now-deprecated Dynamic Client Registration.
5. **Host quirks to design around.** Tool naming (`deepseek_web_search`,
   `deepseek_fetch`) already reflects the quirk catalog in the
   [per-host reference](control-matrix.md#per-host-reference) — name collisions and
   truncation, environment passing, output caps, and per-host approval surfaces; consult
   it per host rather than this summary.

These protocol findings describe compatibility at the research baseline, not completed
end-to-end support for every host. The shipped server exposes stdio; supported setup
guides and installer coverage are listed in the [integration model](../integration.md).

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

- Codex: [rust-v0.163.0 tag](https://github.com/openai/codex/tree/rust-v0.163.0) —
  [Cargo.toml (rmcp pin)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/Cargo.toml),
  [rmcp_client.rs (initialize params)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/rmcp_client.rs),
  [mcp_types.rs (config keys)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/mcp_types.rs),
  [utils.rs (stdio env allowlist)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/rmcp-client/src/utils.rs),
  [rust-sdk protocol constants at the pinned rev](https://github.com/modelcontextprotocol/rust-sdk/blob/4048ac40e958fb1a7d614617a2ae8d26666ee2fa/crates/rmcp/src/model.rs)
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
