import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, excerpt } from "./assert";
import {
  FETCH_NEEDLE,
  MOCK_BASE_URL,
  PLACEHOLDER_KEY,
  readMockLog,
  retrievalCalls,
  runWithMockUpstream,
  SEARCH_CONTENT_NEEDLE,
  SEARCH_NEEDLE,
  toolResultReachedModel,
} from "./mock";
import type { Runner } from "./runner";

const RUN_TIMEOUT_MS = 180_000;
const MODEL = "mock-e2e/mock-chat";

/**
 * Keyless, invocation-level Pi scenario: the same extension-path session shape
 * as `pi-billed`, but every upstream is the in-container mock — the LLM through
 * a custom `models.json` provider (OpenAI-compatible against the mock's chat
 * completions) and the retrieval through `DEEPSEEK_BASE_URL`. The mock's script
 * issues the tool call, the extension's tool runs for real, and the scenario
 * asserts both the final answer and the mock's request log: the retrieval hit
 * the mock endpoints with the placeholder bearer, and the tool result reached
 * the model. Nothing leaves the container and no key is ever billed.
 */
export async function runPiMockScenario(runner: Runner): Promise<string[]> {
  const log: string[] = [];
  const settingsDir = join(runner.homeDir.host, ".pi", "agent");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ packages: [runner.repoDir] }, null, 2));
  writeFileSync(
    join(settingsDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          "mock-e2e": {
            name: "Mock E2E Upstream",
            baseUrl: `${MOCK_BASE_URL}/v1`,
            apiKey: PLACEHOLDER_KEY,
            api: "openai-completions",
            models: [
              {
                id: "mock-chat",
                name: "Mock Chat",
                contextWindow: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
      null,
      2,
    ),
  );

  const env = { HOME: runner.homeDir.guest, DEEPSEEK_API_KEY: PLACEHOLDER_KEY, DEEPSEEK_BASE_URL: MOCK_BASE_URL };
  const cwd = runner.projectDir.guest;

  const version = await runner.run(["pi", "--version"], { cwd, env });
  log.push(`pi version: ${excerpt(version.stdout.trim(), 80)}`);

  const fetchResult = await runWithMockUpstream(
    runner,
    "pi-fetch",
    [
      "pi",
      "--print",
      "--model",
      MODEL,
      "Use the deepseek_fetch tool to fetch https://example.com and reply with only the page's H1 heading.",
    ],
    { cwd, env, timeoutMs: RUN_TIMEOUT_MS },
  );
  check(fetchResult.exitCode === 0, "`pi --print` (fetch) failed", excerpt(fetchResult.stderr || fetchResult.stdout));
  check(
    fetchResult.stdout.includes(FETCH_NEEDLE),
    "fetch prompt did not return the mock page heading",
    excerpt(fetchResult.stdout),
  );
  const fetchLog = readMockLog(runner, "pi-fetch");
  const fetchCalls = retrievalCalls(fetchLog, "fetch");
  check(
    fetchCalls.length > 0,
    "the mock fetch endpoint was never called with the placeholder bearer",
    excerpt(fetchResult.stderr),
  );
  check(
    (fetchCalls[0]?.body?.url ?? "").startsWith("https://example.com"),
    "the fetch request did not carry the example.com target",
    JSON.stringify(fetchCalls[0]?.body),
  );
  check(toolResultReachedModel(fetchLog, FETCH_NEEDLE), "the fetch tool result never reached the model");
  log.push("pi-mock: deepseek_fetch ran against the mock upstream and its result reached the model");

  const searchResult = await runWithMockUpstream(
    runner,
    "pi-search",
    [
      "pi",
      "--print",
      "--model",
      MODEL,
      'Use the deepseek_web_search tool to search the web for "example domain" and reply with exactly one source URL and nothing else.',
    ],
    { cwd, env, timeoutMs: RUN_TIMEOUT_MS },
  );
  check(
    searchResult.exitCode === 0,
    "`pi --print` (search) failed",
    excerpt(searchResult.stderr || searchResult.stdout),
  );
  check(
    searchResult.stdout.includes(SEARCH_NEEDLE),
    "search prompt did not return the mock result URL",
    excerpt(searchResult.stdout),
  );
  const searchLog = readMockLog(runner, "pi-search");
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
  check(
    searchCalls[0]?.body?.need_content === false,
    "a digest search should leave need_content false on the wire",
    JSON.stringify(searchCalls[0]?.body),
  );
  check(toolResultReachedModel(searchLog, SEARCH_NEEDLE), "the search tool result never reached the model");
  log.push("pi-mock: deepseek_web_search ran against the mock upstream and its result reached the model");

  const contentResult = await runWithMockUpstream(
    runner,
    "pi-search-content",
    [
      "pi",
      "--print",
      "--model",
      MODEL,
      'Use the deepseek_web_search tool with need_content set to true to search the web for "example domain" and reply with only the distinctive phrase from the page body.',
    ],
    { cwd, env, timeoutMs: RUN_TIMEOUT_MS },
  );
  check(
    contentResult.exitCode === 0,
    "`pi --print` (need_content search) failed",
    excerpt(contentResult.stderr || contentResult.stdout),
  );
  check(
    contentResult.stdout.includes(SEARCH_CONTENT_NEEDLE),
    "the need_content search did not surface the page-body phrase",
    excerpt(contentResult.stdout),
  );
  const contentLog = readMockLog(runner, "pi-search-content");
  const contentCalls = retrievalCalls(contentLog, "search");
  check(
    contentCalls.length > 0,
    "the mock search endpoint was never called for the need_content leg",
    excerpt(contentResult.stderr),
  );
  check(
    contentCalls[0]?.body?.need_content === true,
    "the need_content search request did not set the flag on the wire",
    JSON.stringify(contentCalls[0]?.body),
  );
  check(
    toolResultReachedModel(contentLog, SEARCH_CONTENT_NEEDLE),
    "the need_content page body never reached the model",
  );
  log.push("pi-mock: deepseek_web_search with need_content=true carried the page body end to end");

  log.push("note: fully keyless — the LLM and retrieval legs never left the container");
  return log;
}
