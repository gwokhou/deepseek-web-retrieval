import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ScenarioError } from "./assert";
import type { ExecResult, Runner } from "./runner";

/** The port the mock upstream binds inside each scenario's container. */
export const MOCK_PORT = 8791;
export const MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
/** The placeholder key every scenario passes; the mock asserts it as the bearer. */
export const PLACEHOLDER_KEY = "sk-e2e-placeholder";
/** The needles the mock serves and the scenarios assert end to end. */
export const FETCH_NEEDLE = "Example Domain";
export const SEARCH_NEEDLE = "https://mock.example/e2e-search";

export type MockRequest = {
  readonly kind: "search" | "fetch" | "chat";
  readonly auth?: string | null;
  readonly body?: { readonly url?: string; readonly query?: string } & Record<string, unknown>;
  readonly round?: string;
  readonly tool?: string;
  readonly toolResult?: string;
};

/**
 * Runs one host-CLI invocation inside a single container that also runs the
 * mock upstream: the server starts in the background, a health poll gates the
 * host command, and both processes die with the container. The wrapper's own
 * stdout is only the host command's output; the mock's request log and server
 * diagnostics land in files under the mounted project dir for host-side
 * assertions (`readMockLog`).
 */
export async function runWithMockUpstream(
  runner: Runner,
  name: string,
  command: readonly string[],
  options: { cwd: string; env: Readonly<Record<string, string | undefined>>; timeoutMs?: number },
): Promise<ExecResult> {
  const log = join(runner.projectDir.guest, `mock-${name}.jsonl`);
  const serverLog = join(runner.projectDir.guest, `mock-${name}.server.log`);
  const script = [
    `node ${shellQuote(join(runner.repoDir, "test", "e2e", "mock-upstream.mjs"))} --port ${MOCK_PORT} --log ${shellQuote(log)} > ${shellQuote(serverLog)} 2>&1 &`,
    "mock_pid=$!",
    "ready=0",
    "for i in $(seq 1 100); do",
    `  if node -e ${shellQuote(`fetch("${MOCK_BASE_URL}/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`)}; then ready=1; break; fi`,
    "  sleep 0.2",
    "done",
    'if [ "$ready" != 1 ]; then',
    `  echo "mock upstream did not become ready" && cat ${shellQuote(serverLog)}`,
    "  kill $mock_pid 2>/dev/null",
    "  exit 90",
    "fi",
    command.map(shellQuote).join(" "),
    "rc=$?",
    "kill $mock_pid 2>/dev/null",
    "wait $mock_pid 2>/dev/null",
    "exit $rc",
  ].join("\n");
  return runner.run(["bash", "-c", script], options);
}

/** The mock upstream's request log for one wrapped invocation, parsed. */
export function readMockLog(runner: Runner, name: string): readonly MockRequest[] {
  const file = join(runner.projectDir.host, `mock-${name}.jsonl`);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new ScenarioError(`mock log ${file} is missing — the mock upstream never received a request`);
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as MockRequest);
}

/** The retrieval requests of one kind the mock served, with the bearer checked. */
export function retrievalCalls(log: readonly MockRequest[], kind: "search" | "fetch"): readonly MockRequest[] {
  return log.filter((entry) => entry.kind === kind && entry.auth === `Bearer ${PLACEHOLDER_KEY}`);
}

/** True when a round-two chat request quoted a tool result containing the needle. */
export function toolResultReachedModel(log: readonly MockRequest[], needle: string): boolean {
  return log.some(
    (entry) => entry.kind === "chat" && entry.round === "final" && (entry.toolResult ?? "").includes(needle),
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
