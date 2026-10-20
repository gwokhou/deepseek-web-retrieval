import { BOTH_CAPABILITIES_OFF, competitorSteeringNote, findCompetitorSteering } from "../detect"
import type { LoadedConfig } from "../formats"
import type { HostPaths, InstallerInput, PlanError } from "../types"

/** What the shared plan header accumulated: notes and errors so far, and whether to stop. */
export interface PlanHeader {
  readonly notes: string[]
  readonly errors: PlanError[]
  /** True when the caller must return the (empty-edits) plan as-is. */
  readonly abort: boolean
}

/**
 * The plan header every host planner starts with, so the three steps cannot drift:
 * refuse an unparsable config (aborting), refuse both capabilities off, and surface
 * competitor steering in the rules file. Host-specific checks follow in the module.
 */
export function planHeader(input: InstallerInput, paths: HostPaths, loaded: LoadedConfig, dialect: string): PlanHeader {
  const notes: string[] = []
  const errors: PlanError[] = []
  if (loaded.parseError) {
    errors.push({ message: `${paths.config} exists but does not parse as ${dialect}: ${loaded.parseError}` })
    return { notes, errors, abort: true }
  }
  if (input.search === "off" && input.fetch === "off") {
    errors.push({ message: BOTH_CAPABILITIES_OFF })
  }
  const steering = findCompetitorSteering(input.host, paths.rules)
  if (steering.length > 0) notes.push(competitorSteeringNote(paths.rules, steering))
  return { notes, errors, abort: false }
}
