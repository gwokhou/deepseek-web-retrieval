import { afterEach, describe, expect, test } from "bun:test"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { SEARCH_ENDPOINT } from "../../src/core/constants"
import { resolvePluginOptions } from "../../src/core/options"
import { createDeepSeekServer } from "../../src/mcp/server"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

interface ModernPersona {
  client: Client
  close: () => Promise<void>
}

async function connectModern(
  clientInfo: { name: string; version: string } = { name: "deepseek-web-retrieval-test", version: "0.0.0" },
): Promise<ModernPersona> {
  const handler = createMcpHandler(() =>
    createDeepSeekServer(resolvePluginOptions(), { DEEPSEEK_API_KEY: "sk-test" }),
  )
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)) as never,
  })
  const client = new Client(
    clientInfo,
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  )
  await client.connect(transport)
  return {
    client,
    close: async () => {
      await client.close()
      await handler.close()
    },
  }
}

describe("MCP server over the modern 2026-07-28 era", () => {
  test("serves a pinned modern client through the HTTP handler", async () => {
    globalThis.fetch = (async () => {
      throw new Error("DeepSeek API must not be called in this test")
    }) as unknown as typeof fetch

    const persona = await connectModern()
    try {
      expect(persona.client.getProtocolEra()).toBe("modern")

      const listed = await persona.client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["deepseek_fetch", "deepseek_web_search"])

      const result = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "not-a-url" },
      })
      expect(result.isError).toBe(true)
    } finally {
      await persona.close()
    }
  })

  test("returns structured results on a 2026-07-28 connection", async () => {
    let deepseekUrl: string | undefined
    globalThis.fetch = (async (url) => {
      deepseekUrl = String(url)
      return new Response(
        JSON.stringify({
          results: [
            { url: "https://a.example/one", title: "First", summary: "Summary.", rerank_score: 2.2, authority: 3 },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const persona = await connectModern()
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "modern era" },
      })
      expect(result.isError).toBeFalsy()
      expect((result.content[0] as { text: string }).text).toContain("1. [First](https://a.example/one)")
      expect((result as { structuredContent?: unknown }).structuredContent).toBeDefined()
      expect(deepseekUrl).toBe(SEARCH_ENDPOINT)
    } finally {
      await persona.close()
    }
  })

  test("omits structured results on a 2026-07-28 connection from the codex-mcp-client identity", async () => {
    globalThis.fetch = (async (_url) => {
      return new Response(
        JSON.stringify({
          results: [
            { url: "https://a.example/one", title: "First", summary: "Summary.", rerank_score: 2.2, authority: 3 },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const persona = await connectModern({ name: "codex-mcp-client", version: "0.163.0" })
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "modern era" },
      })
      expect(result.isError).toBeFalsy()
      expect((result.content[0] as { text: string }).text).toContain("1. [First](https://a.example/one)")
      expect((result as { structuredContent?: unknown }).structuredContent).toBeUndefined()
    } finally {
      await persona.close()
    }
  })
})
