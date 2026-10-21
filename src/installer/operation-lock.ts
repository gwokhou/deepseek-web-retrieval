import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalPath } from "./ownership";
import { pruneEmptyDir } from "./revert";

/**
 * Exclusive, fail-fast operation locks, distinct from persistent ownership claims.
 * Never steal a stale lock automatically: an interrupted multi-file edit needs inspection.
 */
export function withOperationLock<T>(files: readonly string[], run: () => T): T {
  const locks = [...new Set(files.map((file) => `${canonicalPath(file)}.deepseek-web-retrieval.lock`))].sort();
  const acquired: string[] = [];
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    for (const lock of locks) {
      mkdirSync(dirname(lock), { recursive: true });
      try {
        mkdirSync(lock, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        throw new Error(
          `Installer operation is locked at ${lock}. Wait for the other init/uninstall to finish. ` +
            "If it was interrupted, verify the config and install record and ensure no installer is running before removing this lock directory; retry with a new plan.",
        );
      }
      acquired.push(lock);
      writeFileSync(`${lock}/owner.json`, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
        mode: 0o600,
      });
    }
    outcome = { ok: true, value: run() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  {
    const errors: string[] = [];
    for (const lock of acquired.reverse()) {
      try {
        rmSync(lock, { recursive: true });
        pruneEmptyDir(dirname(lock));
      } catch (error) {
        errors.push(`${lock}: ${String(error)}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `${outcome.ok ? "Operation finished" : String(outcome.error)}; could not release operation lock(s): ${errors.join("; ")}`,
        { cause: outcome.ok ? undefined : outcome.error },
      );
    }
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
