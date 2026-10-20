import { existsSync, readFileSync } from "node:fs"
import { applyEdits, modify, parse, type JSONPath } from "jsonc-parser/lib/esm/main.js"
import { parseJsonc } from "../../core/jsonc"
import type { ConfigOp, RecordedOp } from "../types"
import type { AppliedText, FormatCodec, LoadedConfig } from "./index"
import { appendEntries, deepEqual, isPlainObject, valueAt } from "./value"

const JSON_FORMATTING = { insertSpaces: true, tabSize: 2, insertFinalNewline: false } as const

/** Reads a JSONC config file; a missing file starts empty, an unparsable one carries the error. */
export function loadJson(file: string): LoadedConfig {
  if (!existsSync(file)) return { exists: false, text: "", value: {}, lossy: false }
  const text = readFileSync(file, "utf8")
  try {
    return { exists: true, text, value: parseJsonc(text) as Record<string, unknown>, lossy: false }
  } catch (error) {
    const parseError = error instanceof Error ? error.message : String(error)
    return { exists: true, text, value: {}, lossy: false, parseError }
  }
}

export function serializeJson(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`
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
  let current = text.trim().length > 0 ? text : "{}\n"
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

function jsonOpHolds(text: string, op: ConfigOp): boolean {
  if (op.op === "set") return deepEqual(jsonGet(text, op.path), op.value)
  const list = jsonGet(text, op.path)
  return Array.isArray(list) && (op.entries ?? []).every((entry) => list.some((item) => deepEqual(item, entry)))
}

/** The JSON codec: comment-preserving edits on JSONC text. */
export const jsonCodec: FormatCodec = {
  format: "json",
  load: loadJson,
  apply: (text, edit): AppliedText => {
    if (edit.format !== "json") throw new Error(`json codec cannot apply a ${edit.format} edit`)
    const result = applyJsonOps(text, edit.ops)
    return { text: result.text, recorded: result.recorded, createdParents: result.createdParents }
  },
  verify: (text, edit, op) => {
    if (edit.format !== "json") throw new Error(`json codec cannot verify a ${edit.format} edit`)
    const ops = op === undefined ? edit.ops : [op]
    return ops.every((candidate) => jsonOpHolds(text, candidate))
  },
  revert: (text, recorded) => revertJsonOps(text, recorded.ops, recorded.createdParents ?? []),
  isEffectivelyEmpty: (text) => text.replace(/[{}\s]/g, "").length === 0,
}
