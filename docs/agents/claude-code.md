# Claude Code

Claude Code adapter for [DeepSeek Web Retrieval](../../README.md).

Integration mechanism: MCP server over stdio, registered in Claude Code's own MCP config
files — `.mcp.json` at the project root (project scope) or the top-level `mcpServers` key
of `~/.claude.json` (user scope, where `claude mcp add --scope user` writes). Claude Code
negotiates MCP revision `2026-07-28`; the server accepts clients from `2024-11-05` through
`2026-07-28`, so the same build works for other MCP hosts (see
[the compatibility research](../research/mcp-compatibility.md)).

When registered, it adds:

- A `deepseek_web_search` tool backed by DeepSeek Search
- A `deepseek_fetch` tool backed by DeepSeek Fetch

The tools appear in Claude Code as `mcp__deepseek__deepseek_web_search` and
`mcp__deepseek__deepseek_fetch`. Claude Code's built-in `WebSearch` and `WebFetch` tools
are not replaced; see [Control tiers](#control-tiers) for routing them away.

For shared search/fetch limits, retries, and privacy behavior, see
[General behavior](../../README.md#general-behavior).
For configuration layers, the full knob mapping, and defaults, see the
[configuration guide](../configuration.md).

## Requirements

- Claude Code at the tested version in [`docs/hosts.jsonc`](../hosts.jsonc); init reports
  version drift, and newer versions may require rechecking routing behavior
- Node.js 20 or newer (`npx` runs the server)
- A DeepSeek account with access to `/v1/tools/search` and `/v1/tools/fetch`
- A funded DeepSeek account; Search and Fetch are billed per successful request
- `DEEPSEEK_API_KEY` set in the shell that launches Claude Code

## Install

The quickest option is the installer CLI:

```bash
npx deepseek-web-retrieval init --host claude-code --scope project \
  --search <tier> --fetch <tier>
```

It prints the full plan — every file, old value → new value, and notes about existing MCP
servers — and writes nothing until you pass `--apply`. Add `--pin` to register the exact
version of the CLI you are running instead of the always-latest package name. `uninstall`
removes recorded additions and restores snapshotted values that have not since been edited.
`--scope project` registers the server in `./.mcp.json` (shareable via VCS) and writes tier
artifacts to `./.claude/settings.json` and `./CLAUDE.md`; `--scope global` uses
`~/.claude.json`, `~/.claude/settings.json`, and `~/.claude/CLAUDE.md` instead — the two
scopes use disjoint files, so both can coexist. An `off` capability is written as the
tool's full id in the `permissions.deny` array — Claude Code's own mechanism, which removes
the tool from the model's context while the server keeps running — merging with any entries
you put there yourself. When `claude` is on PATH, `init` also probes `claude --version` and
adds a plan note when the installed release differs from the tested lock (see
[hosts.jsonc](../hosts.jsonc)) — version-anchored behavior such as the deny rules may have
drifted between the two.

For an existing installer-managed setup, follow the
[upgrade instructions](../integration.md#upgrading-existing-installs) from the original
project directory and scope.

### Manual install

Add the server to `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "deepseek": {
      "command": "npx",
      "args": ["-y", "deepseek-web-retrieval"],
      "env": { "DEEPSEEK_API_KEY": "${DEEPSEEK_API_KEY}" }
    }
  }
}
```

> [!NOTE]
> `"${DEEPSEEK_API_KEY}"` is Claude Code's own `${VAR}` expansion: the key is read from
> the environment that launches Claude Code and never sits in the file. A literal value
> works too if you prefer it in the file. For a user-scope install, the same entry goes
> under the top-level `mcpServers` key of `~/.claude.json`, or use
> `claude mcp add --scope user --env 'DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}' deepseek -- npx -y deepseek-web-retrieval`.

Claude Code asks once per project whether to use servers from `.mcp.json`; approve the
`deepseek` server when prompted (or via the `/mcp` menu), or its tools will not load in
that project.

To disable one capability, add the tool's full id to `permissions.deny` in
`.claude/settings.json` — Claude Code removes the tool from the model's context while the
server keeps running:

```json
{
  "permissions": {
    "deny": ["mcp__deepseek__deepseek_web_search"]
  }
}
```

The ids match the tool names verbatim (`mcp__deepseek__deepseek_web_search`,
`mcp__deepseek__deepseek_fetch`). The server also honors
`DEEPSEEK_ENABLE_SEARCH`/`DEEPSEEK_ENABLE_FETCH` in the server's `env` block if you prefer
switching the tools off at the source; the installer uses `permissions.deny`.

### Local checkout

```bash
git clone https://github.com/gwokhou/deepseek-web-retrieval.git
cd deepseek-web-retrieval && bun install && bun run build
```

```json
{
  "mcpServers": {
    "deepseek": {
      "command": "node",
      "args": ["/absolute/path/to/deepseek-web-retrieval/dist/cli.js"],
      "env": { "DEEPSEEK_API_KEY": "${DEEPSEEK_API_KEY}" }
    }
  }
}
```

## Control tiers

Claude Code ships built-in `WebSearch` and `WebFetch` tools; neither is replaceable, so
both capabilities use exclusion for the forced tier:

| Capability | Optional | Preferred | Forced |
| --- | --- | --- | --- |
| Search | Tools registered; the built-in `WebSearch` stays available | Plus a CLAUDE.md rules block steering the model to `mcp__deepseek__deepseek_web_search` | Exclusion: `permissions.deny: ["WebSearch"]` |
| Fetch | Tools registered; the built-in `WebFetch` stays available | Plus the rules block | Exclusion: `permissions.deny: ["WebFetch"]` |

The installer maps each tier to these artifacts. Deny entries land in
`~/.claude/settings.json` (user) or `./.claude/settings.json` (project) and merge with
your existing `permissions.deny` entries. The CLAUDE.md rules block lands in
`~/.claude/CLAUDE.md` (user) or `./CLAUDE.md` (project); Claude Code loads the user file
plus every CLAUDE.md from the cwd up the directory tree, concatenating the levels — so
the block steers wherever it is installed. Under a forced tier, other web-capable MCP
servers detected in the config are denied by server-level rules (`mcp__<server>` denies
every tool of that server), so routing stays exclusive.

> [!WARNING]
> Deny rules outrank allow rules at every settings level and **cannot be carved out** —
> denying `WebSearch` or `WebFetch` removes the tool for every workflow in the install's
> scope (every project on the machine for `--scope global`). A managed policy layer
> (`managed-settings.json`) outranks both files; the installer reports when one exists.

## Authentication

`DEEPSEEK_API_KEY` is the only source; MCP has no host credential store. It is forwarded
through the server's `env` block as `${DEEPSEEK_API_KEY}` and read per request, sent only
to `api.deepseek.com` as a Bearer token. Without it the server exits at startup with a
message on stderr.

## Usage

Ask naturally:

```text
Search the web for the latest Claude Code MCP config changes and cite the sources.
Fetch https://code.claude.com/docs/en/mcp and summarize the config keys.
```

The model calls `mcp__deepseek__deepseek_web_search` or `mcp__deepseek__deepseek_fetch`.

The search tool accepts an optional `original_question` argument — the user's question in
their own words — forwarded as DeepSeek's `ori_question` to sharpen search intent; omit it
when the query already stands alone.

Tool output is capped at 25k tokens by default (`MAX_MCP_OUTPUT_TOKENS`), and successful
text results longer than 50,000 characters are saved to a file and referenced — not
dropped silently.

## Configuration

Set these in the server's `env` block in `.mcp.json` (or `~/.claude.json`). Values map onto
the shared option pipeline, so defaults and clamping match the other adapters.
`DEEPSEEK_API_KEY` goes in the same block as the `${VAR}` expansion.

> [!NOTE]
> A shared config file — `~/.config/deepseek-web-retrieval/config.json`
> (Windows: `%APPDATA%\deepseek-web-retrieval\config.json`), camelCase keys —
> sits under the environment layer and works with no env forwarding at all: the server
> reads the file itself, making it the way to set knobs without editing the MCP entry. The
> file carries neither the API key nor the host-integration switches. Run
> `npx deepseek-web-retrieval config` to see every knob's effective value and source
> (it replays file warnings visibly and exits 1 on file problems); `config --search "<query>"`
> verifies key, config, and network with one billed search.

### Search

The "Config file" column names each key's camelCase twin in the shared config file —
one vocabulary pair, one pipeline. `—` marks host-integration entries the file rejects.

| Env variable | Config file | Default | Description |
| --- | --- | --- | --- |
| `DEEPSEEK_ENABLE_SEARCH` | — | `true` | Register the search tool. Only an explicit `false`/`0`/`no`/`off` disables it; at least one tool must stay enabled. |
| `DEEPSEEK_SEARCH_COUNT` | `count` | `10` | Results requested from DeepSeek, 1–50. Billing is per request, not per result. |
| `DEEPSEEK_SEARCH_MAX_RESULTS` | `maxResults` | `10` | Results returned to the model after filtering, 0–50; defaults to `DEEPSEEK_SEARCH_COUNT` when unset. `0` returns no results. |
| `DEEPSEEK_SEARCH_MIN_RERANK` | `minRerank` | `0` | Drop results below this relevance score (0–3); results without a finite score pass at zero and are dropped at a positive threshold. |
| `DEEPSEEK_SEARCH_MIN_AUTHORITY` | `minAuthority` | `0` | Drop known authorities below this tier. Authority is 0–4. |
| `DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY` | `allowUnknownAuthority` | `true` | Keep results whose authority is missing or unknown. Set `false`/`0`/`no`/`off` to drop them. |
| `DEEPSEEK_SEARCH_BLOCKED_DOMAINS` | `blockedDomains` | unset | Comma-separated; adds `-site:` operators to the query. |
| `DEEPSEEK_SEARCH_INCLUDE_DOMAINS` | `includeDomains` | unset | Comma-separated; restricts results with `site:` operators. |
| `DEEPSEEK_SEARCH_LANGUAGE` | `language` | unset | Adds a `lang:` operator, for example `zh,en`. |
| `DEEPSEEK_SEARCH_LOCALIZATION` | `searchLocalization` | unset | Valid IPv4 or IPv6 address sent as DeepSeek's `localization` to prefer geo-localized results; invalid values are ignored. Deployment-level only, never a per-call parameter. |
| `DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS` | `maxSummaryChars` | `1200` | Per-result summary cap, 0–1,000,000. |
| `DEEPSEEK_SEARCH_TIMEOUT_MS` | `searchTimeoutMs` | `30000` | Search timeout, 1,000–120,000 ms. |

### Fetch

| Env variable | Config file | Default | Description |
| --- | --- | --- | --- |
| `DEEPSEEK_ENABLE_FETCH` | — | `true` | Register the fetch tool. Same false-only semantics as `DEEPSEEK_ENABLE_SEARCH`. |
| `DEEPSEEK_FETCH_MAX_CHARS` | `fetchMaxChars` | `16000` | Maximum characters returned, including the title, 0–1,000,000. |
| `DEEPSEEK_FETCH_TIMEOUT_MS` | `fetchTimeoutMs` | `30000` | Fetch timeout, 1,000–120,000 ms. |
| `DEEPSEEK_FETCH_ALLOWED_DOMAINS` | `fetchAllowedDomains` | unset | If set, only these hosts and subdomains may be fetched. |
| `DEEPSEEK_FETCH_BLOCKED_DOMAINS` | `fetchBlockedDomains` | unset | Always block these hosts and subdomains. Blocked wins over allowed. |
| `DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS` | `fetchBlockPrivateHosts` | `true` | Reject localhost, private IPs, `.local`, `.internal`, and similar hosts. |

### Credentials and retries

| Env variable | Config file | Default | Description |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | required | DeepSeek API key, expanded from the launching environment via `${DEEPSEEK_API_KEY}`. The server refuses to start without it. |
| `DEEPSEEK_MAX_RETRIES` | `maxRetries` | `2` | Retries for 408, 425, 429, and 5xx responses, 0–5. |
| `DEEPSEEK_RETRY_BASE_DELAY_MS` | `retryBaseDelayMs` | `250` | Base delay for exponential backoff. `Retry-After` is honored up to 10 seconds. |

## Troubleshooting

| Error or symptom | What to do |
| --- | --- |
| Server fails to start or `HTTP 401` from the tools | `DEEPSEEK_API_KEY` must be set in the environment that launches Claude Code; the `${DEEPSEEK_API_KEY}` expansion in the server's `env` block reads it at launch. |
| Project tools missing after install | Claude Code asks once per project whether to use `.mcp.json` servers; approve the `deepseek` server when prompted or via the `/mcp` menu. |
| Both tools missing after startup | At least one of `DEEPSEEK_ENABLE_SEARCH`/`DEEPSEEK_ENABLE_FETCH` must stay enabled; the server exits when both are false. |
| Forced tier still shows the built-in tool | The kill switch is the bare deny rule in `permissions.deny` at the install's scope; a managed policy layer (`managed-settings.json`) outranks it — the plan reports when one exists. |
| Routing not exclusive | Other MCP servers stay registered and are noted in the plan. Under a forced tier, web-capable servers detected in the config (and the other scope's file) are denied by server-level `mcp__<server>` rules; a server added after install is not covered — re-run init. |
| Fetch results appear as a file reference instead of content | Tool output is capped at 25k tokens by default; raise `MAX_MCP_OUTPUT_TOKENS` or lower `DEEPSEEK_FETCH_MAX_CHARS`. |
| `HTTP 402`, `HTTP 429` | Top up the DeepSeek account; wait, reduce concurrency, or set `DEEPSEEK_MAX_RETRIES`. |
| Fetch fails on localhost or an internal URL | Use a local fetch tool; DeepSeek cannot reach private networks. |

## Compatibility

| Component | Version |
| --- | --- |
| Claude Code | locked in [`docs/hosts.jsonc`](../hosts.jsonc) |
| MCP revision | `2026-07-28` negotiated; server accepts `2024-11-05`–`2026-07-28` |
| MCP SDK | `@modelcontextprotocol/server` 2.3.1 |
| Runtime | Node.js 20+ (stdio) |
| DeepSeek API | `/v1/tools/search`, `/v1/tools/fetch` |

Verified against the Claude Code lock in `docs/hosts.jsonc` on Linux over stdio: the
installer's registration, tiers, and uninstall run in the keyless Docker e2e with a real
`claude mcp list` handshake. The billed prompt scenario (`bun run test:e2e claude-code`)
exercises the same build end to end and requires `DEEPSEEK_API_KEY`.

## Uninstall

```bash
npx deepseek-web-retrieval uninstall --host claude-code --scope project
```

This removes the recorded `mcpServers.deepseek` entry and the installer-appended
`permissions.deny` entries only when their current values still match what the installer
wrote, removes the managed rules block, and deletes installer-created config files only
when left empty. Later user edits to configuration values are kept and reported. For a
manual installation, remove the `deepseek` entry from `.mcp.json` (or `~/.claude.json`),
any `deepseek-web-retrieval` rules block in your `CLAUDE.md`, and the deny entries the
setup added to `settings.json` if they were only for this integration.
