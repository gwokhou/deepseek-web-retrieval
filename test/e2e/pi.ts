import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { check, excerpt, requireEnv } from "./assert"
import type { Runner } from "./runner"

const RUN_TIMEOUT_MS = 240_000
const MODEL = "deepseek/deepseek-flash"

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

/**
 * Billed, invocation-level Pi scenario, at the same depth as the opencode and
 * codex scenarios. Pi 1.3.0 ships DeepSeek as a native provider that reads
 * DEEPSEEK_API_KEY, so one key pays for both legs: the LLM is
 * `deepseek/deepseek-flash` and the MCP server is the same built cli.js. The
 * config keeps the key out of the file (`${DEEPSEEK_API_KEY}` expands from the
 * shell that launches Pi). Runs in an isolated HOME, so the user-level mcp.json
 * never touches a real one, and the working folder has no `.pi` directory, so
 * print mode never needs a project-trust decision.
 */
export async function runPiBilledScenario(runner: Runner): Promise<string[]> {
  const apiKey = requireEnv("DEEPSEEK_API_KEY", "the pi billed scenario makes real billed DeepSeek requests")
  const log: string[] = []
  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: apiKey }

  const configDir = join(runner.homeDir.host, ".pi", "agent")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          deepseek: {
            command: "node",
            args: [join(runner.repoDir, "dist", "cli.js")],
            env: { DEEPSEEK_API_KEY: "${DEEPSEEK_API_KEY}" },
            exposure: "direct",
            enabled: true,
          },
        },
      },
      null,
      2,
    ),
  )

  const version = await runner.run(["pi", "--version"], { cwd: runner.projectDir.guest, env })
  log.push(`pi version: ${excerpt(version.stdout.trim(), 80)}`)

  const fetchReply = await runPrompt(
    runner,
    env,
    "Use the mcp__deepseek__deepseek_fetch tool to fetch https://example.com and reply with only the page's H1 heading.",
  )
  check(
    /Example Domain/i.test(fetchReply),
    "fetch prompt did not return the example heading",
    excerpt(fetchReply),
  )
  log.push("pi: model fetched example.com through deepseek_fetch (billed)")

  const searchReply = await runPrompt(
    runner,
    env,
    'Use the mcp__deepseek__deepseek_web_search tool to search the web for "pi coding agent" and reply with exactly one source URL and nothing else.',
  )
  check(/https?:\/\/\S+/i.test(searchReply), "search prompt did not return a URL", excerpt(searchReply))
  log.push("pi: model searched through deepseek_web_search (billed)")

  log.push("note: real DeepSeek requests were billed by this scenario (LLM + retrieval)")
  return log
}

async function runPrompt(runner: Runner, env: Record<string, string | undefined>, prompt: string): Promise<string> {
  const result = await runner.run(["pi", "--print", "--model", MODEL, prompt], {
    cwd: runner.projectDir.guest,
    env,
    timeoutMs: RUN_TIMEOUT_MS,
  })
  // Print mode writes the final assistant text to stdout and exits nonzero on
  // error or aborted stop reasons.
  check(result.exitCode === 0, "`pi --print` failed", excerpt(result.stderr || result.stdout))
  return result.stdout
}
