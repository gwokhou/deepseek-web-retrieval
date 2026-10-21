import { codecFor } from "./formats";
import { assertFileOwnership, releaseFileOwnership } from "./ownership";
import { stateDir } from "./paths";
import { pruneEmptyDir, revertRecordedFile } from "./revert";
import { claimedByOtherScope, deleteRecord, readRecord } from "./state";
import type { InstallerInput } from "./types";

/**
 * Reverses exactly what the plan applied: overwritten values restore their
 * snapshots (only when the current value still matches what the installer
 * wrote — user edits win), merged arrays lose only the installer's entries,
 * rules blocks are removed, and files the installer created are deleted.
 */
export function uninstall(input: InstallerInput): string[] {
  const record = readRecord(input);
  if (record === undefined) {
    throw new Error(`No ${input.host} install is recorded for the ${input.scope} scope.`);
  }
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
  deleteRecord(input);
  releaseFileOwnership(input, record.files);
  pruneEmptyDir(stateDir(input, input.scope));
  lines.push(`removed install record (${input.host}, ${input.scope})`);
  return lines;
}
