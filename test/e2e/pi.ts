import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { check, excerpt } from "./assert"
import type { Runner } from "./runner"

interface PiServerEntry {
  readonly name?: unknown
  readonly state?: unknown
  readonly tools?: unknown
}

interface PiListOutput {
  readonly servers?: readonly PiServerEntry[]
}

/**
 * Registers the built MCP server in an isolated Pi config and asserts a real
 * `pi mcp list` handshake through Pi's own MCP client. No DeepSeek request is
 * made, so no real key is needed (the server only requires the env var to start).
 */
export async function runPiScenario(runner: Runner): Promise<string[]> {
  const log: string[] = []
  const cli = join(runner.repoDir, "dist", "cli.js")
  check(existsSync(join(runner.repoHostDir, "dist", "cli.js")), "dist/cli.js is missing", "run `bun run build` first")

  const version = await runner.run(["pi", "--version"], { cwd: runner.repoDir, env: { HOME: runner.homeDir.guest } })
  log.push(`pi version: ${excerpt(version.stdout.trim(), 80)}`)

  const configDir = join(runner.homeDir.host, ".pi", "agent")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          deepseek: {
            command: "node",
            args: [cli],
            // Placeholder is enough: the handshake never calls DeepSeek.
            env: { DEEPSEEK_API_KEY: "sk-e2e-placeholder" },
            exposure: "direct",
            enabled: true,
          },
        },
      },
      null,
      2,
    ),
  )

  const list = await runner.run(["pi", "mcp", "list", "--json"], {
    cwd: runner.repoDir,
    env: { HOME: runner.homeDir.guest },
  })
  check(list.exitCode === 0, "`pi mcp list` failed", excerpt(list.stderr || list.stdout))

  let payload: PiListOutput
  try {
    payload = JSON.parse(list.stdout) as PiListOutput
  } catch {
    throw new Error(`pi mcp list returned non-JSON output:\n${excerpt(list.stdout)}`)
  }

  const server = payload.servers?.find((entry) => entry.name === "deepseek")
  check(server !== undefined, "deepseek server missing from `pi mcp list` output")
  check(server.state === "connected", "deepseek server did not connect", `state: ${String(server.state)}`)
  const tools = Array.isArray(server.tools) ? server.tools : []
  check(
    tools.every((tool) => typeof tool === "string") &&
      tools.includes("deepseek_web_search") &&
      tools.includes("deepseek_fetch"),
    "expected both tools to be listed",
    `tools: ${tools.join(", ")}`,
  )

  log.push("pi: deepseek connected with tools deepseek_web_search, deepseek_fetch")
  return log
}
