# Expose need_content as the agent's per-call boolean

Status: Accepted — shipped in 0.10.0 (see [CHANGELOG](../../CHANGELOG.md)).

DeepSeek's Search API accepts a `need_content` boolean — return each result's page body —
that this repo had hardcoded `false` since the first release: the wire field arrived, the
pipeline dropped it, and no search result ever carried a page body
([search-inline-content.md](../research/search-inline-content.md)). The same research
pinned why the value cannot travel alone: DeepSeek documents no size bound for the
returned content, host output caps run as tight as Pi's 20 KB MCP-path truncation, and
the 30 s default search timeout does not budget for a server-side page crawl. We decided
that the boolean itself becomes a per-call tool parameter on the model-facing surfaces
(the MCP server and the Pi extension), defaulting to `false`, while the deployment owns
two envelope-only knobs that apply whenever content flows: `searchContentMaxChars` (the
per-result body budget, default 1,500) and `searchContentTimeoutMs` (the timeout a
content call runs on, default 60 s). Neither knob is ever a tool parameter — the model
cannot see which host caps its output, so it cannot own a budget.

## Considered Options

- **A tristate `searchContent: off | on | auto` config mode** gating whether the
  parameter is exposed. The wire value is a boolean; `auto` is invented vocabulary, and
  no per-call parameter in this repo (`count`, fetch `maxChars`) is mode-gated. The
  `on` state's only real beneficiary is OpenCode, whose `websearch` provider input the
  host fixes to `query` — the same upstream gap that already blocks per-call `count`
  ([opencode-v2.md](../agents/opencode-v2.md)).
- **Default-on inline content** (Jina's architecture). DeepSeek documents no size bound
  for `content`; a default `count=10` response at typical page sizes runs 30–110 KB
  against host caps that truncate near 20 KB, and per-request billing makes the call
  free, not the context bloat.
- **The previous status quo** (hardcoded `false`). An agent that needs page bodies must
  guess from summaries which URLs to fetch; a wrong guess is a silent miss.

## Consequences

The model decides per call whether a search carries page bodies — one round-trip
replaces search-plus-fetch when recall matters, and summaries stay the default when
they suffice. A page body replaces its result's digest, clamped to
`searchContentMaxChars` with an ellipsis marker, so a response's content volume is
bounded by budget × count and can never blow a host cap by an undocumented server-side
size. The text channel renders bodies as indented Markdown that keeps heading and list
structure; digests stay one-line. `searchContentMaxChars: 0` drops bodies entirely (the
digest renders) — a deployment kill switch that still pays the slower call, so leaving
the parameter false is the better tool for the model. A result whose content comes back
empty — the API documents per-result absence — falls back to its summary, so a content
call degrades to today's output rather than to nothing. OpenCode stays summary-only
until its provider input widens upstream. Design detail (budget arithmetic, rendering,
per-adapter composition) lives in the
[search content design note](../design/search-content-design.md).
