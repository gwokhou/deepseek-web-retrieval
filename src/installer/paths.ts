import { join as pathJoin } from "node:path";
import type { FsRoots, Scope } from "./types";

/** Joins path parts with the platform separator, skipping empty segments. */
export function join(...parts: readonly string[]): string {
  const nonEmpty = parts.filter((part) => part.length > 0);
  return nonEmpty.length === 0 ? "" : pathJoin(...nonEmpty);
}

/** Config home: an explicit root wins; otherwise ~/.config. The CLI resolves XDG at the edge. */
export function configHome(roots: FsRoots): string {
  return roots.configHome ?? join(roots.home, ".config");
}

/** State records live with their scope: global installs under the config home, project installs in the checkout. */
export function stateDir(roots: FsRoots, scope: Scope): string {
  return scope === "global"
    ? join(configHome(roots), "deepseek-web-retrieval")
    : join(roots.cwd, ".deepseek-web-retrieval");
}
