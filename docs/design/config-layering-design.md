# Configuration layering design

Design note for the shared configuration base layer across the three shipped adapters (MCP
server, OpenCode plugin, Pi extension). It records the parameter taxonomy, the precedence
model, and the per-adapter composition so the design survives between conversations. Host
capability facts live in [control-matrix.md](../research/control-matrix.md); the config
surface inventory was verified against the code on 2026-10-23.

## Problem

The state this design replaced — recorded here as history, not as the present. The option
pipeline was already single-sourced (names, defaults, clamping in
`src/core/constants.ts` → `src/core/env.ts` → `src/core/options.ts`), but the *channels*
that fed it were fragmented per host, and a multi-host user configured the same intent in
up to three ways:

- **Pi** — extension runs in-process; `DEEPSEEK_*` shell variables just worked.
- **Codex** — stdio children do not inherit the parent environment, and the installer's
  `env_vars` entry forwarded **only** `DEEPSEEK_API_KEY`; every other knob set in the
  shell never reached the server unless the user hand-edited `config.toml` to add each
  variable name. (The entry now forwards every `DEEPSEEK_*` name — see the Codex
  consequence in [ADR-0002](../adr/0002-shared-config-base-layer.md).)
- **OpenCode** — the plugin resolved **only** `ctx.options` (opencode.json plugin
  options, camelCase); `DEEPSEEK_*` variables configured nothing there, so the same
  knob had a second, differently-named vocabulary. (The plugin now composes
  file < environment < `ctx.options` — see the per-adapter composition below.)

One intent ("20 results, block pinterest.com"), three configuration acts, two
vocabularies, one silent-failure trap. The isolation was accidental, not chosen.

## Parameter taxonomy

Isolation versus unification is decided per class, not globally:

| Class | Parameters | Policy |
| --- | --- | --- |
| **API behavior** — describes the user↔DeepSeek relationship, host-independent | `count`, `maxResults`, `minRerank`, `minAuthority`, `allowUnknownAuthority`, `blockedDomains`, `includeDomains`, `language`, `searchLocalization`, `maxRetries`, `retryBaseDelayMs` | Shared base; identical everywhere unless a host layer overrides |
| **Host-sensitive** — interacts with host output caps / deadlines (OpenCode 2,000 lines / 50 KiB; Pi MCP 20 KB + 60 s; Pi extension uncapped; Claude Code 25k tokens) | `searchTimeoutMs`, `fetchTimeoutMs`, `fetchMaxChars`, `maxSummaryChars` | Shared base gives the safe default; **per-host override in the host-native layer is the recommended place** to raise them |
| **Host integration** — describes the host's tool landscape, not the API | `searchEnabled`, `fetchEnabled`, `setDefaultWebsearch`, `fetchOverrideWebfetch`, `fetchRegisterTool`, `apiKeySource` | **Deliberately isolated.** Installer-written, host-native config only; the shared file rejects them |

Security-shaped knobs (`fetchAllowedDomains`, `fetchBlockedDomains`, `fetchBlockPrivateHosts`)
are classed as API behavior: they are deployment policy about the DeepSeek call itself, and a
shared base strengthens rather than weakens them (one policy instead of three drifting ones).

## The layering model

Precedence, low → high, identical semantics in every adapter:

```text
built-in defaults  <  shared config file  <  DEEPSEEK_* environment  <  host-native config
```

- **Host-native config** means: OpenCode `ctx.options` (opencode.json plugin entry), Pi's
  `deepseekWebRetrieval` settings namespace (the two switches), and — for MCP hosts — the
  per-server `env` block in the host's MCP registration (that block is *how* an environment
  variable arrives, not a fifth layer).
- Host-native layers keep outranking the base: installer-written intent (capability tiers)
  and explicit per-host overrides always win, so the blast radius of a bad shared value is
  bounded by whatever the host layer pins.
- The two vocabularies stay as they are — `DEEPSEEK_*` snake-case names for the environment,
  camelCase `PluginOptions` keys for the file and OpenCode options — both generated from the
  same single source and documented side by side.

## The shared config file

- **Path:** `$XDG_CONFIG_HOME/deepseek-web-retrieval/config.json`, defaulting to
  `~/.config/deepseek-web-retrieval/config.json`. On win32 an explicit, non-empty
  `XDG_CONFIG_HOME` still wins; otherwise the conventional Roaming root applies —
  `%APPDATA%\deepseek-web-retrieval\config.json`, falling back to
  `<home>\AppData\Roaming\deepseek-web-retrieval\config.json` when `%APPDATA%` is
  unset. User scope, one file. A project-scope file
  is a confirmed non-goal for this iteration (open question below).
- **Format:** JSON object; keys are the camelCase `PluginOptions` vocabulary (class 1 and 2
  only). Example:

  ```json
  {
    "count": 20,
    "blockedDomains": ["pinterest.com"],
    "language": "zh",
    "searchLocalization": "203.0.113.7"
  }
  ```

- **Validation:** the file's parsed object feeds the existing `resolvePluginOptions` —
  clamps, IP validation, and domain normalization all come along for free. Unknown keys and
  class-3 (host-integration) keys are **rejected with a one-line stderr warning** and
  otherwise ignored; a missing or unparseable file contributes nothing (a warning line for
  the unparseable case), mirroring the Pi settings reader's conventions.
- **The API key is deliberately absent.** Auth keeps its existing channels
  (`DEEPSEEK_API_KEY`, OpenCode's auth store, Pi's env) — a config file is liable to end up
  synced through dotfiles, and widening key storage is a security-surface decision this
  design does not make.

## Per-adapter composition

- **MCP server** (`src/mcp/serve.ts`): `resolveEnvOptions(env)` becomes
  `resolveEnvOptions(env, readFileOptions())` — file keys under environment keys. The server
  reads the file itself, so **the Codex `env_vars` trap disappears** regardless of what the
  host forwards.
- **Pi extension** (`src/pi/extension.ts`): `resolveExtensionOptions` inserts the file
  between defaults and the environment; the settings namespace stays on top, unchanged.
- **OpenCode plugin** (`src/opencode/plugin.ts`): `resolvePluginOptions(ctx.options)` becomes
  `resolvePluginOptions({ ...fileOptions(), ...pluginOptionsFromEnv(process.env), ...ctx.options })`
  — file, then environment, then the host layer. Additive only: existing opencode.json
  options keep winning exactly as before; the change is that the file and environment now
  work on this host too.

## Installer changes

- **Codex `env_vars`:** enumerate **every** `DEEPSEEK_*` name (generated from
  `src/core/constants.ts`, the single source) instead of only `DEEPSEEK_API_KEY`, so
  environment overrides work on Codex without hand-editing `config.toml`. The note the
  installer prints is updated to match.
- No other host artifacts change: the installer never writes the shared file (it is a user
  authoring surface, like a shell profile), and capability tiers stay where they are.

## Visibility

A bad shared value now fails everywhere at once, so effective configuration must be visible:

- The MCP server's startup stderr line (already printing the client identity and enabled
  tools) additionally prints **deviations from defaults only** — e.g.
  `config: count=20 blockedDomains=1 language=zh` — keeping the line short while showing
  every non-default knob a multi-layer resolution produced.
- The OpenCode plugin and Pi extension print the same deviation summary once, at
  registration time, through their host's logging channel (implementer picks the least
  noisy channel per host; the content contract is "non-default effective values").
- `deepseek-web-retrieval config` is the user-facing arm: it prints every knob with its
  value and source, replays the file's warnings where a human actually looks, and its
  `--search` variant verifies the whole chain (key, config, network) with one billed
  request.

## What this design does not change

- `need_content` is no longer hardcoded `false` — it became a per-call tool parameter
  with a deployment-owned envelope
  ([search-content-design.md](search-content-design.md),
  [ADR-0003](../adr/0003-need-content-per-call-boolean.md)).
- `ori_question` remains per-call-only — supplied through the tool input named
  `original_question` (with the Pi session fallback) and sent to the API as `ori_question`;
  it is not configurable.
- Auth surfaces, capability tiers, and the installer's plan/confirm flow.

## Testing

- Unit: file reader (missing / unparseable / unknown-key / class-3-key rejection with
  warning), precedence matrix per adapter (defaults < file < env < host) asserted through
  each adapter's existing resolution entry points.
- The installer's Codex plan snapshot gains the full `env_vars` list.
- Existing suites stay green; e2e scenarios unaffected (the file is absent in CI, which is
  itself the empty-layer case).

## Rollout

Additive and non-breaking: no existing configuration loses effect, no precedence between
existing layers changes. Documentation updates ship with the code: README gains a
"Configuration" section with the precedence table and the two-vocabulary table; the host
guides' option tables gain a shared-file column; the control-matrix note's Pi sentence
("There is no per-extension options channel: the runtime config surface is the
`DEEPSEEK_*` environment") is updated to name the file as part of that surface. All of
these updates are shipped and in place.

**Amendment, 2026-10-23** — two changes approved after this design was confirmed alter
the effective behavior of *untouched* configurations, superseding the "no existing
configuration loses effect" sentence for those two knobs:

1. `maxResults` now follows the effective `count` when unset, so `count`-only
   configurations return `count` results instead of silently truncating to the old
   default of 10 (the one-directional asymmetry is documented at the resolution site in
   `src/core/options.ts`).
2. Transient failures (408/425/429/5xx) retry twice by default instead of zero
   (rationale and the dated vendor-survey correction live in
   `docs/research/search-api-defaults.md`).

## Decisions (confirmed 2026-10-23)

1. **Project-scope file:** not in this iteration — hosts already own project-scope
   semantics, and the extra precedence row is not yet earned by demand.
2. **Invalid-key warnings:** one stderr line per bad key at first resolution — the noise
   buys typo detection (`"retries"` vs `"maxRetries"`) in a hand-edited file.
3. **File naming:** `config.json` inside the `~/.config/deepseek-web-retrieval/`
   directory (win32: `%APPDATA%\deepseek-web-retrieval\`) — room for future siblings.
4. **ADR:** the layering decision is recorded as
   [ADR 0002](../adr/0002-shared-config-base-layer.md) alongside this design note.
