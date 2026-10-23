# Sourcing `ori_question` across hosts

This note answers one question: through what channel could each host in the
[support matrix](../integration.md) supply a value for the DeepSeek Search API's optional
`ori_question` request parameter — "触发搜索的用户原始问题,1~128 个字符,有助于更好地理解搜索意图" (the
user's original question that triggered the search;
[API guide](https://api-docs.deepseek.com/guides/search), parameter table reproduced in
[search-api-defaults.md](search-api-defaults.md))? Two candidate channels are examined per host:
**(A)** a model-filled optional tool input parameter (e.g. an optional `original_question` string in
the tool's input schema), and **(B)** the adapter itself reading the surrounding session/task
context at tool-call time. At the research baseline the repo never sent the parameter; it is
now sent on the MCP path (channel A) and the Pi path (A plus B as a blank-input fallback),
while OpenCode's websearch provider path has no channel at 2.0.32 (below).

**Research baseline:** 2026-10-23, using the same version locks as
[hosts.jsonc](../hosts.jsonc) (baseline 2026-10-19): Cline 0.0.13, Codex 0.163.0
(rust-v0.163.0, rmcp 3.5.1), OpenCode 2.0.32, Pi 1.3.0, Claude Code 2.1.303, Cursor 2026.10.08,
Devin 3000.11.92, GitHub Copilot 1.0.98. Claims are cited to primary sources only: the MCP
specification, host source code at exact git tags, npm tarballs at the locked versions, and
official docs/changelogs. Where no primary source pins a fact, that is stated rather than guessed.
Protocol-revision facts per host are inherited from
[mcp-compatibility.md](mcp-compatibility.md) and not re-derived.

## What the protocol offers

MCP never carries conversation context to a server. The facts, per revision:

- **`tools/call` params are `name` + `arguments` (+ `_meta`).** The 2025-06-18 schema defines the
  params as `name` (required, string) and `arguments` (optional, free-form object with
  `additionalProperties: {}`) — the concrete `CallToolRequest` does not even enumerate `_meta`
  ([schema.json](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-06-18/schema.json));
  the same shape holds in 2024-11-05 and 2025-11-25
  ([tools pages](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)). 2025-11-25
  adds an optional `task` field (task augmentation) and 2026-07-28 adds `inputResponses` /
  `requestState` for multi round-trip retries plus required per-request `_meta` protocol fields
  ([2026-07-28 tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
  [_meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)) — none of
  these carry user or conversation data.
- **The spec assigns input validation to servers, not clients.** "Servers **MUST**: Validate all
  tool inputs"; the client-side SHOULDs cover validating *results* and showing inputs to the user —
  no revision obliges (or forbids) a client to validate model arguments against `inputSchema`
  ([security considerations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
  all revisions). `inputSchema` is "JSON Schema defining expected parameters", defaulting to the
  2020-12 dialect from 2025-11-25 on. This makes an optional declared property the spec-sanctioned
  way for a model to convey extra intent.
- **"MCP has no protocol-level session."** The 2026-07-28 spec says it directly: "a server cannot
  rely on implicit per-connection state to relate one tool call to the next"
  ([Stateful Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#stateful-tools)),
  and the statelessness rules forbid inferring context from prior requests
  ([Statelessness](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#statelessness)).
- **Sampling cannot be abused to obtain the context.** `sampling/createMessage` is
  server-initiated with server-authored `messages`; `includeContext: "thisServer"/"allServers"`
  (soft-deprecated) includes *MCP-server* context, not the host conversation, and requests are
  human-reviewed
  ([sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)). A server
  could only ask a model to *guess* intent — not obtain the user's question.
- **Elicititation is interactive, not derivation.** `elicitation/create` asks the user a form/choice
  question and waits ([2025-06-18+](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation));
  it requires client capability (only Codex in this matrix has it, per
  [mcp-compatibility.md](mcp-compatibility.md)) and an explicit round trip.
- **Tasks are state machines, not context.** The experimental 2025-11-25 `Task` object is
  `taskId`/`status`/timestamps/`ttl`/`pollInterval` — no user data
  ([tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)).
- **`_meta` has no context convention.** Reserved keys are enumerated; vendors may add prefixed
  keys, but no host documents sending conversation context there
  ([_meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)). Codex is the
  one host observed adding its own key — `openai/entitlementContext`, carrying entitlement status
  for zero-argument read-only plugin tools
  ([trusted_access.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/trusted_access.rs))
  — not user context.

Conclusion: **for an MCP-connected host, channel A (the tool's input schema) is the only spec-borne
channel; channel B does not exist at the protocol layer.** Whether A works in practice depends on
each host's client, below.

## Open-source hosts, from source at the lock

### Codex 0.163.0 (rust-v0.163.0)

- **No client-side argument validation.** The model's `arguments` string is parsed as JSON (empty
  allowed; invalid JSON becomes an error result) and the resulting `serde_json::Value` flows
  unchanged to rmcp's `call_tool`
  ([mcp_tool_call.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/mcp_tool_call.rs),
  [connection_manager.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/connection_manager.rs)).
  No JSON-Schema validator exists in the tree (only `schemars`, used to *generate* schemas for
  built-in tools; codex-rs/Cargo.toml at the tag).
- **Input schemas reach the model essentially verbatim.** `mcp_tool_to_responses_api_tool` forwards
  the server's `inputSchema` as the tool's `parameters`
  ([responses_api.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/responses_api.rs));
  the only transformations are inserting an empty `properties` object when missing, sanitizing
  boolean schemas, and a default 5,000-byte budget: over-budget schemas are progressively
  compacted (strip descriptions → drop definitions → collapse deep objects → prune compositions)
  ([mcp_tool.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/mcp_tool.rs),
  [json_schema.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/json_schema.rs),
  [compaction.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/json_schema/compaction.rs)).
  A small schema with one optional string property stays intact.
- **Channel B: none.** Codex's third-party integration surface at this tag is MCP servers; there is
  no session/context API a server can call.

Verdict: **A feasible (nothing validates or strips arguments; schema forwarded), B impossible.**

### Pi 1.3.0 (v1.3.0)

- **The agent loop validates arguments against the tool's parameter schema before `execute`.**
  `validateToolArguments` clones the arguments, normalizes `null` for optional properties, coerces
  types (`Value.Convert`, plus JSON-Schema coercion for plain JSON-Schema tools), then runs a
  TypeBox `Check`; failures come back to the model as `Validation failed for tool …` error results
  ([validation.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/utils/validation.ts),
  [agent-loop.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/agent/src/agent-loop.ts)).
  A *declared optional* property therefore passes and reaches the tool; undeclared fields pass only
  when the schema itself permits them.
- **MCP tools: schema forwarded, params passed through.** The adapter spreads the server's
  `inputSchema` into the model-facing parameters (adding only `type: "object"` and an empty
  `properties` when missing) and passes the validated `params` to the client's `callTool`, which
  sends `{ name, arguments }` verbatim (a `_meta.progressToken` is added only when progress
  reporting is on)
  ([tools.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/extensions/mcp/tools.ts),
  [client.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/mcp/src/client.ts)).
- **Extension tools receive session access as a fifth `execute` argument.** At v1.3.0 the signature
  is `execute(toolCallId, params, signal, onUpdate, ctx: ExtensionToolContext)`
  ([types.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/types.ts)).
  `ExtensionToolContext` extends `ExtensionContext`, whose `sessionManager` is a
  `ReadonlySessionManager` exposing `buildSessionProjection()` — returning the model-visible
  `messages: AgentMessage[]` (user messages included), plus `getEntries`/`getTree`/`getBranch`
  ([session-manager.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/session-manager.ts)).
  The extension docs at the tag document `ctx` for tools (`ctx.executeTool`, `ctx.sessionManager`)
  ([extensions.md](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md)).
  The `ExtensionAPI` event surface (`input`, `message_end`, `tool_execution_*`) additionally lets an
  extension track the user prompt as it arrives.

Verdict: **A feasible on both paths (declared optional TypeBox property; validated, then passed
through). B feasible on the extension path via the fifth `execute` argument — the handler can read
the session's user messages at call time. B impossible via MCP** (separate process, no session
API).

### OpenCode 2.0.32

Repo provenance first: `@opencode/cli@2.0.32`'s manifest points at
[github.com/anomalyco/opencode](https://github.com/anomalyco/opencode), which has the `v2.0.32`
tag (commit `843a6c5`); the `opencode-ai/opencode` repository's tags stop at `v0.0.x` and hold no
2.x tag. Facts below are from the tag plus the npm tarballs at 2.0.32
(`@opencode/plugin`, `@opencode/schema`, `@opencode/client`).

- **The tool runtime validates arguments against the tool's declared input schema before
  `execute`.** `Tool.runtime.execute` decodes the model's input first: raw JSON-Schema inputs are
  converted to an Effect codec and validated; failures return `Invalid arguments for tool "…":
  … Update the arguments and call the tool again.`
  ([runtime.ts](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/runtime.ts)).
  A plugin tool's plain JSON Schema `input` is forwarded to the model **as-is** (`inputJsonSchema`
  returns it unchanged), so a declared optional parameter is both model-visible and validated.
- **`ToolContext` carries IDs only**: `sessionID`, `agent`, `messageID`, call `id`, `signal`,
  `progress` ([tool.d.ts in @opencode/schema 2.0.32](https://registry.npmjs.org/@opencode/schema/2.0.32);
  [tool.d.ts in @opencode/plugin 2.0.32](https://registry.npmjs.org/@opencode/plugin/2.0.32)).
- **But the plugin `Context.session` domain can read the conversation.** The picked `SessionDomain`
  includes `context({ sessionID }) → SessionMessageInfo[]`, and `SessionMessageUser` has
  `text: string` — the user's prompt text — plus attachments
  ([session.d.ts](https://registry.npmjs.org/@opencode/plugin/2.0.32),
  [client types](https://registry.npmjs.org/@opencode/client/2.0.32)). Session hooks round it out:
  `"prompt"` fires with the prompt itself, `"generate"`/`"context"` with `messages: Array<Message>`
  ([session.d.ts at 2.0.32](https://registry.npmjs.org/@opencode/plugin/2.0.32)). So a tool's
  `execute` can call `ctx.session.context({ sessionID: context.sessionID })` at call time.
- **The native websearch provider interface carries only the query.**
  `WebSearch.ProviderInput = Pick<Input, "query">`, the provider context is `{ signal }`, and core
  invokes providers as `.execute({ query: input.query })`
  ([websearch.ts](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/websearch.ts),
  [websearch.d.ts](https://registry.npmjs.org/@opencode/schema/2.0.32)). The model-facing
  `websearch` tool's input schema is fixed in host source to `query` alone
  ([tool/plugin/websearch.ts](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/plugin/websearch.ts)).
  A provider gets no sessionID, so session auto-derivation on this path is not directly possible —
  only heuristic correlation via the session hooks (which fire per model request with the
  sessionID, but no API contract binds a provider call to a session).

Verdict: **tool path (`deepseek_fetch` / the `webfetch` override): A feasible (validated against
the declared schema; raw JSON Schema forwarded verbatim) and B feasible
(`ctx.session.context`). Websearch provider path (the search replacement this repo ships): neither
— the input schema is host-fixed to `query`, and the provider context has no session handle.**

### Cline 0.0.13

Closed source; the platform binary
([@cline/cli-linux-x64 0.0.13](https://registry.npmjs.org/@cline/cli-linux-x64/0.0.13), ~119 MB)
yielded the protocol facts already recorded — custom client negotiating `2024-11-05`,
text-content-only results ([mcp-compatibility.md](mcp-compatibility.md)). No primary source
documents whether the client validates tool arguments against `inputSchema` or mangles schemas;
strings cannot prove a runtime behavior either way, so this is **undeterminable at the lock**. The
2024-11-05 revision itself puts no validation obligation on clients and defines `arguments` as a
free-form object, so there is no protocol-level obstacle to channel A — merely no evidence for or
against host behavior. Channel B: none (MCP only, `paths` in hosts.jsonc).

## Proprietary hosts

No proprietary host documents a context channel; the question is whether anything documents
input-schema handling that would break an optional parameter.

- **Claude Code 2.1.303.** The [MCP docs](https://code.claude.com/docs/en/mcp) say nothing about
  input schemas or argument validation. The
  [changelog](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) documents
  the mechanics indirectly, all at or before the lock: 2.1.300 — "Fixed a conversation failing on
  every turn with a 400 error when the API rejected an MCP tool's input schema; Claude Code now
  sends that tool without parameters for the rest of the conversation"; 2.1.246 — "Fixed MCP tool
  arguments being sent as JSON strings when the parameter's schema is empty (`{}`)"; 2.1.30 —
  prompt-cache invalidation "when tool descriptions or input schemas changed"; 2.0.50 — "bug
  preventing calling MCP tools that have nested references in their input schemas". Together these
  show the server's `inputSchema` is what the model provider sees and that arguments follow it;
  no host-side validation is ever mentioned. **A feasible by this evidence; B none.**
- **Cursor 2026.10.08.** The [MCP docs](https://cursor.com/docs/mcp) describe tools only as
  "Functions for the AI model to execute" and say nothing about input schemas, validation, or
  context — and the protocol revision itself is unpinnable from primary sources
  ([mcp-compatibility.md](mcp-compatibility.md)). **No primary source either way for A; B none.**
- **Devin 3000.11.92.** The [MCP docs](https://docs.devin.ai/cli/extensibility/mcp/overview) and
  [changelog](https://docs.devin.ai/cli/changelog) cover transport, OAuth, permissions, and
  tool-level gating (`disabled_tools`, `mcp__server__tool` patterns) but nothing on input schemas
  or argument validation; the nearest mechanisms (`PostToolUse` hooks, positional prompt arguments)
  are not tool-input channels. **No primary source either way for A; B none.**
- **GitHub Copilot 1.0.98.** The
  [MCP docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
  document per-server `tools` filtering only. The
  [changelog](https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md) shows MCP tool
  schemas are forwarded to model providers verbatim enough that *provider-side* schema validation
  fires, at or before the lock: 1.0.89 — "Gemini models no longer fail every request with 400
  invalid request body when an MCP server exposes a tool whose schema puts a type or properties
  beside anyOf"; 1.0.85 — "MCP tools with boolean property or array-item schemas work with Gemini
  instead of causing a 400 error"; 1.0.61 — "Gemini models work correctly with MCP tools that use
  nullable schema types". No host-side argument validation is mentioned. **A feasible by this
  evidence; B none.**

## Verdicts at a glance

| Host | (A) model-filled optional param | (B) session auto-derivation | Load-bearing fact |
| --- | --- | --- | --- |
| Codex | Yes | No | No argument validation anywhere in the tool-call path; schema forwarded (compaction only above 5 KB) |
| Pi | Yes (extension and MCP paths) | Yes — extension path only | 5th `execute` arg exposes `sessionManager.buildSessionProjection()`; MCP path validated against the server's own schema |
| OpenCode | Yes — tool path; **no** — websearch provider | Yes — tool path; not directly — provider | Runtime validates against the declared schema and forwards raw JSON Schemas verbatim; `ctx.session.context` reads user text; provider input is host-fixed to `query` |
| Cline | Undeterminable (no primary source) | No | 2024-11-05 client; behavior not documented |
| Claude Code | Yes (changelog evidence) | No | Input schemas demonstrably reach the model API |
| Cursor | No primary source | No | Docs silent |
| Devin | No primary source | No | Docs/changelog silent |
| Copilot | Yes (changelog evidence) | No | Provider-side 400s driven by MCP schema shapes prove forwarding |

For every MCP-only host, channel A is the only candidate; where no primary source pins the
behavior (Cline, Cursor, Devin), an optional declared parameter is still spec-conformant on every
negotiated revision in the matrix.

## What this means for this repo

- **MCP server (`src/mcp/server.ts`).** The tool `inputSchema` is the only channel any MCP host
  offers. The server declares its inputs as zod objects (`z.object({ query, original_question })`,
  `z.object({ url })`) through SDK v2's `registerTool`; zod's default behavior strips undeclared
  keys server-side, so a host-side pre-filled undeclared field would be dropped — whatever a host
  sends must be *declared* in the schema to arrive in the handler. The declared optional string
  surfaces in the JSON Schema every host in this note forwards (Codex and Pi verbatim-small,
  OpenCode verbatim, Claude Code and Copilot per changelog evidence; Cline, Cursor, Devin
  unproven but spec-conformant) — exactly the channel the shipped `original_question` rides.
- **OpenCode plugin (`src/opencode/plugin.ts`).** The fetch tools' `execute` receives a
  `ToolContext` with `sessionID`, and the plugin `Context` can read
  `ctx.session.context({ sessionID })` — user messages with their `text` — at call time, so
  channel B exists here without touching schemas. The `websearch` provider replacement — the path
  this repo uses for search — has neither channel at 2.0.32: its model-facing input schema is
  fixed in host source to `query`, and its provider context is `{ signal }` only. Note also that
  `FETCH_INPUT` sets `additionalProperties: false`, which matters if a parameter is ever added on
  channel A: an undeclared field would be rejected by OpenCode's runtime validation with a
  retryable error.
- **Pi extension (`src/pi/extension.ts`).** The search handler reads the fifth `execute`
  argument (`ExtensionToolContext`), whose `sessionManager.buildSessionProjection()` returns the
  model-visible messages, user prompts included — readable synchronously at call time, so channel
  B exists on this path; the shipped adapter uses it as the blank-input fallback. Channel A is
  equally open: the TypeBox `parameters` are what the agent loop validates against, and
  `Type.Optional(Type.String(...))` properties pass validation when the model fills them. The
  extension runs in-process, so B does not pay the MCP detour.

## Sources

### Specification

- MCP tools: [2024-11-05](https://modelcontextprotocol.io/specification/2024-11-05/server/tools) ·
  [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) ·
  [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) ·
  [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
  (Stateful Tools, MRTR retry params, `x-mcp-header`)
- [2025-06-18 schema.json (CallToolRequest)](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-06-18/schema.json)
- [2025-11-25 sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling) ·
  [2025-11-25 tasks (experimental)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [2026-07-28 overview (`_meta`, statelessness)](https://modelcontextprotocol.io/specification/2026-07-28/basic/index)

### Open-source hosts

- Codex: [rust-v0.163.0 tag](https://github.com/openai/codex/tree/rust-v0.163.0) —
  [mcp_tool_call.rs (argument parsing, no validation)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/mcp_tool_call.rs),
  [connection_manager.rs (call_tool passthrough)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/connection_manager.rs),
  [responses_api.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/responses_api.rs),
  [mcp_tool.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/mcp_tool.rs),
  [json_schema.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/json_schema.rs),
  [compaction.rs (5 KB default budget)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tools/src/json_schema/compaction.rs),
  [trusted_access.rs (openai/entitlementContext)](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-mcp/src/trusted_access.rs)
- Pi: [v1.3.0 tag](https://github.com/earendil-works/pi/tree/v1.3.0) —
  [extensions/mcp/tools.ts (toParameters, execute passthrough)](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/extensions/mcp/tools.ts),
  [agent-loop.ts (prepare/validate/execute)](https://github.com/earendil-works/pi/blob/v1.3.0/packages/agent/src/agent-loop.ts),
  [validation.ts (validateToolArguments)](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/utils/validation.ts),
  [mcp/client.ts (callTool)](https://github.com/earendil-works/pi/blob/v1.3.0/packages/mcp/src/client.ts),
  [extensions/types.ts (ToolDefinition.execute 5th arg, ExtensionAPI)](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/types.ts),
  [session-manager.ts (ReadonlySessionManager)](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/session-manager.ts),
  [extensions.md at the tag](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md)
- OpenCode: [anomalyco/opencode v2.0.32 tag](https://github.com/anomalyco/opencode/tree/v2.0.32)
  (repository URL from
  [@opencode/cli 2.0.32](https://registry.npmjs.org/@opencode/cli/2.0.32)) —
  [tool/runtime.ts (input validation, schema forwarding)](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/runtime.ts),
  [websearch.ts (ProviderInput, execute({query}))](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/websearch.ts),
  [tool/plugin/websearch.ts (fixed query schema)](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/plugin/websearch.ts);
  npm tarballs at 2.0.32:
  [@opencode/plugin](https://registry.npmjs.org/@opencode/plugin/2.0.32)
  (ToolContext, Context, SessionDomain hooks),
  [@opencode/schema](https://registry.npmjs.org/@opencode/schema/2.0.32)
  (Tool.Context, WebSearch.ProviderInput),
  [@opencode/client](https://registry.npmjs.org/@opencode/client/2.0.32)
  (session.context → SessionMessageInfo[], SessionMessageUser.text)
- Cline: [@cline/cli-linux-x64 0.0.13](https://registry.npmjs.org/@cline/cli-linux-x64/0.0.13)
  (manifest only; behavior undeterminable) and prior binary analysis recorded in
  [mcp-compatibility.md](mcp-compatibility.md)

### Proprietary hosts

- Claude Code: [changelog](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
  (entries 2.0.50, 2.1.30, 2.1.246, 2.1.300 — all ≤ the 2.1.303 lock),
  [MCP docs](https://code.claude.com/docs/en/mcp)
- Cursor: [MCP docs](https://cursor.com/docs/mcp) (silent on the question)
- Devin: [MCP overview](https://docs.devin.ai/cli/extensibility/mcp/overview),
  [changelog](https://docs.devin.ai/cli/changelog) (silent on the question)
- GitHub Copilot: [changelog](https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md)
  (entries 1.0.61, 1.0.85, 1.0.89 — all ≤ the 1.0.98 lock),
  [MCP docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)

### DeepSeek API

- [Search & Fetch guide](https://api-docs.deepseek.com/guides/search) (`ori_question` optional,
  1–128 chars; parameter table transcribed in
  [search-api-defaults.md](search-api-defaults.md))
