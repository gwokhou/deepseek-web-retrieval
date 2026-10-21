import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
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
 *
 * The config follows DeepSeek's official Codex integration: Codex has no
 * built-in metadata for DeepSeek models, so `~/.codex/models.json` (vendored
 * from the official setup script) must exist and be referenced via
 * `model_catalog_json`, or the model cannot be resolved. The key stays in the
 * environment (`env_key`); unlike the official script we never write it into
 * config.toml. `web_search = "disabled"` is the forced-search kill switch, so
 * this scenario also exercises that tier's mechanism for real.
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
  copyFileSync(
    join(runner.repoHostDir, "test", "e2e", "codex-models.json"),
    join(codexDir, "models.json"),
  )
  const modelsJsonPath = join(runner.homeDir.guest, ".codex", "models.json")
  writeFileSync(
    join(codexDir, "config.toml"),
    [
      `model = "deepseek-flash"`,
      `model_provider = "deepseek"`,
      `forced_login_method = "api"`,
      `model_reasoning_effort = "low"`,
      `web_search = "disabled"`,
      `show_raw_agent_reasoning = true`,
      `model_catalog_json = "${modelsJsonPath}"`,
      ``,
      `[model_providers.deepseek]`,
      `name = "deepseek"`,
      `base_url = "https://api.deepseek.com/"`,
      `wire_api = "responses"`,
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
    `wrote ${join(runner.homeDir.guest, ".codex/config.toml")} + models.json (key forwarded via env_key, never written to a file)`,
  )

  const version = await runner.run(["codex", "--version"], { cwd: runner.projectDir.guest, env })
  check(version.exitCode === 0, "codex --version failed", excerpt(`${version.stdout}\n${version.stderr}`))
  lines.push(`codex: ${version.stdout.trim()}`)

  // Both prompts run under `codex exec --json`: the emitted mcp_tool_call events
  // carry the raw CallToolResult, which makes the text-only shaping observable —
  // if Codex ever renames its codex-mcp-client identity, structured_content
  // reappears in these events and the check below fails loudly.
  const fetchPrompt =
    "Use the deepseek_fetch MCP tool to fetch https://example.com and reply with only the page's H1 heading."
  const fetchRun = await runPrompt(runner, env, fetchPrompt)
  const fetchEvents = parseEvents(fetchRun.stdout)
  check(
    /Example Domain/i.test(lastAgentMessage(fetchEvents)),
    "fetch prompt did not return the example heading",
    excerpt(`${fetchRun.stdout}\n${fetchRun.stderr}`),
  )
  checkShapedResult(lines, fetchEvents, fetchRun, "deepseek_fetch", "Example Domain")
  lines.push("fetch: model fetched example.com through deepseek_fetch (billed)")

  const searchPrompt =
    'Use the deepseek_web_search MCP tool to search the web for "codex mcp servers" and reply with only one result URL.'
  const searchRun = await runPrompt(runner, env, searchPrompt)
  const searchEvents = parseEvents(searchRun.stdout)
  const lastLine =
    lastAgentMessage(searchEvents).trim().split("\n").filter((line) => line.trim().length > 0).pop() ?? ""
  check(
    /^https?:\/\/\S+$/.test(lastLine),
    "search prompt did not end with exactly a result URL",
    excerpt(`${searchRun.stdout}\n${searchRun.stderr}`),
  )
  checkShapedResult(lines, searchEvents, searchRun, "deepseek_web_search", undefined)
  lines.push("search: model searched through deepseek_web_search (billed)")

  lines.push("both legs (LLM + retrieval) were billed to the single DeepSeek key")
  return lines
}

/** Asserts the completed deepseek tool call reached Codex without structuredContent. */
function checkShapedResult(
  lines: string[],
  events: readonly Event[],
  run: { readonly stdout: string; readonly stderr: string },
  tool: string,
  markdownNeedle: string | undefined,
): void {
  const call = events.find(
    (event) =>
      event.type === "item.completed" &&
      event.item?.type === "mcp_tool_call" &&
      event.item?.server === "deepseek" &&
      event.item?.tool === tool &&
      event.item?.status === "completed",
  )?.item?.result
  check(call !== undefined, `${tool} was never called to completion`, excerpt(run.stdout))
  const structured = call?.structured_content ?? null
  const text = Array.isArray(call?.content)
    ? String((call.content[0] as { text?: string } | undefined)?.text ?? "")
    : ""
  check(
    structured === null && (markdownNeedle === undefined ? text.length > 0 : text.includes(markdownNeedle)),
    `${tool} reached Codex with structuredContent (or empty text) — the text-only shaping did not trigger; ` +
      "Codex may have renamed its codex-mcp-client identity",
    excerpt(JSON.stringify(call)),
  )
  lines.push(`shaping: ${tool} reached Codex as Markdown text without structuredContent`)
}

interface Event {
  readonly type?: string
  readonly item?: {
    readonly type?: string
    readonly text?: string
    readonly server?: string
    readonly tool?: string
    readonly status?: string
    readonly result?: {
      readonly content?: readonly { readonly text?: string }[]
      readonly structured_content?: unknown
    }
  }
}

/** One JSON event per line from `codex exec --json`; anything unparsable is skipped. */
function parseEvents(stdout: string): Event[] {
  const events: Event[] = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed) as Event
      if (typeof parsed.type === "string") events.push(parsed)
    } catch {
      // Non-JSON lines are not events; ignore.
    }
  }
  return events
}

function lastAgentMessage(events: readonly Event[]): string {
  const messages = events.filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
  return messages.at(-1)?.item?.text ?? ""
}

function runPrompt(runner: Runner, env: Record<string, string>, prompt: string) {
  return runner.run(
    ["codex", "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", prompt],
    { cwd: runner.projectDir.guest, env, timeoutMs: RUN_TIMEOUT_MS },
  )
}
