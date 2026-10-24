import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import pkg from "../../package.json";
import type { RetrievalClient } from "../core/client";
import { retrievalClient } from "../core/client";
import { ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../core/constants";
import {
  FETCH_TOOL_DESCRIPTION,
  FETCH_URL_PARAMETER,
  SEARCH_ORI_QUESTION_PARAMETER,
  SEARCH_QUERY_PARAMETER,
  SEARCH_TOOL_DESCRIPTION,
} from "../core/descriptions";
import type { Env } from "../core/env";
import { formatSearchResults, toStructuredResult } from "../core/format";
import type { ResolvedOptions } from "../core/types";
import { requireApiKey } from "./auth";
import { omitStructuredContent } from "./client";

export const MCP_SERVER_NAME = "deepseek-web-retrieval";

const SEARCH_INPUT = z.object({
  query: z.string().min(1).describe(SEARCH_QUERY_PARAMETER),
  original_question: z.string().optional().describe(SEARCH_ORI_QUESTION_PARAMETER),
});

const FETCH_INPUT = z.object({
  url: z.string().min(1).describe(FETCH_URL_PARAMETER),
});

/**
 * Builds the host-agnostic MCP server exposing the two DeepSeek retrieval tools.
 * `serveStdio` and `createMcpHandler` serve both protocol eras from this factory.
 */
export function createDeepSeekServer(
  config: ResolvedOptions,
  env: Env = process.env,
  client: RetrievalClient = retrievalClient,
): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: pkg.version });

  if (config.search.enabled) {
    server.registerTool(
      "deepseek_web_search",
      {
        title: "DeepSeek Web Search",
        description: SEARCH_TOOL_DESCRIPTION,
        inputSchema: SEARCH_INPUT,
        annotations: { readOnlyHint: true },
      },
      async ({ query, original_question }, ctx) => {
        try {
          const request = requestContext(config, env, ctx.mcpReq.signal);
          const results = await client.searchWeb(query, config.search, {
            ...request,
            oriQuestion: original_question,
          });
          return callResult(server, ctx, formatSearchResults(results), {
            results: results.map(toStructuredResult),
          });
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
  }

  if (config.fetch.enabled) {
    server.registerTool(
      "deepseek_fetch",
      {
        title: "DeepSeek Fetch",
        description: FETCH_TOOL_DESCRIPTION,
        inputSchema: FETCH_INPUT,
        annotations: { readOnlyHint: true },
      },
      async ({ url }, ctx) => {
        try {
          const request = requestContext(config, env, ctx.mcpReq.signal);
          const page = await client.fetchDocument(url, config.fetch, request);
          return callResult(server, ctx, page.content, {
            url: page.url,
            title: page.title,
            content: page.content,
            truncated: page.truncated,
          });
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
  }

  return server;
}

function requestContext(config: ResolvedOptions, env: Env, signal: AbortSignal) {
  return { signal, auth: { apiKey: requireApiKey(env) }, retry: config.retry, baseUrl: config.baseUrl };
}

/**
 * Text content always reaches the model; the structured mirror is dropped for
 * clients that would replace the text with its serialized JSON (Codex does).
 * The tools declare no `outputSchema` on purpose: the SDK rejects text-only
 * results for a tool with a declared schema ("no structured content was
 * provided"), and no host in the matrix validates the schema anyway.
 */
function callResult(
  server: McpServer,
  ctx: ServerContext,
  text: string,
  structured: Record<string, unknown>,
): CallToolResult {
  if (omitStructuredContent(server, ctx)) return { content: [{ type: "text", text }] };
  return { content: [{ type: "text", text }], structuredContent: structured };
}

/** Returns the both-disabled message, or undefined when a tool stays enabled. */
export function servePrecheck(config: ResolvedOptions): string | undefined {
  if (config.search.enabled || config.fetch.enabled) return undefined;
  return (
    `Both tools are disabled (${ENABLE_SEARCH_ENV} and ${ENABLE_FETCH_ENV} are false); ` +
    "at least one must stay enabled."
  );
}

function toErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}
