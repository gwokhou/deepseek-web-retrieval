# Security policy

## Supported versions

This project is pre-1.0. Security fixes are applied to the latest release and
the `main` branch.

## Reporting a vulnerability

Please **do not** open a public issue for a vulnerability involving credentials,
data exposure, or URL/domain policy bypass.

Use GitHub's private vulnerability reporting / Security Advisory feature for this
repository. Include:

- Affected version or commit
- A minimal reproduction
- Impact assessment
- Any suggested fix

You should receive an initial response within a few days.

## Security model

- The native OpenCode plugin and Pi extension run inside their host processes and
  are trusted like other host extensions; the MCP adapter runs as a local stdio process
  with the permissions of the account that launches it.
- With `apiKeySource: "auto"` or `"opencode"`, the plugin reads the active
  DeepSeek credential from OpenCode's integration store. It uses the credential
  only for the `Authorization` header sent to `api.deepseek.com`.
- Pi and the MCP server read `DEEPSEEK_API_KEY` from their process environment;
  Codex forwards it through `env_vars`, and Pi's MCP fallback uses an environment reference.
- Queries and URLs are sent to DeepSeek's servers. Do not use these adapters for
  private URLs unless you accept that disclosure.
- `fetchBlockPrivateHosts` defaults to `true` and rejects localhost, private IPs,
  and common private hostnames before the URL is sent to DeepSeek.
- The adapters do not write API keys into their own metadata, logs, or files, and
  the installer writes environment references rather than literal keys.
- Install records retain the original configuration values needed for uninstall;
  keep those records and ownership sidecars private and intact for recovery.
- Error bodies are truncated and common key/token patterns are redacted before
  they reach model-visible errors.
