# Passing result quality fields to the model

This note answers one question: through which channel can DeepSeek's per-result quality fields —
`rerank_score` (0–3, "≥1.5 优质"), `authority` (0–4, -1 unknown, "≥3 极权威"), `site_name`
(string|null) — reach the **model** (not the human UI) on each host at its locked version? The
repo filters on the first two in `src/core/search.ts` (thresholds default to off); at the
research baseline it dropped all three before returning — the adapters now pass them through
as a text marker plus a structured mirror (the text marker of *What this means for this
repo*, item 1, is implemented as `formatQualityMarker`).
Related: [ori-question-sourcing.md](ori-question-sourcing.md) (input side),
[search-inline-content.md](search-inline-content.md) (content volume).

**Research baseline:** 2026-10-23, using the same version locks as
[hosts.jsonc](../hosts.jsonc) (Cline 0.0.13, Codex 0.163.0, OpenCode 2.0.32, Pi 1.3.0,
Claude Code 2.1.303, Cursor 2026.10.08, Devin 3000.11.92, GitHub Copilot 1.0.98). Claims are
cited to primary sources: the MCP specification, the official TypeScript SDK as installed in
this repo (`@modelcontextprotocol/server` 2.3.1 — the shipped artifact), host source at the
exact tags or as installed in `node_modules` (the published npm packages are themselves primary
sources), and official docs/changelogs. Prior findings in
[mcp-compatibility.md](mcp-compatibility.md) and [control-matrix.md](control-matrix.md) are
cited rather than re-derived; this note re-verified the load-bearing ones and extends them.

## What the specification says

MCP [`2025-06-18` tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
introduced structured output:

- Unstructured content rides in `content` (text/image/audio/resource blocks); structured
  content is "a JSON object in the `structuredContent` field."
- Backwards compatibility is a server-side SHOULD, verbatim: *"For backwards compatibility, a
  tool that returns structured content **SHOULD** also return the serialized JSON in a
  TextContent block."*
- With a declared `outputSchema`: *"Servers **MUST** provide structured results that conform to
  this schema. Clients **SHOULD** validate structured results against this schema."*
- Content blocks carry optional `annotations.audience` (`"user"` / `"assistant"`) — a spec-level
  way to mark a block as model-visible or human-visible. No host in the matrix is documented to
  honor it; treated as unpinned below.

The `2024-11-05` revision (Cline's floor) has neither `structuredContent` nor `outputSchema`.

## What the official TypeScript SDK enforces (v2.3.1, as shipped in this repo)

The server-side validator (`@modelcontextprotocol/server` 2.3.1,
`dist/mcp-*.mjs`, `validateToolOutput`) makes the outputSchema obligation concrete:

- A tool with an `outputSchema` whose result has no `structuredContent` is **rejected**:
  `Output validation error: Tool <name> has an output schema but no structured content was
  provided` (JSON-RPC `InvalidParams`). Text-only results are not allowed for schema'd tools.
- `structuredContent` is then validated against the schema; a mismatch is rejected the same way.
- The v2 codec's SEP-2106 §4.3 auto-append (so named in the installed SDK's own source;
  implemented as `appendTextFallbackForNonObject`) adds a
  `JSON.stringify(structuredContent)` TextContent block **only when `structuredContent` is a
  non-object** (primitive/array/null) and no text block exists. Object-shaped
  `structuredContent` gets **no** automatic text mirror — the server must mirror it itself to
  satisfy the spec's SHOULD.

Consequence for this repo: the shipped server declares no `outputSchema` and emits both a text
summary and (except for Codex, below) a mirrored `structuredContent` — that combination remains
the spec- and SDK-safe shape. Declaring an `outputSchema` would obligate every successful call
to return schema-conforming structured content.

## Per host: what actually reaches the model

| Host (lock) | Text `content` reaches model | `structuredContent` reaches model | Output caps at the lock |
| --- | --- | --- | --- |
| Codex 0.163.0 | Replaced when `structuredContent` present | Yes — content is **replaced** by serialized JSON | Per-tool `output_token_limit` + "standard 20% serialization allowance" ([mcp_types.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/mcp_types.rs)); default value not pinned there |
| Pi 1.3.0 (MCP path) | Yes (content-first) | Only when no content blocks | 20 KB text middle-truncate, full text saved to file; 60 s per-request ([control-matrix](control-matrix.md#pi)) |
| Pi 1.3.0 (extension path) | Yes — **the only model channel** | **No** — event-layer only (below) | Extension tools bypass the MCP 20 KB truncation ([control-matrix](control-matrix.md#pi)) |
| OpenCode 2.0.32 (plugin path) | Yes (content wins) | **No** — serialized `output` is a fallback only (below) | 2000 lines / 50 KiB tool-output truncation, full output retained to file for 7 days |
| Claude Code 2.1.303 | Yes | Spec-level yes (2026-07-28 + TS SDK 2.0 runtime); client-side rendering not pinned by a primary source | 25k tokens default (`MAX_MCP_OUTPUT_TOKENS`), oversized saved to file ([control-matrix](control-matrix.md#claude-code)) |
| Cline 0.0.13 | Yes | **No** — `2024-11-05` has no `structuredContent` | None documented |
| Devin 3000.11.92 / Copilot 1.0.98 | Yes | Spec-level yes (both negotiate 2026-07-28); rendering not pinned | Not pinned |
| Cursor 2026.10.08 | Yes | Revision unpinnable (docs show ≥2025-06-18 features, so the field exists); rendering not pinned | Not pinned |

Codex's replacement behavior and Cline's text-only floor were established at these locks in
[mcp-compatibility.md](mcp-compatibility.md#what-each-host-supports) and re-checked; the two
native-adapter findings below are new.

### Pi 1.3.0: the extension `structuredContent` never reaches the model

From the installed `@earendil-works/pi-coding-agent` 1.3.0 (the shipped artifact):

- An extension tool's `execute` returns `{ content, structuredContent?, details? }`. The
  `structuredContent` field exists only on the extension **event** layer, documented as
  *"Machine-readable result for tools that declare an `outputSchema`"*
  (`dist/core/extensions/types.d.ts`, `ToolResultEventBase`) — consumers are other extensions
  (hooks, nested tool calls), not the model.
- The model-facing message type (`@earendil-works/pi-ai` `ToolResultMessage`,
  `dist/types.d.ts`) carries `content` blocks, `isError`, ids — no `structuredContent`, and
  `details` is session-record only. The Anthropic serializer sends exactly
  `tool_use_id` + content blocks + `is_error`
  (`dist/api/anthropic-messages.js`, `convertToolResult`).
- So this repo's Pi adapter already does the right thing by putting the full result in the text
  block; its `structuredContent` payload is event-layer data for machine consumers.

### OpenCode 2.0.32: text `content` wins; typed `output` is a JSON-stringified fallback; `metadata` is not model-facing

From the official repo at tag `v2.0.32` (github.com/anomalyco/opencode, where `@opencode/cli`
2.0.32's npm manifest points) and the installed `@opencode/schema`/`@opencode/plugin`:

- `Tool.Result` is `{ output?, content?, metadata? }` — `output` typed by an optional declared
  output schema, `content` a string or text/file blocks, `metadata` a free record
  (`@opencode/schema/dist/tool.d.ts`).
- The model channel is decided by
  [`normalizeContent(content, output)`](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/runtime.ts):
  a string or non-empty `content` wins; only when `content` is absent/empty is `output`
  serialized via `JSON.stringify` into a text block. `metadata` never enters this path (it
  feeds `tool.execute.after` hooks and UI).
- Every tool result then passes through `ToolOutput.truncate`:
  **`MAX_LINES = 2000`, `MAX_BYTES = 50 KiB`** (full output retained to a `tool-output/`
  file for 7 days) — [`packages/core/src/tool-output.ts`](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool-output.ts).
  These caps are also recorded in [control-matrix.md](control-matrix.md#opencode)'s
  OpenCode section.

## What this means for this repo

1. **Text is the only channel verified to reach the model on every host.** Codex is the sole
   host where `structuredContent` demonstrably reaches the model (as a *replacement*); on the
   two native adapters it provably does not (Pi: event-layer only; OpenCode: fallback only).
   Quality fields the model should reason about therefore belong **in the text** — e.g. a
   compact per-result marker like `[rerank 2.1 · authority 3]` (plus `site_name` where present).
   At 10 results that is a few hundred characters, negligible against every cap above.
2. **Mirroring in `structuredContent` stays worth it** for machine consumers (Pi extension
   events, future hosts, tests) and costs nothing: the shipped dual-emission — text plus
   structured, with the mirror omitted for the detected `codex-mcp-client` identity — already
   matches the spec's SHOULD and Codex's replacement. Adding the new fields to both shapes
   changes no host behavior.
3. **Keep `outputSchema` undeclared** on the MCP server unless the team is prepared to guarantee
   schema-conforming `structuredContent` on every successful call (the SDK rejects otherwise).
   The Pi adapter's extension `outputSchema` is safe as-is — Pi re-declares but does not
   validate it, and its `structuredContent` is event data.
4. **New cap facts for the design margin:** OpenCode plugin results truncate at 2000 lines /
   50 KiB, Pi extension tools bypass the MCP 20 KB truncation, Claude Code caps output at
   25k tokens, and Codex applies its per-tool `output_token_limit` (default unpublished).
   None of these bind at search-result volumes; they matter if [inline content](search-inline-content.md) is
   ever enabled.

## Sources

- MCP spec: [2025-06-18 tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
  (structured content, outputSchema MUST/SHOULD, audience annotations); revision table in
  [mcp-compatibility.md](mcp-compatibility.md#protocol-revisions).
- Official TypeScript SDK, **as installed** (`@modelcontextprotocol/server` 2.3.1,
  `@modelcontextprotocol/client` 2.3.1): `dist/mcp-*.mjs` `validateToolOutput` /
  `validateToolInput`; `dist/src-*.mjs` `appendTextFallbackForNonObject` /
  `projectCallToolResult` (SEP-2106 §4.3).
- Pi, **as installed** (`@earendil-works/pi-coding-agent` 1.3.0, `@earendil-works/pi-ai`):
  `dist/core/extensions/types.d.ts` (`ToolResultEventBase.structuredContent` doc,
  `ToolDefinition.outputSchema`), `pi-ai/dist/types.d.ts` (`ToolResultMessage`),
  `pi-ai/dist/api/anthropic-messages.js` (`convertToolResult`, `convertMessages`).
- OpenCode at the lock: [`v2.0.32` tool/runtime.ts (`normalizeContent`)](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/runtime.ts),
  [`v2.0.32` tool-output.ts (MAX_LINES/MAX_BYTES)](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool-output.ts),
  [`v2.0.32` core/src/tool.ts (execute.after result shape)](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool.ts),
  installed `@opencode/schema/dist/tool.d.ts` and `@opencode/plugin/dist/promise/tool.d.ts`.
- Codex: [`mcp_types.rs` at rust-v0.163.0 (`output_token_limit`, 20% serialization allowance)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/mcp_types.rs);
  replacement behavior per [mcp-compatibility.md](mcp-compatibility.md#what-each-host-supports).
- Host caps and protocol facts previously verified at these locks:
  [control-matrix.md](control-matrix.md#per-host-reference) (Pi 20 KB / 60 s, Claude Code
  `MAX_MCP_OUTPUT_TOKENS` 25k, Cline text-only floor),
  [mcp-compatibility.md](mcp-compatibility.md) (per-host negotiated revisions; Cursor
  unpinnable).
