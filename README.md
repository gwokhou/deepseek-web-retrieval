# DeepSeek Web Retrieval

**Bringing [DeepSeek's in-house Search and Fetch APIs](https://api-docs.deepseek.com/guides/search) to coding agents.**

An adapter layer for coding agents. The core is agent-agnostic; each adapter exposes the
same retrieval behavior to a specific agent. OpenCode v2 has a native plugin adapter, and
an MCP server covers MCP-capable hosts, with Pi as the first guided host. Guides for other
coding agents are in progress.

This is an unofficial community project. It is not affiliated with OpenCode or DeepSeek.

## Usage

Shipped adapters:

- [OpenCode v2 setup and usage](docs/agents/opencode-v2.md) — native plugin API
- [Pi setup and usage](docs/agents/pi.md) — MCP server over stdio

The MCP server works with any host that supports MCP tools over stdio; Pi is the first
host with a shipped guide. For how other coding agents integrate—native websearch
providers, native fetch tools, MCP, or wrappers—see the
[integration model](docs/integration.md) with its version-locked host support matrix, and
the [MCP compatibility research](docs/research/mcp-compatibility.md). A host is listed as supported
only after an adapter and guide exist.

For shared search, fetch, retry, and privacy behavior, see below.

## General behavior

### Search

- Sends `need_content: false` and returns DeepSeek's `summary`, falling back to `snippet`.
- Filters by `rerank_score` and `authority`, deduplicates URLs, and returns at most five
  results by default.
- The final query, including `blockedDomains`, `includeDomains`, and `language` operators,
  must be 128 characters or fewer. Longer queries are rejected locally.
- An empty result set is normal and is not an error.

### Fetch

- DeepSeek Fetch returns Markdown only. `format: "text"` and `format: "html"` are rejected.
- Output is capped at 16,000 characters by default, including the title. A
  `[content truncated]` marker is added when the limit leaves room for it.
- If the page already starts with the same title as a top-level heading, no duplicate title
  is added.
- Responses larger than 5 MiB are rejected before parsing.
- URLs must be absolute `http://` or `https://` URLs with a host, no embedded credentials,
  and at most 8,192 characters.
- The core supports allowed/blocked domain lists and private-host blocking. DeepSeek does
  not render JavaScript and cannot reach private networks; PDFs, images, and other binary
  files are unsupported.

### Timeouts and retries

Request timeouts include reading the response body. Retryable responses are 408, 425, 429,
and 5xx; `Retry-After` is honored up to 10 seconds. Other failures, including 401, timeouts,
and network errors, fail without retrying.

### No automatic fallback

If no API key is available, Search and Fetch fail. If DeepSeek is unavailable, returns an
error, or times out, the request fails. The tool does not silently switch to another search
provider or fetch implementation.

### Privacy and cost

Queries and URLs are sent to `https://api.deepseek.com`. The API key is sent only as a
Bearer token to DeepSeek. Search and Fetch are billed per successful request; check current
DeepSeek pricing and rate limits before enabling a team deployment. A 429 means you should
wait, reduce concurrency, or increase retries.

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
