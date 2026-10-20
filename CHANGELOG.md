# Changelog

All notable changes to this project are documented here.

## Unreleased

- Refuse drift between plan and apply (ADR-0001): apply now re-verifies that the value
  at every set-op path still equals what the plan previewed, and refuses with re-run
  guidance when the config changed since the plan was rendered — the preview, the secret
  guard, and the install record describe one snapshot taken once at plan time, and an
  interim user edit can never be silently overwritten. A file that stopped parsing in
  that window refuses the same way
- Deepen the modules the installer and adapters are built on, behavior-preserving
  except where noted: revert and the cross-scope collision invariant each get exactly
  one owner (a whole-file orphan revert now deletes a created file it leaves empty,
  matching uninstall's semantics; partial orphan reverts never delete a still-claimed
  file); the three config formats — comment-preserving JSONC, comment-lossy TOML, and
  the host-marked rules block — sit behind one codec registry, with a plan's file edits
  as a discriminated union instead of optional-field smuggling; each host module owns
  its per-scope paths, tool ids, and shared plan header, the CLI roster derives from
  the planner registry, and `docs/hosts.jsonc` records which hosts have installer
  modules with test guards holding both in sync; the DeepSeek HTTP transport moves
  behind its own seam with an injectable fetch, the per-call timeout becomes part of
  the request context (the shorter of it and the configured timeout wins, for search
  as well as fetch), and the OpenCode adapter stops rebuilding resolved options; the
  core returns a host-neutral search result, owns the capability-fact description
  fragments both adapters compose from, and resolves OpenCode's registration knobs
  inside the OpenCode adapter where they are consumed; the `DEEPSEEK_*` environment
  variable names have a single source in the core constants
- Make the installer CLI edge testable and explicit: command output is injectable,
  input validation returns a discriminated result instead of smuggling exit codes as
  numbers, and the config home is an explicit input with the XDG comparison resolved
  once at the entry (behavior unchanged)
- Track the project's domain documentation: `CONTEXT.md` (the glossary hosts, adapters,
  tiers, plans, records, reverts, codecs are written in) and `docs/adr/` now live in
  the repository, alongside the `docs/agents/` agent-skills configuration (GitHub
  Issues as the tracker, default triage labels, single-context domain docs)
- Enforce the forced tier's exclusivity promise and complete the detect phase: other
  registered MCP servers are now classified web-capable from their name plus
  command/args/url (a heuristic the plan notes state openly). Under a forced tier, Pi
  disables the web-capable ones via their per-server `enabled` key with the prior value
  snapshotted for uninstall, while Codex — which has no per-server kill switch — refuses
  the tier with guidance instead of promising non-exclusive routing (OpenCode's forced is
  replacement, which no third-party server overrides). The target rules file is scanned
  for steering toward other web tools (the installer's own marked block excluded) and the
  conflict is reported, not resolved; every forced-tier plan names the README's "Privacy
  and cost" section; the both-off error and the stay-registered/replacement notes become
  shared strings instead of per-planner copies
- Refuse cross-scope installs that would claim one config file: Codex's project-scope
  fallback writes the user-level `~/.codex/config.toml`, so a project install beside a
  global one left both scopes' records claiming `mcp_servers.deepseek` in that file, and
  whichever uninstalled first reverted the other's registration. The plan now refuses a
  second scope whose edits overlap the other scope's recorded files (pointing at the
  uninstall command to run instead), and uninstall runs the same check defensively for
  records that predate the guard. Pi and OpenCode scope pairs map to disjoint files and
  install side by side as before
- Split installer config editing into `configFile` (JSONC text editing) and
  `configValue` (the parsed-object model), unifying the duplicated path walkers,
  append-array dedupe, created-parents pruning, and the isPlainObject guard along the
  way (no behavior change); add a guard test that every version literal in installer
  prose appears in `docs/hosts.jsonc`, so a version bump without the re-verification
  pass fails tests instead of shipping stale facts in user-facing plan notes
- Close the remaining high- and medium-value e2e coverage gaps with four new Docker
  scenarios: `installer` (keyless — the installer CLI's own product: init/apply/uninstall
  for all three hosts, verified through the real agents' config readers, including the
  Codex kill-switch write and the OpenCode engine replacement), `pkg` (keyless — the
  `npm pack` tarball installed with npm in the container, its bin executed directly,
  then registered as the Pi server for a real handshake), `capability-off` (keyless —
  `DEEPSEEK_ENABLE_FETCH=false` leaves exactly the search tool, both flags false refuses
  to start, and a registration without `exposure` reports `codemode`), and `preferred`
  (billed — installer product at Pi project scope with preferred tiers, then
  natural-language prompts that name no tool, so only the AGENTS.md rules block can steer
  the model). The harness now accepts multiple scenario names, packs the npm tarball
  before running, gives each scenario an isolated HOME and project dir (cleaned up
  afterwards) while sharing one npm download cache per run, and suggests the keyless
  subset when `DEEPSEEK_API_KEY` is missing
- Fix the installer's secret guard refusing its own output: a re-init over an existing
  entry whose `DEEPSEEK_API_KEY` is the `${DEEPSEEK_API_KEY}` indirection form was
  rejected as a literal credential. Pure `${VAR}` expansions now pass the guard (found
  by the new installer e2e scenario running after pi-billed in a shared HOME); literal
  keys are still refused
- Fix the `codex` e2e scenario, which had never actually completed a turn: the slim
  Node base image ships no system CA bundle, so Codex's static-musl TLS stack (rustls,
  unlike Node's bundled store) failed every HTTPS request as an opaque
  "Reconnecting... waiting for network" loop — the Dockerfile now installs
  `ca-certificates`. The scenario config also follows DeepSeek's official Codex
  integration: a vendored `test/e2e/codex-models.json` catalog is written to
  `~/.codex/models.json` and referenced via `model_catalog_json` (without it Codex
  cannot resolve DeepSeek model slugs), with `wire_api = "responses"` and the key
  still forwarded through `env_key`/`env_vars` instead of the official script's
  bearer-token-in-file. The scenario now exercises the `web_search = "disabled"`
  kill switch for real. All four scenarios (pi, pi-billed, opencode, codex) pass in
  Docker with real billed requests
- Add the billed `pi-billed` e2e scenario, bringing Pi to the same invocation-level
  coverage as the opencode and codex scenarios: headless `pi --print` prompts whose
  LLM is Pi's native DeepSeek provider (`deepseek/deepseek-flash`), so one key pays
  for both legs and the model really calls `deepseek_fetch` / `deepseek_web_search`
  through Pi's own MCP client. The keyless `pi` handshake scenario stays
- Drop Continue and Gemini from the host matrix — they will not be supported.
  Both generated tables, the per-host reference, the protocol research, the
  installer examples, and the host-count invariants shrink accordingly (the
  MCP-capable host count is now seven)
- Fix the critical code-review findings on the installer: a tier-change re-init now
  reverts the previous init's artifacts explicitly (shown in the plan, undone on
  apply) instead of orphaning them; the plan renders old values for every set op and
  existing counts for appends; TOML comment-loss detection covers trailing comments
  (string-aware); rules-block markers are per host so pi and codex can share one
  AGENTS.md; install records are written 0600 with `.deepseek-web-retrieval/`
  gitignored; replacing an entry that contains a literal credential-looking key is
  refused instead of snapshotted; the CLI resolves `--cwd`, falls back to
  `os.homedir()`, rejects unknown flags/positionals with targeted messages, and
  apply refuses to clobber non-array/non-object config values before writing
  anything; the e2e runner rejects stale flags (including `--local`) and forwards
  empty env values as empty instead of passing host values through
- Add the installer CLI (`deepseek-web-retrieval init` / `uninstall` / `list`) for
  OpenCode, Pi, and Codex: plan-then-apply with per-capability tiers (optional /
  preferred / forced / off) and a first-class project/global scope, JSON edits that
  preserve comments (jsonc-parser), TOML support (smol-toml), snapshot-based surgical
  rollback that never clobbers user edits, and detect notes for competitors, other
  registered MCP servers, and Codex's `[tools] web_search` no-op trap
- Add `DEEPSEEK_ENABLE_SEARCH` / `DEEPSEEK_ENABLE_FETCH` (and the OpenCode
  `searchEnabled` / `fetchEnabled` options) for per-capability control on every host;
  the MCP server refuses to start when both tools are disabled
- Promote Codex to supported: MCP-server adapter, the `docs/agents/codex.md` guide,
  tier table with the top-level `web_search = "disabled"` kill switch, and
  `env_vars`-based key forwarding that respects Codex's stdio env allowlist
- Make the e2e suites Docker-only (remove `--local`) and add the billed `codex`
  scenario: headless `codex exec` in an isolated HOME with DeepSeek as the Codex LLM
  over the Responses wire (Codex 0.163.0 dropped `wire_api = "chat"`; DeepSeek serves
  the Responses endpoint), one key paying for both legs
- Replace the hand-written JSONC stripper with jsonc-parser (now also
  `src/core/jsonc.ts`); drop `scripts/jsonc.ts`

- Fix documentation review findings: resolve the Pi `structuredContent` contradiction
  against the v1.3.0 source (content-first, structuredContent as a no-content
  fallback), add the missing `extension` mechanism to the taxonomy and re-path
  OpenCode to its native mechanisms, qualify the Forced tier in the Tiers table
  itself, de-restate version locks and the baseline in CONTRIBUTING/integration,
  replace "planned" with "shipped" for the MCP server, tighten installer rollback
  and forced-unavailable/session-scoped semantics, and dedupe the provenance and
  quirk summaries
- State the installer principles — never overwrite user configuration without the
  user's knowledge, and post-install behavior and impact scope must be controllable
  and knowable — and specify the detect/merge/verify flow, tier semantics against
  stock configuration, snapshot-based rollback, and a first-class project/global
  scope choice (honor or report, never silently downgrade) in
  `docs/design/installer-design.md`; qualify the control matrix's exclusion flavor as
  relative to built-in competitors only
- Categorize `docs/`: per-agent guides in `docs/agents/`, research notes in
  `docs/research/`, and design notes in `docs/design/`; the integration hub and
  `docs/hosts.jsonc` stay at the root
- Add `docs/research/control-matrix.md`: control-tier research (optional / preferred /
  forced, per host and capability) with a consolidated per-host reference — built-in web
  tools and their kill switches, MCP registration, and rules files. The control matrix is
  generated from the new `control` field in `docs/hosts.jsonc` (`bun run docs:matrix`;
  drift fails tests)
- Correct the Continue host note (the CLI has no built-in `search_web`; it is
  IDE-extension-only) and state the built-in web tools in the Codex, Cursor, Devin, and
  Copilot notes; extend the host-evaluation checklist with the rules and built-in
  kill-switch questions
- Move install-time tier planning to `docs/design/installer-design.md`, and fold the
  `docs/research/mcp-compatibility.md` per-host setup notes and quirk catalog into the
  control-matrix per-host reference; `integration.md` host notes now link there instead
  of restating details
- Fix the hosts.jsonc drift guard: the matrix renderer no longer rewrites
  docs/integration.md when imported by tests, and CI and `bun run check` now fail
  on drift (`docs:matrix --check`)
- Serve both MCP tools end to end at every pinned client revision, not only
  `listTools`
- Build `dist/cli.js` on demand for the stdio smoke test instead of silently
  skipping it on a fresh checkout
- Share the fetch pipeline (parse, host policy, fetch, format) between the
  OpenCode and MCP adapters through `fetchDocument` in the core
- Stop restating host version locks in narrative docs; reference
  `docs/hosts.jsonc` instead
- Pin the e2e Docker base image (`node:22.23.3-slim`) and correct the 0.2.0
  changelog wording about where e2e versions are pinned
- Type the `DEEPSEEK_*` environment mapping so option keys and variable names
  cannot drift apart

## 0.2.0

- Make `docs/hosts.jsonc` the single source of truth for host facts: the
  integration.md host table is generated from it (`bun run docs:matrix`, drift fails
  tests), CI matrices and the e2e Docker build args derive from it, and narrative
  docs reference it instead of restating version locks
- Add a local-only end-to-end script (`bun run test:e2e`): a keyless real
  `pi mcp list` handshake against the built server, and a headless `opencode run`
  scenario that makes real billed requests; never run in CI. Agents run inside
  Docker with versions injected from `docs/hosts.jsonc` as Docker build args
  (`--local` opts out)
- Add an MCP server adapter (`src/mcp/`) exposing `deepseek_web_search` and `deepseek_fetch`
  over stdio, serving MCP clients from revision 2024-11-05 through 2026-07-28
- Support `DEEPSEEK_*` environment variable configuration in the MCP server, mapped onto the
  shared option pipeline
- Add the Pi guide (`docs/pi.md`) and `examples/pi.mcp.jsonc`; Pi 1.3.0 is the first
  supported MCP host
- Add `docs/mcp-compatibility.md`, a primary-source review of MCP protocol compatibility
  across the hosts in the support matrix
- Add a Node build (`dist/cli.js`) with a `deepseek-web-retrieval` bin entry and Node 20+
  engines, alongside the existing Bun workflow
- Cover the MCP server with SDK client personas pinned to 2024-11-05, 2025-06-18,
  2025-11-25, and 2026-07-28, plus a real stdio smoke test of the built entry
- Enforce the fetch host policy inside the core client so direct core consumers cannot bypass it
- Fail fast on a missing API key before the fetch permission prompt, and reject non-string `url` inputs
- Move OpenCode-specific missing-key guidance out of the agent-agnostic core
- Document that `maxResults: 0` returns no results
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
