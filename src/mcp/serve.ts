import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { apiKeyFromEnv, MISSING_API_KEY_MESSAGE } from "../core/auth";
import { sharedFileOptions } from "../core/config-file";
import { configDeviations } from "../core/config-summary";
import { resolveEnvOptions } from "../core/env";
import { isJsonReplacingClient } from "./client";
import { createDeepSeekServer, servePrecheck } from "./server";

/** Boots the stdio MCP server; the CLI entry reaches this only with no arguments. */
export function serveMcp(): void {
  // stdout is the JSON-RPC channel; all diagnostics must go to stderr.
  const env = process.env;
  if (!apiKeyFromEnv(env)) {
    console.error(MISSING_API_KEY_MESSAGE);
    process.exit(1);
  }

  // Defaults < shared config file < environment: the server reads the file
  // itself, so hosts that forward only DEEPSEEK_API_KEY still honor it.
  const config = resolveEnvOptions(env, sharedFileOptions({ env }));
  const precheck = servePrecheck(config);
  if (precheck) {
    console.error(precheck);
    process.exit(1);
  }
  const handle = serveStdio(() => {
    const server = createDeepSeekServer(config, env);
    // Fires after the handshake-era initialize exchange (the stateless era opens
    // differently and simply never logs). One stderr line so a human run shows
    // which client connected and whether text-only shaping kicked in; if a host
    // renames its clientInfo, this line is where the regression becomes visible.
    server.server.oninitialized = () => {
      const info = server.server.getClientVersion();
      if (info === undefined) return;
      console.error(
        `mcp client: ${info.name} ${info.version ?? "unknown"} — ` +
          (isJsonReplacingClient(info.name)
            ? "text-only results (this client replaces content with serialized structuredContent)"
            : "text + structuredContent results"),
      );
    };
    return server;
  });
  const tools = [
    config.search.enabled ? `search (max ${config.search.maxResults} results)` : null,
    config.fetch.enabled ? `fetch (max ${config.fetch.maxChars} chars)` : null,
  ]
    .filter(Boolean)
    .join(", ");
  console.error(`deepseek-web-retrieval MCP server on stdio (${tools})`);
  // Deviations only, so the line stays short while still showing every
  // non-default knob the layered resolution produced; nothing deviating
  // means no line at all.
  const deviations = configDeviations(config);
  if (deviations) console.error(`config: ${deviations}`);

  process.on("SIGINT", () => void handle.close());
  process.on("SIGTERM", () => void handle.close());
}
