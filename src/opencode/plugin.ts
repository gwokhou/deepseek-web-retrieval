import { Plugin } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { fetchDocument, inspectFetchTarget, searchWeb } from "../core/client"
import { FETCH_MARKDOWN_ONLY, FETCH_OUTPUT_TRUNCATED } from "../core/descriptions"
import { resolveFetchTimeoutMs, resolvePluginOptions } from "../core/options"
import type { PluginOptions, ResolvedOptions, SearchResult } from "../core/types"
import { resolveApiKey } from "./auth"

type FetchInput = {
  readonly url: string
  readonly format?: "markdown" | "text" | "html"
  readonly timeout?: number
}

const FETCH_INPUT = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "Absolute HTTP or HTTPS URL to fetch. Credentials in the URL are rejected.",
    },
    format: {
      type: "string",
      enum: ["markdown", "text", "html"],
      description:
        "Kept for built-in webfetch compatibility. DeepSeek Fetch only returns Markdown; text and html are rejected instead of being misrepresented.",
    },
    timeout: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 120,
      description:
        "Optional timeout in seconds (maximum: 120). The effective limit is the shorter of this and fetchTimeoutMs.",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const

const DEEPSEEK_FETCH_DESCRIPTION =
  "Fetch one web page as clean Markdown through DeepSeek's Fetch API. This separate tool remains " +
    `available when the built-in webfetch is replaced. ${FETCH_MARKDOWN_ONLY} ${FETCH_OUTPUT_TRUNCATED}`

const WEBFETCH_DESCRIPTION =
  "Fetch content from an HTTP or HTTPS URL and return it as Markdown through DeepSeek's Fetch API. " +
    "This is the built-in webfetch replacement enabled by fetchOverrideWebfetch. DeepSeek does not " +
    `render JavaScript and some sites return 403/404. ${FETCH_MARKDOWN_ONLY} ${FETCH_OUTPUT_TRUNCATED}`

/** OpenCode's WebSearch.Result shape, which wraps the published date in `time`. */
interface OpenCodeSearchResult {
  readonly url: string
  readonly title?: string
  readonly content?: string
  readonly time: { readonly published?: number }
}

/** Maps the core's neutral SearchResult onto the shape OpenCode expects. */
function toOpenCodeResult(result: SearchResult): OpenCodeSearchResult {
  return {
    url: result.url,
    ...(result.title ? { title: result.title } : {}),
    ...(result.content ? { content: result.content } : {}),
    ...(result.published !== undefined
      ? { time: { published: result.published } }
      : { time: {} }),
  }
}

/** How the plugin registers itself with OpenCode; resolved where it is consumed. */
export interface Registration {
  readonly setDefault: boolean
  readonly overrideWebfetch: boolean
  readonly registerTool: boolean
}

export function resolveRegistration(input?: PluginOptions): Registration {
  return {
    setDefault: input?.setDefaultWebsearch === true,
    overrideWebfetch: input?.fetchOverrideWebfetch === true,
    registerTool: input?.fetchRegisterTool !== false,
  }
}

async function runFetch(
  ctx: Context,
  config: ResolvedOptions,
  input: FetchInput,
  context: ToolContext,
  permission: string,
  saveAll: boolean,
) {
  const format = input.format ?? "markdown"
  if (format !== "markdown") {
    throw new Error(
      `DeepSeek Fetch only returns Markdown; format "${format}" is not supported. Omit format or use "markdown".`,
    )
  }

  if (typeof input.url !== "string") {
    throw new Error('"url" must be a string')
  }
  // Inspect before the permission prompt so an invalid or blocked target fails
  // without asking the user; fetchPage enforces the policy again.
  const target = inspectFetchTarget(input.url, config.fetch)
  const timeoutMs = resolveFetchTimeoutMs(config.fetch.timeoutMs, input.timeout)

  // Resolved before the permission prompt so a missing key fails fast instead
  // of asking the user to approve a request that cannot run.
  const apiKey = await resolveApiKey(ctx, config.auth.source)

  await ctx.permission.assert({
    sessionID: context.sessionID,
    agent: context.agent,
    action: permission,
    resources: [target.href],
    save: saveAll ? ["*"] : [target.href],
    metadata: saveAll ? { ...input, url: target.href, format } : { url: target.href },
    source: { type: "tool", messageID: context.messageID, id: context.id },
  })

  const page = await fetchDocument(target, config.fetch, {
    signal: context.signal,
    auth: { apiKey },
    retry: config.retry,
    timeoutMs,
  })
  return {
    content: page.content,
    metadata: {
      url: page.url,
      title: page.title,
      truncated: page.truncated,
    },
  }
}

export default Plugin.define({
  id: "deepseek-web-retrieval",
  async setup(ctx) {
    const config = resolvePluginOptions(ctx.options)
    const registration = resolveRegistration(ctx.options)

    if (config.search.enabled) {
      await ctx.websearch.transform((editor) => {
        editor.add({
          id: "deepseek",
          name: "DeepSeek",
          execute: async (input, { signal }) => {
            const apiKey = await resolveApiKey(ctx, config.auth.source)
            const results = await searchWeb(input.query, config.search, {
              signal,
              auth: { apiKey },
              retry: config.retry,
            })
            return results.map(toOpenCodeResult)
          },
        })
        if (registration.setDefault) editor.default.set("deepseek")
      })
    }

    if (config.fetch.enabled) {
      await ctx.tool.transform((editor) => {
        if (registration.overrideWebfetch) editor.remove("webfetch")

        if (registration.registerTool) {
          editor.add({
            name: "deepseek_fetch",
            description: DEEPSEEK_FETCH_DESCRIPTION,
            input: FETCH_INPUT,
            options: { codemode: false, permission: "deepseek_fetch" },
            execute: (input, context) =>
              runFetch(ctx, config, input as FetchInput, context, "deepseek_fetch", false),
          })
        }

        if (registration.overrideWebfetch) {
          editor.add({
            name: "webfetch",
            description: WEBFETCH_DESCRIPTION,
            input: FETCH_INPUT,
            options: { codemode: false, permission: "webfetch" },
            execute: (input, context) =>
              runFetch(ctx, config, input as FetchInput, context, "webfetch", true),
          })
        }
      })
    }
  },
})
