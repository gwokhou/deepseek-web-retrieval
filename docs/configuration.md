# Configuration guide

The one reference for how every knob resolves on every host: the layering
chain, the shared config file, the full knob vocabulary, and which layer to set.
Behavior (what search and fetch do) lives in the README's
[General behavior](../README.md#general-behavior); per-host mechanics (output
caps, deadlines, how the environment reaches a stdio server) live in the host
guides: [Codex](agents/codex.md), [Pi](agents/pi.md),
[OpenCode](agents/opencode-v2.md).

## The resolution chain

Every knob resolves through one chain, low → high, identically on every host:

```
built-in defaults  <  shared config file  <  DEEPSEEK_* environment  <  host-native config
```

A higher layer always wins, so nothing already configured loses effect. The
host-native layer means OpenCode's plugin options (`opencode.jsonc`), Pi's
`deepseekWebRetrieval` settings namespace, and — for MCP hosts — the per-server
`env` block in the host's registration (that block is how an environment
variable arrives, not a fifth layer).

## The shared config file

`$XDG_CONFIG_HOME/deepseek-web-retrieval/config.json` when `XDG_CONFIG_HOME` is
set (this wins on every platform, Windows included); otherwise
`~/.config/deepseek-web-retrieval/config.json` on Linux and macOS and
`%APPDATA%\deepseek-web-retrieval\config.json` on Windows. camelCase keys:

```json
{
  "count": 20,
  "blockedDomains": ["pinterest.com"],
  "language": "zh",
  "searchLocalization": "203.0.113.7"
}
```

Unknown keys and host-integration keys (below) draw a one-line stderr warning
and are otherwise ignored — a bad file never blocks startup. The API key never
goes in the file; it keeps its existing channels (`DEEPSEEK_API_KEY` in the
environment, or OpenCode's stored credential).

## Knob classes

| Knob class | Shared file | Examples |
| --- | --- | --- |
| API behavior — the user↔DeepSeek relationship | yes — that is the point of the file | `count`, `blockedDomains`, `language`, `maxRetries` |
| Host-sensitive — interacts with host output caps and deadlines | carries the safe defaults; a host layer is the recommended override point | `searchTimeoutMs`, `fetchTimeoutMs`, `fetchMaxChars`, `maxSummaryChars` |
| Host integration — the host's tool landscape | rejected — warned about and ignored | `searchEnabled`, `setDefaultWebsearch`, `apiKeySource` |

Keep host-independent intent in the shared file; prefer a host layer when a
host-sensitive knob would cross its host's cap or deadline.

## The knob vocabulary

One knob, two names: the camelCase key for the shared file and OpenCode's
options, the `DEEPSEEK_*` variable for the environment. The table generates
from the same config vocabulary the adapters resolve through, so it cannot
drift from the code (`bun run docs:matrix` regenerates it; CI checks it).

<!-- generated: knob-table — edit src/core/config-summary.ts or env.ts, then run `bun run docs:matrix` -->

| File / OpenCode key | Environment | Default |
| --- | --- | --- |
| `count` | `DEEPSEEK_SEARCH_COUNT` | 10 |
| `maxResults` | `DEEPSEEK_SEARCH_MAX_RESULTS` | follows `count` (10) |
| `minRerank` | `DEEPSEEK_SEARCH_MIN_RERANK` | 0 |
| `minAuthority` | `DEEPSEEK_SEARCH_MIN_AUTHORITY` | 0 |
| `allowUnknownAuthority` | `DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY` | true |
| `blockedDomains` | `DEEPSEEK_SEARCH_BLOCKED_DOMAINS` | unset |
| `includeDomains` | `DEEPSEEK_SEARCH_INCLUDE_DOMAINS` | unset |
| `language` | `DEEPSEEK_SEARCH_LANGUAGE` | unset |
| `searchLocalization` | `DEEPSEEK_SEARCH_LOCALIZATION` | unset |
| `maxSummaryChars` | `DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS` | 1200 |
| `searchTimeoutMs` | `DEEPSEEK_SEARCH_TIMEOUT_MS` | 30000 |
| `fetchMaxChars` | `DEEPSEEK_FETCH_MAX_CHARS` | 16000 |
| `fetchAllowedDomains` | `DEEPSEEK_FETCH_ALLOWED_DOMAINS` | unset |
| `fetchBlockedDomains` | `DEEPSEEK_FETCH_BLOCKED_DOMAINS` | unset |
| `fetchTimeoutMs` | `DEEPSEEK_FETCH_TIMEOUT_MS` | 30000 |
| `fetchBlockPrivateHosts` | `DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS` | true |
| `maxRetries` | `DEEPSEEK_MAX_RETRIES` | 2 |
| `retryBaseDelayMs` | `DEEPSEEK_RETRY_BASE_DELAY_MS` | 250 |

<!-- /generated: knob-table -->

## Special semantics

- **`maxResults` follows `count`** when left unset — configure only `count` and
  the cap moves with it. An explicit `maxResults` still caps; `count` never
  follows `maxResults`.
- **Some switches are false-only.** `allowUnknownAuthority`,
  `fetchBlockPrivateHosts`, `searchEnabled`, and `fetchEnabled` are on by
  default; the environment can only turn them off (`false`, `0`, `no`, or
  `off`). The last two have no file key — they are host-integration keys — so
  they exist only as `DEEPSEEK_ENABLE_SEARCH` and `DEEPSEEK_ENABLE_FETCH`. A
  value like `=true` changes nothing.
- **Invalid environment values are dropped** at startup and the default
  applies. `npx deepseek-web-retrieval config` reports every dropped or
  unknown `DEEPSEEK_*` variable as a warning and exits 1, alongside file
  problems.
- **`searchLocalization` must be a valid IPv4 or IPv6 address**; anything else
  is dropped at option resolution. It is deployment-level configuration, never
  a per-call tool parameter.
- **Domains** in the environment are comma-separated; entries that are not
  domains are dropped (and reported by `config`).
