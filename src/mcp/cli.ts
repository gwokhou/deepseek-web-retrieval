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
const handle = serveStdio(() => createDeepSeekServer(config, env))
console.error(
  `deepseek-web-retrieval MCP server on stdio ` +
    `(search: max ${config.search.maxResults} results, fetch: max ${config.fetch.maxChars} chars)`,
)

process.on("SIGINT", () => void handle.close())
process.on("SIGTERM", () => void handle.close())
