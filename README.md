# DeepSeek Web Retrieval

**Bringing [DeepSeek's in-house Search and Fetch APIs](https://api-docs.deepseek.com/guides/search) to coding agents.**

`deepseek-web-retrieval` is an adapter layer for DeepSeek's Search API and Fetch API. Its
core is agent-agnostic, so each coding agent can share the same retrieval behavior through
a thin adapter. OpenCode v2 is the first supported adapter; more integrations are planned.

This is an unofficial community project. It is not affiliated with OpenCode or DeepSeek.

## What it does

`deepseek-web-retrieval` gives coding agents two useful capabilities:

- **Search** a query through DeepSeek Search and return a short list of relevant results.
- **Fetch** a URL through DeepSeek Fetch and return readable Markdown.

The defaults are designed to keep the model's context small. Search asks for summaries,
filters out weak results, removes duplicate URLs, and returns at most five results. Fetch
returns Markdown and limits how much text it sends back.

## Why use it

Raw search results are noisy. They often contain duplicate links, low-authority pages,
and entire page bodies. Sending all of that to coding agents wastes context and makes
answers worse.

This project sits between the agent and DeepSeek:

- Search requests summaries, not full pages.
- Results are filtered by relevance and authority, then deduplicated.
- Fetch returns Markdown only and caps the output.
- An existing DeepSeek credential can be reused, so a second API key is not required.
- The core is agent-agnostic; OpenCode v2 is the first adapter, not the limit of the project.

## Current support

| Part | Status |
| --- | --- |
| Core retrieval library | Available |
| OpenCode v2 adapter | Available |
| MCP server | Not shipped yet |
| Other agent adapters | Not shipped yet |

OpenCode v2 is the only adapter included in this release. The core is reusable by other
agents and is intended to grow into an MCP server and additional adapters.

## What it does not do

- It does not replace DeepSeek Search or Fetch; it wraps them.
- It does not render JavaScript or handle PDFs, images, or other binary files.
- It does not automatically fall back to another search provider or to the built-in
  `webfetch`.
- It is not an MCP server yet.

## How it fits together

- `src/core/` contains the DeepSeek client, result filtering, formatting, URL/domain policy,
  options, and errors. It does not depend on OpenCode.
- `src/opencode/` is a thin OpenCode v2 adapter.
- New integrations should live under `src/<agent>/` and reuse `src/core/`.

For other agents, the core is exported from `deepseek-web-retrieval/core`.

### Using the core directly

The core is a normal TypeScript API. For example:

```ts
import {
  resolveRetryOptions,
  resolveSearchOptions,
  searchWeb,
} from "deepseek-web-retrieval/core"

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set")

const results = await searchWeb("DeepSeek Search API", resolveSearchOptions(), {
  signal: AbortSignal.timeout(30_000),
  auth: { apiKey },
  retry: resolveRetryOptions(),
})
```

`fetchPage` and the URL/domain helpers are exported from the same entry point. See
`src/core/index.ts` for the full surface.

## Use with OpenCode v2

The OpenCode adapter adds:

- A `websearch` provider with the id `deepseek`
- A `deepseek_fetch` tool backed by DeepSeek Fetch
- An optional drop-in replacement for the built-in `webfetch`

The built-in `webfetch` is not replaced by default. Set `fetchOverrideWebfetch` to
`true` if you want all Markdown fetches to go through DeepSeek.

### Requirements

- OpenCode v2 with `@opencode/plugin` 2.0.32 or newer
- A DeepSeek account with access to `/v1/tools/search` and `/v1/tools/fetch`
- A funded DeepSeek account; Search and Fetch are billed per successful request
- A DeepSeek credential stored in OpenCode, or `DEEPSEEK_API_KEY`
- Bun, which OpenCode provides at runtime

No build step is required. OpenCode loads the TypeScript entry point directly.

### Install

The quickest option is the OpenCode CLI:

```bash
opencode plugin add github:gwokhou/deepseek-web-retrieval
opencode service restart
```

This adds a string entry to the global `plugins` array. It uses the safe defaults:
`deepseek_fetch` is registered, while the built-in `webfetch` stays untouched.

To enable the drop-in `webfetch` replacement or change options, use the object form:

```jsonc
"plugins": [
  {
    "package": "github:gwokhou/deepseek-web-retrieval",
    "options": {
      "fetchOverrideWebfetch": true
    }
  }
]
```

A complete global config using the GitHub package spec can look like this:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:gwokhou/deepseek-web-retrieval",
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

### Other install methods

**Global checkout**

Clone the repository outside the auto-discovered `plugins/` directory so the same package
is not loaded twice:

```bash
git clone https://github.com/gwokhou/deepseek-web-retrieval.git \
  ~/.config/opencode/vendor/deepseek-web-retrieval
```

Then use:

```jsonc
"package": "./vendor/deepseek-web-retrieval"
```

**Project checkout**

```bash
mkdir -p .opencode/vendor
git clone https://github.com/gwokhou/deepseek-web-retrieval.git \
  .opencode/vendor/deepseek-web-retrieval
```

Then use:

```jsonc
"package": "./.opencode/vendor/deepseek-web-retrieval"
```

**Auto-discovery**

If you only need the defaults, copy or clone the repository into one of these directories:

```text
~/.config/opencode/plugins/deepseek-web-retrieval
.opencode/plugins/deepseek-web-retrieval
```

OpenCode discovers it automatically. Auto-discovered plugins do not receive `options`, so
the built-in `webfetch` remains in place and only `deepseek_fetch` is added.

Do not use auto-discovery and an explicit `plugins` entry for the same directory at the
same time. OpenCode can resolve the same target, but the logs may show an extra load.

After any install method, restart OpenCode:

```bash
opencode service restart
```

### Authentication

The plugin looks for a DeepSeek key in this order:

1. The active DeepSeek credential stored in OpenCode
2. The `DEEPSEEK_API_KEY` environment variable

If DeepSeek models already work in OpenCode, no additional setup is usually needed. The
same key is used for Search and Fetch.

To store a credential explicitly:

```bash
opencode auth login
# choose DeepSeek
```

Or use an environment variable:

```bash
export DEEPSEEK_API_KEY="sk-..."
opencode
```

Set `apiKeySource` to make the source explicit:

```jsonc
{ "apiKeySource": "auto" }      // stored credential, then environment
{ "apiKeySource": "opencode" } // only the stored OpenCode credential
{ "apiKeySource": "env" }      // only DEEPSEEK_API_KEY
```

The key is resolved for every request, so rotating it does not require restarting the
plugin. It is sent only as a Bearer token to `api.deepseek.com` and is not written to
plugin metadata or logs.

### Try it

Ask naturally:

```text
Search the web for the latest OpenCode v2 plugin API changes and cite the sources.
```

The model calls `websearch`, which uses the `deepseek` provider. To read a specific page:

```text
Fetch https://opencode.ai/v2/docs/build/plugins and summarize the plugin lifecycle.
```

The model calls `deepseek_fetch`, or `webfetch` when the drop-in replacement is enabled.

## Configuration

These options configure the core and the OpenCode adapter. In OpenCode, set them in the
plugin's `options` object.

### Search

| Option | Default | Description |
| --- | --- | --- |
| `count` | `10` | Results requested from DeepSeek, 1–50. Billing is per request, not per result. |
| `maxResults` | `5` | Results returned to the model after filtering, 0–50. |
| `minRerank` | `1.5` | Drop results below this relevance score. DeepSeek scores are 0–3; 1.5+ is considered high quality. |
| `minAuthority` | `2` | Drop known authorities below this tier. Authority is 0–4. |
| `allowUnknownAuthority` | `false` | Keep results whose authority is missing or unknown. |
| `blockedDomains` | `[]` | Add `-site:` operators to the search query. |
| `includeDomains` | `[]` | Restrict results with `site:` operators. |
| `language` | unset | Add a `lang:` operator, for example `zh,en`. |
| `maxSummaryChars` | `1200` | Per-result summary cap, 0–1,000,000. |
| `searchTimeoutMs` | `30000` | Search request timeout, 1,000–120,000 ms. |
| `setDefaultWebsearch` | `false` | Make `deepseek` the default websearch provider when the plugin loads. |

### Fetch

| Option | Default | Description |
| --- | --- | --- |
| `fetchMaxChars` | `16000` | Maximum characters returned by Fetch, including the title. Range: 0–1,000,000. |
| `fetchTimeoutMs` | `30000` | Fetch request timeout, 1,000–120,000 ms. |
| `fetchOverrideWebfetch` | `false` | Replace the built-in `webfetch` with the DeepSeek version. |
| `fetchRegisterTool` | `true` | Register the separate `deepseek_fetch` tool. |
| `fetchAllowedDomains` | `[]` | If non-empty, only these hosts and subdomains may be fetched. |
| `fetchBlockedDomains` | `[]` | Always block these hosts and subdomains. Blocked wins over allowed. |
| `fetchBlockPrivateHosts` | `true` | Reject localhost, private IPs, `.local`, `.internal`, and similar hosts. |

### Credentials and retries

| Option | Default | Description |
| --- | --- | --- |
| `apiKeySource` | `"auto"` | Credential strategy: `"auto"`, `"opencode"`, or `"env"`. |
| `maxRetries` | `0` | Retries for 408, 425, 429, and 5xx responses, 0–5. |
| `retryBaseDelayMs` | `250` | Base delay for exponential backoff. `Retry-After` is honored up to 10 seconds. |

## Behavior and limitations

### Search

Each call sends:

```json
{ "query": "...", "count": 10, "need_content": false }
```

Search uses DeepSeek's `summary`, falling back to `snippet`. Full page content is never
requested by Search. Use `deepseek_fetch` when you need the page body.

The final query, including `blockedDomains`, `includeDomains`, and `language` operators,
must be 128 characters or fewer. The plugin rejects longer queries locally before calling
DeepSeek. An empty result set is normal and is not an error.

### Fetch

DeepSeek Fetch returns Markdown only. The tool schema keeps `format` for compatibility
with the built-in `webfetch`, but `format: "text"` and `format: "html"` are rejected with
an explicit error instead of returning misleading content.

Output is capped by `fetchMaxChars`, including the title. When output is cut, a
`[content truncated]` marker is added when the configured limit has room for it. If the
page already starts with the same title as a top-level heading, the plugin does not add a
duplicate title.

Successful API responses larger than 5 MiB are rejected before parsing.

DeepSeek Fetch does not render JavaScript. Some sites return 403/404 or no extractable
content. PDFs, images, and other binary files are not supported.

### URL and domain policy

Fetch URLs must be absolute `http://` or `https://` URLs with a host, no embedded
credentials, and at most 8,192 characters.

`fetchAllowedDomains` can restrict fetching to specific hosts and subdomains.
`fetchBlockedDomains` always wins. `fetchBlockPrivateHosts` is enabled by default and
rejects localhost, private IPs, and common private hostnames.

DeepSeek's servers cannot reach your private network. If you need to fetch an internal
page, use the built-in `webfetch` or another local tool.

### Timeouts and retries

Request timeouts include reading the response body, so a slow or stalled body cannot
outlive the configured timeout.

Retryable responses are 408, 425, 429, and 5xx. Other failures, including 401, timeouts,
and network errors, fail without retrying. `Retry-After` is honored, capped at 10 seconds.

### No automatic fallback

If no API key is available, Search and Fetch fail. If DeepSeek is unavailable, returns an
error, or times out, the request fails. The plugin does not silently switch to the built-in
`webfetch` or another search provider.

To keep the built-in `webfetch`, leave `fetchOverrideWebfetch` at `false`.

### Privacy and cost

Queries and URLs are sent to `https://api.deepseek.com`. The API key is sent only as a
Bearer token to DeepSeek. Search and Fetch are billed per successful request; check the
current DeepSeek pricing and rate limits before enabling the plugin for a team.

DeepSeek applies per-account rate limits. A 429 response means you should wait, reduce
concurrency, or increase `maxRetries`.

## Troubleshooting

### `DeepSeek API key is not configured`

Connect DeepSeek in OpenCode:

```bash
opencode auth login
```

Or set `DEEPSEEK_API_KEY` in the environment that starts the OpenCode service.

### `DeepSeek Search failed (HTTP 401, invalid API key)`

The key is missing, revoked, or does not have access to the tools endpoints.

### `DeepSeek Search failed (HTTP 402, insufficient balance)`

Top up the DeepSeek account before retrying.

### `HTTP 429, rate limited`

DeepSeek limits Search and Fetch per account. Increase `maxRetries`, reduce concurrency,
or wait before retrying.

### `DeepSeek search query must be 128 characters or fewer after applying ...`

The final query is too long after adding `-site:`, `site:`, or `lang:` operators. Shorten
the query or reduce the number of configured domains.

### `websearch` shows a generic "Unable to search"

OpenCode's websearch tool may hide provider details. Check the OpenCode log for the
underlying `DeepSeek Search failed ...` error.

### `webfetch` fails on localhost or an internal URL

DeepSeek's servers cannot reach your private network. `fetchBlockPrivateHosts` rejects
these by default. Use the built-in `webfetch` or another local tool for internal pages.

### `format: "html"` / `format: "text"` is rejected

DeepSeek Fetch only returns Markdown. This is intentional; see above.

### Response too large

API responses above 5 MiB are rejected. Fetch a smaller page, or use another fetch tool
if you need the full response.

## Compatibility

| Component | Version |
| --- | --- |
| OpenCode | v2.0.32+ |
| Plugin API | `@opencode/plugin` 2.0.32+ |
| Runtime | Bun (provided by OpenCode) |
| DeepSeek API | `/v1/tools/search`, `/v1/tools/fetch` |

OpenCode v1 and the v1 plugin API are not supported.

Tested with OpenCode 2.0.32 on Linux using both an OpenCode-stored DeepSeek credential
and `DEEPSEEK_API_KEY`. Search, `deepseek_fetch`, and the drop-in `webfetch` were
exercised against the live DeepSeek API.

The core is agent-agnostic, but only the OpenCode v2 adapter is shipped today. Other
agents and an MCP adapter are planned, not currently supported.

## Development

```bash
bun install
bun run typecheck
bun test
```

The test suite mocks the DeepSeek HTTP API and the OpenCode plugin host. Real API calls
require a funded DeepSeek account.

Architecture:

- `src/core/` — shared retrieval logic with no OpenCode dependency
- `src/opencode/` — OpenCode v2 adapter
- `src/<agent>/` — future adapters

New adapters should reuse `src/core/` instead of duplicating retrieval logic.

## Uninstall

Remove the plugin entry from `opencode.jsonc`, remove `websearch.provider` if it points
at `deepseek`, then restart OpenCode:

```bash
opencode service restart
```

If the package was installed into a vendor directory, delete that directory after
removing the config entry. If it was installed with the CLI, remove the plugin entry from
the `plugins` array.

## Prior art

Other community projects in this space include:

- [overwaven/opencode-deepseek-web](https://github.com/overwaven/opencode-deepseek-web)
- [JOEYZYC/opencode-deepseek-websearch](https://github.com/JOEYZYC/opencode-deepseek-websearch)
- [gtoxlili/opencode-deepseek-websearch](https://github.com/gtoxlili/opencode-deepseek-websearch)
- [OniVe/opencode-websearch-deepseek](https://github.com/OniVe/opencode-websearch-deepseek)

This project focuses on small context, credential reuse, optional `webfetch` replacement,
and a reusable agent-agnostic core.

## License

MIT. See [LICENSE](LICENSE).
