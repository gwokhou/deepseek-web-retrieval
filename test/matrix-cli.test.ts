import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderKnobTable } from "../scripts/render-matrix";
import { CONFIG_KEYS } from "../src/core/config-summary";
import { OPTION_ENV_BY_KEY } from "../src/core/env";

test("matrix --check reports drift repeatedly without rewriting any document", () => {
  const root = mkdtempSync(join(tmpdir(), "dwr-matrix-"));
  try {
    for (const dir of ["scripts", "docs", "src/core"])
      cpSync(join(import.meta.dir, "..", dir), join(root, dir), { recursive: true });
    symlinkSync(join(import.meta.dir, "../node_modules"), join(root, "node_modules"));
    const files = ["docs/integration.md", "docs/research/control-matrix.md", "docs/configuration.md"].map((file) =>
      join(root, file),
    );
    const stale = files.map((file) =>
      readFileSync(file, "utf8").replace(/\| (Host|File \/ OpenCode key) \|/, "| Stale |"),
    );
    files.forEach((file, index) => {
      writeFileSync(file, stale[index]);
    });
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [join(root, "scripts/render-matrix.ts"), ...args], { encoding: "utf8" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const check = run("--check");
      expect(check.status).toBe(1);
      expect(check.stderr).toContain("out of sync");
      expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(stale);
    }
    expect(run().status).toBe(0);
    expect(run("--check").status).toBe(0);
    expect(files.map((file) => readFileSync(file, "utf8"))).not.toEqual(stale);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the generated knob table mirrors the config vocabulary, its env names, and the defaults", () => {
  const rows = renderKnobTable()
    .split("\n")
    .filter((line) => line.startsWith("| `"));
  expect(rows).toHaveLength(CONFIG_KEYS.length);
  expect(rows.map((row) => row.match(/^\| `([a-zA-Z]+)`/)?.[1])).toEqual([...CONFIG_KEYS]);
  for (const row of rows) {
    const key = row.match(/^\| `([a-zA-Z]+)`/)?.[1] as string;
    expect(row).toContain(`\`${OPTION_ENV_BY_KEY[key]}\``);
  }
  // The count coupling renders as its semantic, not the incidental default.
  expect(rows.find((row) => row.startsWith("| `maxResults`"))).toContain("follows `count` (10)");
  expect(rows.find((row) => row.startsWith("| `fetchMaxChars`"))).toContain("16000");
});
