import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { check, excerpt, requireEnv } from "./assert"
import type { Runner } from "./runner"

const RUN_TIMEOUT_MS = 240_000

/**
 * Billed, Docker-only scenario. Isolated HOME with a config.toml that registers
 * the built MCP server and points Codex itself at DeepSeek as the LLM via the
 * Responses wire, so one key pays for both legs — mirroring the opencode
 * scenario. Codex 0.163.0 removed `wire_api = "chat"`, and DeepSeek serves the
 * Responses endpoint, which is what makes this single-key setup possible.
 */
export async function runCodexScenario(runner: Runner): Promise<string[]> {
  check(
    existsSync(join(runner.repoHostDir, "dist", "cli.js")),
    "dist/cli.js is missing; the harness runs `bun run build` first, so this means the build failed",
  )
  const apiKey = requireEnv("DEEPSEEK_API_KEY", "the codex scenario makes real billed DeepSeek requests")
  const lines: string[] = []
  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: apiKey }

  const codexDir = join(runner.homeDir.host, ".codex")
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(
    join(codexDir, "config.toml"),
    [
      `model = "deepseek-chat"`,
      `model_provider = "deepseek-llm"`,
      ``,
      `[model_providers.deepseek-llm]`,
      `name = "DeepSeek"`,
      `base_url = "https://api.deepseek.com"`,
      `env_key = "DEEPSEEK_API_KEY"`,
      ``,
      `[mcp_servers.deepseek]`,
      `command = "node"`,
      `args = ["${join(runner.repoDir, "dist", "cli.js")}"]`,
      `env_vars = ["DEEPSEEK_API_KEY"]`,
      `startup_timeout_sec = 20`,
      ``,
    ].join("\n"),
  )
  lines.push(
    `wrote ${join(runner.homeDir.guest, ".codex/config.toml")} (key forwarded via env_vars, never written to a file)`,
  )

  const version = await runner.run(["codex", "--version"], { cwd: runner.projectDir.guest, env })
  check(version.exitCode === 0, "codex --version failed", excerpt(`${version.stdout}\n${version.stderr}`))
  lines.push(`codex: ${version.stdout.trim()}`)

  const fetchPrompt =
    "Use the deepseek_fetch MCP tool to fetch https://example.com and reply with only the page's H1 heading."
  const fetchRun = await runPrompt(runner, env, fetchPrompt)
  check(
    /Example Domain/i.test(finalLines(fetchRun.stdout)),
    "fetch prompt did not return the example heading",
    excerpt(`${fetchRun.stdout}\n${fetchRun.stderr}`),
  )
  lines.push("fetch: model fetched example.com through deepseek_fetch (billed)")

  const searchPrompt =
    'Use the deepseek_web_search MCP tool to search the web for "codex mcp servers" and reply with only one result URL.'
  const searchRun = await runPrompt(runner, env, searchPrompt)
  const lastLine = searchRun.stdout.trim().split("\n").filter((line) => line.trim().length > 0).pop() ?? ""
  check(
    /^https?:\/\/\S+$/.test(lastLine),
    "search prompt did not end with exactly a result URL",
    excerpt(`${searchRun.stdout}\n${searchRun.stderr}`),
  )
  lines.push("search: model searched through deepseek_web_search (billed)")

  lines.push("both legs (LLM + retrieval) were billed to the single DeepSeek key")
  return lines
}

function runPrompt(runner: Runner, env: Record<string, string>, prompt: string) {
  return runner.run(
    ["codex", "exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", prompt],
    { cwd: runner.projectDir.guest, env, timeoutMs: RUN_TIMEOUT_MS },
  )
}

/** Codex prefixes its output with banner lines; assertions target the reply tail. */
function finalLines(stdout: string): string {
  const lines = stdout.trim().split("\n").filter((line) => line.trim().length > 0)
  return lines.slice(-5).join("\n")
}
