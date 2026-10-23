import { homedir } from "node:os";
import { Type } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { apiKeyFromEnv } from "../core/auth";
import type { RequestOptions, RetrievalClient } from "../core/client";
import { inspectFetchTarget, retrievalClient } from "../core/client";
import { sharedFileOptions } from "../core/config-file";
import { configDeviations } from "../core/config-summary";
import { API_KEY_ENV, ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../core/constants";
import {
  FETCH_TOOL_DESCRIPTION,
  FETCH_URL_PARAMETER,
  SEARCH_ORI_QUESTION_PARAMETER,
  SEARCH_QUERY_PARAMETER,
  SEARCH_TOOL_DESCRIPTION,
} from "../core/descriptions";
import type { Env } from "../core/env";
import { pluginOptionsFromEnv } from "../core/env";
import { formatSearchResults, toStructuredResult } from "../core/format";
import { resolvePluginOptions } from "../core/options";
import type { ResolvedOptions } from "../core/types";
import type { ExtensionSettings } from "./settings";
import { readExtensionSettings, SETTINGS_NAMESPACE } from "./settings";

const SEARCH_PARAMETERS = Type.Object({
  query: Type.String({ minLength: 1, description: SEARCH_QUERY_PARAMETER }),
  original_question: Type.Optional(
    Type.String({
      description: `${SEARCH_ORI_QUESTION_PARAMETER} When left blank, the most recent user message in the session is sent instead, truncated to fit.`,
    }),
  ),
});

const SEARCH_OUTPUT = Type.Object({
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      published: Type.Optional(Type.Number()),
      rerankScore: Type.Optional(Type.Number()),
      authority: Type.Optional(Type.Number()),
      siteName: Type.Optional(Type.String()),
    }),
  ),
});

const FETCH_PARAMETERS = Type.Object({
  url: Type.String({ minLength: 1, description: FETCH_URL_PARAMETER }),
});

const FETCH_OUTPUT = Type.Object({
  url: Type.String(),
  title: Type.String(),
  content: Type.String(),
  truncated: Type.Boolean(),
});

/** Pi may execute a tool without an abort signal; the core requires one. */
const NEVER_ABORTS = new AbortController().signal;

/**
 * Resolves the extension's options: defaults < shared config file < the shared
 * DEEPSEEK_* environment pipeline < the settings namespace. The file's path
 * follows the passed environment (XDG_CONFIG_HOME), so the function stays
 * injectable. Settings outrank both lower layers because the installer wrote
 * them as the explicit install-time intent (the off tier lands there — the
 * installer cannot write the shell environment).
 */
export function resolveExtensionOptions(env: Env = process.env, settings: ExtensionSettings = {}): ResolvedOptions {
  const options: Record<string, unknown> = { ...sharedFileOptions(env), ...pluginOptionsFromEnv(env) };
  if (settings.enableSearch === false) options.searchEnabled = false;
  if (settings.enableFetch === false) options.fetchEnabled = false;
  return resolvePluginOptions(options);
}

/** Returns the both-disabled message, or undefined when a tool stays enabled. */
export function extensionPrecheck(config: ResolvedOptions): string | undefined {
  if (config.search.enabled || config.fetch.enabled) return undefined;
  return (
    `Both tools are disabled (${ENABLE_SEARCH_ENV} and ${ENABLE_FETCH_ENV} are false, or the ` +
    `${SETTINGS_NAMESPACE} settings namespace disabled them); at least one must stay enabled.`
  );
}

/** The search tool as Pi registers it; exported for tests. */
export function searchTool(config: ResolvedOptions, client: RetrievalClient = retrievalClient) {
  return defineTool({
    name: "deepseek_web_search",
    label: "DeepSeek Web Search",
    description: SEARCH_TOOL_DESCRIPTION,
    promptSnippet: "Search the web with DeepSeek and return ranked results with summaries.",
    parameters: SEARCH_PARAMETERS,
    outputSchema: SEARCH_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
    exposure: "direct",
    async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult> {
      try {
        // The explicit parameter wins; only when the model left it blank does
        // the session fallback get a say.
        const explicit = params.original_question?.trim() ? params.original_question : undefined;
        const results = await client.searchWeb(params.query, config.search, {
          ...requestContext(config, signal),
          oriQuestion: explicit ?? sessionOriQuestion(ctx),
        });
        return {
          content: [{ type: "text", text: formatSearchResults(results) }],
          structuredContent: { results: results.map(toStructuredResult) },
          details: undefined,
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  });
}

/** The fetch tool as Pi registers it; exported for tests. */
export function fetchTool(config: ResolvedOptions, client: RetrievalClient = retrievalClient) {
  return defineTool({
    name: "deepseek_fetch",
    label: "DeepSeek Fetch",
    description: FETCH_TOOL_DESCRIPTION,
    promptSnippet: "Fetch one web page as clean Markdown with DeepSeek.",
    parameters: FETCH_PARAMETERS,
    outputSchema: FETCH_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
    exposure: "direct",
    async execute(_toolCallId, params, signal): Promise<AgentToolResult> {
      try {
        const target = inspectFetchTarget(params.url, config.fetch);
        const page = await client.fetchDocument(target, config.fetch, requestContext(config, signal));
        return {
          content: [{ type: "text", text: page.content }],
          structuredContent: {
            url: page.url,
            title: page.title,
            content: page.content,
            truncated: page.truncated,
          },
          details: undefined,
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  });
}

/**
 * The Pi extension entry. Pi loads this file through the package's `pi`
 * manifest and calls the default export inside its own process: the tools run
 * without MCP's 20 KB result truncation and 60 s request timeout, exposure is
 * `direct` by Pi's own default (no codemode trap), and the key is read
 * straight from the Pi process environment.
 */
export default function deepSeekWebRetrieval(pi: ExtensionAPI): void {
  const config = resolveExtensionOptions(process.env, readExtensionSettings(homedir(), process.cwd()));
  const precheck = extensionPrecheck(config);
  if (precheck) throw new Error(precheck);
  // Deviations only, printed once at registration: one stderr line so a
  // multi-layer resolution is visible where Pi surfaces extension output;
  // nothing deviating means no line at all (same contract as the MCP server).
  const deviations = configDeviations(config);
  if (deviations) console.error(`deepseek-web-retrieval config: ${deviations}`);
  if (config.search.enabled) pi.registerTool(searchTool(config));
  if (config.fetch.enabled) pi.registerTool(fetchTool(config));
}

function requestContext(config: ResolvedOptions, signal: AbortSignal | undefined): RequestOptions {
  return { signal: signal ?? NEVER_ABORTS, auth: { apiKey: requireApiKey() }, retry: config.retry };
}

/**
 * Best-effort `ori_question` fallback for when the model left the tool input
 * blank: the most recent user message text in the session projection, readable
 * synchronously at call time. Best-effort is the contract — Pi's runtime may
 * call `execute` without a context (the fifth argument is typed non-optional
 * but `wrapToolDefinition` passes `ctx ?? ctxFactory?.()`), and any surprise
 * (missing manager, thrown error, odd shape) must degrade to "no fallback"
 * rather than fail the search itself. Length handling stays in the core
 * client, which trims and clamps to the API's 128-char budget.
 */
function sessionOriQuestion(ctx: ExtensionToolContext | undefined): string | undefined {
  try {
    const messages = ctx?.sessionManager?.buildSessionProjection()?.messages;
    if (!Array.isArray(messages)) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = userMessageText(messages[i]);
      if (text !== undefined) return text;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** The trimmed text of a user message's string or `text`-block content, if any. */
function userMessageText(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { role, content } = message as { role?: unknown; content?: unknown };
  if (role !== "user") return undefined;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
                ? (part as { text?: unknown }).text
                : undefined,
            )
            .filter((part): part is string => typeof part === "string")
            .join(" ")
        : undefined;
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

function requireApiKey(): string {
  const key = apiKeyFromEnv();
  if (key) return key;
  throw new Error(
    `${API_KEY_ENV} is not set. The DeepSeek extension reads it from the environment of the Pi ` +
      "process; set it in the shell that launches Pi.",
  );
}

function toErrorResult(error: unknown): AgentToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], details: undefined, isError: true };
}
