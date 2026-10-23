# DeepSeek Web Retrieval

**DeepSeek Search and Fetch for OpenCode, Pi, and Codex.**

Search the web and fetch pages as Markdown through
[DeepSeek's APIs](https://api-docs.deepseek.com/guides/search), using a **native OpenCode
plugin**, a **native Pi extension**, or **MCP for Codex**. All three share the same retrieval
core, with results formatted for each host.

This is an unofficial community project, not affiliated with DeepSeek or the supported
host projects.

## Features

- **One package, three hosts** — a native OpenCode v2 plugin, a native Pi extension,
  and a stdio MCP server for Codex, all sharing one retrieval core
- **Routing control per tool** — search and fetch are set independently to optional,
  preferred, forced, or off; the tier table in Usage explains each
- **Review before anything is written** — `init` prints the full plan and writes only
  with `--apply`; uninstall restores from snapshots while preserving edits you made
  afterwards
- **Knows the host's web landscape** — detects conflicting web tools and rules,
  configures Pi's MCP fallback for direct tool exposure, and reports Codex version
  drift
- **Your key never enters a config file** — installs reference the environment
  (`${DEEPSEEK_API_KEY}` indirection or `env_vars`), so a project-scope install
  commits clean
- **Fails loudly, never switches silently** — no fallback to another provider, and
  localhost/private URLs are blocked before a request leaves the machine

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

`--search` and `--fetch` each pick a tier — how strongly the host steers toward the
DeepSeek tool, chosen independently per capability:

| Tier | Effect |
| --- | --- |
| `optional` | The tool is declared; the model picks freely among its web tools |
| `preferred` | Rules files steer the model toward the DeepSeek tool — probable, not guaranteed |
| `forced` | Built-in competitors are disabled or replaced so routing is deterministic; the installer refuses rather than pretend when a host cannot guarantee it |
| `off` | The capability is not installed |

A preview run writes nothing. It prints the complete plan — every file it would touch
and every old value → new value:

```console
$ npx deepseek-web-retrieval init --host codex --scope global --search preferred --fetch preferred
Install plan: codex (global scope)
Tiers: search=preferred, fetch=preferred

Files:
  ~/.codex/config.toml
    set mcp_servers.deepseek = {"command":"npx","args":["-y","deepseek-web-retrieval"],"env_vars":["DEEPSEEK_API_KEY"]} (was (absent))
  ~/.codex/AGENTS.md
    upsert marked rules block

Notes:
  - Codex stdio children do not inherit the parent environment, so the entry forwards DEEPSEEK_API_KEY explicitly via env_vars; the key must be set in the shell that launches Codex.
  - Rules block upserted in ~/.codex/AGENTS.md; Codex reads ~/.codex/AGENTS.md plus every AGENTS.md from the project root to the cwd.
  - Shared config ownership is recorded in ~/.codex/.config.toml.deepseek-web-retrieval.codex.owner.json; uninstall releases it. Keep this local metadata with the config.

Plan only — re-run with --apply to write these changes.
```

Repeat your chosen command with `--apply` to write the plan. The host guides explain
activation steps and per-host tier limits. Pi defaults to the extension path; add
`--path mcp` to use its MCP fallback.

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
  industry norm for AI-native search APIs), deduplicating URLs.
- Optional `rerank_score` and `authority` thresholds are off by default — the default
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
