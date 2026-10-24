# Contributing

Thanks for helping improve DeepSeek Web Retrieval.

## Development setup

```bash
bun install
bun run check
```

The project uses Bun for development; native adapters use the SDKs supplied by
OpenCode and Pi at runtime, so do not bundle host SDKs into the adapters.

`bun run check` runs Biome, TypeScript, the generated-docs check, the build, and
the test suite. Biome checks formatting, recommended lint rules, and import
ordering; warnings fail both local checks and CI. Its version is pinned in
`package.json` so local development and CI use the same rules and formatter.

- `bun run lint` — check without changing files.
- `bun run lint:fix` — apply safe fixes and formatting, then report remaining issues.
- `bun run format` — format files only.

Biome covers source, tests (including the e2e harness), scripts, and root project
configuration. Documentation, examples, the vendored e2e model catalog, and
generated build output are outside its scope. Review fixes before committing;
resolve remaining diagnostics manually instead of applying unsafe fixes blindly.

The stdio smoke tests rebuild the CLI and first probe Node child-process stdin,
stdout, and stderr. Some restricted execution environments break those streams
even for a plain Node child. A failed probe fails the suite explicitly; run the
same tests in an environment that supports child-process stdio. Handshake errors
include the server's captured stderr. These tests use placeholder credentials and
local validation, so they do not make billed API calls.

## Release and end-to-end tests

### Automated releases

Push a stable `vX.Y.Z` tag to run `.github/workflows/release.yml`; the tagged
commit must be on `main`, `package.json` must contain `X.Y.Z`, and `CHANGELOG.md`
must contain one nonempty `## X.Y.Z` section. Prerelease tags are not supported.
The workflow builds and smoke-tests a tarball, runs the existing CI matrix and keyless Docker
regressions, publishes that exact tarball to npm with OIDC and provenance, verifies
its registry integrity, then creates a GitHub Release from that changelog section.
Only the final publish job receives npm OIDC and GitHub release permissions.

The repository's [npm trusted publisher](https://www.npmjs.com/package/deepseek-web-retrieval/access)
was validated by the real [v0.5.1 release](https://github.com/gwokhou/deepseek-web-retrieval/releases/tag/v0.5.1).
Routine releases reuse it without npm login.
If the binding needs to be recreated, use these exact values:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `gwokhou` |
| Repository | `deepseek-web-retrieval` |
| Workflow filename | `release.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable direct `npm publish` |

No `NPM_TOKEN`, npm login, or API key is required in Actions. The workflow uses
GitHub-hosted runners, Node 24 and npm 11.21.0. Per the current
[npm policy](https://docs.npmjs.com/trusted-publishers/), a new trusted-publisher
configuration expires unless its first successful publish happens within two
days, so create it shortly before the next release; recreate it if it expires.
A successful first publish validates the binding. Saving the form or running a
dry run does not validate OIDC publishing.

Before tagging, update `package.json` and move the intended `Unreleased` entries into
one `## X.Y.Z` changelog section, keeping each item to one sentence. Commit the release
changes on `main`, run `bun run check`, and push `main`. Derive the tag from the updated
package version so the command stays valid for each release:

```bash
RELEASE_VERSION=$(node -p "require('./package.json').version")
git tag -a "v$RELEASE_VERSION" -m "Release $RELEASE_VERSION"
git push origin "refs/tags/v$RELEASE_VERSION"
```

Watch the [Release workflow](https://github.com/gwokhou/deepseek-web-retrieval/actions/workflows/release.yml)
and confirm the npm `latest` version and GitHub Release after all jobs succeed.

Use **Actions → Release → Run workflow** on `main` for a rehearsal: it builds
and uploads the candidate and runs all checks, without publishing to npm or
creating a GitHub Release. For an interrupted tag release, rerun its failed jobs;
an already-published npm version is accepted only if its integrity matches the
candidate, and an existing stable GitHub Release is left intact. A conflicting
npm version fails instead of being overwritten; a new older version cannot move
`latest` backwards. Do not move or recreate a published tag to retry a release.
After npm accepts an upload, the workflow waits up to five minutes for the
version to become available; if npm processing takes longer, wait until the
version appears in the registry and rerun the failed jobs to finish the release.

### Validation commands

`bun run check:release` runs the full check, the installed-package Node smoke
test, and all nine keyless Docker scenarios (`pi`, `pi-extension`, `pi-mock`,
`opencode-mock`, `installer`, `reinit`, `upgrade`, `pkg`, and `capability-off`).
`prepublishOnly` requires this gate; Docker and npm registry access are required.

The two e2e suites have split responsibilities. **Keyless** (`bun run
test:e2e:keyless`) is CI's regression net: it runs in GitHub Actions on every
push and PR, and proves everything that does not need the real DeepSeek
service — installer lifecycle, packaging, host handshakes, and (through the
in-container mock upstream) real session loops that invoke both retrieval
tools, so a tool-execution regression fails CI without a key. **Billed** (`bun
run test:e2e:billed`, or the full `bun run test:e2e`) runs locally with a real
`DEEPSEEK_API_KEY` and is the only suite that verifies the live DeepSeek API
contract: real LLM behavior, real search results, real page content. Run it
before a release and whenever a host pin in `docs/hosts.jsonc` changes. CI runs
the keyless scenarios and tests the packaged CLI on Node 20, 22, 24,
and 26; billed scenarios remain explicit local runs with a real key.

`bun run test:package` installs a freshly packed tarball in a temporary directory
and tests init, re-init, uninstall, and an MCP stdio handshake with the selected
Node executable using normal npm peer resolution, and fails if any host SDK is
installed alongside the standalone MCP package; it requires a current build
(`bun run build`). The Docker `pkg` scenario also loads the packed native adapters
in the pinned Pi and OpenCode hosts, using the SDKs provided by those hosts.
The e2e runner clears stale `deepseek-web-retrieval-*.tgz` from the repo root
before packing and removes the packed tarball when the run ends, so successive
runs (and version bumps between them) cannot trip the scenarios' exactly-one
tarball lookup. `bun run clean` removes build output, coverage, and any packed
tarballs by hand.
To validate an existing artifact without repacking it, run
`node scripts/test-package.mjs /absolute/path/to/package.tgz`; the release workflow
uses this mode before uploading the exact candidate for the publish job.

Host SDKs are optional peers because only the corresponding native adapter needs
them; the MCP CLI does not import them. Pi peers use `^1.3.0` and OpenCode retains
`^2.0.32`, while development dependencies and `docs/hosts.jsonc` pin the versions
actually tested. These ranges express compatibility expectations, not a claim
that every future minor release has been tested. A custom adapter loader must
supply the appropriate SDK itself.

The release gate needs a temporary directory with enough space for npm caches
and installed packages; on systems with a small `/tmp`, set `TMPDIR` to an empty
directory on a disk with sufficient free space before running it. No npm login
is needed for these public-package checks; tag releases obtain publishing authorization
through GitHub Actions OIDC.

`bun run test:e2e` exercises real coding agents. It only runs
inside Docker (`test/e2e/Dockerfile`); there is no host-binary mode, so the agent
versions from `docs/hosts.jsonc` are always the compatibility claim under test. The
image contains no secrets; the key is passed at `docker run` time.

- `bun run test:e2e pi` — keyless. Registers the built MCP server in an isolated
  Pi config and asserts a real `pi mcp list` handshake.
- `bun run test:e2e pi-extension` — keyless; checks that Pi rejects a both-off
  settings namespace and loads the extension when the namespace is removed.
- `bun run test:e2e pi-mock` — keyless; invocation-level without a key. The
  same extension-path session shape as `pi-billed`, but every upstream is the
  in-container mock (`test/e2e/mock-upstream.mjs`): the LLM is a custom
  `models.json` provider against the mock's OpenAI-compatible endpoint, and
  the retrieval follows `DEEPSEEK_BASE_URL`. The mock's two-round script issues
  the tool call and turns the tool result into the final answer, so the
  scenario passes only when `deepseek_fetch`/`deepseek_web_search` really ran
  and their results reached the model; its request log also proves the
  placeholder bearer and the requested query/url reached the retrieval API shape.
- `bun run test:e2e opencode-mock` — keyless; the OpenCode session loop without
  a key. Same shape as the billed `opencode` scenario (plugin from this
  checkout, `deepseek_fetch` tool, built-in `websearch` backed by the plugin's
  provider) with the mock upstream for both legs; the placeholder bearer on the
  retrieval calls also proves the plugin's environment-variable key fallback.
- `bun run test:e2e pi-billed` — requires `DEEPSEEK_API_KEY`. Runs headless
  `pi --print` prompts through the native extension, with Pi's DeepSeek provider
  (`deepseek/deepseek-flash`) as the LLM from the same key, and verifies model
  calls to `deepseek_fetch` and `deepseek_web_search`. Real billed
  requests (LLM + retrieval).
- `bun run test:e2e installer` — keyless. Runs the installer CLI itself inside
  the container: `init --apply` for Pi (global, verified by a real handshake),
  Codex (global, forced search — the `web_search = "disabled"` kill switch —
  verified by `codex mcp list` and the written config), Claude Code (global,
  forced search + preferred fetch — the `permissions.deny` kill switch, the
  `~/.claude.json` registration verified by a real `claude mcp list` health
  check (global scope connects; an unapproved project `.mcp.json` server only
  lists as pending), and the CLAUDE.md rules block), and OpenCode (project,
  forced search + preferred fetch, verified at the file level), then `uninstall`
  and asserts everything it applied is gone.
- `bun run test:e2e reinit` — keyless. The installer's lifecycle beyond the first
  install: a Codex tier downgrade reverts the orphaned kill switch inside the
  still-claimed config (snapshot restored, registration kept, the plan's reverts
  section visible), a Pi preferred → optional downgrade deletes the orphaned,
  installer-created rules file whole, a second Codex scope claiming the same
  config file is refused with uninstall guidance, Claude Code's scopes map to
  disjoint files and install side by side (project downgrade included),
  `list` reports the recorded
  installs, and `XDG_CONFIG_HOME` routes the global config home (with uninstall
  finding the record there). Also covers the Codex project scope and OpenCode
  global scope path mappings.
- `bun run test:e2e upgrade` — keyless; installs the published npm 0.4.0 CLI,
  creates all three host installs over existing user configuration, upgrades to
  the packed candidate, migrates Pi from MCP to its default extension, repeats
  forced init, and verifies uninstall restores the original settings and rules.
  The baseline omits legacy host peers to avoid resolving them to newer versions;
  the candidate uses normal npm installation, and a fresh install checks that
  ownership claims were released.
- `bun run test:e2e pkg` — keyless. Installs the `npm pack` tarball of this
  checkout with npm inside the container, executes its bin directly, and
  registers the installed binary as the Pi MCP server for a real handshake,
  then verifies native Pi tool registration and OpenCode plugin activation
  without SDKs installed alongside the package.
- `bun run test:e2e capability-off` — keyless. Covers the per-capability
  switches and the exposure trap through `pi mcp list --json`:
  `DEEPSEEK_ENABLE_FETCH=false` leaves exactly the search tool, both flags
  false refuses to start (failed state with the refusal message), and a
  registration without `exposure` reports `codemode`. OpenCode's runtime
  toggles (`searchEnabled`/`fetchEnabled` plugin options) have no keyless
  runtime probe here — OpenCode's tool-inventory HTTP API is experimental — so
  they are covered by unit tests at the registration level instead.
- `bun run test:e2e preferred` — requires `DEEPSEEK_API_KEY`. Installs Pi at
  project scope with preferred tiers via the installer, then prompts in natural
  language without naming any tool — only the AGENTS.md rules block can steer
  the model to the DeepSeek tools, which is exactly what the preferred tier
  promises. Also covers the project scope and the print-mode `--approve` trust
  path. Real billed requests (LLM + retrieval).
- `bun run test:e2e opencode` — requires `DEEPSEEK_API_KEY`. Runs headless
  `opencode run` prompts in an isolated project
  that loads the plugin from this checkout. The LLM is a DeepSeek custom
  provider configured from the same key, so no `opencode auth login` is needed;
  this exercises the adapter's environment-variable key fallback. Real billed
  requests (LLM + retrieval).
- `bun run test:e2e codex` — requires `DEEPSEEK_API_KEY`. Runs headless
  `codex exec` prompts in an isolated HOME whose config.toml registers the built
  MCP server (key forwarded via `env_vars`, never written to a file) and points
  Codex at DeepSeek as the LLM over the Responses wire, following DeepSeek's
  official Codex integration: the vendored `test/e2e/codex-models.json` catalog
  is written to `~/.codex/models.json` and referenced via `model_catalog_json`
  (without it Codex cannot resolve DeepSeek models), and the scenario also
  exercises the top-level `web_search = "disabled"` kill switch for real. Real
  billed requests (LLM + retrieval). The Dockerfile installs `ca-certificates`
  because Codex is a static musl binary whose TLS stack reads the system CA
  store, which the slim Node base does not ship.
- `bun run test:e2e claude-code` — requires `DEEPSEEK_API_KEY`. Runs headless
  `claude -p --output-format stream-json` prompts in an isolated HOME whose
  `.mcp.json` registers the built MCP server (key expanded from the
  environment via `${DEEPSEEK_API_KEY}`, never written to a file) and whose
  `.claude/settings.json` denies the built-in `WebSearch`/`WebFetch` tools —
  the forced-tier kill switch, asserted by requiring the built-ins never appear
  as tool calls. Claude Code is pointed at DeepSeek as the LLM over its
  Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`
  from the same key). Real billed requests (LLM + retrieval).
- `bun run test:e2e` — all scenarios; a missing `DEEPSEEK_API_KEY` fails fast.
  Multiple names select a subset (`bun run test:e2e:keyless` runs every keyless
  scenario); the harness packs the npm
  tarball before running, so the installer and pkg scenarios always exercise
  the current checkout's packaging.

The script rebuilds `dist/cli.js` before running, and a missing key is an
error, not a skip.

## Architecture

- `src/core/` is agent-agnostic: HTTP clients, options, URL/domain policy,
  filtering, formatting, and errors. `createRetrievalClient({ fetchImpl })` binds
  an HTTP dependency per instance. Adapter factories accept this client; tests
  should inject it instead of replacing process-wide `fetch`.
- `src/opencode/` is the OpenCode v2 adapter: plugin setup, credential
  resolution, provider registration, and tools.
- `src/pi/` is the native Pi extension: tool registration, result formatting,
  and settings-based capability switches layered over shared environment options.
- Future agents should add a thin adapter under `src/<agent>/` and reuse
  `src/core/` rather than duplicating retrieval logic. The cross-host MCP
  server lives in `src/mcp/`.
- Adapter-specific setup and usage docs live in `docs/agents/<agent>.md`; keep the
  root README focused on the shared project and adapter overview.
- Host facts (version locks, capabilities, paths, status) live only in
  `docs/hosts.jsonc`. When a host changes, update it there and regenerate the
  host table in `docs/integration.md` and the control matrix in
  `docs/research/control-matrix.md` with `bun run docs:matrix`; tests fail
  if either table drifts. `bun run docs:matrix --check` is read-only; run without
  `--check` to update the generated blocks.
- The knob table in `docs/configuration.md` is generated from the config
  vocabulary itself (`CONFIG_KEYS`, `OPTION_ENV_BY_KEY`, and the built-in
  defaults in `src/core/`) by the same `bun run docs:matrix` — adding or
  renaming a knob means editing those sources, then regenerating.
- Bumping `baseline` or a host `version` in `docs/hosts.jsonc` obliges a
  re-verification pass for that host: re-verify its per-host reference section
  and `control` keys in `docs/research/control-matrix.md`, and re-check the
  drift list there; Cline's 3.x CLI still needs a separate compatibility pass,
  while the Codex docs move and Copilot's `GEMINI.md` dating are recorded as resolved.
  Version mentions inside prose and `key` strings are provenance anchors, not lock
  restatements — they move with the re-verification, not with the bump. Update
  a research note's own baseline date only when its facts were actually
  re-checked.

## Pull requests

Please include:

- A focused description of the behavior being changed.
- Tests for new filtering, auth, retry, URL, or truncation behavior.
- `bun run check` passing.
- Documentation updates for new options or changed defaults.
- No real API keys, tokens, or private URLs in commits, tests, logs, or issues.

## Reporting bugs

Use the bug report template and include:

- Host and version (OpenCode, Pi, Codex, Claude Code, or another MCP client)
- Package version or commit
- Integration path, install method, scope, and selected capability tiers
- Relevant redacted JSONC, JSON, or TOML configuration
- Relevant log lines
- Whether `DEEPSEEK_API_KEY` is set

Do not paste a real API key. Redact it as `sk-***`.

## Security

Please report security issues privately as described in [SECURITY.md](SECURITY.md).
