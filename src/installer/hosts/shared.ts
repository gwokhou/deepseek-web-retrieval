import { spawnSync } from "node:child_process";
import { BOTH_CAPABILITIES_OFF, competitorSteeringNote, findCompetitorSteering } from "../detect";
import { codecFor, type LoadedConfig } from "../formats";
import type { HostPaths, InstallerInput, PlanError } from "../types";

/** What the shared plan header accumulated: notes and errors so far, and whether to stop. */
export interface PlanHeader {
  readonly notes: string[];
  readonly errors: PlanError[];
  /** True when the caller must return the (empty-edits) plan as-is. */
  readonly abort: boolean;
}

/**
 * The plan header every host planner starts with, so the three steps cannot drift:
 * refuse an unparsable config (aborting), refuse both capabilities off, and surface
 * competitor steering in the rules file. Host-specific checks follow in the module.
 */
export function planHeader(input: InstallerInput, paths: HostPaths, loaded: LoadedConfig, dialect: string): PlanHeader {
  const notes: string[] = [];
  const errors: PlanError[] = [];
  if (loaded.parseError) {
    errors.push({ message: `${paths.config} exists but does not parse as ${dialect}: ${loaded.parseError}` });
    return { notes, errors, abort: true };
  }
  if (input.search === "off" && input.fetch === "off") {
    errors.push({ message: BOTH_CAPABILITIES_OFF });
  }
  const rules = codecFor("rules", input.host).load(paths.rules);
  if (rules.parseError) {
    errors.push({ message: `${paths.rules}: ${rules.parseError}` });
    return { notes, errors, abort: true };
  }
  const steering = findCompetitorSteering(input.host, paths.rules);
  if (steering.length > 0) notes.push(competitorSteeringNote(paths.rules, steering));
  return { notes, errors, abort: false };
}

/**
 * The one subprocess shape the installer runs: `<command> --version`, probed
 * for the version-drift note. A missing binary or unreadable output skips the
 * check with a stderr note and never blocks the plan — honor or report.
 * env is passed explicitly: runtime PATH edits (tests) must reach the lookup.
 * The shell hop is required because npm's global install on Windows provides
 * only a .cmd shim, which spawnSync cannot launch without a shell; the command
 * and args are hardcoded, so it is safe.
 */
export function probeHostVersion(
  command: string,
  parse: (output: string) => string | undefined,
  err: (line: string) => void,
): string | undefined {
  const result = spawnSync(command, ["--version"], { timeout: 5000, encoding: "utf8", env: process.env, shell: true });
  const version = result.status === 0 ? parse(result.stdout ?? "") : undefined;
  if (version === undefined) {
    err(`note: ${command} was not found on PATH or printed no version; the version-drift check was skipped`);
  }
  return version;
}
