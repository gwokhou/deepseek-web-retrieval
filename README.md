# DeepSeek Web Retrieval

**Bringing [DeepSeek's in-house Search and Fetch APIs](https://api-docs.deepseek.com/guides/search) to coding agents.**

An adapter layer for coding agents. The core is agent-agnostic; each adapter exposes the
same retrieval behavior to a specific agent. OpenCode v2 has a native plugin adapter, and
an MCP server covers MCP-capable hosts, with Pi as the first guided host. Guides for other
coding agents are in progress.

This is an unofficial community project. It is not affiliated with OpenCode or DeepSeek.

## Features

- **One core, every host** — a native OpenCode v2 plugin plus a stdio MCP
  server for everything else; identical retrieval behavior on each
- **Tiered routing** — optional, preferred, forced, or off, per capability;
  forced refuses when exclusivity is impossible
- **Plan-then-apply installer** — every write previewed as old → new before
  touching disk; arrays merge instead of replacing; uninstall reverses
  exactly what was applied
- **Trap-aware detection** — catches what the agents' own docs don't warn
  about: Codex's silent `[tools] web_search` no-op, Pi's codemode hiding MCP
  tools; conflicting rules and web-capable servers surface in the plan
- **Git-safe installs** — the key never enters config files
  (`${DEEPSEEK_API_KEY}` indirection or `env_vars`), so a project-scope
  install commits clean
- **Fails loudly, never falls back** — no silent provider switches;
  localhost and private URLs blocked before they leave the machine

## Usage

Shipped adapters:

- [OpenCode v2 setup and usage](docs/agents/opencode-v2.md) — native plugin API
- [Pi setup and usage](docs/agents/pi.md) — MCP server over stdio
- [Codex setup and usage](docs/agents/codex.md) — MCP server over stdio

The MCP server works with any host that supports MCP tools over stdio. The
`deepseek-web-retrieval init` CLI installs it with plan-then-apply semantics — search and
fetch tiers chosen per capability, project or global scope, snapshots for rollback. For
how coding agents integrate—native websearch providers, native fetch tools, MCP, or
wrappers—see the
[integration model](docs/integration.md) with its version-locked host support matrix, the
[control-level research](docs/research/control-matrix.md), and the
[MCP compatibility research](docs/research/mcp-compatibility.md). A host is listed as supported
only after an adapter and guide exist.

For shared search, fetch, retry, and privacy behavior, see below.

## General behavior

What this adapter layer adds on top of the
[DeepSeek Search and Fetch APIs](https://api-docs.deepseek.com/guides/search) — the APIs'
own capabilities (Markdown-only output, no JavaScript rendering, no private networks or
binary files, per-request billing) are documented there.

### Search

- Requests summaries only (`need_content: false`, `summary` falling back to `snippet`);
  full page content never enters the results.
- Returns at most ten results by default (matching the API's `count` default and the
  industry norm for AI-native search APIs), deduplicating URLs. Optional
  `rerank_score` and `authority` thresholds are off by default; when enabled they
  drop results below the configured score or tier.
- Builds `blockedDomains`, `includeDomains`, and `language` into query operators and
  rejects the final query locally when it exceeds the API's 128-character limit.
- An empty result set is normal and is not an error.

### Fetch

- Output is capped at 16,000 characters by default, including the title; a
  `[content truncated]` marker is added when the limit leaves room for it.
- A page that already opens with its title as a top-level heading does not get a
  duplicate title.
- Responses larger than 5 MiB are rejected before parsing; URLs must be absolute
  `http://` or `https://`, credential-free, and at most 8,192 characters.
- `format: "text"` and `format: "html"` are rejected rather than misrepresented.
- Allowed/blocked domain lists and private-host blocking are enforced on the client,
  before a request leaves the machine.

### Timeouts and retries

Request timeouts include reading the response body. Retryable responses are 408, 425, 429,
and 5xx; `Retry-After` is honored up to 10 seconds. Other failures, including 401, timeouts,
and network errors, fail without retrying.

### No automatic fallback

If no API key is available, Search and Fetch fail. If DeepSeek is unavailable, returns an
error, or times out, the request fails. The tool does not silently switch to another search
provider or fetch implementation.

### Privacy and cost

Queries and URLs are sent to `https://api.deepseek.com`; the API key is sent only as a
Bearer token to DeepSeek and to nothing else. Retrieval is billed per successful request —
see the official docs for pricing and rate limits before enabling a team deployment.

## Development

```bash
bun install
bun run typecheck
bun test
```

The test suite mocks the DeepSeek HTTP API and the OpenCode plugin host, and drives the
MCP server with SDK clients pinned to each supported protocol revision. Real API calls
require a funded DeepSeek account. Shared retrieval logic lives in `src/core/`; adapters
live in `src/<agent>/` (the cross-host MCP server lives in `src/mcp/`). Adapter docs live
in `docs/agents/<agent>.md`.

## Prior art

Other community projects in this space include:

- [overwaven/opencode-deepseek-web](https://github.com/overwaven/opencode-deepseek-web)
- [JOEYZYC/opencode-deepseek-websearch](https://github.com/JOEYZYC/opencode-deepseek-websearch)
- [gtoxlili/opencode-deepseek-websearch](https://github.com/gtoxlili/opencode-deepseek-websearch)
- [OniVe/opencode-websearch-deepseek](https://github.com/OniVe/opencode-websearch-deepseek)

## License

MIT. See [LICENSE](LICENSE).
