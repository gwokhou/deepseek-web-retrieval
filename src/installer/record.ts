import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod/v4";
import { recordDir } from "./paths";
import { atomicWrite } from "./persistence";
import type { FsRoots, InstallerInput, InstallRecord, Scope } from "./types";

export function recordPathFor(input: InstallerInput): string {
  return join(recordDir(input, input.scope), `install.${input.host}.json`);
}

/** The platform a read resolves for: injected at the CLI edge, process.platform otherwise. */
function platformOf(roots: FsRoots): NodeJS.Platform {
  return roots.platform ?? process.platform;
}

/**
 * Windows-only read compatibility: global records written before the config
 * home moved to %APPDATA% live under `~/.config`. Kept readable so `list` and
 * `uninstall` keep tracking installs made by older releases.
 */
export function legacyGlobalRecordDir(roots: FsRoots): string {
  return join(roots.home, ".config", "deepseek-web-retrieval");
}

/**
 * The file a record is read from: the canonical record path, except that a
 * missing win32 global record falls back to the legacy `~/.config` location
 * (see legacyGlobalRecordDir). Writes always target the canonical path.
 */
export function recordReadPath(input: InstallerInput, platform: NodeJS.Platform = platformOf(input)): string {
  const canonical = recordPathFor(input);
  if (platform !== "win32" || input.scope !== "global" || existsSync(canonical)) return canonical;
  const legacy = join(legacyGlobalRecordDir(input), `install.${input.host}.json`);
  return existsSync(legacy) ? legacy : canonical;
}

const keyPath = z.array(z.string().min(1)).min(1);
const tier = z.enum(["optional", "preferred", "forced", "off"]);
const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: keyPath, applied: z.unknown(), previous: z.unknown().optional() }),
  z.object({
    op: z.literal("append-array"),
    path: keyPath,
    applied: z.array(z.unknown()),
    previous: z.unknown().optional(),
  }),
]);
const recordSchema = z.object({
  version: z.literal(1),
  installerVersion: z.string().optional(),
  host: z.enum(["opencode", "pi", "codex", "claude-code"]),
  scope: z.enum(["global", "project"]),
  tiers: z.object({ search: tier, fetch: tier }),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  files: z.array(
    z.object({
      file: z.string().refine(isAbsolute),
      format: z.enum(["json", "toml", "rules"]),
      created: z.boolean(),
      shared: z.literal(true).optional(),
      ops: z.array(operation),
      blockApplied: z.string().optional(),
      createdParents: z.array(keyPath).optional(),
    }),
  ),
});

export class InstallRecordError extends Error {
  constructor(
    readonly file: string,
    readonly kind: "unreadable" | "invalid",
    detail: string,
  ) {
    super(
      `${kind === "invalid" ? "Invalid install record" : "Cannot read install record"} at ${file} (${detail}). ` +
        "Restore a valid install record from your own copy or repair its permissions before retrying; configuration was not changed. Do not delete the install record to bypass this check.",
    );
    this.name = "InstallRecordError";
  }
}

function readRecordFile(file: string, host: string, scope: string): InstallRecord | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        lstatSync(file);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      }
    }
    throw new InstallRecordError(file, "unreadable", (error as NodeJS.ErrnoException).code ?? "read failed");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InstallRecordError(file, "invalid", "malformed JSON");
  }
  const result = recordSchema.safeParse(value);
  if (!result.success) {
    // Never include snapshot values in diagnostics: they may contain private configuration.
    throw new InstallRecordError(file, "invalid", "unsupported version or malformed record structure");
  }
  if (result.data.host !== host || result.data.scope !== scope) {
    throw new InstallRecordError(file, "invalid", "host or scope does not match its location");
  }
  return result.data as InstallRecord;
}

export function readRecord(input: InstallerInput): InstallRecord | undefined {
  return readRecordFile(recordReadPath(input), input.host, input.scope);
}

/**
 * The one place that knows a file must never be claimed by two scopes of the
 * same host: returns the subset of `files` the record at the other scope claims.
 */
export function claimedByOtherScope(input: InstallerInput, files: readonly string[]): string[] {
  const other = input.scope === "global" ? "project" : "global";
  const record = readRecord({ ...input, scope: other });
  if (record === undefined) return [];
  return files.filter((file) => record.files.some((candidate) => candidate.file === file));
}

/**
 * Install records carry snapshots of replaced values, so they are written with
 * owner-only permissions regardless of umask.
 */
export function writeRecord(input: InstallerInput, record: InstallRecord): void {
  const file = recordPathFor(input);
  atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`, 0o600);
}

/** Entries a previous init appended at the given path, across its recorded files. */
export function appendedByPrevious(record: InstallRecord | undefined, path: readonly string[]): readonly unknown[] {
  if (record === undefined) return [];
  const entries: unknown[] = [];
  for (const file of record.files) {
    for (const op of file.ops) {
      if (op.op !== "append-array" || op.path.join("\u0000") !== path.join("\u0000")) continue;
      if (Array.isArray(op.applied)) entries.push(...op.applied);
    }
  }
  return entries;
}

export function deleteRecord(input: InstallerInput): void {
  // Win32 legacy records are removed where they were found, so uninstalling a
  // pre-APPDATA install clears its tracking instead of a canonical file that
  // was never written.
  const file = recordReadPath(input);
  if (existsSync(file)) rmSync(file);
}

/** Reads every valid record in one scope's directory; an absent directory is empty. */
function readRecordsFromDir(dir: string, scope: Scope): InstallRecord[] {
  const records: InstallRecord[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return records;
    throw new InstallRecordError(dir, "unreadable", (error as NodeJS.ErrnoException).code ?? "list failed");
  }
  for (const name of names) {
    if (!name.startsWith("install.") || !name.endsWith(".json")) continue;
    const record = readRecordFile(join(dir, name), name.slice("install.".length, -".json".length), scope);
    if (record !== undefined) records.push(record);
  }
  return records;
}

function hasRecordFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.startsWith("install.") && name.endsWith(".json"));
  } catch {
    return false;
  }
}

/**
 * True when the global records must be read from the legacy win32 `~/.config`
 * location: win32, nothing recorded under the canonical config home, and
 * pre-%APPDATA% records still present there. `list` says so when this holds.
 */
export function readingLegacyGlobalRecords(roots: FsRoots): boolean {
  if (platformOf(roots) !== "win32") return false;
  if (hasRecordFiles(recordDir(roots, "global"))) return false;
  return hasRecordFiles(legacyGlobalRecordDir(roots));
}

/** Lists install records found in both scope locations for the given roots. */
export function listRecords(roots: FsRoots): InstallRecord[] {
  const global = readRecordsFromDir(recordDir(roots, "global"), "global");
  const project = readRecordsFromDir(recordDir(roots, "project"), "project");
  const legacy = readingLegacyGlobalRecords(roots) ? readRecordsFromDir(legacyGlobalRecordDir(roots), "global") : [];
  return [...global, ...legacy, ...project];
}
