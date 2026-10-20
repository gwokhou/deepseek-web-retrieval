# Contributing

Thanks for helping improve DeepSeek Web Retrieval.

## Development setup

```bash
bun install
bun run typecheck
bun run build
bun test
```

The project uses Bun for development. OpenCode supplies `@opencode/plugin` at
runtime; do not bundle it into the plugin.

## End-to-end tests (local only)

`bun run test:e2e` exercises real coding agents and never runs in CI. It only runs
inside Docker (`test/e2e/Dockerfile`); there is no host-binary mode, so the agent
versions from `docs/hosts.jsonc` are always the compatibility claim under test. The
image contains no secrets; the key is passed at `docker run` time.

- `bun run test:e2e pi` — keyless. Registers the built MCP server in an isolated
  Pi config and asserts a real `pi mcp list` handshake.
- `bun run test:e2e opencode` — requires `DEEPSEEK_API_KEY`. Runs headless
  `opencode run` prompts in an isolated project
  that loads the plugin from this checkout. The LLM is a DeepSeek custom
  provider configured from the same key, so no `opencode auth login` is needed;
  this exercises the adapter's environment-variable key fallback. Real billed
  requests (LLM + retrieval).
- `bun run test:e2e codex` — requires `DEEPSEEK_API_KEY`. Runs headless
  `codex exec` prompts in an isolated HOME whose config.toml registers the built
  MCP server (key forwarded via `env_vars`, never written to a file) and points
  Codex at DeepSeek as the LLM over the Responses wire — Codex 0.163.0 dropped
  `wire_api = "chat"`, and DeepSeek serves the Responses endpoint, which is what
  makes the single-key setup possible. Real billed requests (LLM + retrieval).
- `bun run test:e2e` — all scenarios; a missing `DEEPSEEK_API_KEY` fails fast.

The script rebuilds `dist/cli.js` before running, and a missing key is an
error, not a skip.

## Architecture

- `src/core/` is agent-agnostic: HTTP clients, options, URL/domain policy,
  filtering, formatting, and errors.
- `src/opencode/` is the OpenCode v2 adapter: plugin setup, credential
  resolution, provider registration, and tools.
- Future agents should add a thin adapter under `src/<agent>/` and reuse
  `src/core/` rather than duplicating retrieval logic. The cross-host MCP
  server lives in `src/mcp/`.
- Adapter-specific setup and usage docs live in `docs/agents/<agent>.md`; keep the
  root README focused on the shared project and adapter overview.
- Host facts (version locks, capabilities, paths, status) live only in
  `docs/hosts.jsonc`. When a host changes, update it there and regenerate the
  host table in `docs/integration.md` and the control matrix in
  `docs/research/control-matrix.md` with `bun run docs:matrix`; tests fail
  if either table drifts.
- Bumping `baseline` or a host `version` in `docs/hosts.jsonc` obliges a
  re-verification pass for that host: re-verify its per-host reference section
  and `control` keys in `docs/research/control-matrix.md`, and re-check the
  drift list there (Cline's docs already describe the 3.x binary, Codex's
  config docs have moved, Copilot's `GEMINI.md` support is undated). Version
  mentions inside prose and `key` strings are provenance anchors, not lock
  restatements — they move with the re-verification, not with the bump. Update
  a research note's own baseline date only when its facts were actually
  re-checked.

## Pull requests

Please include:

- A focused description of the behavior being changed.
- Tests for new filtering, auth, retry, URL, or truncation behavior.
- `bun run typecheck` and `bun test` passing.
- Documentation updates for new options or changed defaults.
- No real API keys, tokens, or private URLs in commits, tests, logs, or issues.

## Reporting bugs

Use the bug report template and include:

- OpenCode version
- Plugin version or commit
- Install mode (global vendor path, project path, or auto-discovery)
- Redacted `opencode.jsonc`
- Relevant log lines
- Whether `DEEPSEEK_API_KEY` is set

Do not paste a real API key. Redact it as `sk-***`.

## Security

Please report security issues privately as described in [SECURITY.md](SECURITY.md).
