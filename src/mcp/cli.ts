#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { apiKeyFromEnv } from "../core/auth"
import { MISSING_API_KEY_MESSAGE } from "./auth"
import { resolveEnvOptions } from "./config"
import { createDeepSeekServer } from "./server"

// stdout is the JSON-RPC channel; all diagnostics must go to stderr.
const env = process.env
if (!apiKeyFromEnv(env)) {
  console.error(MISSING_API_KEY_MESSAGE)
  process.exit(1)
}

const config = resolveEnvOptions(env)
if (!config.search.enabled && !config.fetch.enabled) {
  console.error(
    "Both tools are disabled (DEEPSEEK_ENABLE_SEARCH and DEEPSEEK_ENABLE_FETCH are false); " +
      "at least one must stay enabled.",
  )
  process.exit(1)
}
const handle = serveStdio(() => createDeepSeekServer(config, env))
const tools = [
  config.search.enabled ? `search (max ${config.search.maxResults} results)` : null,
  config.fetch.enabled ? `fetch (max ${config.fetch.maxChars} chars)` : null,
]
  .filter(Boolean)
  .join(", ")
console.error(`deepseek-web-retrieval MCP server on stdio (${tools})`)

process.on("SIGINT", () => void handle.close())
process.on("SIGTERM", () => void handle.close())
