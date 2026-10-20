# Installer design

Design note for a future install-time flow (for example a
`deepseek-web-retrieval init` wizard). It is not shipped; it records how the
[control tiers](../research/control-matrix.md) map to the artifacts an installer would emit, so the
design survives between conversations. Research backing lives in
[control-matrix.md](../research/control-matrix.md); host facts in [hosts.jsonc](../hosts.jsonc).

## Goal

At install time the user chooses, per capability (search and fetch independently), how
strongly the tools are routed:

- **Optional** — registered, the model picks freely.
- **Preferred** — registered plus rules steering the model toward them.
- **Forced** — deterministic routing (replacement, exclusion, or de-facto).

## Tier-to-artifact mapping

| Choice | Artifacts |
| --- | --- |
| Optional | Host config registering the server, plus host-side per-tool filtering where supported (Copilot `tools` whitelist, Gemini `includeTools`, Codex `enabled_tools`); Pi needs `"exposure": "direct"` |
| Preferred | The above plus a rules file for the host (file names per host in the [per-host reference](../research/control-matrix.md#per-host-reference)) |
| Forced (replacement) | OpenCode plugin options (`setDefaultWebsearch` / `fetchOverrideWebfetch`) |
| Forced (exclusion) | The built-in competitor's kill switch (per-host keys in the per-host reference) |
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

## Server-side gap

The MCP server registers both tools unconditionally
([src/mcp/config.ts](../../src/mcp/config.ts) has no tool-level enable flags), so
per-capability control on MCP hosts currently lives in host-side filtering only. A
`DEEPSEEK_ENABLE_SEARCH` / `DEEPSEEK_ENABLE_FETCH` env pair would make the split uniform
across hosts that lack per-tool filtering (Pi, Claude Code, Devin, Cursor, Cline,
Continue).

## Hosts without an installer story

OpenCode already has `opencode plugin add`; its object-form options cover the tiers. Every
MCP host is hand-edited config today — the wizard's main value is emitting the config
fragment, the rules file, and the kill-switch lines together, consistently.
