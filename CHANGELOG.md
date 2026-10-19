# Changelog

All notable changes to this project are documented here.

## Unreleased

- Make `docs/hosts.jsonc` the single source of truth for host facts: the
  integration.md host table is generated from it (`bun run docs:matrix`, drift fails
  tests), CI matrices and the e2e Docker build args derive from it, and narrative
  docs reference it instead of restating version locks
- Add a local-only end-to-end script (`bun run test:e2e`): a keyless real
  `pi mcp list` handshake against the built server, and a headless `opencode run`
  scenario that makes real billed requests; never run in CI. Agents run inside
  Docker with versions pinned by `test/e2e/Dockerfile` (`--local` opts out)
- Add an MCP server adapter (`src/mcp/`) exposing `deepseek_web_search` and `deepseek_fetch`
  over stdio, serving MCP clients from revision 2024-11-05 through 2026-07-28
- Support `DEEPSEEK_*` environment variable configuration in the MCP server, mapped onto the
  shared option pipeline
- Add the Pi guide (`docs/pi.md`) and `examples/pi.mcp.jsonc`; Pi 1.3.0 is the first
  supported MCP host
- Add `docs/mcp-compatibility.md`, a primary-source review of MCP protocol compatibility
  across the hosts in the support matrix
- Add a Node build (`dist/cli.js`) with a `deepseek-web-retrieval` bin entry and Node 20+
  engines, alongside the existing Bun workflow
- Cover the MCP server with SDK client personas pinned to 2024-11-05, 2025-06-18,
  2025-11-25, and 2026-07-28, plus a real stdio smoke test of the built entry
- Enforce the fetch host policy inside the core client so direct core consumers cannot bypass it
- Fail fast on a missing API key before the fetch permission prompt, and reject non-string `url` inputs
- Move OpenCode-specific missing-key guidance out of the agent-agnostic core
- Document that `maxResults: 0` returns no results
- Cover response body reads with the request timeout and cancellation signal
- Reject successful API responses larger than 5 MiB
- Reject search queries that exceed 128 characters after adding search operators
- Block IPv4-mapped IPv6 private addresses in the fetch host policy
- Truncate API error bodies by Unicode code points
- Move OpenCode-specific setup and usage into `docs/opencode-v2.md`
- Add `docs/integration.md` with a version-locked host support matrix
- Calibrate the OpenCode v2 install and uninstall guide against verified behavior:
  plugin hot reload, `plugin add` not selecting the provider, and `plugin remove` leftovers

## 0.1.0

Initial public-ready release.

- DeepSeek Search provider for OpenCode v2 (`websearch.provider = "deepseek"`)
- `deepseek_fetch` tool backed by DeepSeek Fetch
- Optional drop-in `webfetch` replacement
- Reuse of the active DeepSeek credential stored in OpenCode
- `DEEPSEEK_API_KEY` fallback and `apiKeySource` control
- Summary-only search with rerank/authority filtering and URL deduplication
- Markdown-only fetch with a configurable character cap
- Domain allow/deny lists and private-host blocking
- Bounded retries for 408, 425, 429, and 5xx responses with `Retry-After`
- Unicode-safe truncation and secret redaction in errors
- Unit tests and CI
