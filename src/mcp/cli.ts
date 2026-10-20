#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { apiKeyFromEnv } from "../core/auth"
import { ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../core/constants"
import { MISSING_API_KEY_MESSAGE } from "./auth"
import { resolveEnvOptions } from "./config"
import { createDeepSeekServer } from "./server"

// Installer subcommands run before the server path; MCP clients spawn this bin
// with no arguments, so the default stdio behavior is unchanged.
const subcommand = process.argv[2]
if (subcommand === "init" || subcommand === "uninstall" || subcommand === "list") {
  const { runInstallerCli } = await import("../installer/cli")
  process.exit(await runInstallerCli(process.argv.slice(2)))
}

// stdout is the JSON-RPC channel; all diagnostics must go to stderr.
const env = process.env
if (!apiKeyFromEnv(env)) {
  console.error(MISSING_API_KEY_MESSAGE)
  process.exit(1)
}

const config = resolveEnvOptions(env)
if (!config.search.enabled && !config.fetch.enabled) {
  console.error(
    `Both tools are disabled (${ENABLE_SEARCH_ENV} and ${ENABLE_FETCH_ENV} are false); ` +
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
