# Changelog

All notable changes to this project are documented here, with one sentence per item.

## 0.6.0

- Return distinct CLI exit codes — 2 for invalid command lines and 3 when a failed apply could not roll back — and document the codes in the usage text.
- Add a `version` subcommand, record the installer version in install records, and show it in `list` output.
- Route any command-line argument to the installer before the MCP server loads, so installer commands never depend on the server's dependency graph and a mistyped command no longer starts a server.
- Reject duplicate flags instead of silently keeping the last value, and print usage to stderr on a bare invocation.
- Wait up to five minutes for npm's post-upload processing before finalizing automated releases, with retry guidance if processing takes longer.
- Clarify OpenCode and Pi native integration and Codex MCP support across setup, upgrade, security, release, and issue-reporting documentation.

## 0.5.1

- Publish npm packages through GitHub Actions trusted publishing and create GitHub Releases automatically from version tags.
- Gate releases on matching versions and changelog entries, the existing CI matrix, and installation tests of the exact release tarball.
- Resume interrupted releases safely by verifying published package integrity and preserving existing GitHub Releases.

## 0.5.0

- Add a native Pi extension as the default integration, with shared environment configuration and settings-based capability switches.
- Add Pi `--path extension|mcp` and preserve uninstall snapshots when migrating between paths.
- Enforce Pi forced tiers by disabling supported competitors and refusing competitors the host cannot exclude.
- Shape MCP results for each client, including readable text for Codex.
- Use Codex's `disabled_tools` for capability off tiers and report host-version drift during init.
- Keep each capability's preferred rules independent of the other capability's tier.
- Make host SDK peers optional for standalone MCP installs and limit Pi peers to the compatible `^1.3.0` range.
- Reject valued `--apply` flags such as `--apply=false` before writing files.
- Validate install records and refuse corrupt or unreadable records with repair guidance.
- Track shared config ownership to prevent installs from different projects overwriting or uninstalling one another.
- Atomically replace individual files, preserve permissions and symlinks, and serialize conflicting writes with operation locks.
- Verify writes and recovery, reporting `rolled_back` or `recovery_required` when apply fails.
- Preserve user content, original competitor snapshots, and rules separators during re-init and uninstall.
- Use platform-native paths and reject malformed or duplicate rules markers.
- Apply identical Fetch URL validation to string and URL-object inputs.
- Allow unscored search results when `minRerank` is zero while retaining positive-threshold filtering.
- Add injectable retrieval clients so adapter tests no longer replace global `fetch`.
- Remove `formatFetchContent` in favor of `formatFetchedContent`, which also reports truncation.
- Add Biome checks, read-only docs drift detection, and clearer stdio handshake diagnostics.
- Gate releases on full checks, installed-package validation across Node 20/22/24/26 in CI, and keyless Docker regressions.
- Add a published 0.4.0 upgrade regression covering all three hosts, Pi path migration, and restoration of original configuration on uninstall.
- Upgrade existing installs from their original project and scope, selecting `--path mcp` explicitly to retain Pi's MCP path.
- Preserve install records for recovery and inspect interrupted operation locks before removing them.

## 0.4.0

- Align search defaults with [industry defaults](docs/research/search-api-defaults.md): return up to ten results with score and authority filtering disabled unless explicitly enabled.
- Make `DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY` default to true, with `false`, `0`, `no`, or `off` disabling it.
- Replace the README's cost-efficiency claim with neutral descriptions of default behavior.

## 0.3.0

- Add keyless re-init coverage for tier downgrades, snapshot restoration, scope collisions, listing, and XDG config routing.
- Refuse apply when configuration has changed or stopped parsing since the plan was generated.
- Consolidate installer codecs, host planning, reversible edits, and shared retrieval behavior behind dedicated modules.
- Make CLI output injectable and resolve input validation and config-home selection at the CLI boundary.
- Add the domain glossary, architecture decisions, and agent workflow documentation.
- Detect competing web tools and refuse forced tiers when the host cannot enforce exclusivity.
- Refuse cross-scope installs that would claim the same config file.
- Separate JSONC editing from value manipulation and guard installer version claims against the host registry.
- Add isolated Docker scenarios for installation, packaging, capability switches, and preferred routing.
- Accept `${VAR}` credential references during re-init while continuing to reject literal secrets.
- Fix Codex end-to-end execution with system CA certificates, a model catalog, and the Responses API.
- Add a billed Pi scenario that verifies real model calls to both retrieval tools.
- Remove Continue and Gemini from the support matrix.
- Harden installer previews, orphan reverts, config-shape checks, rules markers, private records, and CLI validation.
- Add reversible `init`, `uninstall`, and `list` commands for OpenCode, Pi, and Codex with project/global scopes and per-capability tiers.
- Add independent Search and Fetch switches and refuse MCP startup when both are disabled.
- Promote Codex to supported with documented MCP setup, built-in search control, and environment-based key forwarding.
- Make end-to-end tests Docker-only and add a billed Codex scenario.
- Replace the handwritten JSONC parser with `jsonc-parser`.
- Correct integration documentation for Pi content handling, native extensions, control tiers, and rollback limits.
- Document installer preview, scope, verification, and snapshot-based recovery guarantees.
- Organize documentation into agent guides, research, and design notes.
- Generate the capability control matrix from `docs/hosts.jsonc` with drift checks.
- Correct built-in web-tool facts and expand the host evaluation checklist.
- Consolidate host setup and compatibility details in the control-matrix reference.
- Prevent matrix-renderer imports from rewriting documentation and fail checks on generated-doc drift.
- Exercise both MCP tools at every pinned client protocol revision.
- Build the CLI before stdio smoke tests instead of skipping fresh checkouts.
- Share the Fetch pipeline between OpenCode and MCP through the core's `fetchDocument`.
- Reference the host registry instead of repeating version locks in narrative documentation.
- Pin the Docker base image and clarify where end-to-end host versions are configured.
- Type the environment-variable mapping to prevent option names from drifting.

## 0.2.0

- Make `docs/hosts.jsonc` the source for host facts, generated tables, CI matrices, and Docker version arguments.
- Add local end-to-end tests for keyless Pi handshakes and billed OpenCode requests, using Docker by default with an optional local mode.
- Add a stdio MCP adapter exposing Search and Fetch across protocol revisions 2024-11-05 through 2026-07-28.
- Configure the MCP adapter through shared `DEEPSEEK_*` environment options.
- Add Pi setup documentation and an MCP config example as the first supported MCP host.
- Add a primary-source review of MCP compatibility across the host matrix.
- Add the Node 20+ CLI build and executable alongside the Bun workflow.
- Test pinned MCP client revisions and the built CLI's stdio transport.
- Enforce Fetch host policy inside the core client.
- Reject missing credentials before prompting for Fetch permission and reject non-string URLs.
- Move OpenCode-specific credential guidance out of the shared core.
- Document that `maxResults: 0` returns no results.
- Apply timeout and cancellation to response-body reads.
- Reject successful API responses larger than 5 MiB.
- Reject search queries longer than 128 characters after operators are added.
- Block IPv4-mapped IPv6 private addresses.
- Truncate API error bodies by Unicode code points.
- Move OpenCode setup and usage into its dedicated guide.
- Add an integration guide with a version-locked support matrix.
- Correct OpenCode installation and removal guidance for hot reload, provider selection, and leftover configuration.

## 0.1.0

- Add a DeepSeek Search provider for OpenCode v2.
- Add the `deepseek_fetch` tool backed by DeepSeek Fetch.
- Offer an optional replacement for OpenCode's built-in `webfetch`.
- Reuse the active DeepSeek credential stored in OpenCode.
- Support `DEEPSEEK_API_KEY` fallback and `apiKeySource` selection.
- Return summary-only search results with score filtering and URL deduplication.
- Return Markdown Fetch content with a configurable character limit.
- Add domain allow/deny lists and private-host blocking.
- Retry selected transient HTTP failures with bounded attempts and `Retry-After` support.
- Preserve Unicode boundaries and redact secrets in errors.
- Add unit tests and CI.
