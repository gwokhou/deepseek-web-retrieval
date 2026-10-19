# DeepSeek Web Retrieval

**Token-efficient DeepSeek Search and Fetch for coding agents.**

The first supported agent is [OpenCode v2](https://opencode.ai/v2/docs/). The
core is agent-agnostic and is intended to grow into an MCP server and adapters
for other coding agents.

> Unofficial community project. Not affiliated with OpenCode or DeepSeek.

## Why

DeepSeek's Search and Fetch APIs are useful, but raw results can easily flood a
coding-agent context with full pages, duplicate links, and low-quality sources.
This plugin keeps retrieval deliberately small:

- Search asks for `need_content: false` and returns summaries, not whole pages.
- Results are filtered by `rerank_score` and `authority`.
- URLs are deduplicated and capped at 5 results by default.
- Fetch returns Markdown only, capped at 16,000 characters by default.
- The OpenCode provider credential is reused, so no second key is required.

## What it adds

When loaded in OpenCode, the plugin provides:

- A `websearch` provider with id `deepseek`
- A `deepseek_fetch` tool backed by DeepSeek Fetch
- An optional drop-in replacement for the built-in `webfetch` tool

The built-in `webfetch` is **not** replaced by default. Enable
`fetchOverrideWebfetch` when you want all Markdown fetches to go through
DeepSeek.

## Requirements

- OpenCode v2 with plugin API `@opencode/plugin` 2.0.32 or newer
- A DeepSeek account with access to `/v1/tools/search` and `/v1/tools/fetch`
- A funded DeepSeek account; Search and Fetch are billed per successful request
- A DeepSeek credential stored in OpenCode, or `DEEPSEEK_API_KEY`

## Install

The repository currently installs from a Git package specifier or a local
checkout. It does not require a build step: OpenCode loads the TypeScript entry
point directly, and `@opencode/plugin` is supplied by OpenCode at runtime.

### Quick install with the OpenCode CLI

Once the repository is published, install it with:

```bash
opencode plugin add github:OWNER/deepseek-web-retrieval
opencode service restart
```

Replace `OWNER` with the GitHub account that hosts this repository. The CLI adds
a string entry to the global `plugins` array. That uses the safe
defaults: `deepseek_fetch` is registered, while the built-in `webfetch` stays
untouched. To enable the drop-in `webfetch` or change options, replace the
string entry with the object form below. The same Git package specifier works in
that object:

```jsonc
"plugins": [
  {
    "package": "github:OWNER/deepseek-web-retrieval",
    "options": { "fetchOverrideWebfetch": true }
  }
]
```

### Recommended: global install with options

Clone the repository outside the auto-discovered `plugins/` directory, so the
same package is not loaded twice:

```bash
git clone https://github.com/OWNER/deepseek-web-retrieval.git \
  ~/.config/opencode/vendor/deepseek-web-retrieval
```

Add the package to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./vendor/deepseek-web-retrieval",
      "options": {
        "fetchOverrideWebfetch": true
      }
    }
  ],
  "websearch": { "provider": "deepseek" },
  "permissions": [
    { "action": "websearch", "resource": "*", "effect": "allow" },
    { "action": "webfetch", "resource": "*", "effect": "allow" },
    { "action": "deepseek_fetch", "resource": "*", "effect": "allow" }
  ]
}
```

Then restart OpenCode:

```bash
opencode service restart
```

### Project-local install

```bash
mkdir -p .opencode/vendor
git clone https://github.com/OWNER/deepseek-web-retrieval.git \
  .opencode/vendor/deepseek-web-retrieval
```

Use the same plugin object in the project's `opencode.jsonc`, with a relative
path:

```jsonc
"package": "./.opencode/vendor/deepseek-web-retrieval"
```

### Auto-discovered install

If you only need the defaults and do not need custom options, copy or clone the
repository into either:

```text
~/.config/opencode/plugins/deepseek-web-retrieval
.opencode/plugins/deepseek-web-retrieval
```

OpenCode discovers it automatically. Auto-discovered plugins do not receive
`options`, so the built-in `webfetch` remains in place and only
`deepseek_fetch` is added.

Do not use auto-discovery and an explicit `plugins` entry for the same directory
at the same time. OpenCode can resolve the same target, but the logs may show an
extra load.

## Authentication

The plugin resolves credentials in this order by default:

1. The active DeepSeek credential stored in OpenCode
2. `DEEPSEEK_API_KEY`

If DeepSeek models already work in OpenCode, no additional setup is needed. The
same key is used for Search and Fetch.

To configure the credential explicitly:

```bash
opencode auth login
# choose DeepSeek
```

Or use an environment variable:

```bash
export DEEPSEEK_API_KEY="sk-..."
opencode
```

Set `apiKeySource` to make the behavior explicit:

```jsonc
{ "apiKeySource": "auto" }      // stored credential, then env
{ "apiKeySource": "opencode" } // only the stored OpenCode credential
{ "apiKeySource": "env" }      // only DEEPSEEK_API_KEY
```

The key is resolved on every request, so switching accounts or rotating the key
takes effect without reloading the plugin. It is never written to plugin
metadata or logs.

## Usage

Once installed, ask naturally:

```text
Search the web for the latest OpenCode v2 plugin API changes and cite the sources.
```

The model calls `websearch`, which uses the `deepseek` provider. To read a
specific page:

```text
Fetch https://opencode.ai/v2/docs/build/plugins and summarize the plugin lifecycle.
```

The model calls `deepseek_fetch`, or `webfetch` when the drop-in replacement is
enabled.

## Configuration reference

All options are optional.

| Option | Type | Default | Description |
|---|---|---|---|
| `count` | number | `10` | Results requested from DeepSeek, clamped to 1–50. Price is per request, not per result. |
| `maxResults` | number | `5` | Results returned to the model after filtering, 0–50. |
| `minRerank` | number | `1.5` | Drop results below this rerank score. |
| `minAuthority` | number | `2` | Drop known authorities below this tier. |
| `allowUnknownAuthority` | boolean | `false` | Keep results whose authority is missing or unknown. |
| `blockedDomains` | string[] | `[]` | Add `-site:` operators for search. |
| `includeDomains` | string[] | `[]` | Restrict search with `site:` operators. |
| `language` | string | unset | Add a `lang:` operator, e.g. `zh,en`. |
| `maxSummaryChars` | number | `1200` | Per-result summary cap. |
| `searchTimeoutMs` | number | `30000` | Search request timeout, 1,000–120,000 ms. |
| `setDefaultWebsearch` | boolean | `false` | Make `deepseek` the default websearch provider when the plugin loads. |
| `fetchMaxChars` | number | `16000` | Maximum characters returned by Fetch, including the title. |
| `fetchTimeoutMs` | number | `30000` | Fetch request timeout, 1,000–120,000 ms. |
| `fetchOverrideWebfetch` | boolean | `false` | Replace the built-in `webfetch` with the DeepSeek version. |
| `fetchRegisterTool` | boolean | `true` | Register the separate `deepseek_fetch` tool. |
| `fetchAllowedDomains` | string[] | `[]` | If non-empty, only these hosts/subdomains may be fetched. |
| `fetchBlockedDomains` | string[] | `[]` | Always block these hosts/subdomains. Blocked wins over allowed. |
| `fetchBlockPrivateHosts` | boolean | `true` | Reject localhost, private IPs, `.local`, `.internal`, etc. |
| `apiKeySource` | `"auto" \| "opencode" \| "env"` | `"auto"` | Credential resolution strategy. |
| `maxRetries` | number | `0` | Retries for 408, 425, 429, and 5xx responses, 0–5. |
| `retryBaseDelayMs` | number | `250` | Base exponential-backoff delay. `Retry-After` is honored. |

## Behavior and limitations

### Search

Each call sends:

```json
{ "query": "...", "count": 10, "need_content": false }
```

Search results use DeepSeek's `summary`, falling back to `snippet`. Full page
content is never requested by Search. Use `deepseek_fetch` when you need the
page body.

### Fetch

DeepSeek Fetch returns Markdown only. The tool schema keeps `format` for
compatibility with the built-in `webfetch`, but `format: "text"` and
`format: "html"` are rejected with an explicit error instead of returning
misleading content.

DeepSeek Fetch does not render JavaScript. Some sites return 403/404 or no
extractable content. PDFs, images, and other binary files are not supported.

### No automatic fallback

If the OpenCode credential and `DEEPSEEK_API_KEY` are both unavailable, Search
and Fetch fail. If DeepSeek returns 401/429/5xx or times out, the request fails
after the configured retries. The plugin does not silently switch to the
built-in `webfetch` or another search provider.

To keep the built-in `webfetch`, leave `fetchOverrideWebfetch` at `false`.

### Privacy and cost

URLs and queries are sent to `https://api.deepseek.com`. The key is sent only
as a Bearer token to DeepSeek. Search and Fetch are billed per successful
request; check the current DeepSeek pricing and rate limits before enabling the
plugin for a team.

## Troubleshooting

### `DeepSeek API key is not configured`

Connect DeepSeek in OpenCode:

```bash
opencode auth login
```

Or set `DEEPSEEK_API_KEY` in the environment that starts the OpenCode service.

### `DeepSeek Search failed (HTTP 401, invalid API key)`

The key is missing, revoked, or does not have access to the tools endpoints.

### `HTTP 429, rate limited`

DeepSeek limits Search and Fetch per account. Increase `maxRetries`, reduce
concurrency, or wait before retrying.

### `websearch` shows a generic “Unable to search”

OpenCode's websearch tool may hide provider details. Check the OpenCode log for
the underlying `DeepSeek Search failed ...` error.

### `webfetch` fails on localhost or an internal URL

DeepSeek's servers cannot reach your private network. `fetchBlockPrivateHosts`
rejects these by default. Use the built-in `webfetch` or another local tool for
internal pages.

### `format: "html"` / `format: "text"` is rejected

DeepSeek Fetch only returns Markdown. This is intentional; see above.

## Compatibility

| Component | Version |
|---|---|
| OpenCode | v2.0.32+ |
| Plugin API | `@opencode/plugin` 2.0.32+ |
| Runtime | Bun (provided by OpenCode) |
| DeepSeek API | `/v1/tools/search`, `/v1/tools/fetch` |

OpenCode v1 and the v1 plugin API are not supported.

Tested with OpenCode 2.0.32 on Linux using both an OpenCode-stored DeepSeek
credential and `DEEPSEEK_API_KEY`. Search, `deepseek_fetch`, and the drop-in
`webfetch` were exercised against the live DeepSeek API.

## Development

```bash
bun install
bun run typecheck
bun test
```

The test suite mocks the DeepSeek HTTP API and the OpenCode plugin host. Real
API calls require a funded DeepSeek account.

## Uninstall

Remove the plugin entry from `opencode.jsonc`, remove `websearch.provider` if it
points at `deepseek`, then:

```bash
opencode service restart
```

If the package was installed into a vendor directory, delete that directory
after removing the config entry.

## Prior art

Other community projects in this space include:

- [overwaven/opencode-deepseek-web](https://github.com/overwaven/opencode-deepseek-web)
- [JOEYZYC/opencode-deepseek-websearch](https://github.com/JOEYZYC/opencode-deepseek-websearch)
- [gtoxlili/opencode-deepseek-websearch](https://github.com/gtoxlili/opencode-deepseek-websearch)
- [OniVe/opencode-websearch-deepseek](https://github.com/OniVe/opencode-websearch-deepseek)

This project focuses on token-efficient defaults, OpenCode credential reuse,
and an optional drop-in `webfetch` replacement.

## License

MIT. See [LICENSE](LICENSE).
