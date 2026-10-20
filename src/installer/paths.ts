import type { FsRoots, Scope } from "./types"

/** Joins path parts with "/", skipping empty segments. */
export function join(...parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join("/")
}

/** Config home, honoring XDG_CONFIG_HOME only when it belongs to the real home. */
export function configHome(roots: FsRoots): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && roots.home === (process.env.HOME ?? "")) return xdg
  return join(roots.home, ".config")
}

/** State records live with their scope: global installs under the config home, project installs in the checkout. */
export function stateDir(roots: FsRoots, scope: Scope): string {
  return scope === "global"
    ? join(configHome(roots), "deepseek-web-retrieval")
    : join(roots.cwd, ".deepseek-web-retrieval")
}
