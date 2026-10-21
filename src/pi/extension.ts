import { homedir } from "node:os"
import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-coding-agent"
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { apiKeyFromEnv } from "../core/auth"
import { fetchDocument, inspectFetchTarget, searchWeb } from "../core/client"
import type { RequestOptions } from "../core/client"
import { API_KEY_ENV, ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../core/constants"
import {
  FETCH_TOOL_DESCRIPTION,
  FETCH_URL_PARAMETER,
  SEARCH_QUERY_PARAMETER,
  SEARCH_TOOL_DESCRIPTION,
} from "../core/descriptions"
import { pluginOptionsFromEnv } from "../core/env"
import type { Env } from "../core/env"
import { formatSearchResults, toStructuredResult } from "../core/format"
import { resolvePluginOptions } from "../core/options"
import type { ResolvedOptions, SearchResult } from "../core/types"
import { SETTINGS_NAMESPACE, readExtensionSettings } from "./settings"
import type { ExtensionSettings } from "./settings"

const SEARCH_PARAMETERS = Type.Object({
  query: Type.String({ minLength: 1, description: SEARCH_QUERY_PARAMETER }),
})

const SEARCH_OUTPUT = Type.Object({
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      published: Type.Optional(Type.Number()),
    }),
  ),
})

const FETCH_PARAMETERS = Type.Object({
  url: Type.String({ minLength: 1, description: FETCH_URL_PARAMETER }),
})

const FETCH_OUTPUT = Type.Object({
  url: Type.String(),
  title: Type.String(),
  content: Type.String(),
  truncated: Type.Boolean(),
})

/** Pi may execute a tool without an abort signal; the core requires one. */
const NEVER_ABORTS = new AbortController().signal

/**
 * Resolves the extension's options: the shared DEEPSEEK_* environment
 * pipeline, with the settings namespace layered on top. Settings outrank the
 * environment because the installer wrote them as the explicit install-time
 * intent (the off tier lands there — the installer cannot write the shell
 * environment).
 */
export function resolveExtensionOptions(
  env: Env = process.env,
  settings: ExtensionSettings = {},
): ResolvedOptions {
  const options: Record<string, unknown> = { ...pluginOptionsFromEnv(env) }
  if (settings.enableSearch === false) options.searchEnabled = false
  if (settings.enableFetch === false) options.fetchEnabled = false
  return resolvePluginOptions(options)
}

/** Returns the both-disabled message, or undefined when a tool stays enabled. */
export function extensionPrecheck(config: ResolvedOptions): string | undefined {
  if (config.search.enabled || config.fetch.enabled) return undefined
  return (
    `Both tools are disabled (${ENABLE_SEARCH_ENV} and ${ENABLE_FETCH_ENV} are false, or the ` +
    `${SETTINGS_NAMESPACE} settings namespace disabled them); at least one must stay enabled.`
  )
}

/** The search tool as Pi registers it; exported for tests. */
export function searchTool(config: ResolvedOptions) {
  return defineTool({
    name: "deepseek_web_search",
    label: "DeepSeek Web Search",
    description: SEARCH_TOOL_DESCRIPTION,
    promptSnippet: "Search the web with DeepSeek and return ranked results with summaries.",
    parameters: SEARCH_PARAMETERS,
    outputSchema: SEARCH_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
    exposure: "direct",
    async execute(_toolCallId, params, signal): Promise<AgentToolResult> {
      try {
        const results = await searchWeb(params.query, config.search, requestContext(config, signal))
        return {
          content: [{ type: "text", text: formatSearchResults(results) }],
          structuredContent: { results: results.map(toStructuredResult) },
          details: undefined,
        }
      } catch (error) {
        return toErrorResult(error)
      }
    },
  })
}

/** The fetch tool as Pi registers it; exported for tests. */
export function fetchTool(config: ResolvedOptions) {
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
        const target = inspectFetchTarget(params.url, config.fetch)
        const page = await fetchDocument(target, config.fetch, requestContext(config, signal))
        return {
          content: [{ type: "text", text: page.content }],
          structuredContent: {
            url: page.url,
            title: page.title,
            content: page.content,
            truncated: page.truncated,
          },
          details: undefined,
        }
      } catch (error) {
        return toErrorResult(error)
      }
    },
  })
}

/**
 * The Pi extension entry. Pi loads this file through the package's `pi`
 * manifest and calls the default export inside its own process: the tools run
 * without MCP's 20 KB result truncation and 60 s request timeout, exposure is
 * `direct` by Pi's own default (no codemode trap), and the key is read
 * straight from the Pi process environment.
 */
export default function deepSeekWebRetrieval(pi: ExtensionAPI): void {
  const config = resolveExtensionOptions(process.env, readExtensionSettings(homedir(), process.cwd()))
  const precheck = extensionPrecheck(config)
  if (precheck) throw new Error(precheck)
  if (config.search.enabled) pi.registerTool(searchTool(config))
  if (config.fetch.enabled) pi.registerTool(fetchTool(config))
}

function requestContext(config: ResolvedOptions, signal: AbortSignal | undefined): RequestOptions {
  return { signal: signal ?? NEVER_ABORTS, auth: { apiKey: requireApiKey() }, retry: config.retry }
}

function requireApiKey(): string {
  const key = apiKeyFromEnv()
  if (key) return key
  throw new Error(
    `${API_KEY_ENV} is not set. The DeepSeek extension reads it from the environment of the Pi ` +
      "process; set it in the shell that launches Pi.",
  )
}

function toErrorResult(error: unknown): AgentToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: "text", text: message }], details: undefined, isError: true }
}
