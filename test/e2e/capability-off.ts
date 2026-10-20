import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { check, excerpt, ScenarioError } from "./assert"
import type { Runner } from "./runner"

interface PiServerEntry {
  readonly name?: unknown
  readonly state?: unknown
  readonly exposure?: unknown
  readonly tools?: unknown
  readonly error?: unknown
}

interface PiListOutput {
  readonly servers?: readonly PiServerEntry[]
}

const RUN_TIMEOUT_MS = 120_000

/**
 * Keyless coverage of the per-capability switches and Pi's exposure trap, all
 * through `pi mcp list --json`, whose state/tools/exposure fields make each
 * behavior observable without a single billed request:
 *
 * - `DEEPSEEK_ENABLE_FETCH=false` registers only the search tool
 * - both flags false makes the server refuse to start (state "failed" with our
 *   refusal message) — the false-only semantics end to end
 * - registering without `exposure` reports "codemode", the documented trap
 *   where tools stay hidden from the model
 */
export async function runCapabilityOffScenario(runner: Runner): Promise<string[]> {
  const log: string[] = []
  const env = { HOME: runner.homeDir.guest }
  const cwd = runner.projectDir.guest
  const configDir = join(runner.homeDir.host, ".pi", "agent")
  mkdirSync(configDir, { recursive: true })
  const mcpJson = join(configDir, "mcp.json")

  writeFileSync(mcpJson, mcpConfig(runner.repoDir, { DEEPSEEK_ENABLE_FETCH: "false" }, "direct"))
  let server = piServer(await piMcpList(runner, env, cwd))
  check(server.state === "connected", "server with fetch disabled did not connect", JSON.stringify(server))
  const tools = Array.isArray(server.tools) ? (server.tools as unknown[]) : []
  check(
    tools.length === 1 && tools[0] === "deepseek_web_search",
    "DEEPSEEK_ENABLE_FETCH=false should leave exactly the search tool",
    `tools: ${tools.join(", ")}`,
  )
  log.push("capability-off: DEEPSEEK_ENABLE_FETCH=false registered only deepseek_web_search")

  writeFileSync(mcpJson, mcpConfig(runner.repoDir, { DEEPSEEK_ENABLE_SEARCH: "false", DEEPSEEK_ENABLE_FETCH: "false" }, "direct"))
  server = piServer(await piMcpList(runner, env, cwd))
  check(server.state === "failed", "both-off server should be in the failed state", JSON.stringify(server))
  check(
    typeof server.error === "string" && server.error.includes("Both tools are disabled"),
    "both-off failure does not surface the server's refusal message",
    JSON.stringify(server),
  )
  log.push("capability-off: both flags false refused to start (state failed, refusal message surfaced)")

  writeFileSync(mcpJson, mcpConfig(runner.repoDir, {}))
  server = piServer(await piMcpList(runner, env, cwd))
  check(server.state === "connected", "codemode registration did not connect", JSON.stringify(server))
  check(server.exposure === "codemode", "a registration without exposure should report codemode", JSON.stringify(server))
  log.push("capability-off: without exposure the server reports codemode (tools hidden from the model)")
  return log
}

function mcpConfig(repoDir: string, extraEnv: Record<string, string>, exposure?: "direct"): string {
  const entry: Record<string, unknown> = {
    command: "node",
    args: [join(repoDir, "dist", "cli.js")],
    env: { DEEPSEEK_API_KEY: "sk-e2e-placeholder", ...extraEnv },
    enabled: true,
  }
  if (exposure !== undefined) entry.exposure = exposure
  return JSON.stringify({ mcpServers: { deepseek: entry } }, null, 2)
}

/** pi mcp list exits nonzero when a server fails, so only JSON-parseability is asserted here. */
async function piMcpList(runner: Runner, env: Record<string, string | undefined>, cwd: string): Promise<PiListOutput> {
  const result = await runner.run(["pi", "mcp", "list", "--json"], { cwd, env, timeoutMs: RUN_TIMEOUT_MS })
  try {
    return JSON.parse(result.stdout) as PiListOutput
  } catch {
    throw new ScenarioError(`pi mcp list returned non-JSON output:\n${excerpt(result.stdout || result.stderr)}`)
  }
}

function piServer(payload: PiListOutput): PiServerEntry {
  const server = payload.servers?.find((entry) => entry.name === "deepseek")
  if (server === undefined) throw new ScenarioError("deepseek server missing from `pi mcp list` output")
  return server
}
