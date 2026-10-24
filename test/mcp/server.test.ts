import { describe, expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { createRetrievalClient } from "../../src/core/client";
import { ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV, FETCH_ENDPOINT, SEARCH_ENDPOINT } from "../../src/core/constants";
import {
  FETCH_OUTPUT_TRUNCATED,
  FETCH_SERVICE_LIMITS,
  SEARCH_EMPTY_IS_NORMAL,
  SEARCH_ORI_QUESTION_PARAMETER,
  SEARCH_QUERY_OPERATORS,
  SEARCH_RANKED_FILTERED,
} from "../../src/core/descriptions";
import { resolveEnvOptions } from "../../src/core/env";
import { resolvePluginOptions } from "../../src/core/options";
import type { ResolvedOptions } from "../../src/core/types";
import { createDeepSeekServer, servePrecheck } from "../../src/mcp/server";
import { createStub } from "../helpers";

interface Persona {
  client: Client;
  close: () => Promise<void>;
}

async function connectPersona(
  fetchImpl: typeof fetch,
  version?: string,
  env: Record<string, string | undefined> = { DEEPSEEK_API_KEY: "sk-test" },
  config: ResolvedOptions = resolvePluginOptions(),
  clientInfo: { name: string; version: string } = { name: "deepseek-web-retrieval-test", version: "0.0.0" },
): Promise<Persona> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server: McpServer = createDeepSeekServer(config, env, createRetrievalClient({ fetchImpl }));
  await server.connect(serverTransport);
  const client = new Client(clientInfo, version ? { supportedProtocolVersions: [version] } : undefined);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const SEARCH_RESULTS = {
  results: [
    {
      url: "https://a.example/one",
      title: "First",
      summary: "Summary one.",
      rerank_score: 2.1,
      authority: 3,
      date: "2026-01-15T00:00:00Z",
    },
    { url: "https://b.example/two", title: "Second", snippet: "Snippet two.", rerank_score: 1.8, authority: 2 },
    { url: "https://a.example/one", title: "Duplicate URL", summary: "Dropped.", rerank_score: 2.5, authority: 4 },
    { url: "https://c.example/low", title: "Low rerank", summary: "Dropped.", rerank_score: 0.4, authority: 4 },
    { url: "https://d.example/unknown", title: "Unknown authority", summary: "Dropped.", rerank_score: 2.0 },
  ],
};

describe("MCP server over the legacy protocol eras", () => {
  for (const version of ["2025-11-25", "2025-06-18", "2024-11-05"]) {
    test(`lists and serves both tools as a ${version} client`, async () => {
      const stub = createStub();
      stub.respond(SEARCH_RESULTS);
      const persona = await connectPersona(stub.fetchImpl, version);
      try {
        const listed = await persona.client.listTools();
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["deepseek_fetch", "deepseek_web_search"]);
        for (const tool of listed.tools) {
          expect(tool.annotations?.readOnlyHint).toBe(true);
        }
        const searchDescription = listed.tools.find((tool) => tool.name === "deepseek_web_search")?.description;
        expect(searchDescription).toContain(SEARCH_RANKED_FILTERED);
        expect(searchDescription).toContain(SEARCH_EMPTY_IS_NORMAL);
        expect(searchDescription).toContain(SEARCH_QUERY_OPERATORS);
        const searchSchema = listed.tools.find((tool) => tool.name === "deepseek_web_search")?.inputSchema as {
          properties: Record<string, { type?: string; description?: string }>;
          required?: string[];
        };
        expect(searchSchema.properties.original_question).toEqual({
          type: "string",
          description: SEARCH_ORI_QUESTION_PARAMETER,
        });
        expect(searchSchema.required).not.toContain("original_question");
        const fetchDescription = listed.tools.find((tool) => tool.name === "deepseek_fetch")?.description;
        expect(fetchDescription).toContain(FETCH_SERVICE_LIMITS);
        expect(fetchDescription).toContain(FETCH_OUTPUT_TRUNCATED);

        const search = await persona.client.callTool({
          name: "deepseek_web_search",
          arguments: { query: "deepseek mcp" },
        });
        expect(search.isError).toBeFalsy();
        expect((search.content[0] as { text: string }).text).toContain("1. [First](https://a.example/one)");

        stub.respond({ title: "Example", content: "Body text." });
        const fetched = await persona.client.callTool({
          name: "deepseek_fetch",
          arguments: { url: "https://a.example/one" },
        });
        expect(fetched.isError).toBeFalsy();
        expect((fetched.content[0] as { text: string }).text).toContain("# Example\n\nBody text.");
      } finally {
        await persona.close();
      }
    });
  }

  test("search returns filtered results as text and structured content when thresholds are set via env", async () => {
    const stub = createStub();
    stub.respond(SEARCH_RESULTS);
    const env = {
      DEEPSEEK_API_KEY: "sk-test",
      DEEPSEEK_SEARCH_MIN_RERANK: "1.5",
      DEEPSEEK_SEARCH_MIN_AUTHORITY: "2",
      DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "false",
    };
    const persona = await connectPersona(stub.fetchImpl, "2025-11-25", env, resolveEnvOptions(env));
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp" },
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0]).toMatchObject({ type: "text" });

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("1. [First](https://a.example/one)");
      expect(text).toContain("Summary one.");
      expect(text).toContain("2. [Second](https://b.example/two)");
      expect(text).toContain("Snippet two.");
      expect(text).not.toContain("Duplicate URL");
      expect(text).not.toContain("Low rerank");
      expect(text).not.toContain("Unknown authority");

      const structured = (result as { structuredContent?: { results: unknown[] } }).structuredContent;
      expect(structured?.results).toHaveLength(2);
      expect(structured?.results[0]).toMatchObject({
        url: "https://a.example/one",
        title: "First",
        content: "Summary one.",
        published: Date.parse("2026-01-15T00:00:00Z"),
      });

      expect(stub.captured?.url).toBe(SEARCH_ENDPOINT);
      expect(new Headers(stub.captured?.init.headers).get("Authorization")).toBe("Bearer sk-test");
      expect(JSON.parse(String(stub.captured?.init.body))).toEqual({
        query: "deepseek mcp",
        count: 10,
        need_content: false,
      });
    } finally {
      await persona.close();
    }
  });

  test("forwards the optional original_question as ori_question on the search payload", async () => {
    const stub = createStub();
    stub.respond(SEARCH_RESULTS);
    const persona = await connectPersona(stub.fetchImpl, "2025-11-25");
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp", original_question: "how do I add DeepSeek search to my agent?" },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(String(stub.captured?.init.body))).toEqual({
        query: "deepseek mcp",
        count: 10,
        need_content: false,
        ori_question: "how do I add DeepSeek search to my agent?",
      });
    } finally {
      await persona.close();
    }
  });

  test("mirrors the quality fields into structured content and the text marker", async () => {
    const stub = createStub();
    stub.respond({
      results: [
        {
          url: "https://a.example/one",
          title: "First",
          summary: "Summary one.",
          rerank_score: 2.1,
          authority: 3,
          site_name: "GitHub",
        },
        { url: "https://e.example/unknown", title: "Unknown", snippet: "Snippet.", rerank_score: 1.9, authority: -1 },
      ],
    });
    const persona = await connectPersona(stub.fetchImpl, "2025-11-25");
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "quality fields" },
      });
      expect(result.isError).toBeFalsy();

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("1. [First](https://a.example/one) [rerank 2.1 · authority 3 · GitHub]");
      expect(text).toContain("2. [Unknown](https://e.example/unknown) [rerank 1.9]");
      expect(text).not.toContain("authority -1");

      const structured = (result as { structuredContent?: { results: Record<string, unknown>[] } }).structuredContent;
      expect(structured?.results[0]).toMatchObject({ rerankScore: 2.1, authority: 3, siteName: "GitHub" });
      expect(structured?.results[1]).toMatchObject({ rerankScore: 1.9, authority: -1 });
      expect(structured?.results[1]).not.toHaveProperty("siteName");
    } finally {
      await persona.close();
    }
  });

  test("caps returned results at the configured maxResults", async () => {
    const stub = createStub();
    stub.respond({
      results: [
        { url: "https://a.example/one", title: "First", summary: "One.", rerank_score: 2.5, authority: 4 },
        { url: "https://b.example/two", title: "Second", summary: "Two.", rerank_score: 2.4, authority: 4 },
        { url: "https://c.example/three", title: "Third", summary: "Three.", rerank_score: 2.3, authority: 4 },
      ],
    });
    const persona = await connectPersona(stub.fetchImpl, undefined, undefined, resolvePluginOptions({ maxResults: 1 }));
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "capped" },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("First");
      expect(text).not.toContain("Second");
      expect(text).not.toContain("Third");
      expect((result as { structuredContent?: { results: unknown[] } }).structuredContent?.results).toHaveLength(1);
    } finally {
      await persona.close();
    }
  });

  test("search with no matches returns a normal empty result", async () => {
    const stub = createStub();
    stub.respond({ results: [] });
    const persona = await connectPersona(stub.fetchImpl, "2025-11-25");
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "nothing matches" },
      });
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toBe("No results found.");
    } finally {
      await persona.close();
    }
  });

  test("fetch returns formatted Markdown with title dedup and a truncation flag", async () => {
    const stub = createStub();
    stub.respond({ title: "Example", content: "# Example\n\nBody text." });
    const persona = await connectPersona(stub.fetchImpl, "2025-11-25");
    try {
      const result = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "https://a.example/one" },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text.startsWith("# Example\n\nBody text.")).toBe(true);
      expect(text.match(/# Example/g)).toHaveLength(1);

      const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
      expect(structured).toMatchObject({
        url: "https://a.example/one",
        title: "Example",
        content: "# Example\n\nBody text.",
        truncated: false,
      });
      expect(stub.captured?.url).toBe(FETCH_ENDPOINT);
      expect(JSON.parse(String(stub.captured?.init.body))).toEqual({ url: "https://a.example/one" });
    } finally {
      await persona.close();
    }
  });

  test("fetch truncates long pages to the configured size", async () => {
    const stub = createStub();
    stub.respond({ title: "Long", content: "x".repeat(20000) });
    const persona = await connectPersona(stub.fetchImpl);
    try {
      const result = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "https://a.example/long" },
      });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("[content truncated]");
      expect((result as { structuredContent?: { truncated?: boolean } }).structuredContent?.truncated).toBe(true);
    } finally {
      await persona.close();
    }
  });

  test("rejects invalid URLs and private hosts before any network call", async () => {
    const stub = createStub();
    stub.reject();
    const persona = await connectPersona(stub.fetchImpl);
    try {
      const invalid = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "not-a-url" },
      });
      expect(invalid.isError).toBe(true);

      const privateHost = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "http://127.0.0.1:8080/internal" },
      });
      expect(privateHost.isError).toBe(true);
      expect(stub.captured).toBeUndefined();
    } finally {
      await persona.close();
    }
  });

  test("maps API errors to isError results without leaking the key", async () => {
    const stub = createStub();
    stub.respond({ error: "bad key sk-live-secret" }, 401);
    const persona = await connectPersona(stub.fetchImpl);
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "anything" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("401");
      expect(text).not.toContain("sk-live-secret");
    } finally {
      await persona.close();
    }
  });

  test("fails with guidance when the API key is missing", async () => {
    const stub = createStub();
    stub.reject();
    const persona = await connectPersona(stub.fetchImpl, "2025-11-25", {});
    try {
      const result = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "anything" },
      });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("DEEPSEEK_API_KEY");
      expect(stub.captured).toBeUndefined();
    } finally {
      await persona.close();
    }
  });
});

describe("client-aware output shaping", () => {
  test("omits structuredContent for Codex's client identity so the model reads the text blocks", async () => {
    const stub = createStub();
    stub.respond(SEARCH_RESULTS);
    const persona = await connectPersona(stub.fetchImpl, "2025-06-18", undefined, undefined, {
      name: "codex-mcp-client",
      version: "0.163.0",
    });
    try {
      const search = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp" },
      });
      expect(search.isError).toBeFalsy();
      expect((search.content[0] as { text: string }).text).toContain("1. [First](https://a.example/one)");
      expect((search as { structuredContent?: unknown }).structuredContent).toBeUndefined();

      stub.respond({ title: "Example", content: "Body text." });
      const fetched = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "https://a.example/one" },
      });
      expect(fetched.isError).toBeFalsy();
      expect((fetched.content[0] as { text: string }).text).toContain("# Example");
      expect((fetched as { structuredContent?: unknown }).structuredContent).toBeUndefined();
    } finally {
      await persona.close();
    }
  });

  test("keeps structuredContent for other clients on the same protocol revision", async () => {
    const stub = createStub();
    stub.respond(SEARCH_RESULTS);
    const persona = await connectPersona(stub.fetchImpl, "2025-06-18");
    try {
      const search = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp" },
      });
      expect((search as { structuredContent?: { results: unknown[] } }).structuredContent?.results).toHaveLength(4);
    } finally {
      await persona.close();
    }
  });
});

describe("per-tool enable switches", () => {
  test("registers only the search tool when fetch is disabled", async () => {
    const stub = createStub();
    const persona = await connectPersona(
      stub.fetchImpl,
      undefined,
      undefined,
      resolvePluginOptions({ fetchEnabled: false }),
    );
    try {
      const listed = await persona.client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["deepseek_web_search"]);
    } finally {
      await persona.close();
    }
  });

  test("registers only the fetch tool when search is disabled", async () => {
    const stub = createStub();
    const persona = await connectPersona(
      stub.fetchImpl,
      undefined,
      undefined,
      resolvePluginOptions({ searchEnabled: false }),
    );
    try {
      const listed = await persona.client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["deepseek_fetch"]);
    } finally {
      await persona.close();
    }
  });

  test("registers neither tool when both are disabled", async () => {
    const stub = createStub();
    const persona = await connectPersona(
      stub.fetchImpl,
      undefined,
      undefined,
      resolvePluginOptions({ searchEnabled: false, fetchEnabled: false }),
    );
    try {
      const listed = await persona.client.listTools();
      expect(listed.tools).toEqual([]);
    } finally {
      await persona.close();
    }
  });

  test("search count and fetch maxChars parameters reach the wire and the output budget", async () => {
    const stub = createStub();
    stub.respond(SEARCH_RESULTS);
    const persona = await connectPersona(stub.fetchImpl);
    try {
      const search = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp", count: 20 },
      });
      expect(search.isError).toBeFalsy();
      expect(JSON.parse(String(stub.captured?.init.body)).count).toBe(20);

      stub.respond({ title: "Example", content: "x".repeat(300) });
      const fetched = await persona.client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "https://a.example/one", maxChars: 40 },
      });
      expect(fetched.isError).toBeFalsy();
      const text = (fetched.content[0] as { text: string }).text;
      expect(Array.from(text).length).toBeLessThanOrEqual(40);
      expect(text).toContain("[content truncated]");
    } finally {
      await persona.close();
    }
  });

  test("the need_content parameter reaches the wire", async () => {
    const stub = createStub();
    stub.respond(SEARCH_RESULTS);
    const persona = await connectPersona(stub.fetchImpl);
    try {
      const search = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp", need_content: true },
      });
      expect(search.isError).toBeFalsy();
      expect(JSON.parse(String(stub.captured?.init.body)).need_content).toBe(true);
    } finally {
      await persona.close();
    }
  });

  test("search headers the effective query when a language filter applies", async () => {
    const stub = createStub();
    stub.respond(SEARCH_RESULTS);
    const persona = await connectPersona(
      stub.fetchImpl,
      undefined,
      { DEEPSEEK_API_KEY: "sk-test" },
      resolvePluginOptions({ language: "zh" }),
    );
    try {
      const search = await persona.client.callTool({
        name: "deepseek_web_search",
        arguments: { query: "deepseek mcp" },
      });
      expect((search.content[0] as { text: string }).text.startsWith("Searched for: deepseek mcp lang:zh")).toBe(true);
    } finally {
      await persona.close();
    }
  });
});

describe("servePrecheck", () => {
  test("reports the both-disabled message composed from the env names", () => {
    expect(servePrecheck(resolvePluginOptions({ searchEnabled: false, fetchEnabled: false }))).toBe(
      `Both tools are disabled (${ENABLE_SEARCH_ENV} and ${ENABLE_FETCH_ENV} are false); ` +
        "at least one must stay enabled.",
    );
  });

  test("returns undefined when either capability stays enabled", () => {
    expect(servePrecheck(resolvePluginOptions())).toBeUndefined();
    expect(servePrecheck(resolvePluginOptions({ searchEnabled: false }))).toBeUndefined();
    expect(servePrecheck(resolvePluginOptions({ fetchEnabled: false }))).toBeUndefined();
  });
});
