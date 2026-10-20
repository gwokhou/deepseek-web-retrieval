import { readdirSync } from "node:fs"
import { join } from "node:path"
import { ScenarioError } from "./assert"

/**
 * Finds the tarball `npm pack` produced in the repo root. The harness packs it
 * before the scenarios run, so it is always the current checkout's packaging —
 * exactly what `npx deepseek-web-retrieval` installs for users.
 */
export function findPackedTarball(repoHostDir: string): string {
  const matches = readdirSync(repoHostDir).filter((name) => /^deepseek-web-retrieval-.*\.tgz$/.test(name))
  if (matches.length !== 1) {
    throw new ScenarioError(
      `expected exactly one deepseek-web-retrieval-*.tgz in ${repoHostDir}, found ${matches.length}`,
    )
  }
  return matches[0] as string
}
