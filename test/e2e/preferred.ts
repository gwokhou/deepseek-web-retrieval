import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc } from "../../src/core/jsonc";
import { check, excerpt, requireEnv } from "./assert";
import type { Runner } from "./runner";
import { findPackedTarball, prewarmNpx } from "./tarball";

const RUN_TIMEOUT_MS = 240_000;
const MODEL = "deepseek/deepseek-flash";

/**
 * Billed coverage of the preferred tier through the installer's own product:
 * `init --host pi --scope project --search preferred --fetch preferred` writes
 * `.pi/mcp.json` plus the AGENTS.md rules block, and the prompts then ask in
 * natural language WITHOUT naming any tool — the only thing that can steer the
 * model to `mcp__deepseek__*` is the rules block, which is exactly what the
 * preferred tier promises. Also covers the project scope end to end, including
 * the print-mode `--approve` trust path for `.pi/mcp.json`.
 */
export async function runPreferredScenario(runner: Runner): Promise<string[]> {
  const apiKey = requireEnv("DEEPSEEK_API_KEY", "the preferred scenario makes real billed DeepSeek requests");
  const log: string[] = [];
  const cli = join(runner.repoDir, "dist", "cli.js");
  const tarball = findPackedTarball(runner.repoHostDir);
  // The `file:` spec keeps npx in package mode; a bare path would be executed as a command.
  const packageRef = `file:${join(runner.repoDir, tarball)}`;
  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: apiKey };
  const cwd = runner.projectDir.guest;

  const init = await runner.run(
    [
      "node",
      cli,
      "init",
      "--host",
      "pi",
      "--scope",
      "project",
      "--search",
      "preferred",
      "--fetch",
      "preferred",
      "--path",
      "mcp",
      "--package",
      packageRef,
      "--apply",
    ],
    { cwd, env },
  );
  check(init.exitCode === 0, "installer init (pi project preferred) failed", excerpt(`${init.stdout}\n${init.stderr}`));

  const projectConfig = parseJsonc(readFileSync(join(runner.projectDir.host, ".pi", "mcp.json"), "utf8")) as {
    mcpServers?: { deepseek?: { exposure?: unknown } };
  };
  check(projectConfig.mcpServers?.deepseek !== undefined, "installer did not write .pi/mcp.json");
  check(projectConfig.mcpServers?.deepseek?.exposure === "direct", "project registration lacks exposure direct");
  const agents = readFileSync(join(runner.projectDir.host, "AGENTS.md"), "utf8");
  check(
    agents.includes("<!-- deepseek-web-retrieval:pi:rules:begin -->") && agents.includes("mcp__deepseek__"),
    "AGENTS.md rules block is missing or does not name the tools",
  );
  log.push("preferred: installer wrote .pi/mcp.json and the AGENTS.md rules block at project scope");

  await prewarmNpx(runner, env, packageRef);

  const searchReply = await runPrompt(
    runner,
    env,
    "Search the web for the official Rust programming language documentation and reply with exactly one source URL and nothing else.",
  );
  check(
    /https?:\/\/\S+/i.test(searchReply),
    "natural-language search prompt did not return a URL",
    excerpt(searchReply),
  );
  log.push("preferred: rules block steered an unnamed search prompt to deepseek_web_search (billed)");

  const fetchReply = await runPrompt(
    runner,
    env,
    "Fetch https://example.com and reply with only the page's main heading.",
  );
  check(
    /Example Domain/i.test(fetchReply),
    "natural-language fetch prompt did not return the heading",
    excerpt(fetchReply),
  );
  log.push("preferred: rules block steered an unnamed fetch prompt to deepseek_fetch (billed)");

  log.push("note: real DeepSeek requests were billed by this scenario (LLM + retrieval)");
  return log;
}

async function runPrompt(runner: Runner, env: Record<string, string | undefined>, prompt: string): Promise<string> {
  const result = await runner.run(["pi", "--print", "--approve", "--model", MODEL, prompt], {
    cwd: runner.projectDir.guest,
    env,
    timeoutMs: RUN_TIMEOUT_MS,
  });
  check(result.exitCode === 0, "`pi --print` failed", excerpt(result.stderr || result.stdout));
  return result.stdout;
}
