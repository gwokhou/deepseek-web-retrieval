import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseJsonc } from "../src/core/jsonc"

/** Integration mechanisms, aligned with the Mechanisms table in docs/integration.md. */
export const MECHANISMS = ["native-provider", "native-override", "plugin", "extension", "mcp", "wrapper"] as const
export type Mechanism = (typeof MECHANISMS)[number]

export type HostStatus = "supported" | "no-adapter-yet"

/** How deterministically a capability can be routed to this project; aligned with docs/research/control-matrix.md. */
export const FORCED_FLAVORS = ["replacement", "exclusion", "de-facto", "none"] as const
export type ForcedFlavor = (typeof FORCED_FLAVORS)[number]

/** Tier availability: "yes", or "n/a" when the tier is structurally unreachable. */
export type TierAvailability = "yes" | "n/a"

export interface CapabilityControl {
  readonly optional: TierAvailability
  readonly preferred: TierAvailability
  readonly forced: ForcedFlavor
  /** Config key or fact that realizes the forced tier; empty when forced is "none". */
  readonly key: string
}

export interface ControlEntry {
  readonly search: CapabilityControl
  readonly fetch: CapabilityControl
}

export interface HostEntry {
  readonly name: string
  readonly display: string
  readonly version: string
  /** SPDX license of the CLI/client code, or null for proprietary hosts. */
  readonly license: string | null
  readonly npm?: string
  readonly nativeSearchProvider: boolean
  readonly nativeFetchOverride: boolean
  /** Ordered integration paths; the first entry is the recommended one. */
  readonly paths: readonly Mechanism[]
  readonly status: HostStatus
  readonly adapter?: string
  readonly guide?: string
  readonly e2eScenario?: string
  /** Control-tier facts for the generated matrix in docs/research/control-matrix.md. */
  readonly control: ControlEntry
}

export interface HostsFile {
  /** Research baseline date for the version locks, YYYY-MM-DD. */
  readonly baseline: string
  readonly hosts: readonly HostEntry[]
}

/** Reads docs/hosts.jsonc, the single source of truth for host facts. */
export function readHosts(repoRoot: string = join(dirname(fileURLToPath(import.meta.url)), "..")): HostsFile {
  const raw = readFileSync(join(repoRoot, "docs", "hosts.jsonc"), "utf8")
  const parsed = parseJsonc(raw) as HostsFile
  if (!Array.isArray(parsed.hosts)) throw new Error("docs/hosts.jsonc is missing its hosts array")
  return parsed
}

export function findHost(hosts: HostsFile, name: string): HostEntry {
  const host = hosts.hosts.find((entry) => entry.name === name)
  if (host === undefined) throw new Error(`host "${name}" is not registered in docs/hosts.jsonc`)
  return host
}
