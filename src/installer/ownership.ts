import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isPlainObject } from "../core/object";
import { recordPathFor, recordReadPath } from "./record";
import { pruneEmptyDir } from "./revert";
import type { InstallerInput, RecordedFile, Scope } from "./types";

type ClaimedFile = Pick<RecordedFile, "file" | "format" | "shared">;

/**
 * True when a ref's final `@` segment is a version spec — it starts with a digit
 * (`name@<version>`, `npm:name@<version>`) — and not an npm scope
 * (`@scope/name`, whose only `@` leads the string) or a dist-tag (`name@canary`).
 */
function hasVersionSuffix(ref: string): boolean {
  const at = ref.lastIndexOf("@");
  return at > 0 && /^[0-9]/.test(ref.slice(at + 1));
}

function stripVersionSuffix(ref: string): string {
  const at = ref.lastIndexOf("@");
  return hasVersionSuffix(ref) ? ref.slice(0, at) : ref;
}

/**
 * Package-ref identity, the one comparison for "is this entry our package":
 * two refs are the same package when they are equal after stripping a trailing
 * `@version` suffix, so a pinned ref (`deepseek-web-retrieval@<version>`,
 * `npm:deepseek-web-retrieval@<version>`) still matches its lineage
 * (`deepseek-web-retrieval`). Forks, dist-tags, and lookalike names compare
 * unequal. Everywhere a recorded or configured ref is matched against this
 * install's ref — orphan detection, upgrade detection — goes through this
 * helper instead of exact string equality.
 */
export function samePackageName(a: string, b: string): boolean {
  return stripVersionSuffix(a) === stripVersionSuffix(b);
}

/**
 * A lineage-membership predicate over an excused/own ref set: the candidate
 * matches when it is the same package as any listed ref (version suffixes
 * stripped via samePackageName — a pinned or hand-edited ref still matches its
 * lineage). Both host modules build their set (previous init's tracked entries
 * plus this run's ref) and ask the same two questions with this one predicate.
 */
export function lineageMatcher(refs: readonly string[]): (candidate: string) => boolean {
  return (candidate: string) => refs.some((ref) => samePackageName(ref, candidate));
}

/**
 * The `--pin` rule: append the running CLI's version to the ref unless its
 * final `@` segment already is a version (`name` → `name@<version>`; a ref
 * already ending in a version keeps it).
 */
export function pinPackageRef(ref: string, version: string): string {
  return hasVersionSuffix(ref) ? ref : `${ref}@${version}`;
}

interface FileOwner {
  readonly recordPath: string;
  readonly scope: Scope;
  readonly cwd: string;
}

/** Resolve existing symlinks, including the parents of a file not created yet. */
export function canonicalPath(file: string): string {
  const absolute = resolve(file);
  if (existsSync(absolute)) return realpathSync(absolute);
  return join(canonicalPath(dirname(absolute)), basename(absolute));
}

function ownerOf(input: InstallerInput): FileOwner {
  return { recordPath: canonicalPath(recordPathFor(input)), scope: input.scope, cwd: canonicalPath(input.cwd) };
}

/**
 * Put shared config claims beside the actual config, so another cwd or
 * XDG_CONFIG_HOME cannot hide them. Project-local configs need no sidecars.
 * The sidecar contains only the install record's location, never config values.
 */
function claimPaths(input: InstallerInput, files: readonly ClaimedFile[]): string[] {
  return [
    ...new Set(
      files
        .filter((file) => file.format !== "rules")
        .map((file) => {
          const target = canonicalPath(file.file);
          return join(dirname(target), `.${basename(target)}.deepseek-web-retrieval.${input.host}.owner.json`);
        }),
    ),
  ];
}

function readOwner(file: string): FileOwner | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      isPlainObject(value) &&
      typeof value.recordPath === "string" &&
      typeof value.cwd === "string" &&
      (value.scope === "project" || value.scope === "global")
    ) {
      return { recordPath: value.recordPath, cwd: value.cwd, scope: value.scope };
    }
  } catch {
    // An unreadable claim must not permit another install to take the file.
  }
  throw new Error(`Cannot read config ownership in ${file}; repair the ownership record before retrying.`);
}

function assertOwner(input: InstallerInput, claim: string): void {
  const owner = readOwner(claim);
  if (owner === undefined || owner.recordPath === ownerOf(input).recordPath) return;
  // A win32 sidecar written before the config home moved to %APPDATA% names the
  // legacy record location; when that is where this input's record is read
  // from (see recordReadPath), it still identifies this same install lineage.
  if (owner.recordPath === canonicalPath(recordReadPath(input))) return;
  throw new Error(
    `A ${input.host} install is already recorded at the ${owner.scope} scope (${owner.recordPath}) and claims the same config file. ` +
      `Uninstall it first: deepseek-web-retrieval uninstall --host ${input.host} --scope ${owner.scope} --cwd ${JSON.stringify(owner.cwd)}. ` +
      "Two install records must not edit one file.",
  );
}

/** Read-only check used by planning, apply and uninstall, across all project roots. */
export function assertFileOwnership(input: InstallerInput, files: readonly ClaimedFile[]): void {
  for (const claim of claimPaths(input, files)) assertOwner(input, claim);
}

/** Include the new metadata write in the plan preview. */
export function fileOwnershipNotes(input: InstallerInput, files: readonly ClaimedFile[]): string[] {
  return claimPaths(
    input,
    files.filter((file) => file.shared),
  ).map(
    (claim) =>
      `Shared config ownership is recorded in ${claim}; uninstall releases it. Keep this local metadata with the config.`,
  );
}

/** Acquire before config writes; wx prevents two different installs taking an unclaimed file. */
export function acquireFileOwnership(input: InstallerInput, files: readonly ClaimedFile[]): () => void {
  const acquired: string[] = [];
  const owner = ownerOf(input);
  const releaseNew = () => {
    for (const claim of acquired.reverse()) releaseClaim(input, claim);
  };
  try {
    for (const claim of claimPaths(
      input,
      files.filter((file) => file.shared),
    )) {
      assertOwner(input, claim);
      mkdirSync(dirname(claim), { recursive: true });
      try {
        writeFileSync(claim, `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
        acquired.push(claim);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        assertOwner(input, claim);
      }
    }
    return releaseNew;
  } catch (error) {
    releaseNew();
    throw error;
  }
}

function releaseClaim(input: InstallerInput, claim: string): void {
  const owner = readOwner(claim);
  if (owner === undefined) return;
  assertOwner(input, claim);
  rmSync(claim);
  pruneEmptyDir(dirname(claim));
}

/** Release only after successful uninstall or after reverting a whole-file orphan. */
export function releaseFileOwnership(input: InstallerInput, files: readonly ClaimedFile[]): void {
  for (const claim of claimPaths(input, files)) releaseClaim(input, claim);
}
