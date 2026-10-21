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
- **Off** — the capability's tool is not registered at all. When the other capability
  stays on, the MCP entry still lands and carries that capability's server-side
  false-only switch (`DEEPSEEK_ENABLE_SEARCH` / `DEEPSEEK_ENABLE_FETCH`); both off
  refuses to install anything.
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
   enterprise team settings) that would outrank what the
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
  per-host keys cover them), or routing is not actually forced. Concretely: Pi's
  per-server `enabled` key lets the plan disable detected web-capable competitors
  (each prior value snapshotted for uninstall); Codex has no per-server kill switch,
  so a detected web-capable competitor makes the plan refuse the tier instead of
  promising non-exclusive routing; OpenCode's forced is replacement, which no
  third-party server overrides. Detection classifies a server web-capable from its
  name plus its command/args/url — a heuristic the plan notes never hide. Forced also
  overrides
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
host's scope pairs (Pi's agent dir versus `.pi/`,
Cursor's `cli-config.json` versus `.cursor/cli.json`, Claude Code's
settings hierarchy, OpenCode's global versus project config) under three rules:

- **Honor or report, never silently downgrade.** Some keys exist at only one scope:
  Devin's `disabled_tools` is user-level only (project config allows just
  `permissions`, `read_config_from`, and `hooks`); Cline's
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
entries and vice versa, and a list mode shows what is installed where. The invariant is
guarded, not just assumed: two records for one host never claim the same file. When a
scope choice would overlap the other scope's record — Codex's project-scope fallback
onto `~/.codex/config.toml` beside a global install — the plan refuses with guidance,
and uninstall runs the same check defensively before touching anything.

Shared config files also carry an owner-only sidecar beside the actual file
(`.config.toml.deepseek-web-retrieval.codex.owner.json` for Codex). It points to the
owning install record and project directory, so two different project directories
cannot both claim the same global config, even with different `XDG_CONFIG_HOME`
values. Planning reports this metadata write; apply acquires the claim before
writing config and rechecks ownership, and uninstall releases it. A failed first
apply releases its new claim; a failed re-init retains the previous owner's claim.
Project-local configs and shared rules blocks do not need these sidecars.

For installs created before this ownership metadata existed, re-run init from the
original project and scope to establish the claim. An installer-style registration
without a record at the requested location is refused rather than adopted as a new
snapshot. If an identical registration was created manually, remove it before init.
Do not delete an ownership sidecar while its install is still active.

## Rollback

Uninstall reverses exactly what the plan applied: overwritten values restore their
snapshots, merged arrays remove only the entries the installer appended, appended rules
content is removed, and files the installer created are deleted — nothing more, nothing
less. The [OpenCode v2 guide](../agents/opencode-v2.md) documents the failure mode this
avoids: `plugin remove` deletes the plugin entry but leaves `websearch.provider`
pointing at the removed plugin, and the user must clean up by hand.

## Tier-to-artifact mapping

Pi has two integration paths (`--path extension` by default, `--path mcp` as the fallback);
the artifacts below name the path where they differ.

| Choice | Artifacts |
| --- | --- |
| Optional | Host config registering the integration: Pi's extension path appends an `npm:<package>` source to `packages` in settings.json; the MCP paths register the server (Pi's MCP entry needs `"exposure": "direct"`; the extension path needs nothing — extension tools are `direct` by Pi's own default) |
| Preferred | The above plus a rules file for the host (file names per host in the [per-host reference](../research/control-matrix.md#per-host-reference)); the rules name the path's tool ids (`deepseek_web_search` for the extension, `mcp__deepseek__deepseek_web_search` for MCP) |
| Forced (replacement) | OpenCode plugin options (`setDefaultWebsearch` / `fetchOverrideWebfetch`) |
| Forced (exclusion) | The built-in competitor's kill switch (per-host keys in the per-host reference), plus the exclusion of any other web-capable MCP servers the detect phase found — Pi sets their `enabled` key to `false`; Codex, lacking a per-server kill switch, refuses the tier instead; Pi's extension path additionally refuses when a web-capable `packages`/`extensions` source is listed in settings.json (no per-package kill switch exists) |
| Forced (de-facto) | Nothing beyond the Optional artifacts — no competitor exists |
| Off | Codex writes the capability's raw tool name into the server entry's `disabled_tools` (host-native: the tool leaves the model's context; the user's own entries in that array are kept); the other MCP entry writes the capability's false-only server-side switch instead (`DEEPSEEK_ENABLE_SEARCH` / `DEEPSEEK_ENABLE_FETCH`); Pi's extension path writes the same switches into the `deepseekWebRetrieval` settings namespace the extension reads at load; both capabilities off refuses to install |

OpenCode additionally appends `permissions` allow entries for exactly the tools it
registers (`websearch`, `deepseek_fetch`, and `webfetch` when fetch is forced), merged
into any existing `permissions` array rather than replacing it.

## Non-negotiables

- **Cost warning on the Forced tier.** Search and Fetch are billed per successful
  request; deterministic routing removes both the model's discretion and its restraint as
  a cost brake. Every forced-tier plan carries a note naming the README's "Privacy and
  cost" section.
- **Rules content.** Name the full tool ids the host will see (`mcp__deepseek__deepseek_web_search`
  over MCP, `deepseek_web_search` over Pi's extension), state trigger conditions rather than
  unconditional preference, and list exclusions (localhost/private-network URLs go to local
  fetch tools; the server blocks them by default). Emit routing guidance only for the
  capability selected as preferred; an optional capability stays optional even when the
  other capability is preferred. Missing, reversed, or duplicate block markers refuse
  planning, apply, and uninstall without deleting the ambiguous surrounding text.

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
  the installer's own output as the "previous" value. Pi forced re-inits keep their
  competitor-disable ops even when those servers are already disabled, so orphan
  reverts cannot re-enable a still-excluded competitor.
- Verify is file-level: after apply it re-reads each written file and asserts every op
  holds (set values in place, appended entries present, rules block present). Higher
  layers would be a plan-time detect concern, and none of the three shipped hosts
  documents a layer above user config, so there is nothing to check there yet.
- Only a bare `--apply` enables writes; assigning a value such as `--apply=false`
  is a usage error and writes nothing.
- File verification precedes the install-record commit. A write or verification
  failure restores the pre-apply files and record and checks the restored values.
  `ApplyError.status` is `rolled_back` only after recovery and new-claim cleanup
  succeed. Otherwise it is `recovery_required`, with the original cause and a
  recovery report; new claims remain while file or record recovery is incomplete.
  Obsolete claims are released after commit. If that cleanup fails, the verified
  install and new record are retained and reported explicitly for recovery.

## Server-side gap (resolved)

The MCP server now honors `DEEPSEEK_ENABLE_SEARCH` / `DEEPSEEK_ENABLE_FETCH`
(false-only switches through the shared option pipeline) and refuses to start when both
are disabled; the OpenCode plugin honors the matching `searchEnabled` / `fetchEnabled`
options. Per-capability control is uniform across hosts, including those without
host-side tool filtering.

## Hosts without an installer story

Claude Code, Cursor, Devin, GitHub Copilot, and Cline still have no
host module; their artifacts (from the tier-to-artifact mapping) remain hand-edited
config until a module lands here. OpenCode's `opencode plugin add` remains available but
cannot pass options or manage snapshots; `init` supersedes it for tiered installs.


### Persistence and concurrent operations

Install records distinguish absent files from invalid or unreadable files. The
reader validates version, host/scope identity, tiers, file metadata, and recorded
operations before an install or uninstall can use undo state. `list` reports a
bad record instead of silently omitting it. Restore the record from backup or
repair access before retrying; deleting it can discard the original snapshots.

Config and record writes use private temporary files in the target directory,
verify the temporary contents, flush the file, then rename and flush the directory
(on POSIX). Existing config permissions and valid symbolic links are preserved;
records are always mode 0600. A failed write before rename leaves the old file
intact. This makes each file replacement atomic, not the entire multi-file install.
The apply rollback remains responsible for caught errors; power-loss recovery is
not an automatic transaction replay.

Apply and uninstall acquire a record operation lock before reading undo state,
then locks for every config/rules path they may mutate, including orphan reverts.
Locks follow canonical paths, so another project or symlink alias cannot bypass a
shared-file lock. A plan whose prior record changed is refused, even if its only
edits append arrays. Preview generation is read-only and does not reserve locks.

Operation locks are directories ending in `.deepseek-web-retrieval.lock`, with
owner PID and start time inside. Ordinary success or failure releases them. A
killed process may leave a lock: after confirming no installer is running, inspect
config, install record, and persistent ownership claims, restore any inconsistent
state, then remove the reported lock directory and generate a new plan. Locks are
never stolen based only on age or PID. Persistent `.owner.json` claims remain a
separate safeguard against two installations owning one shared config.
