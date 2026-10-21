import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { codecFor, writeConfig } from "./formats";
import { deepEqual, valueAt } from "./formats/value";
import { withOperationLock } from "./operation-lock";
import { acquireFileOwnership, assertFileOwnership, releaseFileOwnership } from "./ownership";
import { pruneEmptyDir, revertRecordedFile } from "./revert";
import { deleteRecord, readRecord, statePathFor, writeRecord } from "./state";
import type { ConfigOp, FileEdit, InstallerInput, InstallPlan, InstallRecord, RecordedFile } from "./types";

export interface ApplyResult {
  readonly lines: string[];
  readonly ok: boolean;
}

/** A failed apply tells callers whether retrying is safe or recovery is still needed. */
export class ApplyError extends Error {
  constructor(
    readonly status: "rolled_back" | "recovery_required",
    message: string,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "ApplyError";
  }
}

interface PreparedEdit {
  readonly edit: FileEdit;
  readonly recorded: RecordedFile;
  readonly write: () => void;
}

/**
 * Applies a plan: refuses first when the config drifted since the plan was
 * rendered (the plan and the record must describe one plan-time snapshot —
 * ADR-0001), prepares every edit in memory (a malformed existing config fails
 * before any file is written), writes the files, reverts artifacts orphaned by
 * a tier change, verifies the result, then records surgical-undo state. Write
 * and verification failures restore touched files and the previous record.
 * Incomplete recovery is reported explicitly and keeps new ownership claims
 * so another install cannot adopt partially applied configuration.
 */
export function applyPlan(plan: InstallPlan, input: InstallerInput): ApplyResult {
  if (plan.errors.length > 0) {
    throw new Error(`refusing to apply a plan with errors: ${plan.errors.map((error) => error.message).join("; ")}`);
  }
  return withOperationLock([statePathFor(input)], () =>
    withOperationLock(
      [...plan.edits, ...(plan.reverts ?? [])].map((file) => file.file),
      () => applyLocked(plan, input),
    ),
  );
}

function applyLocked(plan: InstallPlan, input: InstallerInput): ApplyResult {
  const touched = [...plan.edits, ...(plan.reverts ?? [])];
  assertFileOwnership(input, touched);
  assertNoDrift(plan);
  const previous = readRecord(input);
  if (Object.hasOwn(plan, "previousRecord") && !deepEqual(previous, plan.previousRecord)) {
    throw new Error(
      "The install record changed since the plan was rendered. Re-run init to plan against the current install.",
    );
  }

  const prepared = plan.edits.map((edit) => prepareEdit(edit, plan.host));
  const snapshots = snapshotTouchedFiles(plan);
  const files: RecordedFile[] = [];
  const lines: string[] = [];
  const releaseNewClaims = acquireFileOwnership(input, touched);
  try {
    for (const item of prepared) {
      item.write();
      const desired = item.edit.format === "rules" ? [] : item.edit.ops;
      files.push(
        mergeRecorded(
          item.recorded,
          previous?.files.find((file) => file.file === item.edit.file),
          desired,
        ),
      );
      lines.push(`${item.recorded.created ? "created" : "updated"} ${item.edit.file}`);
    }
    if ((plan.reverts ?? []).length > 0) {
      lines.push(...applyReverts(plan));
    }
    const verification = verifyEdits(plan.edits, plan.host);
    if (!verification.ok) {
      throw new Error(
        `verification failed: ${verification.lines.filter((line) => line.startsWith("FAIL")).join("; ")}`,
      );
    }
    lines.push(...verification.lines);
    const record: InstallRecord = {
      version: 1,
      host: plan.host,
      scope: plan.scope,
      tiers: plan.tiers,
      createdAt: new Date().toISOString(),
      files,
    };
    writeRecord(input, record);
  } catch (error) {
    const rollback = rollbackApply(input, previous, snapshots);
    if (rollback.complete) {
      try {
        releaseNewClaims();
      } catch (releaseError) {
        rollback.complete = false;
        rollback.report.push(`could not release new config ownership: ${errorMessage(releaseError)}`);
      }
    }
    const status = rollback.complete ? "rolled_back" : "recovery_required";
    const outcome = rollback.complete ? "was rolled back" : "recovery is required";
    const guidance = rollback.complete
      ? "Fix the cause and re-run init."
      : "Restore the reported files and ownership metadata before re-running init.";
    throw new ApplyError(
      status,
      `apply failed and ${outcome} (${errorMessage(error)}). Rollback report: ${rollback.report.join("; ")}. ${guidance}`,
      error,
    );
  }
  try {
    releaseFileOwnership(
      input,
      (previous?.files ?? []).filter((file) => !files.some((current) => current.file === file.file)),
    );
  } catch (error) {
    throw new ApplyError(
      "recovery_required",
      `apply was written and verified, but old config ownership could not be released (${errorMessage(error)}). ` +
        "The new install record is retained; repair the reported ownership metadata before re-running init.",
      error,
    );
  }
  return { lines, ok: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ADR-0001: every set op the plan previewed must still find the value it showed.
 * A file that changed between plan review and apply refuses the whole apply with
 * re-run guidance, so an interim user edit is never silently overwritten and the
 * record's snapshots stay provably equal to what the user approved.
 */
function assertNoDrift(plan: InstallPlan): void {
  const drifts: string[] = [];
  for (const edit of plan.edits) {
    if (edit.format === "rules") continue;
    const loaded = codecFor(edit.format, plan.host).load(edit.file);
    if (loaded.parseError) {
      drifts.push(`${edit.file} no longer parses (${loaded.parseError})`);
      continue;
    }
    for (const op of edit.ops) {
      if (op.op !== "set") continue;
      const current = valueAt(loaded.value, op.path);
      if (!deepEqual(current, op.previous)) {
        drifts.push(`${edit.file}: ${op.path.join(".")} changed since the plan was rendered`);
      }
    }
  }
  if (drifts.length > 0) {
    throw new Error(
      `refusing to apply — the config changed since the plan was rendered: ${drifts.join("; ")}. ` +
        "Re-run init to re-plan against the current files.",
    );
  }
}

/** The on-disk state of one file before the apply mutated it. */
interface FileSnapshot {
  readonly exists: boolean;
  readonly text: string;
}

/** Captures the exact bytes of every file the apply may touch, edits and reverts. */
function snapshotTouchedFiles(plan: InstallPlan): Map<string, FileSnapshot> {
  const snapshots = new Map<string, FileSnapshot>();
  const touched = [...plan.edits.map((edit) => edit.file), ...(plan.reverts ?? []).map((revert) => revert.file)];
  for (const file of new Set(touched)) {
    snapshots.set(
      file,
      existsSync(file) ? { exists: true, text: readFileSync(file, "utf8") } : { exists: false, text: "" },
    );
  }
  return snapshots;
}

/**
 * Undoes a partially applied plan: every touched file returns to its pre-apply
 * bytes (a file the apply created is deleted and its directory pruned) and the
 * previous record is restored, so the disk and the install state again
 * describe the world the user approved — the original snapshots a later re-init
 * would inherit are what rollback writes back, not the failed run's values.
 * Restore failures are reported in the thrown error, never thrown over the
 * original cause, which stays the headline.
 */
function rollbackApply(
  input: InstallerInput,
  previous: InstallRecord | undefined,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): { complete: boolean; report: string[] } {
  const report: string[] = [];
  let complete = true;
  for (const [file, snapshot] of [...snapshots.entries()].reverse()) {
    try {
      if (snapshot.exists) {
        if (existsSync(file) && readFileSync(file, "utf8") === snapshot.text) continue;
        writeConfig(file, snapshot.text);
        if (readFileSync(file, "utf8") !== snapshot.text) throw new Error("restored contents differ from the snapshot");
      } else {
        if (!existsSync(file)) continue;
        rmSync(file);
        if (existsSync(file)) throw new Error("created file still exists after removal");
        pruneEmptyDir(dirname(file));
      }
      report.push(`restored ${file}`);
    } catch (restoreError) {
      complete = false;
      report.push(`could not restore ${file}: ${errorMessage(restoreError)}`);
    }
  }
  try {
    if (previous !== undefined) writeRecord(input, previous);
    else deleteRecord(input);
    if (previous === undefined ? existsSync(statePathFor(input)) : !deepEqual(readRecord(input), previous)) {
      throw new Error("restored install record differs from its previous state");
    }
  } catch (restoreError) {
    complete = false;
    report.push(`could not restore the install record: ${errorMessage(restoreError)}`);
  }
  return { complete, report };
}

function prepareEdit(edit: FileEdit, host: InstallPlan["host"]): PreparedEdit {
  const codec = codecFor(edit.format, host);
  const loaded = codec.load(edit.file);
  if (loaded.parseError) {
    throw new Error(`${edit.file} does not parse: ${loaded.parseError}`);
  }
  const applied = codec.apply(loaded.text, edit);
  const recorded: RecordedFile =
    edit.format === "rules"
      ? { file: edit.file, format: "rules", created: !loaded.exists, ops: [], blockApplied: edit.block }
      : {
          file: edit.file,
          format: edit.format,
          created: !loaded.exists,
          ...(edit.shared ? { shared: true as const } : {}),
          ops: applied.recorded,
          createdParents: applied.createdParents,
        };
  return {
    edit,
    recorded,
    write: () => writeConfig(edit.file, applied.text),
  };
}

/**
 * Reverts artifacts from a superseded init: shown in the plan, undone here, gone
 * from the record. Files the new plan still claims revert partially (never
 * deleted); files it no longer wants revert wholly and are deleted when the
 * installer created them and they are left empty.
 */
function applyReverts(plan: InstallPlan): string[] {
  const lines: string[] = [];
  for (const revert of plan.reverts ?? []) {
    const whole = !plan.edits.some((edit) => edit.file === revert.file);
    lines.push(...revertRecordedFile(revert, plan.host, { label: " (previous init)", whole }));
  }
  return lines;
}

/**
 * Merges a re-apply with the record it supersedes: a set op whose previous value is
 * what an earlier run applied inherits that run's snapshot, appended arrays
 * accumulate only the entries the new plan still wants (entries it dropped were
 * reverted as orphans during apply, so claiming them would orphan the record),
 * and the created flag keeps the first install's truth.
 */
function mergeRecorded(
  current: RecordedFile,
  before: RecordedFile | undefined,
  desired: readonly ConfigOp[],
): RecordedFile {
  if (before === undefined) return current;
  const ops = current.ops.map((op) => {
    const old = before.ops.find(
      (candidate) => candidate.op === op.op && candidate.path.join("\u0000") === op.path.join("\u0000"),
    );
    if (old === undefined) return op;
    if (op.op === "set" && old.op === "set" && deepEqual(op.previous, old.applied)) {
      return { ...op, previous: old.previous };
    }
    if (op.op === "append-array" && old.op === "append-array") {
      const wanted = desired.find(
        (candidate) => candidate.op === "append-array" && candidate.path.join("\u0000") === op.path.join("\u0000"),
      );
      const kept = (Array.isArray(old.applied) ? old.applied : []).filter((entry) =>
        (wanted?.entries ?? []).some((candidate) => deepEqual(candidate, entry)),
      );
      return { ...op, applied: [...kept, ...(Array.isArray(op.applied) ? op.applied : [])] };
    }
    return op;
  });
  return {
    ...current,
    created: before.created,
    ops,
    createdParents: [...(before.createdParents ?? []), ...(current.createdParents ?? [])],
  };
}

function verifyEdits(edits: readonly FileEdit[], host: InstallPlan["host"]): { lines: string[]; ok: boolean } {
  const lines: string[] = [];
  let ok = true;
  for (const edit of edits) {
    if (!existsSync(edit.file)) {
      lines.push(`FAIL ${edit.file} does not exist after apply`);
      ok = false;
      continue;
    }
    const codec = codecFor(edit.format, host);
    const text = readFileSync(edit.file, "utf8");
    if (edit.format === "rules") {
      const good = codec.verify(text, edit);
      lines.push(`${good ? "pass" : "FAIL"} ${edit.file}: rules block ${good ? "present" : "missing"}`);
      ok = ok && good;
      continue;
    }
    for (const op of edit.ops) {
      const good = codec.verify(text, edit, op);
      lines.push(`${good ? "pass" : "FAIL"} ${edit.file}: ${describeOp(op)} ${good ? "holds" : "missing"}`);
      ok = ok && good;
    }
  }
  return { lines, ok };
}

function describeOp(op: ConfigOp): string {
  if (op.op === "set") return `set ${op.path.join(".")}`;
  return `append ${op.path.join(".")}`;
}
