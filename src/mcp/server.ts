import { McpServer } from "@modelcontextprotocol/server"
import type { CallToolResult } from "@modelcontextprotocol/server"
import * as z from "zod/v4"
import { fetchDocument, searchWeb } from "../core/client"
import type { ResolvedOptions, WebSearchResult } from "../core/types"
import pkg from "../../package.json"
import { requireApiKey } from "./auth"
import type { Env } from "./config"
import { formatSearchResults } from "./format"

export const MCP_SERVER_NAME = "deepseek-web-retrieval"

const SEARCH_INPUT = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Search query, 128 characters or fewer including operators (site:, -site:, quoted phrases, lang:).",
    ),
})

const SEARCH_OUTPUT = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
      published: z.number().optional(),
    }),
  ),
})

const FETCH_INPUT = z.object({
  url: z.string().min(1).describe("Absolute http:// or https:// URL to fetch. Credentials are rejected."),
})

const FETCH_OUTPUT = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  truncated: z.boolean(),
})

const SEARCH_DESCRIPTION =
  "Search the web with DeepSeek's in-house search engine and return a short, filtered result " +
    "list (title, URL, summary). Results are ranked by relevance and source authority, deduplicated " +
    "by URL, and capped at the configured maximum. An empty result list is normal, not an error. " +
    "Use site:/-site: operators in the query to include or exclude domains; the full query must stay " +
    "within 128 characters. To read a full page, pass a result URL to the deepseek_fetch tool."

const FETCH_DESCRIPTION =
  "Fetch one web page as clean Markdown through DeepSeek's Fetch API. DeepSeek does not render " +
    "JavaScript and cannot reach private networks; PDFs, images, and other binary files are " +
    "unsupported. Output is truncated to the configured size."

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
        outputSchema: SEARCH_OUTPUT,
        annotations: { readOnlyHint: true },
      },
      async ({ query }, ctx) => {
        try {
          const request = requestContext(config, env, ctx.mcpReq.signal)
          const results = await searchWeb(query, config.search, request)
          return {
            content: [{ type: "text", text: formatSearchResults(results) }],
            structuredContent: { results: results.map(toStructuredResult) },
          }
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
        outputSchema: FETCH_OUTPUT,
        annotations: { readOnlyHint: true },
      },
      async ({ url }, ctx) => {
        try {
          const request = requestContext(config, env, ctx.mcpReq.signal)
          const page = await fetchDocument(url, config.fetch, request)
          return {
            content: [{ type: "text", text: page.content }],
            structuredContent: {
              url: page.url,
              title: page.title,
              content: page.content,
              truncated: page.truncated,
            },
          }
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

function toStructuredResult(result: WebSearchResult) {
  return {
    url: result.url,
    ...(result.title ? { title: result.title } : {}),
    ...(result.content ? { content: result.content } : {}),
    ...(result.time.published !== undefined ? { published: result.time.published } : {}),
  }
}

function toErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: "text", text: message }], isError: true }
}
