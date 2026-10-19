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

- The plugin runs inside the OpenCode plugin host and is trusted like other
  OpenCode plugins.
- With `apiKeySource: "auto"` or `"opencode"`, the plugin reads the active
  DeepSeek credential from OpenCode's integration store. It uses the credential
  only for the `Authorization` header sent to `api.deepseek.com`.
- Queries and URLs are sent to DeepSeek's servers. Do not use this plugin for
  private URLs unless you accept that disclosure.
- `fetchBlockPrivateHosts` defaults to `true` and rejects localhost, private IPs,
  and common private hostnames before the URL is sent to DeepSeek.
- The plugin does not write API keys into its own metadata, logs, or files.
- Error bodies are truncated and common key/token patterns are redacted before
  they reach model-visible errors.
