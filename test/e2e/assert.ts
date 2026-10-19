export class ScenarioError extends Error {}

/** Fails the scenario with a clear message; `detail` carries host output when available. */
export function check(condition: boolean, message: string, detail?: string): asserts condition {
  if (!condition) throw new ScenarioError(detail ? `${message}\n${detail}` : message)
}

/** Requires a binary on PATH and returns its absolute path. */
export function requireWhich(bin: string, hint: string): string {
  const path = Bun.which(bin)
  if (!path) throw new ScenarioError(`${bin} is not on PATH\n${hint}`)
  return path
}

/** Requires a non-empty environment variable and returns its trimmed value. */
export function requireEnv(name: string, hint: string): string {
  const value = (process.env[name] ?? "").trim()
  if (!value) throw new ScenarioError(`${name} is not set\n${hint}`)
  return value
}

/** A short excerpt of host output for failure messages. */
export function excerpt(text: string, maxChars = 600): string {
  const trimmed = text.trim()
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`
}
