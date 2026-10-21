/** Shared plain-object guard: core modules and the installer's value helpers agree on one. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
