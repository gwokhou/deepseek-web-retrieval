# DeepSeek Web Retrieval

**DeepSeek Search and Fetch for OpenCode, Pi, Codex, and Claude Code.**

Search the web and fetch pages as Markdown through
[DeepSeek's APIs](https://api-docs.deepseek.com/guides/search), using a **native OpenCode
plugin**, a **native Pi extension**, or **MCP for Codex and Claude Code**. All four share
the same retrieval core, with results formatted for each host.

This is an unofficial community project, not affiliated with DeepSeek or the supported
host projects.

Jump to: [Features](#features) · [Quickstart](#quickstart) · [Usage](#usage) ·
[General behavior](#general-behavior) · [Configuration](#configuration) ·
[Development](#development)

## Features

- **One package, four hosts** — a native OpenCode v2 plugin, a native Pi extension,
  and a stdio MCP server for Codex and Claude Code, all sharing one retrieval core
- **Routing control per tool** — search and fetch are set independently to optional,
  preferred, forced, or off; the tier table in Usage explains each
- **Review before anything is written** — `init` prints the full plan and writes only
  with `--apply`; uninstall restores from snapshots while preserving edits you made
  afterwards
- **Knows the host's web landscape** — detects conflicting web tools and rules,
  configures Pi's MCP fallback for direct tool exposure, and reports Codex and
  Claude Code version drift
- **Your key never enters a config file** — installs reference the environment
  (`${DEEPSEEK_API_KEY}` indirection or `env_vars`), so a project-scope install
  commits clean
- **Fails loudly, never switches silently** — no fallback to another provider, and
  localhost/private URLs are blocked before a request leaves the machine

## Quickstart

Requires Node.js 20+ and npm, plus a DeepSeek API key with Search and Fetch access
(retrieval is billed per successful request; the account needs balance).

```bash
export DEEPSEEK_API_KEY=sk-...
# Preview the plan for your host — nothing is written yet:
npx deepseek-web-retrieval init --host opencode --scope project --search forced --fetch preferred
# Re-run with --apply to write it:
npx deepseek-web-retrieval init --host opencode --scope project --search forced --fetch preferred --apply
```

For Pi, Codex, or Claude Code, other scopes, or finer routing control, see [Usage](#usage).

## Usage

Choose your host:

| Host | Default integration | Setup |
| --- | --- | --- |
| OpenCode v2 | Native plugin: search provider and Fetch tools | [OpenCode guide](docs/agents/opencode-v2.md) |
| Pi | Native extension: Search and Fetch tools; MCP also available | [Pi guide](docs/agents/pi.md) |
| Codex | MCP server over stdio, with readable text results | [Codex guide](docs/agents/codex.md) |
| Claude Code | MCP server over stdio in `.mcp.json` or `~/.claude.json` | [Claude Code guide](docs/agents/claude-code.md) |

Set `DEEPSEEK_API_KEY` in the environment that launches your host; OpenCode can also
use its stored DeepSeek key. Run `init` for your host to preview a configuration — the
command shape is the quickstart's; each host guide shows its recommended tiers.

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
    set mcp_servers.deepseek = {"command":"npx","args":["-y","deepseek-web-retrieval"],"env_vars":["DEEPSEEK_API_KEY","DEEPSEEK_... (was (absent))
  ~/.codex/AGENTS.md
    upsert marked rules block

Notes:
  - Codex stdio children do not inherit the parent environment, so the entry forwards DEEPSEEK_API_KEY and every DEEPSEEK_* option variable explicitly via env_vars; shell-set knobs reach the server without hand-editing config.toml (the shared config file works without any forwarding).
  - Rules block upserted in ~/.codex/AGENTS.md; Codex reads ~/.codex/AGENTS.md plus every AGENTS.md from the project root to the cwd.
  - Shared config ownership is recorded in ~/.codex/.config.toml.deepseek-web-retrieval.codex.owner.json; uninstall releases it. Keep this local metadata with the config.

Plan only — re-run with --apply to write these changes.
```

Repeat your chosen command with `--apply` to write the plan. The host guides explain
activation steps and per-host tier limits. Pi defaults to the extension path; add
`--path mcp` to use its MCP fallback.

Add `--pin` to register the exact version of the CLI you are running
(`deepseek-web-retrieval@<version>`) instead of the unpinned name, so hosts keep
resolving that release rather than every latest publish. The trade-off is no
auto-updates: re-run `init --pin` from a newer CLI to move the pin.

Other stdio MCP hosts may use the server, but the supported setup guides and installer
currently cover the four hosts above. See the [integration model](docs/integration.md)
for tested versions and the [control tiers](docs/research/control-matrix.md) for
routing limits. For an existing installation, follow the
[upgrade instructions](docs/integration.md#upgrading-existing-installs).

## General behavior

What this adapter layer adds on top of the
[DeepSeek Search and Fetch APIs](https://api-docs.deepseek.com/guides/search) — the APIs'
own capabilities (Markdown-only output, no JavaScript rendering, no private networks or
binary files, per-request billing) are documented there.

| Default | Value | Knob |
| --- | --- | --- |
| Results per search | 10 | `count` |
| Fetch output cap | 16,000 characters | `fetchMaxChars` |
| Search summary cap | 1,200 characters | `maxSummaryChars` |
| Request timeout, body read included | 30 s | `searchTimeoutMs` / `fetchTimeoutMs` |
| Transient retries | 2 (range 0–5) | `maxRetries` |

### Search

- Requests summaries only (`need_content: false`, falling back from `summary` to
  `snippet`); full page content never enters the results.
- Deduplicates URLs; an empty result set is normal, not an error.
- Builds `blockedDomains`, `includeDomains`, and `language` into query operators, and
  rejects the final query locally when it exceeds the API's 128-character limit.
- Optional `rerank_score` and `authority` thresholds are off by default — the default
  returns exactly what DeepSeek ranked. A positive threshold drops results below it.
  A missing `rerank_score` is dropped too; an unknown `authority` stays unless
  `allowUnknownAuthority` is set to false.
- On the paths where this package defines the search tool's inputs (the MCP server and
  the Pi extension), the tool accepts an optional `original_question`: the user's
  question in their own words. It is forwarded as DeepSeek's `ori_question`, trimmed
  and truncated to 128 characters; on the Pi extension, a blank input falls back to the
  most recent user message in the session.

### Fetch

- Output is capped per the table above, title included; a `[content truncated]` marker
  is added when the limit leaves room for it.
- A page that already opens with its title as a top-level heading does not get a
  duplicate title.
- URLs must be absolute `http://` or `https://`, credential-free, and at most 8,192
  characters; responses larger than 5 MiB are rejected before parsing.
- `format: "text"` and `format: "html"` are rejected rather than misrepresented.
- Allowed/blocked domain lists and private-host blocking are enforced on the client,
  before a request leaves the machine.

### Timeouts and retries

Request timeouts include reading the response body. Transient failures are retried per
the table; retryable responses are 408, 425, 429, and 5xx, and `Retry-After` is honored
up to 10 seconds. Other failures — including 401, timeouts, and network errors — fail
without retrying.

### No automatic fallback

If no API key is available, Search and Fetch fail. If DeepSeek is unavailable, returns
an error, or times out, the request fails. The tool does not silently switch to another
search provider or fetch implementation.

### Privacy and cost

Queries and URLs are sent to `https://api.deepseek.com`; the API key is sent only as a
Bearer token to DeepSeek and to nothing else. Retrieval is billed per successful request —
see the official docs for pricing and rate limits before enabling a team deployment.

## Configuration

Every knob resolves through one chain, low → high, identically on every host:

`built-in defaults < shared config file < DEEPSEEK_* environment < host-native config`

A higher layer always wins, so nothing already configured loses effect.

The shared file works on every host and takes camelCase keys:
`$XDG_CONFIG_HOME/deepseek-web-retrieval/config.json` — by default
`~/.config/deepseek-web-retrieval/config.json` on Linux and macOS and
`%APPDATA%\deepseek-web-retrieval\config.json` on Windows.

```json
{
  "count": 20,
  "blockedDomains": ["pinterest.com"],
  "language": "zh",
  "searchLocalization": "203.0.113.7"
}
```

Unknown keys and host-integration keys are warned about on stderr and ignored. The API
key does not go in the file — it keeps its existing channels (`DEEPSEEK_API_KEY` in the
environment, or OpenCode's stored credential).

Which layer to set for a knob, the full file-key ↔ `DEEPSEEK_*` mapping, per-knob
defaults, and special semantics live in the [configuration guide](docs/configuration.md).
Per-host mechanics — how the environment reaches a stdio server, each host's output caps
and deadlines — live in the host guides: [Codex](docs/agents/codex.md),
[Claude Code](docs/agents/claude-code.md),
[Pi](docs/agents/pi.md), [OpenCode](docs/agents/opencode-v2.md).

To see what actually resolves, run `npx deepseek-web-retrieval config`: every knob
printed with its value and its source (`default`, `file`, or `env`). Problems in the
file or in `DEEPSEEK_*` variables are replayed as visible warnings, and it exits 1 when
there are any — so it doubles as a dotfile CI check. `npx deepseek-web-retrieval config
--search "<query>"` runs one billed search through the effective configuration to verify
the key, config, and network end to end.

## Development

```bash
bun install
bun run check
```

Use `bun run lint:fix` to apply Biome's safe lint fixes and formatting. See
[CONTRIBUTING.md](CONTRIBUTING.md) for development checks, e2e scenarios, and
[automated tag releases](CONTRIBUTING.md#automated-releases).

The test suite mocks the DeepSeek API and the OpenCode and Pi host APIs; real API calls
require a funded DeepSeek account. Shared retrieval logic lives in `src/core/`; adapters
live in `src/<agent>/` (the cross-host MCP server lives in `src/mcp/`), with adapter docs
in `docs/agents/<agent>.md`.

## Prior art

Other community projects in this space include:

- [overwaven/opencode-deepseek-web](https://github.com/overwaven/opencode-deepseek-web)
- [JOEYZYC/opencode-deepseek-websearch](https://github.com/JOEYZYC/opencode-deepseek-websearch)
- [gtoxlili/opencode-deepseek-websearch](https://github.com/gtoxlili/opencode-deepseek-websearch)
- [OniVe/opencode-websearch-deepseek](https://github.com/OniVe/opencode-websearch-deepseek)

## License

MIT. See [LICENSE](LICENSE).
