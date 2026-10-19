# Changelog

All notable changes to this project are documented here.

## Unreleased

- Cover response body reads with the request timeout and cancellation signal
- Reject successful API responses larger than 5 MiB
- Reject search queries that exceed 128 characters after adding search operators
- Block IPv4-mapped IPv6 private addresses in the fetch host policy
- Truncate API error bodies by Unicode code points
- Move OpenCode-specific setup and usage into `docs/opencode-v2.md`
- Add `docs/integration.md` with a version-locked host support matrix
- Calibrate the OpenCode v2 install and uninstall guide against verified behavior:
  plugin hot reload, `plugin add` not selecting the provider, and `plugin remove` leftovers

## 0.1.0

Initial public-ready release.

- DeepSeek Search provider for OpenCode v2 (`websearch.provider = "deepseek"`)
- `deepseek_fetch` tool backed by DeepSeek Fetch
- Optional drop-in `webfetch` replacement
- Reuse of the active DeepSeek credential stored in OpenCode
- `DEEPSEEK_API_KEY` fallback and `apiKeySource` control
- Summary-only search with rerank/authority filtering and URL deduplication
- Markdown-only fetch with a configurable character cap
- Domain allow/deny lists and private-host blocking
- Bounded retries for 408, 425, 429, and 5xx responses with `Retry-After`
- Unicode-safe truncation and secret redaction in errors
- Unit tests and CI
