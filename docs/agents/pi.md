# Pi

Pi adapter for [DeepSeek Web Retrieval](../../README.md).

Integration mechanism: MCP server over stdio, launched from Pi's `mcp.json`. Pi 1.3.0
negotiates MCP revision `2025-11-25`; the server also accepts clients from `2024-11-05`
through `2026-07-28`, so the same build works for other MCP hosts (see
[the compatibility research](../research/mcp-compatibility.md)).

When registered, it adds:

- A `deepseek_web_search` tool backed by DeepSeek Search
- A `deepseek_fetch` tool backed by DeepSeek Fetch

The tools appear in Pi as `mcp__deepseek__deepseek_web_search` and
`mcp__deepseek__deepseek_fetch`. Pi's built-in tools are not replaced.

For shared search/fetch limits, retries, and privacy behavior, see
[General behavior](../../README.md#general-behavior).

## Requirements

- Pi 1.3.0 or newer
- Node.js 20 or newer (`npx` runs the server)
- A DeepSeek account with access to `/v1/tools/search` and `/v1/tools/fetch`
- A funded DeepSeek account; Search and Fetch are billed per successful request
- `DEEPSEEK_API_KEY` set in the server's `env` block

## Install

The quickest option is the installer CLI:

```bash
npx deepseek-web-retrieval init --host pi --scope <project|global> \
  --search <optional|preferred|forced|off> --fetch <optional|preferred|forced|off>
```

It prints the full plan — every file, old value → new value, and notes about existing
MCP servers and the `exposure` requirement — and writes nothing until you pass `--apply`.
JSON edits preserve comments. `uninstall` restores exactly what the plan applied. Under a
forced tier, other registered MCP servers that look web-capable are disabled
(`enabled: false`, prior value snapshotted) so DeepSeek routing is exclusive, and
`uninstall` restores them. The
tiers follow the [control matrix](../research/control-matrix.md): Pi ships no built-in web
tool, so forced is de-facto for both capabilities and `off` writes
`DEEPSEEK_ENABLE_SEARCH`/`DEEPSEEK_ENABLE_FETCH` into the server's env block.

### Manual install

Add the server to `~/.pi/agent/mcp.json` (user) or `.pi/mcp.json` (project):

```jsonc
{
  "mcpServers": {
    "deepseek": {
      "command": "npx",
      "args": ["-y", "deepseek-web-retrieval"],
      "env": { "DEEPSEEK_API_KEY": "${DEEPSEEK_API_KEY}" },
      "exposure": "direct"
    }
  }
}
```

`${DEEPSEEK_API_KEY}` expands from the shell that launches Pi, so the key itself stays out
of the config file. Set it in your shell profile:

```bash
export DEEPSEEK_API_KEY="sk-***"
```

> [!NOTE]
> `exposure` matters. Pi 1.3.0 defaults MCP tools to `codemode`, which does not declare
> them to the model. `"exposure": "direct"` registers the two tools like built-ins so the
> model can call them. Without it the server connects but the tools are never used.

Verify the registration with `pi mcp list` (or the `/mcp` panel inside a session); Pi
shows the server's tools when the handshake succeeds. Config changes load with `/reload`
or a new session.

### Local checkout

To run the server from a checkout instead of the published package (for
development):

```bash
git clone https://github.com/gwokhou/deepseek-web-retrieval.git
cd deepseek-web-retrieval
bun install && bun run build
```

Then point Pi at the built entry:

```jsonc
{
  "mcpServers": {
    "deepseek": {
      "command": "node",
      "args": ["/absolute/path/to/deepseek-web-retrieval/dist/cli.js"],
      "env": { "DEEPSEEK_API_KEY": "${DEEPSEEK_API_KEY}" },
      "exposure": "direct"
    }
  }
}
```

## Authentication

`DEEPSEEK_API_KEY` is the only source; MCP has no host credential store. The key is read
per request and sent only to `api.deepseek.com` as a Bearer token. It is not written to
tool output or logs. Without a key the server exits at startup with a message on stderr.

## Usage

Ask naturally:

```text
Search the web for the latest Pi extension API changes and cite the sources.
Fetch https://pi.dev/docs/latest/extensions and summarize the extension lifecycle.
```

The model calls `mcp__deepseek__deepseek_web_search` or `mcp__deepseek__deepseek_fetch`.

## Configuration

Set these in the server's `env` block. Values map onto the shared option pipeline, so
defaults and clamping match the OpenCode adapter.

### Search

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_ENABLE_SEARCH` | `true` | Register the search tool. Only an explicit `false`/`0`/`no`/`off` disables it; at least one tool must stay enabled. |
| `DEEPSEEK_SEARCH_COUNT` | `10` | Results requested from DeepSeek, 1–50. Billing is per request, not per result. |
| `DEEPSEEK_SEARCH_MAX_RESULTS` | `5` | Results returned to the model after filtering, 0–50. `0` returns no results. |
| `DEEPSEEK_SEARCH_MIN_RERANK` | `1.5` | Drop results below this relevance score. DeepSeek scores are 0–3. |
| `DEEPSEEK_SEARCH_MIN_AUTHORITY` | `2` | Drop known authorities below this tier. Authority is 0–4. |
| `DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY` | `false` | Keep results whose authority is missing or unknown. Set `true`/`1`. |
| `DEEPSEEK_SEARCH_BLOCKED_DOMAINS` | unset | Comma-separated; adds `-site:` operators to the query. |
| `DEEPSEEK_SEARCH_INCLUDE_DOMAINS` | unset | Comma-separated; restricts results with `site:` operators. |
| `DEEPSEEK_SEARCH_LANGUAGE` | unset | Adds a `lang:` operator, for example `zh,en`. |
| `DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS` | `1200` | Per-result summary cap, 0–1,000,000. |
| `DEEPSEEK_SEARCH_TIMEOUT_MS` | `30000` | Search timeout, 1,000–120,000 ms. |

### Fetch

| Env variable | Default | Description |
| --- | --- |
| `DEEPSEEK_ENABLE_FETCH` | `true` | Register the fetch tool. Same false-only semantics as `DEEPSEEK_ENABLE_SEARCH`. |
| `DEEPSEEK_FETCH_MAX_CHARS` | `16000` | Maximum characters returned, including the title, 0–1,000,000. |
| `DEEPSEEK_FETCH_TIMEOUT_MS` | `30000` | Fetch timeout, 1,000–120,000 ms. |
| `DEEPSEEK_FETCH_ALLOWED_DOMAINS` | unset | If set, only these hosts and subdomains may be fetched. |
| `DEEPSEEK_FETCH_BLOCKED_DOMAINS` | unset | Always block these hosts and subdomains. Blocked wins over allowed. |
| `DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS` | `true` | Reject localhost, private IPs, `.local`, `.internal`, and similar hosts. Set `false`/`0` to disable. |

### Credentials and retries

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | required | DeepSeek API key. The server refuses to start without it. |
| `DEEPSEEK_MAX_RETRIES` | `0` | Retries for 408, 425, 429, and 5xx responses, 0–5. |
| `DEEPSEEK_RETRY_BASE_DELAY_MS` | `250` | Base delay for exponential backoff. `Retry-After` is honored up to 10 seconds. |

Invalid values fall back to the shared default.

## Troubleshooting

| Error or symptom | What to do |
| --- | --- |
| Server connects but the model never calls the tools | Set `"exposure": "direct"`; Pi 1.3.0 defaults to `codemode`, which hides MCP tools from the model. |
| Server fails to start (`pi mcp list`) | Check `DEEPSEEK_API_KEY`; without it the process exits with a stderr message. |
| `HTTP 401, invalid API key` | Check the key and its access to the tools endpoints. |
| `HTTP 402, insufficient balance` | Top up the DeepSeek account. |
| `HTTP 429, rate limited` | Wait, reduce concurrency, or set `DEEPSEEK_MAX_RETRIES`. |
| Search query too long | Shorten the query or reduce configured domain/language operators. |
| Fetch fails on localhost or an internal URL | Use a local fetch tool; DeepSeek cannot reach private networks. |
| Long fetch results look cut in the middle | Pi truncates text results over 20 KB (full text is saved to a file). Keep `DEEPSEEK_FETCH_MAX_CHARS` at or below 20000 to truncate deterministically. |
| Request fails around 60 seconds | Pi's per-request default timeout is 60 s; raise the server's `timeout` if you raise `DEEPSEEK_*_TIMEOUT_MS` beyond it. |
| Config change does not take effect | Run `/reload` in the session or start a new one. |

## Compatibility

| Component | Version |
| --- | --- |
| Pi | locked in [`docs/hosts.jsonc`](../hosts.jsonc) |
| MCP revision | `2025-11-25` negotiated; server accepts `2024-11-05`–`2026-07-28` |
| MCP SDK | `@modelcontextprotocol/server` 2.3.1 |
| Runtime | Node.js 20+ (stdio) |
| DeepSeek API | `/v1/tools/search`, `/v1/tools/fetch` |

Pi 1.3.0 supports stdio and Streamable HTTP servers; this guide uses stdio. Tested with
Pi 1.3.0 on Linux over stdio; the dual-era protocol behavior is covered by the SDK client
test personas (`2024-11-05`, `2025-06-18`, `2025-11-25`, `2026-07-28`).

## Uninstall

With the installer CLI:

```bash
npx deepseek-web-retrieval uninstall --host pi --scope <project|global>
```

Or remove the `deepseek` entry from `~/.pi/agent/mcp.json` or `.pi/mcp.json`, or run:

```bash
pi mcp remove deepseek
```

For a local-checkout install, also delete the cloned directory.
