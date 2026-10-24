import { codecFor } from "./formats";
import { withOperationLock } from "./operation-lock";
import { assertFileOwnership, releaseFileOwnership } from "./ownership";
import { recordDir } from "./paths";
import { claimedByOtherScope, deleteRecord, readRecord, recordPathFor } from "./record";
import { pruneEmptyDir, revertRecordedFile } from "./revert";
import type { InstallerInput, InstallRecord } from "./types";

/**
 * Reverses exactly what the plan applied: overwritten values restore their
 * snapshots (only when the current value still matches what the installer
 * wrote — user edits win), merged arrays lose only the installer's entries,
 * rules blocks are removed, and files the installer created are deleted.
 */
export function uninstall(input: InstallerInput): string[] {
  return withOperationLock([recordPathFor(input)], () => {
    const record = readRecord(input);
    if (record === undefined) {
      throw new Error(`No ${input.host} install is recorded for the ${input.scope} scope.`);
    }
    return withOperationLock(
      record.files.map((file) => file.file),
      () => uninstallLocked(input, record),
    );
  });
}

function uninstallLocked(input: InstallerInput, record: InstallRecord): string[] {
  assertFileOwnership(input, record.files);
  const other = input.scope === "global" ? "project" : "global";
  const overlap = claimedByOtherScope(
    input,
    record.files.map((file) => file.file),
  );
  if (overlap.length > 0) {
    throw new Error(
      `A ${input.host} install is also recorded at the ${other} scope and claims the same file(s): ${overlap.join(", ")}. ` +
        `Uninstall the ${other}-scope install first so this rollback cannot clobber its entries.`,
    );
  }
  const lines: string[] = [];
  // Validate all rules before reverting any file, retaining the record on refusal.
  for (const file of record.files) {
    if (file.format !== "rules") continue;
    const loaded = codecFor("rules", record.host).load(file.file);
    if (loaded.parseError) throw new Error(`${file.file}: ${loaded.parseError}`);
  }
  for (const file of [...record.files].reverse()) {
    lines.push(...revertRecordedFile(file, record.host, { label: "", whole: true }));
  }
  // Release claims before deleting the record: releaseClaim re-asserts lineage
  // through recordReadPath, whose legacy win32 fallback needs the record file
  // to still exist on disk.
  releaseFileOwnership(input, record.files);
  deleteRecord(input);
  pruneEmptyDir(recordDir(input, input.scope));
  lines.push(`removed install record (${input.host}, ${input.scope})`);
  return lines;
}
