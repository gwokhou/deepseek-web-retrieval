import { existsSync, readFileSync } from "node:fs";
import { parse as parseToml, stringify as stringifyTomlValue } from "smol-toml";
import type { ConfigOp, RecordedOp } from "../types";
import type { AppliedText, FormatCodec, LoadedConfig } from "./index";
import { appendEntries, deepEqual, isPlainObject, removeAt, valueAt } from "./value";

/** Reads a TOML config file; a missing file starts empty, an unparsable one carries the error. */
function loadToml(file: string): LoadedConfig {
  if (!existsSync(file)) return { exists: false, text: "", value: {}, lossy: false };
  const text = readFileSync(file, "utf8");
  try {
    return { exists: true, text, value: parseToml(text) as Record<string, unknown>, lossy: hasTomlComment(text) };
  } catch (error) {
    const parseError = error instanceof Error ? error.message : String(error);
    return { exists: true, text, value: {}, lossy: false, parseError };
  }
}

/**
 * String-aware TOML comment detection: any `#` outside basic ("") or literal ('')
 * strings counts, including trailing comments like `key = "x" # note`.
 */
export function hasTomlComment(text: string): boolean {
  let inBasic = false;
  let inLiteral = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inBasic) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inBasic = false;
      continue;
    }
    if (inLiteral) {
      if (ch === "'") inLiteral = false;
      continue;
    }
    if (ch === '"') inBasic = true;
    else if (ch === "'") inLiteral = true;
    else if (ch === "#") return true;
  }
  return false;
}

function serializeToml(value: Record<string, unknown>): string {
  return `${stringifyTomlValue(value)}\n`;
}

/**
 * Applies ops to a parsed TOML value, returning the mutated value plus one record
 * per op with the previous value for surgical undo, and the path prefixes created.
 */
function applyTomlOps(
  value: Record<string, unknown>,
  ops: readonly ConfigOp[],
): { value: Record<string, unknown>; recorded: RecordedOp[]; createdParents: (readonly string[])[] } {
  const target: Record<string, unknown> = structuredClone(value);
  const recorded: RecordedOp[] = [];
  const createdParents: (readonly string[])[] = [];
  for (const op of ops) {
    const parent = navigate(target, op.path, createdParents);
    const key = op.path[op.path.length - 1];
    if (op.op === "set") {
      const previous = Object.hasOwn(parent, key) ? parent[key] : undefined;
      parent[key] = structuredClone(op.value);
      recorded.push({ op: "set", path: op.path, applied: structuredClone(op.value), previous });
      continue;
    }
    const existing = parent[key];
    if (existing === undefined) createdParents.push(op.path);
    const { list, appended } = appendEntries(existing, op.entries ?? [], op.path);
    parent[key] = [...list, ...appended.map((entry) => structuredClone(entry))];
    recorded.push({ op: "append-array", path: op.path, applied: appended, previous: undefined });
  }
  return { value: target, recorded, createdParents };
}

function navigate(
  root: Record<string, unknown>,
  path: readonly string[],
  created: (readonly string[])[],
): Record<string, unknown> {
  let node = root;
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const key = path[depth] as string;
    const next: unknown = node[key];
    if (next === undefined) {
      node[key] = {};
      created.push(path.slice(0, depth + 1));
    } else if (!isPlainObject(next)) {
      throw new Error(
        `cannot descend into ${path.slice(0, depth + 1).join(".")}: it is ${Array.isArray(next) ? "an array" : `a ${typeof next}`}, not a table`,
      );
    }
    node = node[key] as Record<string, unknown>;
  }
  return node;
}

/** Surgical undo on a parsed TOML object; user edits made after install win. */
function revertTomlOps(value: Record<string, unknown>, ops: readonly RecordedOp[]): string[] {
  const notes: string[] = [];
  for (const record of [...ops].reverse()) {
    if (record.op === "set") {
      const now = valueAt(value, record.path);
      if (now === undefined) continue;
      if (!deepEqual(now, record.applied)) {
        notes.push(`${record.path.join(".")}: current value differs from what the installer wrote; left untouched`);
        continue;
      }
      if (record.previous === undefined) {
        removeAt(value, record.path);
      } else {
        setValueAt(value, record.path, record.previous);
      }
    } else {
      const entries = Array.isArray(record.applied) ? record.applied : [];
      for (const entry of entries) {
        const list = valueAt(value, record.path);
        if (!Array.isArray(list)) continue;
        const index = list.findIndex((item) => deepEqual(item, entry));
        if (index === -1) continue;
        list.splice(index, 1);
      }
    }
  }
  return notes;
}

/** Removes path prefixes the installer created when they are left empty, newest first. */
function pruneCreatedParents(value: Record<string, unknown>, parents: readonly (readonly string[])[]): void {
  for (const parent of [...parents].reverse()) {
    const current = valueAt(value, parent);
    if (isPlainObject(current) && Object.keys(current).length === 0) removeAt(value, parent);
  }
}

function setValueAt(value: Record<string, unknown>, path: readonly string[], replacement: unknown): void {
  const parent = valueAt(value, path.slice(0, -1));
  if (isPlainObject(parent)) parent[path[path.length - 1] as string] = replacement;
}

function tomlOpHolds(text: string, op: ConfigOp): boolean {
  const value = parseToml(text) as Record<string, unknown>;
  const current = valueAt(value, op.path);
  if (op.op === "set") return deepEqual(current, op.value);
  return Array.isArray(current) && (op.entries ?? []).every((entry) => current.some((item) => deepEqual(item, entry)));
}

/** The TOML codec: ops on a parsed value, serialized lossily (comments drop on rewrite). */
export const tomlCodec: FormatCodec = {
  format: "toml",
  load: loadToml,
  apply: (text, edit): AppliedText => {
    if (edit.format !== "toml") throw new Error(`toml codec cannot apply a ${edit.format} edit`);
    const result = applyTomlOps(parseToml(text) as Record<string, unknown>, edit.ops);
    return { text: serializeToml(result.value), recorded: result.recorded, createdParents: result.createdParents };
  },
  verify: (text, edit, op) => {
    if (edit.format !== "toml") throw new Error(`toml codec cannot verify a ${edit.format} edit`);
    const ops = op === undefined ? edit.ops : [op];
    return ops.every((candidate) => tomlOpHolds(text, candidate));
  },
  revert: (text, recorded) => {
    const value = parseToml(text) as Record<string, unknown>;
    const notes = revertTomlOps(value, recorded.ops);
    pruneCreatedParents(value, recorded.createdParents ?? []);
    return { text: serializeToml(value), notes };
  },
  isEffectivelyEmpty: (text) => Object.keys(parseToml(text) as Record<string, unknown>).length === 0,
};
