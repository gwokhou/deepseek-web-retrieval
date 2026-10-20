import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseToml } from "smol-toml"
import { parseJsonc } from "../../src/core/jsonc"
import { check, excerpt } from "./assert"
import { findPackedTarball } from "./tarball"
import type { Runner } from "./runner"

/**
 * Keyless lifecycle coverage the happy-path installer scenario does not reach:
 * a tier downgrade's orphan reverts (including the whole-file deletion of an
 * orphaned, installer-created rules file), snapshot restore across a re-init,
 * the cross-scope refusal, XDG routing for the global config home, and the
 * list command — all through the real CLI in the container.
 */
export async function runReinitScenario(runner: Runner): Promise<string[]> {
  const log: string[] = []
  const cli = join(runner.repoDir, "dist", "cli.js")
  const tarball = findPackedTarball(runner.repoHostDir)
  // The `file:` spec keeps npx in package mode; a bare path would be executed as a command.
  const packageRef = `file:${join(runner.repoDir, tarball)}`
  const env = { HOME: runner.homeDir.guest }
  const cwd = runner.projectDir.guest
  const codexFile = join(runner.homeDir.host, ".codex", "config.toml")

  const init = async (flags: readonly string[], expectOk = true) => {
    const result = await runner.run(["node", cli, "init", ...flags, "--package", packageRef, "--apply"], { cwd, env })
    if (expectOk) {
      check(result.exitCode === 0, `init failed (${flags.join(" ")})`, excerpt(`${result.stdout}\n${result.stderr}`))
    }
    return result
  }
  const uninstall = async (host: string, scope: string, extraEnv: Record<string, string> = {}) => {
    const result = await runner.run(["node", cli, "uninstall", "--host", host, "--scope", scope], { cwd, env: { ...env, ...extraEnv } })
    check(result.exitCode === 0, `uninstall failed (${host} ${scope})`, excerpt(`${result.stdout}\n${result.stderr}`))
  }
  const codexConfig = () => parseToml(readFileSync(codexFile, "utf8")) as Record<string, unknown>
  const codexServers = (config: Record<string, unknown>) => (config.mcp_servers ?? {}) as Record<string, unknown>

  // --- Codex project scope: rules stay project-local, the config falls back to
  // the user-level file; both are installer-created here and deleted on uninstall.
  await init(["--host", "codex", "--scope", "project", "--search", "optional", "--fetch", "preferred"])
  const projectAgents = join(runner.projectDir.host, "AGENTS.md")
  check(
    readFileSync(projectAgents, "utf8").includes("<!-- deepseek-web-retrieval:codex:rules:begin -->"),
    "codex project init did not write the project-local rules block",
  )
  check("deepseek" in codexServers(codexConfig()), "codex project init did not register the server")
  await uninstall("codex", "project")
  check(!existsSync(projectAgents), "codex project uninstall left the rules file behind")
  check(!existsSync(codexFile), "codex project uninstall left an empty config.toml behind")
  log.push("reinit: codex project init wrote project-local rules plus the user-level entry; uninstall deleted both")

  // --- Codex global: forced search snapshots the pre-seeded value, and a
  // downgrade to optional reverts the orphaned kill switch inside the
  // still-claimed config file while keeping the registration.
  mkdirSync(join(runner.homeDir.host, ".codex"), { recursive: true })
  writeFileSync(codexFile, 'model = "gpt-5.2"\nweb_search = "live"\n')
  await init(["--host", "codex", "--scope", "global", "--search", "forced", "--fetch", "optional"])
  check(codexConfig().web_search === "disabled", "codex forced search did not set web_search = \"disabled\"")
  const downgraded = await init(["--host", "codex", "--scope", "global", "--search", "optional", "--fetch", "optional"])
  check(downgraded.stdout.includes("Reverts"), "the downgrade plan did not show its reverts section", excerpt(downgraded.stdout))
  const afterDowngrade = codexConfig()
  check(afterDowngrade.web_search === "live", "the downgrade did not restore the snapshotted web_search value")
  check("deepseek" in codexServers(afterDowngrade), "the downgrade dropped the still-wanted server entry")
  log.push("reinit: codex forced → optional reverted the orphaned kill switch and kept the entry")

  // --- Cross-scope refusal: a project install would claim the same config.toml.
  const refused = await init(["--host", "codex", "--scope", "project", "--search", "optional", "--fetch", "optional"], false)
  check(refused.exitCode === 1, "a second codex scope claiming one config file did not fail", excerpt(refused.stdout))
  check(refused.stderr.includes("already recorded at the global scope"), "the refusal is missing its scope guidance", excerpt(refused.stderr))
  check(refused.stderr.includes("uninstall --host codex --scope global"), "the refusal is missing the uninstall command", excerpt(refused.stderr))
  log.push("reinit: a second codex scope claiming the same config file was refused with guidance")

  // --- Pi project, preferred → optional: the orphaned, installer-created rules
  // file reverts wholly and is deleted; the registration stays.
  await init(["--host", "pi", "--scope", "project", "--search", "optional", "--fetch", "preferred"])
  const piConfig = join(runner.projectDir.host, ".pi", "mcp.json")
  const piAgents = join(runner.projectDir.host, "AGENTS.md")
  check(existsSync(piAgents), "pi preferred init did not create the rules file")
  const piServers = () =>
    (parseJsonc(readFileSync(piConfig, "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers
  check("deepseek" in piServers(), "pi preferred init did not register the server")
  await init(["--host", "pi", "--scope", "project", "--search", "optional", "--fetch", "optional"])
  check(!existsSync(piAgents), "the downgrade left the orphaned rules file behind instead of deleting it")
  check("deepseek" in piServers(), "the downgrade dropped the pi registration")
  log.push("reinit: pi preferred → optional deleted the orphaned rules file and kept the registration")

  // --- list reports both recorded installs.
  const listed = await runner.run(["node", cli, "list"], { cwd, env })
  check(listed.exitCode === 0, "list failed", excerpt(listed.stderr))
  check(
    listed.stdout.includes("codex (global)") && listed.stdout.includes("pi (project)"),
    "list output missing the recorded installs",
    excerpt(listed.stdout),
  )
  log.push("reinit: list reported both recorded installs")

  // --- XDG routing: the global config home follows XDG_CONFIG_HOME when it
  // belongs to the real home, and uninstall finds the record there too.
  const xdgGuest = join(runner.homeDir.guest, "xdg-config")
  const xdgEnv = { HOME: runner.homeDir.guest, XDG_CONFIG_HOME: xdgGuest }
  const xdgInit = await runner.run(
    ["node", cli, "init", "--host", "opencode", "--scope", "global", "--search", "optional", "--fetch", "optional", "--package", packageRef, "--apply"],
    { cwd, env: xdgEnv },
  )
  check(xdgInit.exitCode === 0, "opencode global init under XDG failed", excerpt(`${xdgInit.stdout}\n${xdgInit.stderr}`))
  check(existsSync(join(runner.homeDir.host, "xdg-config", "opencode", "opencode.jsonc")), "XDG_CONFIG_HOME did not route the global config")
  check(!existsSync(join(runner.homeDir.host, ".config", "opencode", "opencode.jsonc")), "the global config ignored XDG_CONFIG_HOME")
  log.push("reinit: XDG_CONFIG_HOME routed the opencode global config home")

  // --- Everything uninstalls cleanly, including the XDG-scope record.
  await uninstall("codex", "global")
  await uninstall("pi", "project")
  await uninstall("opencode", "global", { XDG_CONFIG_HOME: xdgGuest })
  check(!existsSync(join(runner.homeDir.host, "xdg-config", "opencode", "opencode.jsonc")), "the XDG-scope uninstall left the config behind")
  log.push("reinit: every install in the scenario uninstalled cleanly")

  return log
}
