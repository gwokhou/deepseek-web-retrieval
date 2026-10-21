import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseToml } from "smol-toml"
import { parseJsonc } from "../../src/core/jsonc"
import { check, excerpt, ScenarioError } from "./assert"
import { findPackedTarball, prewarmNpx } from "./tarball"
import type { Runner } from "./runner"

interface PiListEntry {
  readonly name?: unknown
  readonly scope?: unknown
  readonly source?: unknown
  readonly state?: unknown
  readonly exposure?: unknown
  readonly tools?: unknown
}

interface PiListOutput {
  readonly servers?: readonly PiListEntry[]
}

/**
 * Keyless end-to-end run of the installer itself: `init --apply` inside the
 * container, verification through the real agents' own config readers, then
 * `uninstall` restores exactly what the plan applied. This is the only place
 * the installer's product — not a hand-written config — is validated against
 * the agents. The registered command is `npx -y <packed tarball>`, so the
 * handshake also runs the published artifact.
 */
export async function runInstallerScenario(runner: Runner): Promise<string[]> {
  const log: string[] = []
  const cli = join(runner.repoDir, "dist", "cli.js")
  const tarball = findPackedTarball(runner.repoHostDir)
  // The `file:` spec keeps npx in package mode; a bare path would be executed as a command.
  const packageRef = `file:${join(runner.repoDir, tarball)}`
  // The installer writes `${DEEPSEEK_API_KEY}` into the Pi env block; a
  // placeholder expands fine because the handshake never calls DeepSeek.
  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: "sk-e2e-placeholder" }
  const cwd = runner.projectDir.guest

  // --- Pi, global scope, extension path (the default): init -> settings.json
  // packages entry -> the extension factory loads cleanly -> uninstall.
  await install(runner, cli, ["--host", "pi", "--scope", "global", "--search", "optional", "--fetch", "optional"], packageRef, cwd, env)
  const settingsPath = join(runner.homeDir.host, ".pi/agent/settings.json")
  const settings = parseJsonc(readFileSync(settingsPath, "utf8")) as { packages?: string[] }
  check(
    Array.isArray(settings.packages) && settings.packages.includes(`npm:${packageRef}`),
    "installer did not append the npm package source to the pi settings packages array",
    JSON.stringify(settings),
  )
  const piList = await runner.run(["pi", "list"], { cwd, env, timeoutMs: 120_000 })
  check(piList.exitCode === 0 && piList.stdout.includes("deepseek-web-retrieval"), "`pi list` does not show the installed package", excerpt(piList.stdout || piList.stderr))
  // The extension factory runs at session start, before the model call: with a
  // placeholder key the session fails on model auth but must NOT fail on
  // extension loading — that is the keyless load proof.
  const session = await runner.run(
    ["pi", "--print", "--no-tools", "--model", "deepseek/deepseek-flash", "hi"],
    { cwd, env, timeoutMs: 120_000 },
  )
  check(
    !`${session.stdout}\n${session.stderr}`.includes("Failed to load extension"),
    "the pi extension failed to load from the installer-written settings",
    excerpt(`${session.stdout}\n${session.stderr}`),
  )
  log.push("installer: pi global extension-path init verified by `pi list` and a clean extension load")

  await uninstall(runner, cli, "pi", "global", cwd, env)
  check(!existsSync(settingsPath), "pi extension-path uninstall left settings.json behind")
  log.push("installer: pi extension-path uninstall removed the settings file it created")

  // --- Pi, global scope, MCP fallback (`--path mcp`): init -> real handshake -> uninstall.
  await install(runner, cli, ["--host", "pi", "--scope", "global", "--search", "optional", "--fetch", "optional", "--path", "mcp"], packageRef, cwd, env)
  await prewarmNpx(runner, env, packageRef)
  const server = requirePiServer(await piMcpList(runner, env, cwd))
  check(server.state === "connected", "installer-registered pi server did not connect", JSON.stringify(server))
  check(
    server.scope === "global" && server.source === join(runner.homeDir.guest, ".pi/agent/mcp.json"),
    "pi server is not registered at the global scope",
    JSON.stringify(server),
  )
  check(server.exposure === "direct", "installer did not write exposure direct", JSON.stringify(server))
  check(
    Array.isArray(server.tools) && server.tools.includes("deepseek_web_search") && server.tools.includes("deepseek_fetch"),
    "connected pi server does not expose both tools",
    JSON.stringify(server),
  )
  log.push("installer: pi global mcp-path init verified by a real `pi mcp list` handshake (npx tarball, exposure direct)")

  await uninstall(runner, cli, "pi", "global", cwd, env)
  const afterPiUninstall = piServer(await piMcpList(runner, env, cwd))
  check(afterPiUninstall === undefined, "pi uninstall left the deepseek entry behind", JSON.stringify(afterPiUninstall))
  log.push("installer: pi uninstall removed the entry")

  // --- Codex, global scope, forced search: the kill switch is written for real.
  await install(runner, cli, ["--host", "codex", "--scope", "global", "--search", "forced", "--fetch", "optional"], packageRef, cwd, env)
  const codexConfig = parseToml(readFileSync(join(runner.homeDir.host, ".codex", "config.toml"), "utf8")) as Record<string, unknown>
  check(codexConfig.web_search === "disabled", "codex forced search did not set web_search = \"disabled\"")
  const mcpServers = codexConfig.mcp_servers as Record<string, unknown> | undefined
  check(mcpServers !== undefined && "deepseek" in mcpServers, "codex config has no [mcp_servers.deepseek]")
  const codexList = await runner.run(["codex", "mcp", "list"], { cwd, env: { HOME: runner.homeDir.guest } })
  check(codexList.exitCode === 0 && codexList.stdout.includes("deepseek"), "codex mcp list does not show the installed server", excerpt(codexList.stdout))
  log.push("installer: codex global init wrote the kill switch and the server entry; `codex mcp list` reads both")

  await uninstall(runner, cli, "codex", "global", cwd, env)
  const codexAfter = existsSync(join(runner.homeDir.host, ".codex", "config.toml"))
    ? (parseToml(readFileSync(join(runner.homeDir.host, ".codex", "config.toml"), "utf8")) as Record<string, unknown>)
    : {}
  check(codexAfter.web_search === undefined, "codex uninstall left web_search behind")
  check(codexAfter.mcp_servers === undefined, "codex uninstall left [mcp_servers.deepseek] behind")
  const codexListAfter = await runner.run(["codex", "mcp", "list"], { cwd, env: { HOME: runner.homeDir.guest } })
  check(
    codexListAfter.exitCode === 0 && !codexListAfter.stdout.includes("deepseek"),
    "codex mcp list still shows a server after uninstall",
    excerpt(codexListAfter.stdout),
  )
  log.push("installer: codex uninstall restored the config (kill switch and entry gone)")

  // --- OpenCode, project scope, forced search + preferred fetch: engine
  // replacement plus the fetch rules block. (OpenCode search has no preferred
  // tier: the websearch engine is host-level config, not a model choice.)
  await install(runner, cli, ["--host", "opencode", "--scope", "project", "--search", "forced", "--fetch", "preferred"], packageRef, cwd, env)
  const opencodePath = join(runner.projectDir.host, "opencode.jsonc")
  const opencodeConfig = parseJsonc(readFileSync(opencodePath, "utf8")) as Record<string, unknown>
  const plugins = opencodeConfig.plugins
  check(Array.isArray(plugins) && plugins.length === 1, "opencode.jsonc has no installer plugin entry")
  const websearch = opencodeConfig.websearch as { provider?: unknown } | undefined
  check(websearch?.provider === "deepseek", "opencode forced search did not set websearch.provider = deepseek")
  const agents = readFileSync(join(runner.projectDir.host, "AGENTS.md"), "utf8")
  check(
    agents.includes("<!-- deepseek-web-retrieval:opencode:rules:begin -->"),
    "opencode preferred fetch did not write the AGENTS.md rules block",
  )
  log.push("installer: opencode project init wrote the plugin entry, the engine replacement, and the fetch rules block")

  await uninstall(runner, cli, "opencode", "project", cwd, env)
  check(!existsSync(opencodePath), "opencode uninstall left opencode.jsonc behind")
  check(
    !existsSync(join(runner.projectDir.host, "AGENTS.md")) ||
      !readFileSync(join(runner.projectDir.host, "AGENTS.md"), "utf8").includes("deepseek-web-retrieval:opencode:rules:begin"),
    "opencode uninstall left the rules block behind",
  )
  log.push("installer: opencode uninstall removed everything it created")

  return log
}

async function install(
  runner: Runner,
  cli: string,
  tierFlags: readonly string[],
  packageRef: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const result = await runner.run(["node", cli, "init", ...tierFlags, "--package", packageRef, "--apply"], { cwd, env })
  check(result.exitCode === 0, `installer init failed (${tierFlags.join(" ")})`, excerpt(`${result.stdout}\n${result.stderr}`))
}

async function uninstall(
  runner: Runner,
  cli: string,
  host: string,
  scope: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const result = await runner.run(["node", cli, "uninstall", "--host", host, "--scope", scope], { cwd, env })
  check(result.exitCode === 0, `installer uninstall failed (--host ${host} --scope ${scope})`, excerpt(`${result.stdout}\n${result.stderr}`))
}

async function piMcpList(runner: Runner, env: Record<string, string | undefined>, cwd: string): Promise<PiListOutput> {
  const result = await runner.run(["pi", "mcp", "list", "--json"], { cwd, env })
  check(result.exitCode === 0, "`pi mcp list` failed", excerpt(result.stderr || result.stdout))
  try {
    return JSON.parse(result.stdout) as PiListOutput
  } catch {
    throw new ScenarioError(`pi mcp list returned non-JSON output:\n${excerpt(result.stdout)}`)
  }
}

function piServer(payload: PiListOutput): PiListEntry | undefined {
  return payload.servers?.find((entry) => entry.name === "deepseek")
}

function requirePiServer(payload: PiListOutput): PiListEntry {
  const server = piServer(payload)
  if (server === undefined) throw new ScenarioError("deepseek server missing from `pi mcp list` output")
  return server
}
