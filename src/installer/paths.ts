import type { HostName, InstallerInput, Scope } from "./types"

/** The filesystem roots path resolution needs; InstallerInput satisfies this structurally. */
export interface FsRoots {
  readonly home: string
  readonly cwd: string
}

/** The files a host edit touches for a given scope. */
export interface HostPaths {
  /** Main host config file the installer edits. */
  readonly config: string
  readonly configFormat: "json" | "toml"
  /** Rules file receiving the marked block for the preferred tier. */
  readonly rules: string
  /** Where the install record lives for this host and scope. */
  readonly state: string
}

function join(...parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join("/")
}

function configHome(roots: FsRoots): string {
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

export function hostPaths(host: HostName, input: InstallerInput): HostPaths {
  const scope = input.scope
  const state = join(stateDir(input, scope), `install.${host}.json`)
  if (host === "pi") {
    return scope === "global"
      ? { config: join(input.home, ".pi/agent/mcp.json"), configFormat: "json", rules: join(input.home, ".pi/agent/AGENTS.md"), state }
      : { config: join(input.cwd, ".pi/mcp.json"), configFormat: "json", rules: join(input.cwd, "AGENTS.md"), state }
  }
  if (host === "opencode") {
    return scope === "global"
      ? {
          config: join(configHome(input), "opencode/opencode.jsonc"),
          configFormat: "json",
          rules: join(configHome(input), "opencode/AGENTS.md"),
          state,
        }
      : { config: join(input.cwd, "opencode.jsonc"), configFormat: "json", rules: join(input.cwd, "AGENTS.md"), state }
  }
  // Codex: the config file is user-level only; project scope keeps the rules file
  // project-local and reports the fallback.
  return {
    config: join(input.home, ".codex/config.toml"),
    configFormat: "toml",
    rules: scope === "global" ? join(input.home, ".codex/AGENTS.md") : join(input.cwd, "AGENTS.md"),
    state,
  }
}
