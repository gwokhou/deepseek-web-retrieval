# DeepSeek Web Retrieval

An adapter layer bringing DeepSeek's Search and Fetch APIs to coding agents. The
retrieval core is agent-agnostic; adapters expose it to specific hosts, and the
installer wires it into host configuration with plan-then-apply semantics.

## Retrieval

**Host**:
A coding agent the project serves (OpenCode, Pi, Codex, Claude Code, …); the unit of compatibility facts in `docs/hosts.jsonc`.
_Avoid_: agent (ambiguous with the coding agent itself), client

**Adapter**:
The per-host exposure of the retrieval core (a native plugin or extension, or the MCP server for MCP-capable hosts).
_Avoid_: integration, wrapper

**Host module**:
The installer's per-host module: one file owning that host's paths, tool ids, and tier semantics, listed in the planner roster.
_Avoid_: host adapter (that means the runtime adapter)

**Capability**:
Search or Fetch, switched independently (optional / preferred / forced / off).
_Avoid_: tool (a tool is what a host registers for a capability)

**SearchResult**:
The core's processed search hit: url, title, summary content, and optional publish time, host-neutral; adapters map it to their host's shape.
_Avoid_: WebSearchResult (that is OpenCode's shape)

**Tier**:
How strongly a capability's tools are routed: optional, preferred, forced, or off.
_Avoid_: level, mode

## Configuration

**Shared config file**:
The user-scope base config layer (`~/.config/deepseek-web-retrieval/config.json`; `%APPDATA%\` on Windows): camelCase keys, read by every adapter beneath the environment and host-native layers.
_Avoid_: global config (it is one layer of the chain, not the whole configuration)

**Host-integration key**:
An option describing the host's tool landscape (enable switches, registration flags, credential source) rather than the DeepSeek call; rejected by the shared config file, configured host-natively. Distinct from Adapter, which is code, not a key.
_Avoid_: adapter option (that means any option an adapter consumes)

**Config vocabulary**:
The one ordered set of knob names shared by the file, the options tables, and the summaries (`SHARED_CONFIG_KEYS`/`CONFIG_KEYS`); host-integration keys are not part of it.
_Avoid_: schema (that is the JSON Schema of a tool input)

**Content envelope**:
The deployment-level pair (`searchContentMaxChars`, `searchContentTimeoutMs`) bounding how much inline page content a `need_content` call may return — distinct from the per-call boolean that decides whether content flows at all.
_Avoid_: content mode (there is no mode; the flag is a per-call boolean)

## Installing

**Plan**:
The preview a user approves before anything is written: edits with old→new values, reverts, notes, and refusal errors.
_Avoid_: proposal

**Scope**:
The effective reach of an install: project (one checkout, shareable via VCS) or global (every project for that host on the machine).
_Avoid_: layer (a layer is a config-precedence level above the user, a different concept)

**Install record**:
The persisted undo state for one host and scope: snapshots, appended entries, created files.
_Avoid_: state file

**Snapshot**:
The prior value captured before a single-value key is overwritten, so rollback can restore it.
_Avoid_: backup

**Revert**:
Undoing artifacts of a superseded init during apply (shown in the plan, applied, then gone from the record).
_Avoid_: rollback (reserved for uninstall's full restore), undo

**Whole-file orphan**:
A file the previous init touched that the new plan no longer claims; reverts entirely.
_Avoid_: stale file

**Partial orphan**:
Ops inside a file the new plan still claims that the plan no longer wants; reverts without deleting the file.

**Claimed files**:
The files a plan or install record declares it touches; the unit of the invariant that two scopes of one host never claim the same file.
_Avoid_: owned files, touched files

**Config format**:
The dialect of a file an install edits: JSONC (comment-preserving), TOML (comment-lossy), or a host-marked rules block.
_Avoid_: file type

**Codec**:
The module that loads, applies, verifies, and reverts one config format; one per format, behind one interface.
_Avoid_: parser, editor
