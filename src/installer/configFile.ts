import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { applyEdits, modify, parse, type JSONPath } from "jsonc-parser/lib/esm/main.js"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { parseJsonc } from "../core/jsonc"
import { appendEntries, deepEqual, isPlainObject, valueAt } from "./configValue"
import type { ConfigOp, RecordedOp } from "./types"

export type ConfigFormat = "json" | "toml"

const JSON_FORMATTING = { insertSpaces: true, tabSize: 2, insertFinalNewline: false } as const

export interface LoadedConfig {
  readonly exists: boolean
  readonly text: string
  readonly value: Record<string, unknown>
  /** True when serializing the parsed value would drop comments (TOML only; JSON edits preserve them). */
  readonly lossy: boolean
  readonly parseError?: string
}

/** Reads and parses a config file; a missing or unparsable file starts from `{}`. */
export function loadConfig(file: string, format: ConfigFormat): LoadedConfig {
  if (!existsSync(file)) return { exists: false, text: "", value: {}, lossy: false }
  const text = readFileSync(file, "utf8")
  try {
    const value = (format === "json" ? parseJsonc(text) : parseToml(text)) as Record<string, unknown>
    return { exists: true, text, value, lossy: format === "toml" && hasTomlComment(text) }
  } catch (error) {
    const parseError = error instanceof Error ? error.message : String(error)
    return { exists: true, text, value: {}, lossy: false, parseError }
  }
}

/**
 * String-aware TOML comment detection: any `#` outside basic ("") or literal ('')
 * strings counts, including trailing comments like `key = "x" # note`.
 */
export function hasTomlComment(text: string): boolean {
  let inBasic = false
  let inLiteral = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string
    if (inBasic) {
      if (ch === "\\") i += 1
      else if (ch === '"') inBasic = false
      continue
    }
    if (inLiteral) {
      if (ch === "'") inLiteral = false
      continue
    }
    if (ch === '"') inBasic = true
    else if (ch === "'") inLiteral = true
    else if (ch === "#") return true
  }
  return false
}

export function serializeConfig(value: Record<string, unknown>, format: ConfigFormat): string {
  return format === "json" ? `${JSON.stringify(value, null, 2)}\n` : `${stringifyToml(value)}\n`
}

export function writeConfig(file: string, serialized: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, serialized)
}

/** Reads the value at a dotted path from JSON text, or undefined when absent. */
export function jsonGet(text: string, path: readonly string[]): unknown {
  const root = parse(text, undefined, { allowTrailingComma: true }) as Record<string, unknown>
  return valueAt(root, path)
}

export interface JsonOpsResult {
  readonly text: string
  readonly recorded: RecordedOp[]
  /** Path prefixes the ops had to create; uninstall removes them when left empty. */
  readonly createdParents: readonly (readonly string[])[]
}

/**
 * Applies ops to JSONC text with jsonc-parser's comment-preserving edits.
 * Ops are idempotent: `set` writes the value, `append-array` skips deep-equal entries.
 * Each op is recorded with its previous value (or the entries actually appended)
 * for surgical undo.
 */
export function applyJsonOps(text: string, ops: readonly ConfigOp[]): JsonOpsResult {
  let current = text.trim().length > 0 ? text : "{}"
  const recorded: RecordedOp[] = []
  const createdParents: (readonly string[])[] = []
  for (const op of ops) {
    const path = op.path as unknown as JSONPath
    if (op.op === "set") {
      current = ensureParents(current, op.path, createdParents)
      const previous = jsonGet(current, op.path)
      current = edit(current, path, op.value)
      recorded.push({ op: "set", path: op.path, applied: structuredClone(op.value), previous })
      continue
    }
    current = ensureParents(current, op.path, createdParents)
    const existing = jsonGet(current, op.path)
    const { list, appended } = appendEntries(existing, op.entries ?? [], op.path)
    if (existing === undefined) {
      current = edit(current, path, [])
      createdParents.push(op.path)
    }
    let index = list.length
    for (const entry of appended) {
      current = edit(current, [...path, index] as unknown as JSONPath, entry)
      index += 1
    }
    recorded.push({ op: "append-array", path: op.path, applied: appended, previous: undefined })
  }
  return { text: current, recorded, createdParents }
}

/** Reverses recorded ops on current JSON text; returns the text plus notes about skipped work. */
export function revertJsonOps(text: string, ops: readonly RecordedOp[], createdParents: readonly (readonly string[])[]): { text: string; notes: string[] } {
  let current = text
  const notes: string[] = []
  for (const record of [...ops].reverse()) {
    const path = record.path as unknown as JSONPath
    if (record.op === "set") {
      const now = jsonGet(current, record.path)
      if (now === undefined) continue
      if (!deepEqual(now, record.applied)) {
        notes.push(`${record.path.join(".")}: current value differs from what the installer wrote; left untouched`)
        continue
      }
      current = record.previous === undefined ? edit(current, path, void 0) : edit(current, path, record.previous)
    } else {
      const entries = Array.isArray(record.applied) ? record.applied : []
      for (const entry of [...entries].reverse()) {
        const list = jsonGet(current, record.path)
        if (!Array.isArray(list)) continue
        const index = list.findIndex((item) => deepEqual(item, entry))
        if (index === -1) continue
        current = edit(current, [...path, index] as unknown as JSONPath, void 0)
      }
    }
  }
  for (const parent of [...createdParents].reverse()) {
    const value = jsonGet(current, parent)
    const isEmptyObject = isPlainObject(value) && Object.keys(value).length === 0
    const isEmptyArray = Array.isArray(value) && value.length === 0
    if (isEmptyObject || isEmptyArray) {
      current = edit(current, parent as unknown as JSONPath, void 0)
    }
  }
  return { text: current, notes }
}

function edit(text: string, path: JSONPath, value: unknown): string {
  return applyEdits(text, modify(text, path, value as never, { formattingOptions: JSON_FORMATTING }))
}

/** Creates missing path prefixes as objects (or arrays when the next segment is an index). */
function ensureParents(text: string, path: readonly string[], created: (readonly string[])[]): string {
  let current = text
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const prefix = path.slice(0, depth + 1)
    const existing = jsonGet(current, prefix)
    if (existing !== undefined && typeof existing !== "object") {
      throw new Error(`cannot descend into ${prefix.join(".")}: it is a ${typeof existing}, not an object`)
    }
    if (existing !== undefined) continue
    const nextSegmentIsIndex = Number.isInteger(Number(path[depth + 1]))
    const placeholder = nextSegmentIsIndex ? [] : {}
    current = edit(current, prefix as unknown as JSONPath, placeholder)
    created.push(prefix)
  }
  return current
}
