# Codex

Codex adapter for [DeepSeek Web Retrieval](../../README.md).

Integration mechanism: MCP server over stdio, registered in Codex's `~/.codex/config.toml`.
Codex negotiates MCP revision `2025-06-18` (with `mcp_2026_07_28` behind a feature flag); the
server also accepts clients from `2024-11-05` through `2026-07-28`, so the same build works
for other MCP hosts (see [the compatibility research](../research/mcp-compatibility.md)).

When registered, it adds:

- A `deepseek_web_search` tool backed by DeepSeek Search
- A `deepseek_fetch` tool backed by DeepSeek Fetch

The tools appear in Codex as `mcp__deepseek__deepseek_web_search` and
`mcp__deepseek__deepseek_fetch`. Codex's built-in `web_search` tool is not replaced; see
[Control tiers](#control-tiers) for routing it away.

The server recognizes Codex's MCP client identity (`codex-mcp-client`, declared in the
initialize handshake) and returns text-only tool results: Codex replaces the content
blocks with the serialized `structuredContent` JSON when it is present, so for Codex the
structured mirror is omitted and the model reads clean Markdown. Other clients receive
both the text and `structuredContent`.

For shared search/fetch limits, retries, and privacy behavior, see
[General behavior](../../README.md#general-behavior).

## Requirements

- Codex at the tested version in [`docs/hosts.jsonc`](../hosts.jsonc); init reports
  version drift, and newer versions may require rechecking routing behavior
- Node.js 20 or newer (`npx` runs the server)
- A DeepSeek account with access to `/v1/tools/search` and `/v1/tools/fetch`
- A funded DeepSeek account; Search and Fetch are billed per successful request
- `DEEPSEEK_API_KEY` set in the shell that launches Codex

## Install

The quickest option is the installer CLI:

```bash
npx deepseek-web-retrieval init --host codex --scope global \
  --search <tier> --fetch <tier>
```

It prints the full plan — every file, old value → new value, and notes about existing
MCP servers — and writes nothing until you pass `--apply`. `uninstall` removes recorded
additions and restores snapshotted values that have not since been edited. Codex's config
lives in `~/.codex/config.toml` at the user level only, so the server registration and kill switch
are written there even for `--scope project`; the rules file follows the scope. An `off`
capability is written as the tool's name in the server entry's `disabled_tools` array —
Codex's own mechanism — merging with any entries you put there yourself. When `codex` is
on PATH, `init` also probes `codex --version` and adds a plan note when the installed
release differs from the tested lock (see
[hosts.jsonc](../hosts.jsonc)) — version-anchored behavior such as the kill switch may
have drifted between the two.

For an existing installer-managed setup, follow the
[upgrade instructions](../integration.md#upgrading-existing-installs) from the original
project directory and scope.

### Manual install

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.deepseek]
command = "npx"
args = ["-y", "deepseek-web-retrieval"]
env_vars = ["DEEPSEEK_API_KEY"]
```

> [!NOTE]
> `env_vars` is load-bearing. Codex stdio children do not inherit the parent
> environment — only `HOME`, `PATH`, and a few system variables — so the key must be
> forwarded explicitly and set in the shell that launches Codex. Literal values can go
> in an `env` table instead if you prefer them in the file.

To disable one capability, add its raw tool name to the server's `disabled_tools` —
Codex removes the tool from the model's context while the server keeps running:

```toml
[mcp_servers.deepseek]
command = "npx"
args = ["-y", "deepseek-web-retrieval"]
env_vars = ["DEEPSEEK_API_KEY"]
disabled_tools = ["deepseek_web_search"]   # or deepseek_fetch; at least one must stay on
```

The names match verbatim what the server declares (`deepseek_web_search`,
`deepseek_fetch`). The server also honors `DEEPSEEK_ENABLE_SEARCH`/`DEEPSEEK_ENABLE_FETCH`
in the `env` table if you prefer switching the tools off at the source; the installer uses
`disabled_tools`.

### Local checkout

```bash
git clone https://github.com/gwokhou/deepseek-web-retrieval.git
cd deepseek-web-retrieval && bun install && bun run build
```

```toml
[mcp_servers.deepseek]
command = "node"
args = ["/absolute/path/to/deepseek-web-retrieval/dist/cli.js"]
env_vars = ["DEEPSEEK_API_KEY"]
```

## Control tiers

Codex ships a built-in `web_search` tool (default `cached` mode, an OpenAI index) and no
built-in fetch tool, so the tiers differ per capability:

| Capability | Optional | Preferred | Forced |
| --- | --- | --- | --- |
| Search | Tools registered; the built-in `web_search` stays available | Plus an AGENTS.md rules block steering the model to `mcp__deepseek__deepseek_web_search` | Exclusion: `web_search = "disabled"` at the top level of config.toml |
| Fetch | Tools registered | Plus the rules block | De-facto: no built-in fetch tool exists |

The installer maps each tier to these artifacts. `AGENTS.md` rules land in
`~/.codex/AGENTS.md` (user) or `./AGENTS.md` (project); Codex reads both plus every
`AGENTS.md` from the project root to the cwd.

> [!WARNING]
> The `[tools] web_search = <bool>` form parses but is a **silent no-op** at 0.163.0 —
> only the top-level `web_search` key controls the tool. The installer refuses to plan
> when it finds the trap in your config.

## Authentication

`DEEPSEEK_API_KEY` is the only source; MCP has no host credential store. It is forwarded
to the server via `env_vars` and read per request, sent only to `api.deepseek.com` as a
Bearer token. Without it the server exits at startup with a message on stderr.

## Usage

Ask naturally:

```text
Search the web for the latest Codex MCP config changes and cite the sources.
Fetch https://learn.chatgpt.com/docs/extend/mcp and summarize the config keys.
```

The model calls `mcp__deepseek__deepseek_web_search` or `mcp__deepseek__deepseek_fetch`.

The search tool accepts an optional `original_question` argument — the user's question in
their own words — forwarded as DeepSeek's `ori_question` to sharpen search intent; omit it
when the query already stands alone.

## Configuration

Set these in the server's `env` table. Values map onto the shared option pipeline, so
defaults and clamping match the other adapters. `DEEPSEEK_API_KEY` goes in `env_vars`.

> [!NOTE]
> A shared config file — `~/.config/deepseek-web-retrieval/config.json`, camelCase keys —
> sits under the environment layer and works with no env forwarding at all: the server
> reads the file itself, making it the way to set knobs without editing `env_vars` (the
> installer's `env_vars` entry also forwards every `DEEPSEEK_*` name). The file carries
> neither the API key nor the host-integration switches. Run
> `npx deepseek-web-retrieval config` to see every knob's effective value and source
> (it replays file warnings visibly and exits 1 on file problems); `config --search "<query>"`
> verifies key, config, and network with one billed search.

### Search

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_ENABLE_SEARCH` | `true` | Register the search tool. Only an explicit `false`/`0`/`no`/`off` disables it; at least one tool must stay enabled. |
| `DEEPSEEK_SEARCH_COUNT` | `10` | Results requested from DeepSeek, 1–50. Billing is per request, not per result. |
| `DEEPSEEK_SEARCH_MAX_RESULTS` | `10` | Results returned to the model after filtering, 0–50; defaults to `DEEPSEEK_SEARCH_COUNT` when unset. `0` returns no results. |
| `DEEPSEEK_SEARCH_MIN_RERANK` | `0` | Drop results below this relevance score (0–3); results without a finite score pass at zero and are dropped at a positive threshold. |
| `DEEPSEEK_SEARCH_MIN_AUTHORITY` | `0` | Drop known authorities below this tier. Authority is 0–4. |
| `DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY` | `true` | Keep results whose authority is missing or unknown. Set `false`/`0`/`no`/`off` to drop them. |
| `DEEPSEEK_SEARCH_BLOCKED_DOMAINS` | unset | Comma-separated; adds `-site:` operators to the query. |
| `DEEPSEEK_SEARCH_INCLUDE_DOMAINS` | unset | Comma-separated; restricts results with `site:` operators. |
| `DEEPSEEK_SEARCH_LANGUAGE` | unset | Adds a `lang:` operator, for example `zh,en`. |
| `DEEPSEEK_SEARCH_LOCALIZATION` | unset | Valid IPv4 or IPv6 address sent as DeepSeek's `localization` to prefer geo-localized results; invalid values are ignored. Deployment-level only, never a per-call parameter. |
| `DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS` | `1200` | Per-result summary cap, 0–1,000,000. |
| `DEEPSEEK_SEARCH_TIMEOUT_MS` | `30000` | Search timeout, 1,000–120,000 ms. |

### Fetch

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_ENABLE_FETCH` | `true` | Register the fetch tool. Same false-only semantics as `DEEPSEEK_ENABLE_SEARCH`. |
| `DEEPSEEK_FETCH_MAX_CHARS` | `16000` | Maximum characters returned, including the title, 0–1,000,000. |
| `DEEPSEEK_FETCH_TIMEOUT_MS` | `30000` | Fetch timeout, 1,000–120,000 ms. |
| `DEEPSEEK_FETCH_ALLOWED_DOMAINS` | unset | If set, only these hosts and subdomains may be fetched. |
| `DEEPSEEK_FETCH_BLOCKED_DOMAINS` | unset | Always block these hosts and subdomains. Blocked wins over allowed. |
| `DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS` | `true` | Reject localhost, private IPs, `.local`, `.internal`, and similar hosts. |

### Credentials and retries

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | required | DeepSeek API key, forwarded via `env_vars`. The server refuses to start without it. |
| `DEEPSEEK_MAX_RETRIES` | `2` | Retries for 408, 425, 429, and 5xx responses, 0–5. |
| `DEEPSEEK_RETRY_BASE_DELAY_MS` | `250` | Base delay for exponential backoff. `Retry-After` is honored up to 10 seconds. |

## Troubleshooting

| Error or symptom | What to do |
| --- | --- |
| Server fails to start or `HTTP 401` from the tools | `DEEPSEEK_API_KEY` must be set in the shell that launches Codex and forwarded via `env_vars`; stdio children do not inherit the environment. |
| Both tools missing after startup | At least one of `DEEPSEEK_ENABLE_SEARCH`/`DEEPSEEK_ENABLE_FETCH` must stay enabled; the server exits when both are false. |
| Search still uses the built-in tool under the forced tier | The kill switch is the top-level `web_search = "disabled"` key; the `[tools] web_search` form is a no-op at 0.163.0. |
| Tool results look like raw JSON | The server omits `structuredContent` for Codex's `codex-mcp-client` client identity so the model reads Markdown; if JSON still appears, a newer Codex renamed the identity — report it. |
| Tools time out before the configured DeepSeek timeout | Codex's per-server `tool_timeout_sec` defaults to 300 s — above the 120 s `DEEPSEEK_*_TIMEOUT_MS` maximum — so this only happens if you lowered it; raise it back above the DeepSeek timeout. |
| Routing not exclusive | Other `[mcp_servers.*]` entries stay registered and are noted in the plan. Under a forced tier, an entry that looks web-capable makes `init` refuse — Codex has no per-server kill switch, so remove the server or restrict its tools via `disabled_tools` by hand. |
| `HTTP 402`, `HTTP 429` | Top up the DeepSeek account; wait, reduce concurrency, or set `DEEPSEEK_MAX_RETRIES`. |
| Fetch fails on localhost or an internal URL | Use a local fetch tool; DeepSeek cannot reach private networks. |

## Compatibility

| Component | Version |
| --- | --- |
| Codex | locked in [`docs/hosts.jsonc`](../hosts.jsonc) |
| MCP revision | `2025-06-18` negotiated (`mcp_2026_07_28` behind a flag); server accepts `2024-11-05`–`2026-07-28` |
| MCP SDK | `@modelcontextprotocol/server` 2.3.1 |
| Runtime | Node.js 20+ (stdio) |
| DeepSeek API | `/v1/tools/search`, `/v1/tools/fetch` |

Tested with Codex 0.163.0 on Linux over stdio.

## Uninstall

```bash
npx deepseek-web-retrieval uninstall --host codex --scope global
```

This restores snapshotted `web_search` and `mcp_servers.deepseek` values only when their
current values still match what the installer wrote, removes the managed rules block,
and deletes installer-created config files only when left empty. Later user edits to
configuration values are kept and reported. For a manual installation, remove the
`[mcp_servers.deepseek]` table, any `deepseek-web-retrieval` rules block in your
`AGENTS.md`, and the top-level `web_search` key if it was only set for the forced tier.
