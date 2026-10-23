import { apiKeyFromEnv, MISSING_API_KEY_MESSAGE } from "../core/auth";
import { createRetrievalClient, type RetrievalClient } from "../core/client";
import { configFilePath, readFileOptionsReport } from "../core/config-file";
import { configSummaryValues, formatConfigValue } from "../core/config-summary";
import type { Env } from "../core/env";
import { pluginOptionsFromEnv, resolveEnvOptions } from "../core/env";
import { formatSearchResults } from "../core/format";

const EXIT_CONFIG_PROBLEMS = 1;
const EXIT_USAGE = 2;

const HOST_OVERRIDE_NOTE =
  "Host-native layers (OpenCode options, Pi settings) may override file and env values per host.";

/** Where the config command writes; the installer CLI resolves its CliIo into this. */
export interface ConfigCommandIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Injectable seams: the environment to resolve, and the client for --search. */
export interface ConfigCommandDeps {
  readonly env?: Env;
  readonly client?: RetrievalClient;
}

/**
 * The `config` subcommand: the user-facing arm of configuration visibility.
 * Prints the effective options exactly as the MCP server would resolve them
 * (defaults < shared file < environment), each knob with its value and source,
 * and replays the file problems that would only whisper past on stderr at
 * runtime. With `query` set, runs one real billed search through that config —
 * the end-to-end verifier for key, config, and network. Returns the exit code:
 * 0 normally, 1 for file problems (plain form) or a failed search, 2 for a
 * blank --search query. A missing file is not a problem.
 */
export async function runConfigCommand(
  query: string | undefined,
  io: ConfigCommandIo,
  deps: ConfigCommandDeps = {},
): Promise<number> {
  if (query !== undefined && !query.trim()) {
    io.err('error: --search requires a query (for example: config --search "deepseek mcp")');
    return EXIT_USAGE;
  }

  const env = deps.env ?? process.env;
  const file = configFilePath({ env });
  const report = readFileOptionsReport(file);
  for (const warning of report.warnings) io.err(`warning: ${warning}`);

  // The same layers, in the same order, as the MCP server's startup resolution.
  const envOptions = pluginOptionsFromEnv(env);
  const resolved = resolveEnvOptions(env, report.options);

  if (query === undefined) {
    printConfigReport(file, report.exists, report.options, envOptions, resolved, io);
    return report.warnings.length > 0 ? EXIT_CONFIG_PROBLEMS : 0;
  }

  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) {
    io.err(MISSING_API_KEY_MESSAGE);
    return EXIT_CONFIG_PROBLEMS;
  }
  const client = deps.client ?? createRetrievalClient();
  const startedAt = Date.now();
  try {
    const results = await client.searchWeb(query, resolved.search, {
      signal: new AbortController().signal,
      auth: { apiKey },
      retry: resolved.retry,
    });
    const elapsedMs = Date.now() - startedAt;
    io.out(
      `search "${query.trim()}" — ${results.length} ${results.length === 1 ? "result" : "results"} in ${elapsedMs} ms`,
    );
    io.out("");
    for (const line of formatSearchResults(results).split("\n")) io.out(line);
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT_CONFIG_PROBLEMS;
  }
}

/** The knob table, in the vocabulary order the startup deviation summary uses. */
function printConfigReport(
  file: string,
  exists: boolean,
  fileOptions: Readonly<Record<string, unknown>>,
  envOptions: Readonly<Record<string, unknown>>,
  resolved: ReturnType<typeof resolveEnvOptions>,
  io: ConfigCommandIo,
): void {
  io.out(`Config file: ${file} (${exists ? "exists" : "missing"})`);
  io.out("");
  const effective = configSummaryValues(resolved);
  const fileKeys = new Set(Object.keys(fileOptions));
  const envKeys = new Set(Object.keys(envOptions));
  for (const name of Object.keys(effective)) {
    // The environment wins over the file for the same key, exactly as resolution does.
    let source = envKeys.has(name) ? "env" : fileKeys.has(name) ? "file" : "default";
    // maxResults follows the effective count when unset (options.ts), so when
    // the count knob was configured its derived value is not "default" — its
    // source is the count setting that drove it.
    if (name === "maxResults" && source === "default" && (envKeys.has("count") || fileKeys.has("count"))) {
      source = "count";
    }
    io.out(`${name} = ${formatConfigValue(effective[name], "join")} (${source})`);
  }
  io.out("");
  io.out(HOST_OVERRIDE_NOTE);
}
