# Share one config base layer across hosts

Status: Accepted — shipped in 0.7.0 (see [CHANGELOG](../../CHANGELOG.md)).

The option pipeline was single-sourced — names, defaults, and clamping resolved through
one chain (`src/core/constants.ts` → `src/core/env.ts` → `src/core/options.ts`) — but the
channels feeding it were per
host: `DEEPSEEK_*` shell variables on Pi, only `ctx.options` on OpenCode, and
on Codex only the names the installer's `env_vars` entry forwards — just
`DEEPSEEK_API_KEY`, so every other knob set in the shell silently never
reached the server. One intent ("20 results, block pinterest.com") took up to
three configuration acts in two vocabularies. We decided that a shared config
file becomes the base layer under every existing channel, with the precedence
`built-in defaults < shared config file < DEEPSEEK_* environment < host-native
config`, a three-class parameter taxonomy that isolates host integration in
the host-native layer and rejects it from the file, and no API key in the
file — auth keeps its existing channels.

## Considered Options

- **Unify on the file alone** (retire the environment and host-option
  vocabularies so there is one configuration act). But host integration —
  `searchEnabled`/`fetchEnabled`, `setDefaultWebsearch`,
  `fetchOverrideWebfetch`, `fetchRegisterTool`, `apiKeySource` — describes the
  host's tool landscape, not the user↔DeepSeek relationship, so the host layer
  must keep owning it, and retiring `DEEPSEEK_*` would break every existing
  shell profile.
- **Keep the per-host channels as the only surface** (previous status quo).
  The Codex `env_vars` trap stays — knobs set in the shell reach the server
  only by hand-editing `config.toml` — and the same knob keeps two
  vocabularies across hosts.

## Consequences

One file — `$XDG_CONFIG_HOME/deepseek-web-retrieval/config.json`, default
`~/.config/deepseek-web-retrieval/config.json`, camelCase keys — configures
every host, and host layers keep winning: installer-written intent and
explicit per-host overrides always outrank the base, bounding the blast
radius of a bad shared value. Unknown keys and host-integration keys in the
file draw a one-line stderr warning and are otherwise ignored. Because a bad
shared value now fails everywhere at once, every adapter prints a
deviations-from-defaults summary of its effective configuration.

The installer's Codex `env_vars` entry forwards every `DEEPSEEK_*` name, so
environment overrides work on Codex without hand-editing `config.toml`.
Design detail (per-adapter composition, validation, visibility, rollout)
lives in the [layering design note](../design/config-layering-design.md).
