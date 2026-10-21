# DeepSeek Web Retrieval

**DeepSeek Search and Fetch for OpenCode, Pi, and Codex.**

Search the web and fetch pages as Markdown through
[DeepSeek's APIs](https://api-docs.deepseek.com/guides/search), using a **native OpenCode
plugin**, a **native Pi extension**, or **MCP for Codex**. All three share the same retrieval
core, with results formatted for each host.

This is an unofficial community project, not affiliated with DeepSeek or the supported
host projects.

## Features

- **Three supported hosts** — OpenCode v2 and Pi use their own plugin and extension APIs;
  Codex uses the included stdio MCP server
- **Tiered routing** — optional, preferred, forced, or off, per capability;
  forced refuses when exclusivity is impossible
- **Preview and recovery** — review configuration changes before applying them;
  uninstall uses saved snapshots and preserves subsequent user edits to configuration values
- **Host-aware setup** — detects conflicting web tools and rules, configures Pi's MCP
  fallback for direct tool exposure, and reports Codex version drift
- **Git-safe installs** — the key never enters config files
  (`${DEEPSEEK_API_KEY}` indirection or `env_vars`), so a project-scope
  install commits clean
- **Explicit failures** — no silent provider switches; localhost and private URLs are
  blocked by default before they leave the machine

## Usage

Choose your host:

| Host | Default integration | Setup |
| --- | --- | --- |
| OpenCode v2 | Native plugin: search provider and Fetch tools | [OpenCode guide](docs/agents/opencode-v2.md) |
| Pi | Native extension: Search and Fetch tools; MCP also available | [Pi guide](docs/agents/pi.md) |
| Codex | MCP server over stdio, with readable text results | [Codex guide](docs/agents/codex.md) |

The installer CLI requires Node.js 20+ and npm. Retrieval requires a DeepSeek API key
with access to Search and Fetch and sufficient account balance. Set `DEEPSEEK_API_KEY`
in the environment that launches your host; OpenCode can also use its stored DeepSeek key.

Run the command for your host to preview a configuration:

```bash
# OpenCode: select DeepSeek as the search provider and prefer its Fetch tool.
npx deepseek-web-retrieval init --host opencode --scope project --search forced --fetch preferred

# Pi: use the native extension and prefer both tools.
npx deepseek-web-retrieval init --host pi --scope project --search preferred --fetch preferred

# Codex: register the MCP server and prefer both tools.
npx deepseek-web-retrieval init --host codex --scope global --search preferred --fetch preferred
```

Review the plan, then repeat your chosen command with `--apply` to write it. Choose
tiers and scope for your workflow; the host guides explain their effects and activation
steps. Pi defaults to the extension path; add `--path mcp` to use its MCP fallback.

Other stdio MCP hosts may use the server, but the supported setup guides and installer
currently cover the three hosts above. See the [integration model](docs/integration.md)
for tested versions and the [control tiers](docs/research/control-matrix.md) for routing
limits. For an existing installation, follow the
[upgrade instructions](docs/integration.md#upgrading-existing-installs).

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
  `rerank_score` and `authority` thresholds are off by default — the default
  returns exactly what DeepSeek ranked, including results without a score;
  when a positive threshold is set, results below it (or without a score to
  compare) are dropped.
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

Request timeouts include reading the response body. Retries are disabled by default;
when enabled, retryable responses are 408, 425, 429, and 5xx, and `Retry-After` is honored
up to 10 seconds. Other failures, including 401, timeouts, and network errors, fail
without retrying.

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
bun run check
```

Use `bun run lint:fix` to apply Biome's safe lint fixes and formatting. See
[CONTRIBUTING.md](CONTRIBUTING.md) for development checks, e2e scenarios, and
[automated tag releases](CONTRIBUTING.md#automated-releases).

The test suite mocks the DeepSeek HTTP API and the OpenCode and Pi host APIs, and drives the
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
