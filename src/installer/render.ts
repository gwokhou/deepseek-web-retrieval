import type { InstallPlan } from "./types";

/** Renders a plan for review: files, ops with old→new previews, and notes. */
export function renderPlan(plan: InstallPlan): string {
  const lines: string[] = [];
  lines.push(`Install plan: ${plan.host} (${plan.scope} scope)`);
  lines.push(`Tiers: search=${plan.tiers.search}, fetch=${plan.tiers.fetch}`);
  lines.push("");
  lines.push("Files:");
  for (const edit of plan.edits) {
    lines.push(`  ${edit.file}`);
    if (edit.format === "rules") {
      lines.push("    upsert marked rules block");
      continue;
    }
    for (const op of edit.ops) {
      if (op.op === "set") {
        const was = op.previous === undefined ? "(absent)" : preview(op.previous);
        lines.push(`    set ${op.path.join(".")} = ${preview(op.value)} (was ${was})`);
      } else {
        const count = (op.entries ?? []).length;
        const kept = op.existingCount !== undefined ? ` (${op.existingCount} existing kept)` : "";
        lines.push(`    append ${count} entr${count === 1 ? "y" : "ies"} to ${op.path.join(".")}${kept}`);
        for (const entry of op.entries ?? []) lines.push(`      + ${preview(entry)}`);
      }
    }
  }
  if (plan.reverts && plan.reverts.length > 0) {
    lines.push("");
    lines.push("Reverts (artifacts from the previous init that this plan no longer wants):");
    for (const revert of plan.reverts) {
      lines.push(`  ${revert.file}`);
      if (revert.format === "rules") {
        lines.push("    remove rules block");
        continue;
      }
      for (const op of revert.ops) {
        if (op.op === "set") {
          lines.push(
            op.previous === undefined
              ? `    remove ${op.path.join(".")} (was not set before this install)`
              : `    restore ${op.path.join(".")} = ${preview(op.previous)}`,
          );
        } else {
          const count = Array.isArray(op.applied) ? op.applied.length : 0;
          lines.push(`    remove ${count} appended entr${count === 1 ? "y" : "ies"} from ${op.path.join(".")}`);
        }
      }
    }
  }
  if (plan.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of plan.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}
