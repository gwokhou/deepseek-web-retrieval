import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server"
import type { McpServer, ServerContext } from "@modelcontextprotocol/server"

/**
 * Clients that discard a result's content blocks and hand the model the serialized
 * `structuredContent` JSON instead. For these the server omits `structuredContent`
 * so the model reads the text blocks. The declared names are research facts —
 * docs/agents/codex.md records where codex-mcp-client comes from.
 */
const JSON_REPLACING_CLIENT_NAMES = new Set(["codex-mcp-client"])

/**
 * The connected client's declared name. The per-request envelope comes first (the
 * 2026-07-28 era, where clientInfo is a SHOULD, not a MUST); the initialize-scoped
 * accessor covers the handshake era and is backfilled per request on modern
 * connections, so it works as the fallback for both.
 */
export function clientNameOf(server: McpServer, ctx: ServerContext): string | undefined {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined
  const name = envelope?.[CLIENT_INFO_META_KEY]
  if (typeof name === "object" && name !== null && "name" in name && typeof name.name === "string") {
    return name.name
  }
  return server.server.getClientVersion()?.name
}

/** True when a client declaring this name would replace text content with serialized JSON. */
export function isJsonReplacingClient(name: string | undefined): boolean {
  return name !== undefined && JSON_REPLACING_CLIENT_NAMES.has(name)
}

/** True when the connected client would replace text content with serialized JSON. */
export function omitStructuredContent(server: McpServer, ctx: ServerContext): boolean {
  return isJsonReplacingClient(clientNameOf(server, ctx))
}
