import { readdirSync } from "node:fs";
import { check, excerpt, ScenarioError } from "./assert";
import type { Runner } from "./runner";

/**
 * Finds the tarball `npm pack` produced in the repo root. The harness packs it
 * before the scenarios run, so it is always the current checkout's packaging —
 * exactly what `npx deepseek-web-retrieval` installs for users.
 */
export function findPackedTarball(repoHostDir: string): string {
  const matches = readdirSync(repoHostDir).filter((name) => /^deepseek-web-retrieval-.*\.tgz$/.test(name));
  if (matches.length !== 1) {
    throw new ScenarioError(
      `expected exactly one deepseek-web-retrieval-*.tgz in ${repoHostDir}, found ${matches.length}`,
    );
  }
  return matches[0] as string;
}

/**
 * Warms the npx cache so a later handshake does not pay a cold tarball install
 * inside the server startup timeout. 300 s: the per-run npm cache starts cold
 * inside the container, and npm 10's cold dependency resolution has exceeded
 * 120 s on slow links — every scenario that spawns the packed tarball goes
 * through here so none of them re-learns that timeout.
 */
export async function prewarmNpx(
  runner: Runner,
  env: Readonly<Record<string, string | undefined>>,
  packageRef: string,
): Promise<void> {
  const result = await runner.run(["npx", "-y", packageRef, "list"], {
    cwd: runner.projectDir.guest,
    env,
    timeoutMs: 300_000,
  });
  check(
    result.exitCode === 0,
    "npx prewarm of the packed tarball failed",
    excerpt(`${result.stdout}\n${result.stderr}`),
  );
}
