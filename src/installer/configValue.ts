import type { ConfigOp, RecordedOp } from "./types"

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  const aArray = Array.isArray(a)
  const bArray = Array.isArray(b)
  if (aArray !== bArray) return false
  if (aArray && bArray) {
    const x = a as unknown[]
    const y = b as unknown[]
    return x.length === y.length && x.every((item, index) => deepEqual(item, y[index]))
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const xKeys = Object.keys(x)
  const yKeys = Object.keys(y)
  return xKeys.length === yKeys.length && xKeys.every((key) => deepEqual(x[key], y[key]))
}

/** Reads the value at a dotted path from a parsed object, or undefined when absent. */
export function valueAt(value: Record<string, unknown>, path: readonly string[]): unknown {
  let node: unknown = value
  for (const key of path) {
    if (Array.isArray(node)) {
      const index = Number(key)
      node = Number.isInteger(index) ? node[index] : undefined
    } else if (isPlainObject(node)) {
      node = node[key]
    } else {
      return undefined
    }
    if (node === undefined) return undefined
  }
  return node
}

export function removeAt(value: Record<string, unknown>, path: readonly string[]): void {
  const parent = valueAt(value, path.slice(0, -1))
  if (isPlainObject(parent)) delete parent[path[path.length - 1] as string]
}

function setValueAt(value: Record<string, unknown>, path: readonly string[], replacement: unknown): void {
  const parent = valueAt(value, path.slice(0, -1))
  if (isPlainObject(parent)) parent[path[path.length - 1] as string] = replacement
}

/**
 * Shared append-array step for both config formats: rejects a non-array at the
 * path and dedupes entries already present, so applied records list only what
 * was actually appended.
 */
export function appendEntries(existing: unknown, entries: readonly unknown[], path: readonly string[]): { readonly list: readonly unknown[]; readonly appended: readonly unknown[] } {
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new Error(`cannot append to ${path.join(".")}: it is a ${typeof existing}, not an array`)
  }
  const list = Array.isArray(existing) ? existing : []
  const appended = entries.filter((entry) => !list.some((item) => deepEqual(item, entry)))
  return { list, appended }
}

/**
 * Applies ops to a parsed TOML value, returning the mutated value plus one record
 * per op with the previous value for surgical undo, and the path prefixes created.
 */
export function applyTomlOps(value: Record<string, unknown>, ops: readonly ConfigOp[]): { value: Record<string, unknown>; recorded: RecordedOp[]; createdParents: (readonly string[])[] } {
  const target: Record<string, unknown> = structuredClone(value)
  const recorded: RecordedOp[] = []
  const createdParents: (readonly string[])[] = []
  for (const op of ops) {
    const parent = navigate(target, op.path, createdParents)
    const key = op.path[op.path.length - 1]
    if (op.op === "set") {
      const previous = Object.prototype.hasOwnProperty.call(parent, key) ? parent[key] : undefined
      parent[key] = structuredClone(op.value)
      recorded.push({ op: "set", path: op.path, applied: structuredClone(op.value), previous })
      continue
    }
    const existing = parent[key]
    if (existing === undefined) createdParents.push(op.path)
    const { list, appended } = appendEntries(existing, op.entries ?? [], op.path)
    parent[key] = [...list, ...appended.map((entry) => structuredClone(entry))]
    recorded.push({ op: "append-array", path: op.path, applied: appended, previous: undefined })
  }
  return { value: target, recorded, createdParents }
}

function navigate(root: Record<string, unknown>, path: readonly string[], created: (readonly string[])[]): Record<string, unknown> {
  let node = root
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const key = path[depth] as string
    const next: unknown = node[key]
    if (next === undefined) {
      node[key] = {}
      created.push(path.slice(0, depth + 1))
    } else if (!isPlainObject(next)) {
      throw new Error(
        `cannot descend into ${path.slice(0, depth + 1).join(".")}: it is ${Array.isArray(next) ? "an array" : `a ${typeof next}`}, not a table`,
      )
    }
    node = node[key] as Record<string, unknown>
  }
  return node
}

/** Surgical undo on a parsed TOML object; user edits made after install win. */
export function revertTomlOps(value: Record<string, unknown>, ops: readonly RecordedOp[]): string[] {
  const notes: string[] = []
  for (const record of [...ops].reverse()) {
    if (record.op === "set") {
      const now = valueAt(value, record.path)
      if (now === undefined) continue
      if (!deepEqual(now, record.applied)) {
        notes.push(`${record.path.join(".")}: current value differs from what the installer wrote; left untouched`)
        continue
      }
      if (record.previous === undefined) {
        removeAt(value, record.path)
      } else {
        setValueAt(value, record.path, record.previous)
      }
    } else {
      const entries = Array.isArray(record.applied) ? record.applied : []
      for (const entry of entries) {
        const list = valueAt(value, record.path)
        if (!Array.isArray(list)) continue
        const index = list.findIndex((item) => deepEqual(item, entry))
        if (index === -1) continue
        list.splice(index, 1)
      }
    }
  }
  return notes
}

/** Removes path prefixes the installer created when they are left empty, newest first. */
export function pruneCreatedParents(value: Record<string, unknown>, parents: readonly (readonly string[])[]): void {
  for (const parent of [...parents].reverse()) {
    const current = valueAt(value, parent)
    if (isPlainObject(current) && Object.keys(current).length === 0) removeAt(value, parent)
  }
}
