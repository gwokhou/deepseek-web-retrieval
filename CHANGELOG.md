# Changelog

All notable changes to this project are documented here.

## Unreleased

- Categorize `docs/`: per-agent guides in `docs/agents/`, research notes in
  `docs/research/`, and design notes in `docs/design/`; the integration hub and
  `docs/hosts.jsonc` stay at the root
- Add `docs/research/control-matrix.md`: control-tier research (optional / preferred /
  forced, per host and capability) with a consolidated per-host reference — built-in web
  tools and their kill switches, MCP registration, and rules files. The control matrix is
  generated from the new `control` field in `docs/hosts.jsonc` (`bun run docs:matrix`;
  drift fails tests)
- Correct the Continue host note (the CLI has no built-in `search_web`; it is
  IDE-extension-only) and state the built-in web tools in the Codex, Cursor, Devin, and
  Copilot notes; extend the host-evaluation checklist with the rules and built-in
  kill-switch questions
- Move install-time tier planning to `docs/design/installer-design.md`, and fold the
  `docs/research/mcp-compatibility.md` per-host setup notes and quirk catalog into the
  control-matrix per-host reference; `integration.md` host notes now link there instead
  of restating details
- Fix the hosts.jsonc drift guard: the matrix renderer no longer rewrites
  docs/integration.md when imported by tests, and CI and `bun run check` now fail
  on drift (`docs:matrix --check`)
- Serve both MCP tools end to end at every pinned client revision, not only
  `listTools`
- Build `dist/cli.js` on demand for the stdio smoke test instead of silently
  skipping it on a fresh checkout
- Share the fetch pipeline (parse, host policy, fetch, format) between the
  OpenCode and MCP adapters through `fetchDocument` in the core
- Stop restating host version locks in narrative docs; reference
  `docs/hosts.jsonc` instead
- Pin the e2e Docker base image (`node:22.23.3-slim`) and correct the 0.2.0
  changelog wording about where e2e versions are pinned
- Type the `DEEPSEEK_*` environment mapping so option keys and variable names
  cannot drift apart

## 0.2.0

- Make `docs/hosts.jsonc` the single source of truth for host facts: the
  integration.md host table is generated from it (`bun run docs:matrix`, drift fails
  tests), CI matrices and the e2e Docker build args derive from it, and narrative
  docs reference it instead of restating version locks
- Add a local-only end-to-end script (`bun run test:e2e`): a keyless real
  `pi mcp list` handshake against the built server, and a headless `opencode run`
  scenario that makes real billed requests; never run in CI. Agents run inside
  Docker with versions injected from `docs/hosts.jsonc` as Docker build args
  (`--local` opts out)
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
