import { isPlainObject } from "../../core/object"

export { isPlainObject }

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
