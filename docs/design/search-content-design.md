# Search content design

Design note for `need_content` — DeepSeek's inline-content search flag — across the two
model-facing adapters (the MCP server and the Pi extension). It records the parameter
split (who decides what), the envelope arithmetic that sets the defaults, the rendering
contract, and the per-adapter composition, so the design survives between conversations.
The facts it builds on are in [search-inline-content.md](../research/search-inline-content.md)
(baseline 2026-10-23); the decision record is
[ADR-0003](../adr/0003-need-content-per-call-boolean.md). This note was verified against
the code on 2026-10-24.

## Problem

The wire parameter is a boolean the repo hardcoded `false`: search results carried a
summary digest (`summary` falling back to `snippet`) and never a page body. An agent
needing bodies had to guess which URLs to fetch from the digests — a wrong guess is a
silent miss. Turning the flag on naively is not safe either: DeepSeek documents **no**
size bound for the returned `content`, host output caps run as tight as Pi's 20 KB
MCP-path truncation (middle truncation — whole results vanish), and the 30 s default
search timeout does not budget for the server-side page crawl the flag triggers.

## The parameter split

Two axes, two owners:

- **The agent owns the boolean.** `need_content` is a per-call, optional tool parameter
  on every surface where this package defines the search tool's inputs (the MCP server
  and the Pi extension), defaulting to `false`. It rides `SearchRequest.needContent`
  (the `oriQuestion` pattern), not the resolved options — it changes nothing in option
  state, only what that one call sends. Task type is the biggest determinant of whether
  content helps, and only the model knows the task; the repo's other per-call parameters
  (`count`, fetch `maxChars`) are the precedent: always exposed, never mode-gated.
- **The deployment owns the envelope.** Two deployment-level knobs — never tool
  parameters — apply whenever content flows: `searchContentMaxChars` (per-result body
  budget) and `searchContentTimeoutMs` (the timeout a content call runs on, replacing
  `searchTimeoutMs` for that call; the per-call `timeoutMs` cap still wins if shorter).
  The model cannot see which host caps its output, so it cannot own a budget.

## The envelope

Defaults from the host-cap arithmetic in the research note:

- `searchContentMaxChars` defaults to **1,500**. At the default `count=10`, bodies plus
  the ~1k chars of per-result metadata land near 16 KB — under the tightest published
  cap (Pi's 20 KB MCP-path truncation) for Latin-script pages. CJK-heavy responses
  measure 3 bytes per character toward that cap, so a CJK-focused deployment on a
  20 KB host should lower the budget or the count (at 1,500 chars/result, count ≈ 13 is
  the 20 KB ceiling even for Latin text). The native Pi extension bypasses the MCP
  layer entirely — neither its 20 KB truncation nor its 60 s timeout applies — so that
  deployment can afford a larger budget.
- `searchContentTimeoutMs` defaults to **60,000** — between the 30 s search default the
  digest path keeps and the 300 s ceiling Codex allows, because the API must fetch
  every result page server-side before responding and documents no latency statement.

The total a response can carry is budget × count plus metadata. That product is the
deployment's arithmetic to run when tuning either knob; the core does not narrow any
parameter's range at runtime (see Decisions).

## Per-adapter composition

- **MCP server**: `need_content` in the zod input schema, forwarded as
  `needContent: need_content === true`.
- **Pi extension**: the same parameter in the TypeBox schema (`SEARCH_PARAMETERS` stays
  a module-level constant on both surfaces — the schema is unconditional), forwarded the
  same way.
- **OpenCode**: no change. The host fixes the `websearch` provider input to `query`
  (the upstream gap that already blocks per-call `count`), so the provider stays
  summary-only; the envelope knobs resolve through the shared pipeline and are dormant
  there. Documented next to the count gap in
  [opencode-v2.md](../agents/opencode-v2.md).
- **Installer**: no artifacts change. The knob defaults are global and the deviation
  lines on every adapter already report non-default values through the config
  vocabulary.

## Processing and rendering

`processResults` is mode-agnostic: a present, non-empty `content` **replaces** the
digest (the summary is a proxy for the body it compresses), clamped to
`searchContentMaxChars` with an ellipsis marker when shortened; an empty, whitespace,
or missing body — the API documents per-result absence, and `need_content: false`
responses carry an empty string — falls back to the digest path. `searchContentMaxChars:
0` treats the body as absent. Each result carries `contentKind: "page" | "digest"` so
the renderer knows the source: page bodies render as Markdown indented into the list
item (heading and list structure survive); digests stay compacted to one line, as
summaries always were. The `structuredContent` mirror carries the same `content`
string on hosts that read it.

## What this design does not change

- Billing behavior: Search bills per successful request; `need_content` is not a price
  modifier, so a content call costs the same as a digest call (and can replace fetch
  calls at the same per-request price).
- The fetch tool, its `maxChars` parameter, and the two-tool architecture — a content
  call replaces *some* fetches, not the deep-read path.
- `maxSummaryChars`, thresholds, dedup, query composition, and degradation.
- `MAX_RESPONSE_BYTES` (5 MiB) — still the outer guard, still erroring rather than
  truncating; the per-result budget keeps responses far below it.

## Testing

Wire assertions on both model-facing adapters (`need_content: true` reaching the wire;
`false` by default), client tests for the flag and the timeout selection
(`contentTimeoutMs` used only when the call asks for content), `processResults` tests
for the body-over-digest precedence, the budget clamp and marker, the empty-body
fallback, and the zero-budget drop, and format tests for the two rendering shapes.

## Rollout

Shipped behind default-`false` behavior: with no configuration and no parameter use,
every surface behaves exactly as before (the wire still says `need_content: false`).
Deployments opt in per call by the model, per host by the two envelope knobs. No
installer or shared-file migration; the knobs join the config vocabulary and the
generated knob table.

## Decisions (confirmed 2026-10-24)

1. The boolean is a per-call tool parameter, always exposed on the MCP server and the
   Pi extension; no config mode gates it.
2. The envelope is deployment-only: `searchContentMaxChars` (1,500) and
   `searchContentTimeoutMs` (60,000), never tool parameters.
3. A page body replaces the digest; empty bodies fall back to it.
4. `need_content` does not control other parameters — neither their availability nor
   their value ranges. Effects may be conditional (the envelope knobs apply only when
   content flows); domains are static. No surveyed vendor couples a content flag to
   another parameter's range ([search-inline-content.md](../research/search-inline-content.md)),
   and a silent runtime narrowing (say, of `count`) would be a decision the model
   cannot see. The budget × count arithmetic is the deployment's to run.
5. OpenCode stays summary-only until the upstream provider input widens.
