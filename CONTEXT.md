# DeepSeek Web Retrieval

An adapter layer bringing DeepSeek's Search and Fetch APIs to coding agents. The
retrieval core is agent-agnostic; adapters expose it to specific hosts, and the
installer wires it into host configuration with plan-then-apply semantics.

## Retrieval

**Host**:
A coding agent the project serves (OpenCode, Pi, Codex, …); the unit of compatibility facts in `docs/hosts.jsonc`.
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
_Avoid_: rollback (that is uninstall's whole ability), undo

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
