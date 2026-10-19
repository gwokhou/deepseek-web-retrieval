import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { check, excerpt, requireEnv, requireWhich } from "./assert"
import type { Runner } from "./runner"

const RUN_TIMEOUT_MS = 180_000

/**
 * Runs headless `opencode run` prompts in an isolated project that loads the
 * plugin from this checkout, and asserts real search/fetch output. The LLM is
 * a DeepSeek custom provider configured from the same DEEPSEEK_API_KEY, so no
 * `opencode auth login` is needed and one key pays for both legs. Makes real,
 * billed DeepSeek requests.
 */
export async function runOpencodeScenario(runner: Runner): Promise<string[]> {
  const log: string[] = []
  if (runner.mode === "local") {
    requireWhich("opencode", "install: https://opencode.ai/v2/docs/, or drop --local to use docker")
  }
  const apiKey = requireEnv(
    "DEEPSEEK_API_KEY",
    "the opencode scenario makes real billed DeepSeek requests",
  )

  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: apiKey }
  writeFileSync(
    join(runner.projectDir.host, "opencode.jsonc"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugins: [{ package: runner.repoDir }],
        websearch: { provider: "deepseek" },
        providers: {
          "deepseek-llm": {
            name: "DeepSeek (E2E)",
            env: ["DEEPSEEK_API_KEY"],
            package: "@opencode/ai/providers/openai-compatible",
            settings: {
              baseURL: "https://api.deepseek.com",
              apiKey: "{env:DEEPSEEK_API_KEY}",
            },
            models: {
              "deepseek-chat": { name: "DeepSeek Chat" },
            },
          },
        },
        model: "deepseek-llm/deepseek-chat",
        permissions: [
          { action: "websearch", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "deepseek_fetch", resource: "*", effect: "allow" },
        ],
      },
      null,
      2,
    ),
  )

  const version = await runner.run(["opencode", "--version"], { cwd: runner.projectDir.guest, env })
  log.push(`opencode version: ${excerpt(version.stdout.trim(), 80)}`)

  const fetchReply = await runPrompt(runner, env, [
    "Fetch https://example.com using the deepseek_fetch tool, then reply with only the page's H1 heading text.",
  ])
  check(
    fetchReply.includes("Example Domain"),
    "fetch prompt did not return the expected page heading",
    excerpt(fetchReply),
  )
  log.push("opencode: deepseek_fetch returned the example.com heading")

  const searchReply = await runPrompt(runner, env, [
    'Search the web for "opencode plugin api" using websearch, then reply with exactly one source URL and nothing else.',
  ])
  check(/https?:\/\/\S+/i.test(searchReply), "search prompt did not return a URL", excerpt(searchReply))
  log.push("opencode: websearch (provider deepseek) returned a source URL")

  log.push("note: real DeepSeek requests were billed by this scenario (LLM + retrieval)")
  return log
}

async function runPrompt(runner: Runner, env: Record<string, string | undefined>, prompt: string[]): Promise<string> {
  const result = await runner.run(["opencode", "run", ...prompt], {
    cwd: runner.projectDir.guest,
    env,
    timeoutMs: RUN_TIMEOUT_MS,
  })
  check(result.exitCode === 0, "`opencode run` failed", excerpt(result.stderr || result.stdout))
  return result.stdout
}
