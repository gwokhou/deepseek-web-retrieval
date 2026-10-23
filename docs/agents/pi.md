# Pi

Pi adapter for [DeepSeek Web Retrieval](../../README.md).

Integration mechanism: Pi's native extension API — the package's `pi` manifest names
`src/pi/extension.ts`, and Pi loads it in-process (via jiti, TypeScript directly) at session
start. The same build also ships an MCP server over stdio as the fallback path
([below](#the-mcp-fallback-path)); the extension is the recommended one:

- The tools are declared to the model like built-ins (`exposure: "direct"` is Pi's own
  default for extension tools — the MCP path's codemode trap does not exist here).
- Results bypass Pi's MCP layer entirely: no 20 KB middle truncation and no 60 s
  per-request timeout; the adapter's own output cap is the only limit.
- The key is read from the Pi process environment — no `env` forwarding, no `${VAR}`
  indirection in any config file.

When loaded, it adds:

- A `deepseek_web_search` tool backed by DeepSeek Search
- A `deepseek_fetch` tool backed by DeepSeek Fetch

Pi 1.3.0 ships no built-in web tool, so the registered tools are the only web path. For
shared search/fetch limits, retries, and privacy behavior, see
[General behavior](../../README.md#general-behavior).

## Requirements

- Pi with host SDKs in the `^1.3.0` peer range (`>=1.3.0 <2.0.0`); the tested
  version is recorded in [`docs/hosts.jsonc`](../hosts.jsonc)
- Node.js 20+ and npm when using the installer CLI or MCP fallback
- A DeepSeek account with access to `/v1/tools/search` and `/v1/tools/fetch`
- A funded DeepSeek account; Search and Fetch are billed per successful request
- `DEEPSEEK_API_KEY` set in the shell that launches Pi

## Install

The quickest option is the installer CLI:

```bash
npx deepseek-web-retrieval init --host pi --scope <project|global> \
  --search <optional|preferred|forced|off> --fetch <optional|preferred|forced|off>
```

It prints the full plan — every file, old value → new value, and notes about existing
packages and MCP servers — and writes nothing until you pass `--apply`. The default path is
the extension: the plan appends `npm:deepseek-web-retrieval` to the `packages` array in
`~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project), and Pi resolves the
source at the next session start (the first launch fetches the package from npm;
`pi update --extensions` refreshes it later). An off capability is written into the
`deepseekWebRetrieval` settings namespace the extension reads at load. Pass `--path mcp`
to install the [MCP fallback path](#the-mcp-fallback-path) instead. `uninstall` removes
recorded additions and restores unchanged configuration values from their snapshots.

For upgrades from 0.4.0, select `--path mcp` explicitly to retain the old path, or use
the extension default to migrate; follow the shared
[upgrade instructions](../integration.md#upgrading-existing-installs).

### Manual install

Use Pi's own installer:

```bash
pi install npm:deepseek-web-retrieval           # ~/.pi/agent/settings.json (user)
pi install --local npm:deepseek-web-retrieval   # .pi/settings.json (project)
```

Pi reads the package's `pi` manifest and loads `src/pi/extension.ts` at session start. No
build step and no config entry beyond the `packages` source are needed.

### Local checkout

```bash
git clone https://github.com/gwokhou/deepseek-web-retrieval.git
```

Then point Pi at the checkout (it is itself a valid package):

```bash
pi install /absolute/path/to/deepseek-web-retrieval
```

The extension entry imports only host-supplied modules (`@earendil-works/pi-coding-agent`,
`@earendil-works/pi-ai`) and the package's own `src/core/`, so a plain clone works.

## Authentication

`DEEPSEEK_API_KEY` is the only source: the extension runs inside the Pi process and reads
the environment directly, so the key must be set in the shell that launches Pi (MCP's env
forwarding does not apply). It is read per request and sent only to `api.deepseek.com` as a
Bearer token. It is not written to tool output or logs. Without it, the first tool call
returns an error naming the missing variable.

## Usage

Ask naturally:

```text
Search the web for the latest Pi extension API changes and cite the sources.
Fetch https://pi.dev/docs/latest/extensions and summarize the extension lifecycle.
```

The model calls `deepseek_web_search` or `deepseek_fetch` — the same names over both paths;
only the MCP fallback prefixes them with `mcp__deepseek__`.

The search tool accepts an optional `original_question` input — the user's question in their
own words — forwarded as DeepSeek's `ori_question` to sharpen search intent. When the model
leaves it blank, the extension falls back to the most recent user message in the session
(best-effort; truncated to the API's 128-character limit). The MCP fallback path has no
session access, so there a blank input simply omits the parameter.

## Configuration

The runtime config surface is the same `DEEPSEEK_*` environment the MCP server reads
(identical defaults and clamping), set in the shell that launches Pi, plus the
`deepseekWebRetrieval` settings namespace for the off switches (written by the installer;
it outranks the environment and is preserved by Pi's own settings rewrites).

The shared config file (`~/.config/deepseek-web-retrieval/config.json`, camelCase keys)
also sits in this surface, layered under the environment, and needs no forwarding on any
path — the extension and the MCP server both read the file themselves. One file therefore
configures every host running this package, with this host's environment and settings
still outranking it.

### Search

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_ENABLE_SEARCH` | `true` | Register the search tool. Only an explicit `false`/`0`/`no`/`off` disables it; at least one tool must stay enabled. |
| `DEEPSEEK_SEARCH_COUNT` | `10` | Results requested from DeepSeek, 1–50. Billing is per request, not per result. |
| `DEEPSEEK_SEARCH_MAX_RESULTS` | `10` | Results returned to the model after filtering, 0–50. `0` returns no results. |
| `DEEPSEEK_SEARCH_MIN_RERANK` | `0` | Drop results below this relevance score (0–3); results without a finite score pass at zero and are dropped at a positive threshold. |
| `DEEPSEEK_SEARCH_MIN_AUTHORITY` | `0` | Drop known authorities below this tier. Authority is 0–4. |
| `DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY` | `true` | Keep results whose authority is missing or unknown. Set `false`/`0`/`no`/`off` to drop them. |
| `DEEPSEEK_SEARCH_BLOCKED_DOMAINS` | unset | Comma-separated; adds `-site:` operators to the query. |
| `DEEPSEEK_SEARCH_INCLUDE_DOMAINS` | unset | Comma-separated; restricts results with `site:` operators. |
| `DEEPSEEK_SEARCH_LANGUAGE` | unset | Adds a `lang:` operator, for example `zh,en`. |
| `DEEPSEEK_SEARCH_LOCALIZATION` | unset | Valid IPv4 or IPv6 address sent as DeepSeek's `localization` to prefer geo-localized results; invalid values are ignored. Deployment-level only, never a per-call parameter. |
| `DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS` | `1200` | Per-result summary cap, 0–1,000,000. |
| `DEEPSEEK_SEARCH_TIMEOUT_MS` | `30000` | Search timeout, 1,000–120,000 ms. No host-side cap applies on the extension path. |

### Fetch

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_ENABLE_FETCH` | `true` | Register the fetch tool. Same false-only semantics as `DEEPSEEK_ENABLE_SEARCH`. |
| `DEEPSEEK_FETCH_MAX_CHARS` | `16000` | Maximum characters returned, including the title, 0–1,000,000. The only output cap on this path. |
| `DEEPSEEK_FETCH_TIMEOUT_MS` | `30000` | Fetch timeout, 1,000–120,000 ms. No host-side cap applies on the extension path. |
| `DEEPSEEK_FETCH_ALLOWED_DOMAINS` | unset | If set, only these hosts and subdomains may be fetched. |
| `DEEPSEEK_FETCH_BLOCKED_DOMAINS` | unset | Always block these hosts and subdomains. Blocked wins over allowed. |
| `DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS` | `true` | Reject localhost, private IPs, `.local`, `.internal`, and similar hosts. Set `false`/`0` to disable. |

### Credentials and retries

| Env variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | required | DeepSeek API key, read from the Pi process environment. |
| `DEEPSEEK_MAX_RETRIES` | `0` | Retries for 408, 425, 429, and 5xx responses, 0–5. |
| `DEEPSEEK_RETRY_BASE_DELAY_MS` | `250` | Base delay for exponential backoff. `Retry-After` is honored up to 10 seconds. |

Invalid values fall back to the shared default.

## Troubleshooting

| Error or symptom | What to do |
| --- | --- |
| `Failed to load extension ... at least one must stay enabled` | Both capabilities are off (env or the `deepseekWebRetrieval` namespace); keep at least one on. |
| Tools never appear | Check that the `packages` entry is present (`pi list`) and that the first launch after install could reach npm; `pi update --extensions` re-fetches. |
| First tool call errors on the key | `DEEPSEEK_API_KEY` must be set in the shell that launches Pi; the extension reads only the process environment. |
| `HTTP 401, invalid API key` | Check the key and its access to the tools endpoints. |
| `HTTP 402, insufficient balance` | Top up the DeepSeek account. |
| `HTTP 429, rate limited` | Wait, reduce concurrency, or set `DEEPSEEK_MAX_RETRIES`. |
| Search query too long | Shorten the query or reduce configured domain/language operators. |
| Fetch fails on localhost or an internal URL | Use a local fetch tool; DeepSeek cannot reach private networks. |
| Project-scope install does not load | Pi gates project-local files behind project trust; approve the project when prompted (or launch with `--approve`). |

## Compatibility

| Component | Version |
| --- | --- |
| Pi | locked in [`docs/hosts.jsonc`](../hosts.jsonc) |
| Extension entry | `src/pi/extension.ts` via the package's `pi` manifest (jiti, no build step) |
| Runtime | Inside the Pi process (Node, host-provided) |
| DeepSeek API | `/v1/tools/search`, `/v1/tools/fetch` |

Tested with Pi 1.3.0 on Linux. The extension API is version-locked research surface: the
`ToolDefinition` shape and the settings `packages` key are verified at the locked version
(see [the per-host reference](../research/control-matrix.md#pi)).

## Uninstall

With the installer CLI:

```bash
npx deepseek-web-retrieval uninstall --host pi --scope <project|global>
```

For a manual installation, remove the source with Pi itself; use `--local` for a
project-local install. Installer-managed installs should use `uninstall` above so
rules, snapshots, and install records are cleaned up as well:

```bash
pi remove npm:deepseek-web-retrieval
```

For a local-checkout install, also delete the cloned directory.

## The MCP fallback path

The same package ships a stdio MCP server (`npx deepseek-web-retrieval`). It works on Pi
through `~/.pi/agent/mcp.json` or `.pi/mcp.json`:

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

The tools appear as `mcp__deepseek__deepseek_web_search` and `mcp__deepseek__deepseek_fetch`,
and the MCP layer's limits apply instead: text results over 20 KB are middle-truncated with
the full text saved to a file (keep `DEEPSEEK_FETCH_MAX_CHARS` at or below 20000 to truncate
deterministically), and the per-request default timeout is 60 s (raise the entry's `timeout`
if you raise `DEEPSEEK_*_TIMEOUT_MS` beyond it). `pi mcp list` verifies the handshake, and
config changes load with `/reload` or a new session. `npx deepseek-web-retrieval init
--host pi --path mcp ...` installs this shape with plan-then-apply semantics; see
[`examples/pi.mcp.jsonc`](../../examples/pi.mcp.jsonc).
