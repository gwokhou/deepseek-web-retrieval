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

The body budget counts Unicode code points, not UTF-8 bytes. A shortened body adds
an ellipsis **outside** that budget. Final text also includes metadata and three spaces
per body line for Markdown indentation; missing bodies use `maxSummaryChars` instead.
Measure `Buffer.byteLength(formattedText, "utf8")` for the actual output envelope,
not just budget × count. The core does not narrow any parameter's range at runtime
(see Decisions).

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

### Keyless output-budget regression coverage

`test/fixtures/search-content.mjs` supplies the same 13 synthetic cases to the
formatting tests, both adapter suites, and `test/e2e/pi-mock.ts`. Run:

```sh
bun test test/core/format.test.ts test/pi/extension.test.ts test/mcp/server.test.ts
bun run test:e2e pi-mock
```

The second command uses the existing Docker runner and the Pi version pinned in
`docs/hosts.jsonc` (1.3.0 for this baseline). Both retrieval and the scripted model
use the local mock and placeholder keys. It runs each fixture through the native
extension and the direct MCP path, checks `need_content` and the effective count
on the wire, and measures the complete tool message received by the mock model.
No real DeepSeek key, upstream crawl, or paid model is involved.

Each `content-budget:` JSON line records formatted text bytes, structured-mirror
JSON bytes separately, actual model-message bytes, truncation, complete result-block
indices, and visible/missing URL indices. A complete block includes its heading,
body/digest and metadata; a visible URL alone does not establish completeness.
For truncated MCP output the mock also reads Pi's saved full-output file inside the
same container and compares its byte count and SHA-256 to the complete expected text.

The threshold fixtures render to exactly 20,479, 20,480 and 20,481 bytes, using
ASCII title padding to vary one byte at a time while keeping ten CJK bodies.
Pi's MCP threshold is **20 × 1024 = 20,480 bytes**, applied to text before adding
the truncation warning, marker and saved-file reference. Those additions mean the
final model message can exceed 20,480 bytes; it is not a hard final-message cap.
The tests assert exact unmodified text at/below the threshold, a cut above it,
and preservation on the native path. The 50-result case exercises the supported
per-call maximum without silently reducing count.

Measured against v0.10.0 with Pi 1.3.0 (all byte counts are UTF-8; complete blocks
refer to the configured excerpts, not full upstream pages):

| Fixture | Formatted text bytes | Native complete blocks | MCP complete blocks | MCP text truncated |
| --- | ---: | ---: | ---: | --- |
| Latin body, default count 10 | 16,269 | 10/10 | 10/10 | no |
| CJK body, default count 10 | 46,069 | 10/10 | 4/10 | yes |
| CJK body, per-call count 50 | 230,389 | 50/50 | 4/50 | yes |
| CJK/ASCII/emoji, 1,501 source code points | 37,159 | 10/10 | 4/10 | yes |
| Missing/null/empty/blank bodies, body budget 500 | 25,759 | 10/10 | 6/10 | yes |
| Same fallback fixture, summary budget also 500 | 13,159 | 10/10 | 10/10 | no |
| CJK, per-call count 4 | 18,426 | 4/4 | 4/4 | no |
| CJK, body budget 500, count 10 | 16,139 | 10/10 | 10/10 | no |
| CJK multiline, default count 10 | 53,519 | 10/10 | 2/10 | yes |
| CJK, body budget 500, long titles | 46,139 | 10/10 | 4/10 | yes |
| Threshold minus one byte | 20,479 | 10/10 | 10/10 | no |
| Exact threshold | 20,480 | 10/10 | 10/10 | no |
| Threshold plus one byte | 20,481 | 10/10 | 9/10 | yes |

For the default CJK fixture, MCP preserves complete blocks 1, 2, 9 and 10, with
URLs 4–8 missing from the direct model message; the saved full-output file retains
all ten blocks. At threshold + 1 all ten URLs survive but block 5 is incomplete.
In this run truncated model messages occupied 20,657–20,665 bytes including Pi's
notice and file reference; that final size depends on the generated file path.
No malformed Unicode was observed. These are measured host truncation effects on
constructed inputs, not evidence of upstream retrieval loss. Reading the saved file
or reducing a full result through codemode is a separate step, not exercised here.

For deployment tuning, use the native extension when full inline search results
are needed in Pi. On the direct MCP path, a lower `count` or body budget can reduce
truncation, but `searchContentMaxChars` alone does not bound fallback digests,
metadata, or Markdown indentation. Measure representative formatted outputs and
leave headroom; tune `maxSummaryChars` as well when missing-body fallback is common.
Per-call `count` overrides the configured count and result cap, so a smaller
deployment default is not a guaranteed response-wide limit. These tests establish
boundary behavior, not a production size distribution or a universal safe setting;
the shipped defaults remain unchanged.

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
6. The descriptions state facts — mechanics, latency, price, magnitude, the fetch
   alternative — and no usage policy. When content is worth it is the model's per-call
   judgment (or a user's rules file per deployment), not the tool author's; if usage
   data later shows the parameter systematically ignored or overused, that is the point
   to add minimal steering, decided by evidence.
