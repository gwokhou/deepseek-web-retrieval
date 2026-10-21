import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("matrix --check reports drift repeatedly without rewriting either document", () => {
  const root = mkdtempSync(join(tmpdir(), "dwr-matrix-"));
  try {
    for (const dir of ["scripts", "docs", "src/core"])
      cpSync(join(import.meta.dir, "..", dir), join(root, dir), { recursive: true });
    symlinkSync(join(import.meta.dir, "../node_modules"), join(root, "node_modules"));
    const files = ["docs/integration.md", "docs/research/control-matrix.md"].map((file) => join(root, file));
    const stale = files.map((file) => readFileSync(file, "utf8").replace("| Host |", "| Stale |"));
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
