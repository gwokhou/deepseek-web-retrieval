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

## Architecture

- `src/core/` is agent-agnostic: HTTP clients, options, URL/domain policy,
  filtering, formatting, and errors.
- `src/opencode/` is the OpenCode v2 adapter: plugin setup, credential
  resolution, provider registration, and tools.
- Future agents should add a thin adapter under `src/<agent>/` and reuse
  `src/core/` rather than duplicating retrieval logic. The cross-host MCP
  server lives in `src/mcp/`.
- Adapter-specific setup and usage docs live in `docs/<agent>.md`; keep the
  root README focused on the shared project and adapter overview.
- Keep the host support matrix in `docs/integration.md` current when a host's
  extension points or checked version change.

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
