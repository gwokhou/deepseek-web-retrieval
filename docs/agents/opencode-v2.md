# OpenCode v2

OpenCode v2 adapter for [DeepSeek Web Retrieval](../../README.md).

Integration mechanism: OpenCode's native plugin API (`@opencode/plugin`), not MCP.

When loaded, it adds:

- A `websearch` provider with the id `deepseek`
- A `deepseek_fetch` tool backed by DeepSeek Fetch
- An optional drop-in replacement for the built-in `webfetch`

The built-in `webfetch` is not replaced by default. Set `fetchOverrideWebfetch` to `true`
if you want all Markdown fetches to go through DeepSeek.

For shared search/fetch limits, retries, and privacy behavior, see
[General behavior](../../README.md#general-behavior).

## Requirements

- OpenCode v2 with `@opencode/plugin` in the `^2.0.32` peer range; the tested version
  is recorded in [`docs/hosts.jsonc`](../hosts.jsonc)
- Node.js 20+ and npm when using the installer CLI
- A DeepSeek account with access to `/v1/tools/search` and `/v1/tools/fetch`
- A funded DeepSeek account; Search and Fetch are billed per successful request
- A DeepSeek credential stored in OpenCode, or `DEEPSEEK_API_KEY`
- Bun, which OpenCode provides at runtime

No build step is required. OpenCode loads the TypeScript entry point directly.

## Install

The quickest option is the installer CLI:

```bash
npx deepseek-web-retrieval init --host opencode --scope <project|global> \
  --search <optional|forced|off> --fetch <optional|preferred|forced|off>
```

It prints the full plan — every file, old value → new value — and writes nothing until
you pass `--apply`. It snapshots the current `websearch.provider` before the forced tier
replaces it, merges `permissions` without touching yours, preserves comments in
`opencode.jsonc`, and `uninstall` restores recorded values that have not since been edited.
Search has no `preferred` tier on OpenCode (the provider is host-level config, never a
model choice); the CLI rejects it.

### OpenCode CLI install

The next option is the OpenCode CLI:

```bash
opencode plugin add github:gwokhou/deepseek-web-retrieval
```

This fetches the package into OpenCode's plugin cache and adds a
`"github:gwokhou/deepseek-web-retrieval"` entry to the global `opencode.jsonc`. OpenCode
watches the config and reloads plugins when it changes, so a restart is normally
unnecessary; run `opencode service restart` only if the plugin does not appear.

> [!NOTE]
> `plugin add` registers the `deepseek` websearch provider and the `deepseek_fetch` tool,
> but it does not select them. Search still uses the built-in provider, and the built-in
> `webfetch` stays untouched. To route search through DeepSeek, set `websearch.provider` to
> `deepseek` (see the complete config below), or enable `setDefaultWebsearch` in the plugin
> options.

To replace `webfetch` or change options, replace the string entry with the object form and
edit its `options`:

```jsonc
"plugins": [
  {
    "package": "github:gwokhou/deepseek-web-retrieval",
    "options": { "fetchOverrideWebfetch": true }
  }
]
```

A complete global config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:gwokhou/deepseek-web-retrieval",
      "options": { "fetchOverrideWebfetch": true }
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

**Published npm package**

Use the bare package name (optionally pinned) as the `package` value:

```jsonc
"plugins": [{ "package": "deepseek-web-retrieval" }]
```

Append `@X.Y.Z` to pin a published version. For an existing installer-managed setup,
follow the [upgrade instructions](../integration.md#upgrading-existing-installs).

**Global checkout**

```bash
git clone https://github.com/gwokhou/deepseek-web-retrieval.git \
  ~/.config/opencode/vendor/deepseek-web-retrieval
```

Use `"package": "./vendor/deepseek-web-retrieval"`.

**Project checkout**

```bash
mkdir -p .opencode/vendor
git clone https://github.com/gwokhou/deepseek-web-retrieval.git \
  .opencode/vendor/deepseek-web-retrieval
```

Use `"package": "./.opencode/vendor/deepseek-web-retrieval"`.

**Auto-discovery**

Clone or copy the repository into `~/.config/opencode/plugins/deepseek-web-retrieval` or
`.opencode/plugins/deepseek-web-retrieval`. Auto-discovered plugins do not receive options,
so `webfetch` stays in place; the `deepseek` search provider and `deepseek_fetch` are still
added.

Do not combine auto-discovery with an explicit `plugins` entry for the same directory.

OpenCode reloads plugins when the config or plugin directory changes, so a restart is
normally unnecessary. If a change does not take effect, restart the background server:

```bash
opencode service restart
```

## Authentication

The adapter resolves a key in this order:

1. The active DeepSeek credential stored in OpenCode
2. `DEEPSEEK_API_KEY`

Store a key with `opencode auth login` and choose DeepSeek, or set
`DEEPSEEK_API_KEY`. `apiKeySource` can be `"auto"` (default), `"opencode"`, or `"env"`.

The key is resolved for every request and sent only to `api.deepseek.com` as a Bearer
token. It is not written to plugin metadata or logs.

## Usage

Ask naturally:

```text
Search the web for the latest OpenCode v2 plugin API changes and cite the sources.
Fetch https://opencode.ai/v2/docs/build/plugins and summarize the plugin lifecycle.
```

The model calls `websearch` (provider `deepseek`) or `deepseek_fetch`. When
`fetchOverrideWebfetch` is enabled, Markdown fetches go through `webfetch` instead.

## Configuration

Set these in the plugin's `options` object.

### Search

| Option | Default | Description |
| --- | --- | --- |
| `searchEnabled` | `true` | Register the DeepSeek search provider at all. Only an explicit `false` disables it. |
| `count` | `10` | Results requested from DeepSeek, 1–50. Billing is per request, not per result. |
| `maxResults` | `10` | Results returned to the model after filtering, 0–50. `0` returns no results. |
| `minRerank` | `0` | Drop results below this relevance score. DeepSeek scores are 0–3. A result without a finite score passes while the threshold is `0` and is dropped once it is positive. |
| `minAuthority` | `0` | Drop known authorities below this tier. Authority is 0–4. |
| `allowUnknownAuthority` | `true` | Keep results whose authority is missing or unknown. Only an explicit `false` disables it. |
| `blockedDomains` | `[]` | Add `-site:` operators to the search query. |
| `includeDomains` | `[]` | Restrict results with `site:` operators. |
| `language` | unset | Add a `lang:` operator, for example `zh,en`. |
| `maxSummaryChars` | `1200` | Per-result summary cap, 0–1,000,000. |
| `searchTimeoutMs` | `30000` | Search timeout, 1,000–120,000 ms. |
| `setDefaultWebsearch` | `false` | Make `deepseek` the default websearch provider when the plugin loads. |

### Fetch

| Option | Default | Description |
| --- | --- | --- |
| `fetchEnabled` | `true` | Register any DeepSeek fetch tooling (the separate tool and the webfetch override). |
| `fetchMaxChars` | `16000` | Maximum characters returned, including the title, 0–1,000,000. |
| `fetchTimeoutMs` | `30000` | Fetch timeout, 1,000–120,000 ms. |
| `fetchOverrideWebfetch` | `false` | Replace the built-in `webfetch`. |
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

## Troubleshooting

| Error or symptom | What to do |
| --- | --- |
| `DeepSeek API key is not configured` | Run `opencode auth login` or set `DEEPSEEK_API_KEY`. |
| `HTTP 401, invalid API key` | Check the key and its access to the tools endpoints. |
| `HTTP 402, insufficient balance` | Top up the DeepSeek account. |
| `HTTP 429, rate limited` | Wait, reduce concurrency, or increase `maxRetries`. |
| Search query too long | Shorten the query or reduce configured domain/language operators. |
| `webfetch` fails on localhost or an internal URL | Use a local fetch tool; DeepSeek cannot reach private networks. |
| `format: "text"` / `format: "html"` rejected | DeepSeek Fetch only returns Markdown. |
| Response too large | Use another fetch tool for the full response. |
| `websearch` shows a generic "Unable to search" | Check the OpenCode log for the underlying DeepSeek error. |
| Install or config change does not take effect | Run `opencode service restart`; OpenCode normally reloads plugins automatically. |

## Compatibility

| Component | Version |
| --- | --- |
| OpenCode / plugin API | locked in [`docs/hosts.jsonc`](../hosts.jsonc) |
| Runtime | Bun (provided by OpenCode) |
| DeepSeek API | `/v1/tools/search`, `/v1/tools/fetch` |

OpenCode v1 and the v1 plugin API are not supported. Tested with OpenCode 2.0.32 on Linux
using both an OpenCode-stored DeepSeek credential and `DEEPSEEK_API_KEY`.

## Uninstall

With the installer CLI (restores the snapshotted `websearch.provider`, removes only the
appended permissions, and deletes installer-created files only when they are left empty):

```bash
npx deepseek-web-retrieval uninstall --host opencode --scope <project|global>
```

For a CLI install, remove the config entry with:

```bash
opencode plugin remove github:gwokhou/deepseek-web-retrieval
```

> [!NOTE]
> `plugin remove` only edits `opencode.jsonc`. It leaves an empty `"plugins": []` and any
> `websearch.provider` pointing at `deepseek` in place, so clean those up by hand:

```jsonc
{
  "$schema": "https://opencode.ai/config.json"
}
```

For vendor or auto-discovery installs, also remove the `plugins` entry and delete the
directory you cloned or copied into (`vendor/` or `plugins/`, global or project-local).

OpenCode reloads plugins when the config changes, so a restart is normally unnecessary:

```bash
opencode service restart
```

The CLI installs into OpenCode's plugin cache (for example `~/.cache/opencode/npm/` on
Linux). Leaving it is safe; OpenCode re-fetches it if you install again.
