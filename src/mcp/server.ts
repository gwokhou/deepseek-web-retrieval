import { McpServer } from "@modelcontextprotocol/server"
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server"
import * as z from "zod/v4"
import { fetchDocument, searchWeb } from "../core/client"
import { ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../core/constants"
import {
  FETCH_OUTPUT_TRUNCATED,
  FETCH_SERVICE_LIMITS,
  SEARCH_EMPTY_IS_NORMAL,
  SEARCH_QUERY_OPERATORS,
  SEARCH_RANKED_FILTERED,
} from "../core/descriptions"
import { formatSearchResults } from "../core/format"
import type { ResolvedOptions, SearchResult } from "../core/types"
import pkg from "../../package.json"
import { requireApiKey } from "./auth"
import { omitStructuredContent } from "./client"
import type { Env } from "./config"

export const MCP_SERVER_NAME = "deepseek-web-retrieval"

const SEARCH_INPUT = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Search query, 128 characters or fewer including operators (site:, -site:, quoted phrases, lang:).",
    ),
})

const FETCH_INPUT = z.object({
  url: z.string().min(1).describe("Absolute http:// or https:// URL to fetch. Credentials are rejected."),
})

const SEARCH_DESCRIPTION =
  "Search the web with DeepSeek's in-house search engine and return a short, filtered result " +
    "list (title, URL, summary). " +
    `${SEARCH_RANKED_FILTERED} ` +
    `${SEARCH_EMPTY_IS_NORMAL} ` +
    `${SEARCH_QUERY_OPERATORS} ` +
    "To read a full page, pass a result URL to the deepseek_fetch tool."

const FETCH_DESCRIPTION =
  "Fetch one web page as clean Markdown through DeepSeek's Fetch API. " +
    `${FETCH_SERVICE_LIMITS} ` +
    `${FETCH_OUTPUT_TRUNCATED}`

/**
 * Builds the host-agnostic MCP server exposing the two DeepSeek retrieval tools.
 * `serveStdio` and `createMcpHandler` serve both protocol eras from this factory.
 */
export function createDeepSeekServer(config: ResolvedOptions, env: Env = process.env): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: pkg.version })

  if (config.search.enabled) {
    server.registerTool(
      "deepseek_web_search",
      {
        title: "DeepSeek Web Search",
        description: SEARCH_DESCRIPTION,
        inputSchema: SEARCH_INPUT,
        annotations: { readOnlyHint: true },
      },
      async ({ query }, ctx) => {
        try {
          const request = requestContext(config, env, ctx.mcpReq.signal)
          const results = await searchWeb(query, config.search, request)
          return callResult(server, ctx, formatSearchResults(results), {
            results: results.map(toStructuredResult),
          })
        } catch (error) {
          return toErrorResult(error)
        }
      },
    )
  }

  if (config.fetch.enabled) {
    server.registerTool(
      "deepseek_fetch",
      {
        title: "DeepSeek Fetch",
        description: FETCH_DESCRIPTION,
        inputSchema: FETCH_INPUT,
        annotations: { readOnlyHint: true },
      },
      async ({ url }, ctx) => {
        try {
          const request = requestContext(config, env, ctx.mcpReq.signal)
          const page = await fetchDocument(url, config.fetch, request)
          return callResult(server, ctx, page.content, {
            url: page.url,
            title: page.title,
            content: page.content,
            truncated: page.truncated,
          })
        } catch (error) {
          return toErrorResult(error)
        }
      },
    )
  }

  return server
}

function requestContext(config: ResolvedOptions, env: Env, signal: AbortSignal) {
  return { signal, auth: { apiKey: requireApiKey(env) }, retry: config.retry }
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
  if (omitStructuredContent(server, ctx)) return { content: [{ type: "text", text }] }
  return { content: [{ type: "text", text }], structuredContent: structured }
}

function toStructuredResult(result: SearchResult) {
  return {
    url: result.url,
    ...(result.title ? { title: result.title } : {}),
    ...(result.content ? { content: result.content } : {}),
    ...(result.published !== undefined ? { published: result.published } : {}),
  }
}

/** Returns the both-disabled message, or undefined when a tool stays enabled. */
export function servePrecheck(config: ResolvedOptions): string | undefined {
  if (config.search.enabled || config.fetch.enabled) return undefined
  return (
    `Both tools are disabled (${ENABLE_SEARCH_ENV} and ${ENABLE_FETCH_ENV} are false); ` +
    "at least one must stay enabled."
  )
}

function toErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: "text", text: message }], isError: true }
}
