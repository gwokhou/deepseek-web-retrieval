import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod/v4";
import { stateDir } from "./paths";
import { atomicWrite } from "./persistence";
import type { FsRoots, InstallerInput, InstallRecord } from "./types";

export function statePathFor(input: InstallerInput): string {
  return join(stateDir(input, input.scope), `install.${input.host}.json`);
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
  host: z.enum(["opencode", "pi", "codex"]),
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
        "Restore a valid record from backup or repair its permissions before retrying; configuration was not changed. Do not delete undo state to bypass this check.",
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
  return readRecordFile(statePathFor(input), input.host, input.scope);
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
  const file = statePathFor(input);
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
  const file = statePathFor(input);
  if (existsSync(file)) rmSync(file);
}

/** Lists install records found in both scope locations for the given roots. */
export function listRecords(roots: FsRoots): InstallRecord[] {
  const records: InstallRecord[] = [];
  for (const scope of ["global", "project"] as const) {
    const dir = stateDir(roots, scope);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new InstallRecordError(dir, "unreadable", (error as NodeJS.ErrnoException).code ?? "list failed");
    }
    for (const name of names) {
      if (!name.startsWith("install.") || !name.endsWith(".json")) continue;
      const record = readRecordFile(join(dir, name), name.slice("install.".length, -".json".length), scope);
      if (record !== undefined) records.push(record);
    }
  }
  return records;
}
