import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API_KEY_ENV } from "../../src/core/constants";
import { check, excerpt, requireEnv } from "./assert";
import type { Runner } from "./runner";

const RUN_TIMEOUT_MS = 300_000;

/**
 * Billed, Docker-only scenario. Isolated HOME whose `.mcp.json` registers the
 * built MCP server and whose `.claude/settings.json` denies the built-in
 * WebSearch/WebFetch tools (the forced-tier kill switch, exercised for real),
 * with Claude Code itself pointed at DeepSeek as the LLM through DeepSeek's
 * Anthropic-compatible endpoint — one key pays for both legs, mirroring the
 * codex and opencode scenarios.
 *
 * The container runs as root, where Claude Code refuses
 * `--dangerously-skip-permissions` unless it recognizes a sandbox: `IS_SANDBOX=1`
 * marks the run (verified at the lock; deny rules still apply in every mode,
 * including bypassPermissions). `-p` mode additionally requires `--verbose` for
 * `--output-format stream-json`. A `-p` session connects `.mcp.json` servers
 * without the per-project approval prompt, so `settings.local.json` approving
 * them is belt and suspenders; `~/.claude.json` marks onboarding complete. The
 * key stays in the environment: the server entry uses `${DEEPSEEK_API_KEY}`
 * expansion, never a literal.
 */
export async function runClaudeCodeScenario(runner: Runner): Promise<string[]> {
  check(
    existsSync(join(runner.repoHostDir, "dist", "cli.js")),
    "dist/cli.js is missing; the harness runs `bun run build` first, so this means the build failed",
  );
  const apiKey = requireEnv("DEEPSEEK_API_KEY", "the claude-code scenario makes real billed DeepSeek requests");
  const lines: string[] = [];
  const env = {
    HOME: runner.homeDir.guest,
    DEEPSEEK_API_KEY: apiKey,
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: apiKey,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    IS_SANDBOX: "1",
  };

  const projectDir = runner.projectDir.host;
  writeFileSync(
    join(projectDir, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          deepseek: {
            command: "node",
            args: [join(runner.repoDir, "dist", "cli.js")],
            env: { [API_KEY_ENV]: `\${${API_KEY_ENV}}` },
          },
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(
    join(projectDir, ".claude", "settings.json"),
    JSON.stringify({ permissions: { deny: ["WebSearch", "WebFetch"] } }, null, 2),
  );
  writeFileSync(
    join(projectDir, ".claude", "settings.local.json"),
    JSON.stringify({ enableAllProjectMcpServers: true }),
  );
  writeFileSync(join(runner.homeDir.host, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }));
  lines.push(
    `wrote ${join(runner.projectDir.guest, ".mcp.json")} + .claude/settings.json (deny WebSearch/WebFetch; key expanded from the environment)`,
  );

  const version = await runner.run(["claude", "--version"], { cwd: runner.projectDir.guest, env });
  check(version.exitCode === 0, "claude --version failed", excerpt(`${version.stdout}\n${version.stderr}`));
  lines.push(`claude: ${version.stdout.trim()}`);

  const fetchPrompt =
    "Use the mcp__deepseek__deepseek_fetch tool to fetch https://example.com and reply with only the page's H1 heading.";
  const fetchRun = await runPrompt(runner, env, fetchPrompt);
  const fetchEvents = parseEvents(fetchRun.stdout);
  check(
    /Example Domain/i.test(finalResult(fetchEvents)),
    "fetch prompt did not return the example heading",
    excerpt(`${fetchRun.stdout}\n${fetchRun.stderr}`),
  );
  checkToolLeg(lines, fetchEvents, fetchRun, "mcp__deepseek__deepseek_fetch", "Example Domain");
  lines.push("fetch: model fetched example.com through deepseek_fetch (billed)");

  const searchPrompt =
    'Use the mcp__deepseek__deepseek_web_search tool to search the web for "claude code mcp" and reply with only one result URL.';
  const searchRun = await runPrompt(runner, env, searchPrompt);
  const searchEvents = parseEvents(searchRun.stdout);
  const lastLine =
    finalResult(searchEvents)
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .pop() ?? "";
  check(
    /^https?:\/\/\S+$/.test(lastLine),
    "search prompt did not end with exactly a result URL",
    excerpt(`${searchRun.stdout}\n${searchRun.stderr}`),
  );
  checkToolLeg(lines, searchEvents, searchRun, "mcp__deepseek__deepseek_web_search", undefined);
  lines.push("search: model searched through deepseek_web_search (billed)");

  lines.push("both legs (LLM + retrieval) were billed to the single DeepSeek key");
  return lines;
}

/** Asserts the DeepSeek tool ran to completion and the built-ins never appeared. */
function checkToolLeg(
  lines: string[],
  events: readonly Event[],
  run: { readonly stdout: string; readonly stderr: string },
  tool: string,
  markdownNeedle: string | undefined,
): void {
  const tools = toolUses(events);
  check(tools.includes(tool), `${tool} was never called`, excerpt(run.stdout));
  check(
    !tools.includes("WebSearch") && !tools.includes("WebFetch"),
    "the built-in WebSearch/WebFetch were callable — the permissions.deny kill switch did not take effect",
    excerpt(run.stdout),
  );
  lines.push("kill switch: WebSearch and WebFetch stayed denied for the whole session");
  if (markdownNeedle !== undefined) {
    // Stream shape verified at the lock: a tool_use block carries its id in `id`;
    // the matching tool_result references it via `tool_use_id` and carries the
    // server's output as a string. Search the serialization so any shape fits.
    const ids = new Set(
      events.flatMap((event) =>
        (event.message?.content ?? [])
          .filter((block) => block.type === "tool_use" && block.name === tool)
          .map((block) => String(block.id ?? "")),
      ),
    );
    const results = events.flatMap((event) =>
      (event.message?.content ?? []).filter(
        (block) => block.type === "tool_result" && ids.has(String(block.tool_use_id ?? "")),
      ),
    );
    check(
      JSON.stringify(results).includes(markdownNeedle),
      `${tool} result did not reach the model as text containing "${markdownNeedle}"`,
      excerpt(run.stdout),
    );
    lines.push(`shaping: ${tool} returned its Markdown text to the model`);
  }
}

interface Event {
  readonly type?: string;
  readonly message?: {
    readonly content?: readonly {
      readonly type?: string;
      readonly name?: string;
      readonly id?: string;
      readonly tool_use_id?: string;
    }[];
  };
  readonly result?: string;
}

/** One JSON event per line from `claude -p --output-format stream-json`; unparsable lines are skipped. */
function parseEvents(stdout: string): Event[] {
  const events: Event[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as Event;
      if (typeof parsed.type === "string") events.push(parsed);
    } catch {
      // Non-JSON lines are not events; ignore.
    }
  }
  return events;
}

function finalResult(events: readonly Event[]): string {
  return [...events].reverse().find((event) => event.type === "result")?.result ?? "";
}

function toolUses(events: readonly Event[]): readonly string[] {
  const names: string[] = [];
  for (const event of events) {
    if (event.type !== "assistant") continue;
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use" && typeof block.name === "string") names.push(block.name);
    }
  }
  return names;
}

function runPrompt(runner: Runner, env: Record<string, string>, prompt: string) {
  return runner.run(
    [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "deepseek-flash",
      "--dangerously-skip-permissions",
      "--max-turns",
      "8",
    ],
    { cwd: runner.projectDir.guest, env, timeoutMs: RUN_TIMEOUT_MS },
  );
}
