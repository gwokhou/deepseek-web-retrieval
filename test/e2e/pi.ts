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
 * Keyless Pi extension-path scenario: the repo checkout itself is the package
 * source (`packages: ["/work"]` — jiti loads src/pi/extension.ts directly), and
 * the settings namespace is proven against the real runtime in both directions:
 * a both-off namespace makes the factory throw through Pi's own
 * "Failed to load extension" surface, and its removal loads cleanly. No
 * DeepSeek request is made (the model call fails on a placeholder key after
 * the factory has already run).
 */
export async function runPiExtensionScenario(runner: Runner): Promise<string[]> {
  const log: string[] = []
  const settingsDir = join(runner.homeDir.host, ".pi", "agent")
  mkdirSync(settingsDir, { recursive: true })
  const settingsPath = join(settingsDir, "settings.json")
  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: "sk-e2e-placeholder" }
  const cwd = runner.projectDir.guest

  writeFileSync(settingsPath, JSON.stringify({ packages: [runner.repoDir] }, null, 2))

  const listed = await runner.run(["pi", "list"], { cwd, env, timeoutMs: RUN_TIMEOUT_MS })
  check(
    listed.exitCode === 0 && listed.stdout.includes(runner.repoDir),
    "`pi list` does not show the checkout package",
    excerpt(listed.stdout || listed.stderr),
  )

  // Both capabilities off in the settings namespace: the factory throws at load.
  writeFileSync(
    settingsPath,
    JSON.stringify({ packages: [runner.repoDir], deepseekWebRetrieval: { enableSearch: false, enableFetch: false } }, null, 2),
  )
  const refused = await runSession(runner, env, cwd)
  const refusedText = `${refused.stdout}\n${refused.stderr}`
  check(refusedText.includes("Failed to load extension"), "the both-off extension did not fail at load", excerpt(refusedText))
  check(refusedText.includes("at least one must stay enabled"), "the load failure is not the precheck message", excerpt(refusedText))

  // Namespace removed: the same package loads cleanly (the model call's 401 is
  // expected and arrives after the factory has run).
  writeFileSync(settingsPath, JSON.stringify({ packages: [runner.repoDir] }, null, 2))
  const clean = await runSession(runner, env, cwd)
  const cleanText = `${clean.stdout}\n${clean.stderr}`
  check(!cleanText.includes("Failed to load extension"), "the extension failed to load from the checkout", excerpt(cleanText))

  log.push("pi-extension: settings namespace both-off refused at load, removal loaded clean (keyless)")
  return log
}

async function runSession(
  runner: Runner,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return runner.run(["pi", "--print", "--no-tools", "--model", "deepseek/deepseek-flash", "hi"], {
    cwd,
    env,
    timeoutMs: RUN_TIMEOUT_MS,
  })
}

/**
 * Billed, invocation-level Pi scenario on the extension path (the recommended
 * one): the repo checkout is the package source, so jiti loads the adapter's
 * TypeScript entry directly and the tools run in-process. Pi 1.3.0 ships
 * DeepSeek as a native provider that reads DEEPSEEK_API_KEY, so one key pays
 * for both legs: the LLM is `deepseek/deepseek-flash` and the retrieval goes
 * through the extension's own tool execution. Runs in an isolated HOME, so the
 * user-level settings.json never touches a real one.
 */
export async function runPiBilledScenario(runner: Runner): Promise<string[]> {
  const apiKey = requireEnv("DEEPSEEK_API_KEY", "the pi billed scenario makes real billed DeepSeek requests")
  const log: string[] = []
  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: apiKey }

  const settingsDir = join(runner.homeDir.host, ".pi", "agent")
  mkdirSync(settingsDir, { recursive: true })
  writeFileSync(
    join(settingsDir, "settings.json"),
    JSON.stringify({ packages: [runner.repoDir] }, null, 2),
  )

  const version = await runner.run(["pi", "--version"], { cwd: runner.projectDir.guest, env })
  log.push(`pi version: ${excerpt(version.stdout.trim(), 80)}`)

  const fetchReply = await runPrompt(
    runner,
    env,
    "Use the deepseek_fetch tool to fetch https://example.com and reply with only the page's H1 heading.",
  )
  check(
    /Example Domain/i.test(fetchReply),
    "fetch prompt did not return the example heading",
    excerpt(fetchReply),
  )
  log.push("pi: model fetched example.com through the extension's deepseek_fetch (billed)")

  const searchReply = await runPrompt(
    runner,
    env,
    'Use the deepseek_web_search tool to search the web for "pi coding agent" and reply with exactly one source URL and nothing else.',
  )
  check(/https?:\/\/\S+/i.test(searchReply), "search prompt did not return a URL", excerpt(searchReply))
  log.push("pi: model searched through the extension's deepseek_web_search (billed)")

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
