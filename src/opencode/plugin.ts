import { Plugin } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { assertFetchHostPolicy } from "../core/domains"
import { formatFetchedContent } from "../core/format"
import { resolveFetchTimeoutMs, resolvePluginOptions } from "../core/options"
import { fetchPage, searchWeb } from "../core/client"
import type { ResolvedOptions } from "../core/types"
import { parseFetchUrl } from "../core/url"
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
  'Fetch one web page as clean Markdown through DeepSeek\'s Fetch API. This separate tool remains available when the built-in webfetch is replaced. Only format "markdown" is supported. Output is truncated to the configured size.'

const WEBFETCH_DESCRIPTION =
  'Fetch content from an HTTP or HTTPS URL and return it as Markdown through DeepSeek\'s Fetch API. This is the built-in webfetch replacement enabled by fetchOverrideWebfetch. DeepSeek does not render JavaScript and some sites return 403/404. Only format "markdown" is supported. Output is truncated to the configured size.'

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
  const target = parseFetchUrl(input.url)
  // Fail before the permission prompt; fetchPage enforces this again for core
  // consumers that skip the pre-check.
  assertFetchHostPolicy(target, config.fetch)
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

  const page = await fetchPage(
    target,
    { ...config.fetch, timeoutMs },
    { signal: context.signal, auth: { apiKey }, retry: config.retry },
  )
  const formatted = formatFetchedContent(page.title, page.content, config.fetch.maxChars)
  return {
    content: formatted.content,
    metadata: {
      url: page.url,
      title: page.title,
      truncated: formatted.truncated,
    },
  }
}

export default Plugin.define({
  id: "deepseek-web-retrieval",
  async setup(ctx) {
    const config = resolvePluginOptions(ctx.options)

    await ctx.websearch.transform((editor) => {
      editor.add({
        id: "deepseek",
        name: "DeepSeek",
        execute: async (input, { signal }) => {
          const apiKey = await resolveApiKey(ctx, config.auth.source)
          return searchWeb(input.query, config.search, {
            signal,
            auth: { apiKey },
            retry: config.retry,
          })
        },
      })
      if (config.search.setDefault) editor.default.set("deepseek")
    })

    await ctx.tool.transform((editor) => {
      if (config.fetch.overrideWebfetch) editor.remove("webfetch")

      if (config.fetch.registerTool) {
        editor.add({
          name: "deepseek_fetch",
          description: DEEPSEEK_FETCH_DESCRIPTION,
          input: FETCH_INPUT,
          options: { codemode: false, permission: "deepseek_fetch" },
          execute: (input, context) =>
            runFetch(ctx, config, input as FetchInput, context, "deepseek_fetch", false),
        })
      }

      if (config.fetch.overrideWebfetch) {
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
  },
})
