#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { apiKeyFromEnv } from "../core/auth"
import { MISSING_API_KEY_MESSAGE } from "./auth"
import { isJsonReplacingClient } from "./client"
import { resolveEnvOptions } from "../core/env"
import { createDeepSeekServer, servePrecheck } from "./server"

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
const precheck = servePrecheck(config)
if (precheck) {
  console.error(precheck)
  process.exit(1)
}
const handle = serveStdio(() => {
  const server = createDeepSeekServer(config, env)
  // Fires after the handshake-era initialize exchange (the stateless era opens
  // differently and simply never logs). One stderr line so a human run shows
  // which client connected and whether text-only shaping kicked in; if a host
  // renames its clientInfo, this line is where the regression becomes visible.
  server.server.oninitialized = () => {
    const info = server.server.getClientVersion()
    if (info === undefined) return
    console.error(
      `mcp client: ${info.name} ${info.version ?? "unknown"} — ` +
        (isJsonReplacingClient(info.name)
          ? "text-only results (this client replaces content with serialized structuredContent)"
          : "text + structuredContent results"),
    )
  }
  return server
})
const tools = [
  config.search.enabled ? `search (max ${config.search.maxResults} results)` : null,
  config.fetch.enabled ? `fetch (max ${config.fetch.maxChars} chars)` : null,
]
  .filter(Boolean)
  .join(", ")
console.error(`deepseek-web-retrieval MCP server on stdio (${tools})`)

process.on("SIGINT", () => void handle.close())
process.on("SIGTERM", () => void handle.close())
