import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, excerpt } from "./assert";
import {
  FETCH_NEEDLE,
  MOCK_BASE_URL,
  PLACEHOLDER_KEY,
  readMockLog,
  retrievalCalls,
  runWithMockUpstream,
  SEARCH_NEEDLE,
  toolResultReachedModel,
} from "./mock";
import type { Runner } from "./runner";

const RUN_TIMEOUT_MS = 180_000;

/**
 * Keyless, session-level OpenCode scenario: the same shape as the billed
 * `opencode` scenario — the plugin loads from this checkout, `deepseek_fetch`
 * runs as a tool and the built-in `websearch` is backed by the plugin's
 * provider — but the LLM is a custom provider pointed at the in-container mock
 * and the retrieval follows `DEEPSEEK_BASE_URL`. The scenario asserts the final
 * answers plus the mock's request log (retrieval carried the placeholder
 * bearer, which also proves the plugin's env-key fallback). Nothing leaves the
 * container and no key is ever billed.
 */
export async function runOpencodeMockScenario(runner: Runner): Promise<string[]> {
  const log: string[] = [];
  writeFileSync(
    join(runner.projectDir.host, "opencode.jsonc"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugins: [{ package: runner.repoDir }],
        websearch: { provider: "deepseek" },
        providers: {
          "mock-llm": {
            name: "Mock E2E LLM",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${MOCK_BASE_URL}/v1`, apiKey: PLACEHOLDER_KEY },
            models: { "mock-chat": { name: "Mock Chat" } },
          },
        },
        model: "mock-llm/mock-chat",
        permissions: [
          { action: "websearch", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "deepseek_fetch", resource: "*", effect: "allow" },
        ],
      },
      null,
      2,
    ),
  );

  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: PLACEHOLDER_KEY, DEEPSEEK_BASE_URL: MOCK_BASE_URL };
  const cwd = runner.projectDir.guest;

  const version = await runner.run(["opencode", "--version"], { cwd, env });
  log.push(`opencode version: ${excerpt(version.stdout.trim(), 80)}`);

  const fetchResult = await runWithMockUpstream(
    runner,
    "opencode-fetch",
    [
      "opencode",
      "run",
      "Fetch https://example.com using the deepseek_fetch tool, then reply with only the page's H1 heading text.",
    ],
    { cwd, env, timeoutMs: RUN_TIMEOUT_MS },
  );
  check(fetchResult.exitCode === 0, "`opencode run` (fetch) failed", excerpt(fetchResult.stderr || fetchResult.stdout));
  check(
    fetchResult.stdout.includes(FETCH_NEEDLE),
    "fetch prompt did not return the mock page heading",
    excerpt(fetchResult.stdout),
  );
  const fetchLog = readMockLog(runner, "opencode-fetch");
  const fetchCalls = retrievalCalls(fetchLog, "fetch");
  check(
    fetchCalls.length > 0,
    "the mock fetch endpoint was never called with the placeholder bearer (env-key fallback)",
    excerpt(fetchResult.stderr),
  );
  check(
    (fetchCalls[0]?.body?.url ?? "").startsWith("https://example.com"),
    "the fetch request did not carry the example.com target",
    JSON.stringify(fetchCalls[0]?.body),
  );
  check(toolResultReachedModel(fetchLog, FETCH_NEEDLE), "the fetch tool result never reached the model");
  log.push("opencode-mock: deepseek_fetch ran against the mock upstream and its result reached the model");

  const searchResult = await runWithMockUpstream(
    runner,
    "opencode-search",
    [
      "opencode",
      "run",
      'Search the web for "example domain" using websearch, then reply with exactly one source URL and nothing else.',
    ],
    { cwd, env, timeoutMs: RUN_TIMEOUT_MS },
  );
  check(
    searchResult.exitCode === 0,
    "`opencode run` (search) failed",
    excerpt(searchResult.stderr || searchResult.stdout),
  );
  check(
    searchResult.stdout.includes(SEARCH_NEEDLE),
    "search prompt did not return the mock result URL",
    excerpt(searchResult.stdout),
  );
  const searchLog = readMockLog(runner, "opencode-search");
  const searchCalls = retrievalCalls(searchLog, "search");
  check(
    searchCalls.length > 0,
    "the mock search endpoint was never called with the placeholder bearer",
    excerpt(searchResult.stderr),
  );
  check(
    typeof searchCalls[0]?.body?.query === "string" && searchCalls[0].body.query.length > 0,
    "the search request did not carry a query",
    JSON.stringify(searchCalls[0]?.body),
  );
  check(toolResultReachedModel(searchLog, SEARCH_NEEDLE), "the search tool result never reached the model");
  log.push(
    "opencode-mock: websearch (provider deepseek) ran against the mock upstream and its result reached the model",
  );

  log.push("note: fully keyless — the LLM and retrieval legs never left the container");
  return log;
}
