import { afterEach, describe, expect, test } from "bun:test"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import type { McpServer } from "@modelcontextprotocol/server"
import {
  ENABLE_FETCH_ENV,
  ENABLE_SEARCH_ENV,
  FETCH_ENDPOINT,
  SEARCH_ENDPOINT,
} from "../../src/core/constants"
import {
  FETCH_OUTPUT_TRUNCATED,
  FETCH_SERVICE_LIMITS,
  SEARCH_EMPTY_IS_NORMAL,
  SEARCH_QUERY_OPERATORS,
  SEARCH_RANKED_FILTERED,
} from "../../src/core/descriptions"
import { resolvePluginOptions } from "../../src/core/options"
import type { ResolvedOptions } from "../../src/core/types"
import { resolveEnvOptions } from "../../src/core/env"
import { createDeepSeekServer, servePrecheck } from "../../src/mcp/server"

const originalFetch = globalThis.fetch

let captured: { url: string; init: RequestInit } | undefined

function stubFetch(body: unknown, status = 200): void {
  captured = undefined
  globalThis.fetch = (async (url, init) => {
    captured = { url: String(url), init: init ?? {} }
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}

function notFoundFetch(): void {
  captured = undefined
  globalThis.fetch = (async () => {
    throw new Error("network must not be reached")
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
  captured = undefined
})

interface Persona {
  client: Client
  close: () => Promise<void>
}

async function connectPersona(
  version?: string,
  env: Record<string, string | undefined> = { DEEPSEEK_API_KEY: "sk-test" },
  config: ResolvedOptions = resolvePluginOptions(),
  clientInfo: { name: string; version: string } = { name: "deepseek-web-retrieval-test", version: "0.0.0" },
): Promise<Persona> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server: McpServer = createDeepSeekServer(config, env)
  await server.connect(serverTransport)
  const client = new Client(
    clientInfo,
    version ? { supportedProtocolVersions: [version] } : undefined,
  )
  await client.connect(clientTransport)
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

const SEARCH_RESULTS = {
  results: [
    { url: "https://a.example/one", title: "First", summary: "Summary one.", rerank_score: 2.1, authority: 3, date: "2026-01-15T00:00:00Z" },
    { url: "https://b.example/two", title: "Second", snippet: "Snippet two.", rerank_score: 1.8, authority: 2 },
    { url: "https://a.example/one", title: "Duplicate URL", summary: "Dropped.", rerank_score: 2.5, authority: 4 },
    { url: "https://c.example/low", title: "Low rerank", summary: "Dropped.", rerank_score: 0.4, authority: 4 },
    { url: "https://d.example/unknown", title: "Unknown authority", summary: "Dropped.", rerank_score: 2.0 },
  ],
}

describe("MCP server over the legacy protocol eras", () => {
  for (const version of ["2025-11-25", "2025-06-18", "2024-11-05"]) {
    test(`lists and serves both tools as a ${version} client`, async () => {
      stubFetch(SEARCH_RESULTS)
      const persona = await connectPersona(version)
      try {
        const listed = await persona.client.listTools()
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["deepseek_fetch", "deepseek_web_search"])
        for (const tool of listed.tools) {
          expect(tool.annotations?.readOnlyHint).toBe(true)
        }
        const searchDescription = listed.tools.find((tool) => tool.name === "deepseek_web_search")
          ?.description
        expect(searchDescription).toContain(SEARCH_RANKED_FILTERED)
        expect(searchDescription).toContain(SEARCH_EMPTY_IS_NORMAL)
        expect(searchDescription).toContain(SEARCH_QUERY_OPERATORS)
        const fetchDescription = listed.tools.find((tool) => tool.name === "deepseek_fetch")
          ?.description
        expect(fetchDescription).toContain(FETCH_SERVICE_LIMITS)
        expect(fetchDescription).toContain(FETCH_OUTPUT_TRUNCATED)

        const search = await persona.client.callTool({
          name: "deepseek_web_search",
          arguments: { query: "deepseek mcp" },
        })
        expect(search.isError).toBeFalsy()
        expect((search.content[0] as { text: string }).text).toContain("1. [First](https://a.example/one)")

        stubFetch({ title: "Example", content: "Body text." })
        const fetched = await persona.client.callTool({
          name: "deepseek_fetch",
          arguments: { url: "https://a.example/one" },
        })
        expect(fetched.isError).toBeFalsy()
        expect((fetched.content[0] as { text: string }).text).toContain("# Example\n\nBody text.")
      } finally {
        await persona.close()
      }
    })
  }

  test("search returns filtered results as text and structured content when thresholds are set via env", async () => {
    stubFetch(SEARCH_RESULTS)
    const env = {
      DEEPSEEK_API_KEY: "sk-test",
      DEEPSEEK_SEARCH_MIN_RERANK: "1.5",
      DEEPSEEK_SEARCH_MIN_AUTHORITY: "2",
      DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "false",
    }
    const persona = await connectPersona("2025-11-25", env, resolveEnvOptions(env))
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp" },
      })
      expect(result.isError).toBeFalsy()
      expect(result.content[0]).toMatchObject({ type: "text" })

      const text = (result.content[0] as { text: string }).text
      expect(text).toContain("1. [First](https://a.example/one)")
      expect(text).toContain("Summary one.")
      expect(text).toContain("2. [Second](https://b.example/two)")
      expect(text).toContain("Snippet two.")
      expect(text).not.toContain("Duplicate URL")
      expect(text).not.toContain("Low rerank")
      expect(text).not.toContain("Unknown authority")

      const structured = (result as { structuredContent?: { results: unknown[] } }).structuredContent
      expect(structured?.results).toHaveLength(2)
      expect(structured?.results[0]).toMatchObject({
        url: "https://a.example/one",
        title: "First",
        content: "Summary one.",
        published: Date.parse("2026-01-15T00:00:00Z"),
      })

      expect(captured?.url).toBe(SEARCH_ENDPOINT)
      expect(new Headers(captured?.init.headers).get("Authorization")).toBe("Bearer sk-test")
      expect(JSON.parse(String(captured?.init.body))).toEqual({
        query: "deepseek mcp",
        count: 10,
        need_content: false,
      })
    } finally {
      await persona.close()
    }
  })

  test("caps returned results at the configured maxResults", async () => {
    stubFetch({
      results: [
        { url: "https://a.example/one", title: "First", summary: "One.", rerank_score: 2.5, authority: 4 },
        { url: "https://b.example/two", title: "Second", summary: "Two.", rerank_score: 2.4, authority: 4 },
        { url: "https://c.example/three", title: "Third", summary: "Three.", rerank_score: 2.3, authority: 4 },
      ],
    })
    const persona = await connectPersona(undefined, undefined, resolvePluginOptions({ maxResults: 1 }))
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "capped" },
      })
      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain("First")
      expect(text).not.toContain("Second")
      expect(text).not.toContain("Third")
      expect(
        (result as { structuredContent?: { results: unknown[] } }).structuredContent?.results,
      ).toHaveLength(1)
    } finally {
      await persona.close()
    }
  })

  test("search with no matches returns a normal empty result", async () => {
    stubFetch({ results: [] })
    const persona = await connectPersona("2025-11-25")
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "nothing matches" },
      })
      expect(result.isError).toBeFalsy()
      expect((result.content[0] as { text: string }).text).toBe("No results found.")
    } finally {
      await persona.close()
    }
  })

  test("fetch returns formatted Markdown with title dedup and a truncation flag", async () => {
    stubFetch({ title: "Example", content: "# Example\n\nBody text." })
    const persona = await connectPersona("2025-11-25")
    try {
      const result = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "https://a.example/one" },
      })
      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { text: string }).text
      expect(text.startsWith("# Example\n\nBody text.")).toBe(true)
      expect(text.match(/# Example/g)).toHaveLength(1)

      const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent
      expect(structured).toMatchObject({
        url: "https://a.example/one",
        title: "Example",
        content: "# Example\n\nBody text.",
        truncated: false,
      })
      expect(captured?.url).toBe(FETCH_ENDPOINT)
      expect(JSON.parse(String(captured?.init.body))).toEqual({ url: "https://a.example/one" })
    } finally {
      await persona.close()
    }
  })

  test("fetch truncates long pages to the configured size", async () => {
    stubFetch({ title: "Long", content: "x".repeat(20000) })
    const persona = await connectPersona()
    try {
      const result = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "https://a.example/long" },
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain("[content truncated]")
      expect(
        (result as { structuredContent?: { truncated?: boolean } }).structuredContent?.truncated,
      ).toBe(true)
    } finally {
      await persona.close()
    }
  })

  test("rejects invalid URLs and private hosts before any network call", async () => {
    notFoundFetch()
    const persona = await connectPersona()
    try {
      const invalid = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "not-a-url" },
      })
      expect(invalid.isError).toBe(true)

      const privateHost = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "http://127.0.0.1:8080/internal" },
      })
      expect(privateHost.isError).toBe(true)
      expect(captured).toBeUndefined()
    } finally {
      await persona.close()
    }
  })

  test("maps API errors to isError results without leaking the key", async () => {
    stubFetch({ error: "bad key sk-live-secret" }, 401)
    const persona = await connectPersona()
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "anything" },
      })
      expect(result.isError).toBe(true)
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain("401")
      expect(text).not.toContain("sk-live-secret")
    } finally {
      await persona.close()
    }
  })

  test("fails with guidance when the API key is missing", async () => {
    notFoundFetch()
    const persona = await connectPersona("2025-11-25", {})
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "anything" },
      })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain("DEEPSEEK_API_KEY")
      expect(captured).toBeUndefined()
    } finally {
      await persona.close()
    }
  })
})

describe("client-aware output shaping", () => {
  test("omits structuredContent for Codex's client identity so the model reads the text blocks", async () => {
    stubFetch(SEARCH_RESULTS)
    const persona = await connectPersona("2025-06-18", undefined, undefined, {
      name: "codex-mcp-client",
      version: "0.163.0",
    })
    try {
      const search = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp" },
      })
      expect(search.isError).toBeFalsy()
      expect((search.content[0] as { text: string }).text).toContain("1. [First](https://a.example/one)")
      expect((search as { structuredContent?: unknown }).structuredContent).toBeUndefined()

      stubFetch({ title: "Example", content: "Body text." })
      const fetched = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "https://a.example/one" },
      })
      expect(fetched.isError).toBeFalsy()
      expect((fetched.content[0] as { text: string }).text).toContain("# Example")
      expect((fetched as { structuredContent?: unknown }).structuredContent).toBeUndefined()
    } finally {
      await persona.close()
    }
  })

  test("keeps structuredContent for other clients on the same protocol revision", async () => {
    stubFetch(SEARCH_RESULTS)
    const persona = await connectPersona("2025-06-18")
    try {
      const search = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp" },
      })
      expect(
        (search as { structuredContent?: { results: unknown[] } }).structuredContent?.results,
      ).toHaveLength(4)
    } finally {
      await persona.close()
    }
  })
})

describe("per-tool enable switches", () => {
  test("registers only the search tool when fetch is disabled", async () => {
    const persona = await connectPersona(undefined, undefined, resolvePluginOptions({ fetchEnabled: false }))
    try {
      const listed = await persona.client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual(["deepseek_web_search"])
    } finally {
      await persona.close()
    }
  })

  test("registers only the fetch tool when search is disabled", async () => {
    const persona = await connectPersona(undefined, undefined, resolvePluginOptions({ searchEnabled: false }))
    try {
      const listed = await persona.client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual(["deepseek_fetch"])
    } finally {
      await persona.close()
    }
  })

  test("registers neither tool when both are disabled", async () => {
    const persona = await connectPersona(undefined, undefined, resolvePluginOptions({ searchEnabled: false, fetchEnabled: false }))
    try {
      const listed = await persona.client.listTools()
      expect(listed.tools).toEqual([])
    } finally {
      await persona.close()
    }
  })
})

describe("servePrecheck", () => {
  test("reports the both-disabled message composed from the env names", () => {
    expect(
      servePrecheck(resolvePluginOptions({ searchEnabled: false, fetchEnabled: false })),
    ).toBe(
      `Both tools are disabled (${ENABLE_SEARCH_ENV} and ${ENABLE_FETCH_ENV} are false); ` +
        "at least one must stay enabled.",
    )
  })

  test("returns undefined when either capability stays enabled", () => {
    expect(servePrecheck(resolvePluginOptions())).toBeUndefined()
    expect(servePrecheck(resolvePluginOptions({ searchEnabled: false }))).toBeUndefined()
    expect(servePrecheck(resolvePluginOptions({ fetchEnabled: false }))).toBeUndefined()
  })
})
