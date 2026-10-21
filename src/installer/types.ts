/** Hosts the installer supports. */
export type HostName = "opencode" | "pi" | "codex";

/** Install scope, a first-class user choice. */
export type Scope = "project" | "global";

/**
 * The filesystem roots path resolution needs; InstallerInput satisfies this structurally.
 * Each host module owns the mapping from an input to its config and rules files.
 */
export interface FsRoots {
  readonly home: string;
  readonly cwd: string;
  /** Explicit config home; the CLI edge resolves XDG once and passes it down. */
  readonly configHome?: string;
}

/** The files a host edit touches for a given scope. */
export interface HostPaths {
  /** Main host config file the installer edits. */
  readonly config: string;
  /** Rules file receiving the marked block for the preferred tier. */
  readonly rules: string;
}

/** Control tier per capability; "off" skips the tool entirely. */
export type Tier = "optional" | "preferred" | "forced" | "off";

/** Everything the installer needs to build a plan. */
export interface InstallerInput {
  readonly host: HostName;
  readonly scope: Scope;
  readonly search: Tier;
  readonly fetch: Tier;
  /** npm package reference written into host config; defaults to the published name. */
  readonly packageRef: string;
  readonly home: string;
  readonly cwd: string;
  readonly configHome?: string;
  /**
   * Integration mechanism for hosts with more than one (Pi: the native
   * extension, or the MCP server). Undefined means the host's default path.
   */
  readonly path?: "extension" | "mcp";
  /**
   * The host CLI's version probed at the CLI edge (for drift notes); undefined
   * means the probe was not attempted or could not read a version.
   */
  readonly hostVersion?: string;
}

/** A mutation on a parsed config object, addressed by a dotted path. */
export interface ConfigOp {
  readonly op: "set" | "append-array";
  readonly path: readonly string[];
  readonly value?: unknown;
  readonly entries?: readonly unknown[];
  /** Plan-preview metadata: the value the set replaces (undefined when absent). */
  readonly previous?: unknown;
  /** Plan-preview metadata: entries already present at an append-array path. */
  readonly existingCount?: number;
}

/** A JSON file edit: comment-preserving ops on JSONC text. */
export interface JsonEdit {
  readonly file: string;
  readonly format: "json";
  readonly ops: readonly ConfigOp[];
}

/** A TOML file edit: ops on the parsed value, serialized on write. */
export interface TomlEdit {
  readonly file: string;
  readonly format: "toml";
  readonly ops: readonly ConfigOp[];
}

/** A rules file edit: upserts the host's marked block; it carries no ops. */
export interface RulesEdit {
  readonly file: string;
  readonly format: "rules";
  readonly block: string;
}

/** One file the plan touches, discriminated by config format. */
export type FileEdit = JsonEdit | TomlEdit | RulesEdit;

/** A plan that refuses to proceed (for example a structurally unavailable tier). */
export interface PlanError {
  readonly message: string;
}

export interface InstallPlan {
  readonly host: HostName;
  readonly scope: Scope;
  readonly tiers: { readonly search: Tier; readonly fetch: Tier };
  readonly edits: readonly FileEdit[];
  readonly notes: readonly string[];
  readonly errors: readonly PlanError[];
  /**
   * Artifacts from a previous init that this plan no longer wants (for example the
   * web_search kill switch after a forced → optional tier change). They are shown in
   * the plan, reverted during apply, and then gone from the record — so uninstall
   * still restores exactly what this install applied.
   */
  readonly reverts?: readonly RecordedFile[];
}

/** An op as it was actually applied, with the previous value for surgical undo. */
export interface RecordedOp {
  readonly op: "set" | "append-array";
  readonly path: readonly string[];
  readonly applied: unknown;
  readonly previous: unknown;
}

/** A file as it was actually written, for surgical uninstall. */
export interface RecordedFile {
  readonly file: string;
  readonly format: "json" | "toml" | "rules";
  readonly created: boolean;
  readonly ops: readonly RecordedOp[];
  readonly blockApplied?: string;
  /** Path prefixes the apply step had to create; uninstall removes them when left empty. */
  readonly createdParents?: readonly (readonly string[])[];
}

/** Persisted install state; one record per host and scope. */
export interface InstallRecord {
  readonly version: 1;
  readonly host: HostName;
  readonly scope: Scope;
  readonly tiers: { readonly search: Tier; readonly fetch: Tier };
  readonly createdAt: string;
  readonly files: readonly RecordedFile[];
}
