# Installer design

Design note for the install-time flow, shipped as the `deepseek-web-retrieval init`,
`uninstall`, and `list` subcommands for **OpenCode, Pi, and Codex**. It records how the
[control tiers](../research/control-matrix.md) map to the artifacts the installer emits, so
the design survives between conversations. Research backing lives in
[control-matrix.md](../research/control-matrix.md); host facts in [hosts.jsonc](../hosts.jsonc).
Remaining hosts get host modules here as their guides ship.

## Principles

- **Never overwrite user configuration without the user's knowledge.** Every write is
  shown as a plan — old value → new value, per file — and confirmed before it is
  applied. Single-value keys are snapshotted so rollback can restore what was there.
- **Post-install behavior and impact scope must be controllable and knowable.** The
  installer reports what changes, which existing tools, rules, and MCP servers the
  choice affects, what stops working, and how to undo it. If a choice cannot fully take
  effect — a higher configuration layer outranks it — that is reported, never silently
  dropped.

## Goal

At install time the user makes two decisions: per capability (search and fetch
independently), how strongly the tools are routed — and separately, the effective scope
of the whole install.

- **Optional** — registered, the model picks freely.
- **Preferred** — registered plus rules steering the model toward them.
- **Forced** — deterministic routing (replacement, exclusion, or de-facto).
- **Scope** — project-level (this checkout, shareable via VCS) or global (every project
  for that host on the machine).

## Stock configuration

The tier definitions assume a clean host. Real installs land on configuration that
already exists, and the installer runs three phases before anything is written:

1. **Detect.** Read the host config, the rules files, and the registered MCP servers.
   Report the conflict surface: existing rules steering toward another web tool; other
   web-capable MCP servers already on the field; array-valued keys the plan must merge
   into rather than replace (`disabledTools`, `permissions.deny`, permissions
   `exclude`, `disabled_tools`); and higher layers (Claude Code managed policy, Devin
   enterprise team settings, Gemini's system settings file) that would outrank what the
   installer writes.
2. **Merge or snapshot.** Array keys merge with existing entries, recording exactly
   which entries the installer appended; single-value keys (`websearch.provider`, Pi's
   `exposure`) snapshot the prior value before overwriting; files the installer creates
   are tracked as created. Nothing is written until the user approves the full plan.
3. **Verify.** After applying, confirm the chosen tier actually holds: the deny rules
   take effect, no higher layer overrides them, and the model sees exactly the intended
   tools.

## Tier semantics against stock configuration

- **Optional is inherently stock-safe**: purely additive — it appends new entries
  without altering existing keys or values, and removes nothing. It is the safe default.
- **Preferred** can conflict without any config being touched: existing rules pointing
  at another web tool produce contradictory instructions whose outcome depends on each
  host's load order (Claude Code concatenates every level; Devin ranks team above
  project above user); competing MCP servers stay on the field; and approval-friction
  asymmetry (for example Cursor's `autoAcceptWebSearch` making the built-in search
  zero-friction) can outweigh prompt-level steering. The installer surfaces these
  conditions; it does not resolve them.
- **Forced is conditional**: the exclusion kill switches remove the built-in
  competitor, not third-party web MCP servers — those must be excluded too (the
  per-host keys cover them), or routing is not actually forced. Forced also overrides
  explicit user choices (OpenCode's `websearch.provider`), and its deny rules affect
  workflows beyond this project (a Claude Code deny cannot be carved out by allow
  rules), so the plan must state the blast radius before the user approves it.
- **Forced is not universally available**: where hosts.jsonc records `forced: "none"`
  (Cursor's search today), the wizard does not offer the tier — the tier-level analogue
  of the scope rule: honor or report, never offer what cannot be delivered. Some kill
  switches are session-scoped (Copilot fetch's `--deny-tool`/`--excluded-tools` flags);
  an installer cannot persist them, so the plan reports that the exclusion evaporates on
  restart and offers what persistence exists.

## Scope

The effective scope is a first-class install-time choice, decided by the user alongside
the tiers — not inferred from the artifacts. The installer maps the choice onto the
host's scope pairs (Pi's agent dir versus `.pi/`, Gemini's `~/.gemini` versus
`.gemini/`, Cursor's `cli-config.json` versus `.cursor/cli.json`, Claude Code's
settings hierarchy, OpenCode's global versus project config) under three rules:

- **Honor or report, never silently downgrade.** Some keys exist at only one scope:
  Devin's `disabled_tools` is user-level only (project config allows just
  `permissions`, `read_config_from`, and `hooks`); Continue's MCP registration is
  documented only at `~/.continue/config.yaml` (user) at 1.5.47; Cline's
  `global-settings.json` and MCP settings file are user-scope at 0.0.13. When the
  chosen scope cannot be honored for an artifact, the plan says so and offers the
  alternative — the global fallback for a kill switch, or a different tier that works
  at project scope — instead of quietly writing to the other scope.
- **Blast radius is part of the plan.** Global scope changes every project the user
  opens with that host; project scope is confined to one checkout but is often
  committed, which shares the config and rules with the whole team — including the
  `${DEEPSEEK_API_KEY}` expansion that relies on each member's environment. The impact
  report states which applies.
- **Layers above the user still outrank the choice.** Managed, enterprise, and system
  layers override anything the installer writes at either scope; the detect phase
  reports them instead of failing silently.

Uninstall is scope-aware: removing a project-scope install never touches user-scope
entries and vice versa, and a list mode shows what is installed where.

## Rollback

Uninstall reverses exactly what the plan applied: overwritten values restore their
snapshots, merged arrays remove only the entries the installer appended, appended rules
content is removed, and files the installer created are deleted — nothing more, nothing
less. The [OpenCode v2 guide](../agents/opencode-v2.md) documents the failure mode this
avoids: `plugin remove` deletes the plugin entry but leaves `websearch.provider`
pointing at the removed plugin, and the user must clean up by hand.

## Tier-to-artifact mapping

| Choice | Artifacts |
| --- | --- |
| Optional | Host config registering the server, plus host-side per-tool filtering where supported (Copilot `tools` whitelist, Gemini `includeTools`, Codex `enabled_tools`); Pi needs `"exposure": "direct"` |
| Preferred | The above plus a rules file for the host (file names per host in the [per-host reference](../research/control-matrix.md#per-host-reference)) |
| Forced (replacement) | OpenCode plugin options (`setDefaultWebsearch` / `fetchOverrideWebfetch`) |
| Forced (exclusion) | The built-in competitor's kill switch (per-host keys in the per-host reference), plus the exclusion of any other web-capable MCP servers the detect phase found |
| Forced (de-facto) | Nothing beyond the Optional artifacts — no competitor exists |

## Non-negotiables

- **Cost warning on the Forced tier.** Search and Fetch are billed per successful
  request; deterministic routing removes both the model's discretion and its restraint as
  a cost brake. The README's privacy-and-cost section should be surfaced in the wizard's
  Forced-tier copy.
- **Rules content.** Name the full tool ids (`mcp__deepseek__deepseek_web_search`), state
  trigger conditions rather than unconditional preference, and list exclusions
  (localhost/private-network URLs go to local fetch tools; the server blocks them by
  default).

## Implementation notes

- JSON edits go through `jsonc-parser` (the library behind VS Code's JSON support), so
  comments and formatting in `opencode.jsonc` and Pi's `mcp.json` survive apply and
  uninstall; TOML edits go through `smol-toml` and drop comments, which the plan reports
  as a note. The hand-written JSONC stripper that predated this lived in `scripts/jsonc.ts`.
- Install state lives per host and scope (global under
  `~/.config/deepseek-web-retrieval/`, project under `.deepseek-web-retrieval/`); it
  records snapshots, appended entries, created files, and created path prefixes — never
  full file contents, so other servers' secrets stay out of the state file.
- Re-applying over a previous init inherits the original snapshots instead of recording
  the installer's own output as the "previous" value.

## Server-side gap (resolved)

The MCP server now honors `DEEPSEEK_ENABLE_SEARCH` / `DEEPSEEK_ENABLE_FETCH`
(false-only switches through the shared option pipeline) and refuses to start when both
are disabled; the OpenCode plugin honors the matching `searchEnabled` / `fetchEnabled`
options. Per-capability control is uniform across hosts, including those without
host-side tool filtering.

## Hosts without an installer story

Claude Code, Cursor, Devin, GitHub Copilot, Cline, Continue, and Gemini still have no
host module; their artifacts (from the tier-to-artifact mapping) remain hand-edited
config until a module lands here. OpenCode's `opencode plugin add` remains available but
cannot pass options or manage snapshots; `init` supersedes it for tiered installs.
