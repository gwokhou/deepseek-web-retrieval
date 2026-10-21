import { afterEach, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createRetrievalClient } from "../../src/core/client";
import { ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../../src/core/constants";
import { FETCH_SERVICE_LIMITS, SEARCH_EMPTY_IS_NORMAL } from "../../src/core/descriptions";
import deepSeekWebRetrieval, {
  extensionPrecheck,
  fetchTool,
  resolveExtensionOptions,
  searchTool,
} from "../../src/pi/extension";

interface CapturedTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string | undefined;
  readonly parameters: unknown;
  readonly outputSchema: unknown;
  readonly annotations: { readOnlyHint?: boolean; openWorldHint?: boolean } | undefined;
  readonly exposure: string | undefined;
  readonly execute: (
    toolCallId: string,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
  ) => Promise<{
    content: { type: string; text: string }[];
    structuredContent?: unknown;
    details?: unknown;
    isError?: boolean;
  }>;
}

function fakePi() {
  const registered: CapturedTool[] = [];
  return {
    registered,
    pi: {
      registerTool: (tool: CapturedTool) => {
        registered.push(tool);
      },
    } as never,
  };
}

const originalKey = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

function textOf(result: { content: readonly unknown[] }): string {
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  return first?.type === "text" ? (first.text ?? "") : "";
}

describe("pi extension wiring", () => {
  test("registers both tools with direct exposure and honest annotations", () => {
    const { pi, registered } = fakePi();
    deepSeekWebRetrieval(pi);
    expect(registered.map((tool) => tool.name)).toEqual(["deepseek_web_search", "deepseek_fetch"]);
    for (const tool of registered) {
      expect(tool.exposure).toBe("direct");
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
      expect(typeof tool.promptSnippet).toBe("string");
      expect(tool.parameters).toMatchObject({ type: "object" });
    }
    expect(registered[0]?.description).toContain(SEARCH_EMPTY_IS_NORMAL);
    expect(registered[1]?.description).toContain(FETCH_SERVICE_LIMITS);
  });

  test("skips a capability the environment disabled", () => {
    const { pi, registered } = fakePi();
    deepSeekWebRetrieval(pi);
    expect(registered.length).toBe(2);

    const disabled = fakePi();
    process.env[ENABLE_SEARCH_ENV] = "false";
    try {
      deepSeekWebRetrieval(disabled.pi);
      expect(disabled.registered.map((tool) => tool.name)).toEqual(["deepseek_fetch"]);
    } finally {
      delete process.env[ENABLE_SEARCH_ENV];
    }
  });

  test("throws at load when both capabilities are off", () => {
    const { pi } = fakePi();
    process.env[ENABLE_SEARCH_ENV] = "false";
    process.env[ENABLE_FETCH_ENV] = "false";
    try {
      expect(() => deepSeekWebRetrieval(pi)).toThrow(/at least one must stay enabled/);
    } finally {
      delete process.env[ENABLE_SEARCH_ENV];
      delete process.env[ENABLE_FETCH_ENV];
    }
  });

  test("settings namespace outranks the environment for the off switches", () => {
    expect(resolveExtensionOptions({}, { enableSearch: false }).search.enabled).toBe(false);
    expect(resolveExtensionOptions({}, { enableSearch: false }).fetch.enabled).toBe(true);
    // An explicit true in the namespace is not a thing — only false is meaningful.
    expect(resolveExtensionOptions({}, { enableFetch: true }).fetch.enabled).toBe(true);
  });

  test("extensionPrecheck names both switches and the settings namespace", () => {
    const bothOff = resolveExtensionOptions({ [ENABLE_SEARCH_ENV]: "false", [ENABLE_FETCH_ENV]: "false" }, {});
    expect(extensionPrecheck(bothOff)).toContain("deepseekWebRetrieval");
    expect(extensionPrecheck(resolveExtensionOptions({}, {}))).toBeUndefined();
  });
});

describe("pi extension tools", () => {
  test("search returns formatted text plus structured results", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    let request: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (input: string | URL | Request, init: RequestInit) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({
          results: [{ url: "https://a", title: "A", summary: "summary", rerank_score: 2.5, authority: 3 }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const config = resolveExtensionOptions({ DEEPSEEK_SEARCH_COUNT: "7" });
    const result = await searchTool(config, createRetrievalClient({ fetchImpl })).execute(
      "call_1",
      { query: "bun" },
      undefined,
      undefined,
      {} as never,
    );

    assert.ok(request, "Search request must be captured");
    expect(request.url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(JSON.parse(String(request.init.body))).toEqual({ query: "bun", count: 7, need_content: false });
    expect((request.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(textOf(result)).toContain("https://a/");
    expect(result.structuredContent).toEqual({
      results: [{ url: "https://a/", title: "A", content: "summary" }],
    });
  });

  test("fetch returns the page markdown and truncation flag", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ title: "Example", content: "# Example\nbody" }), {
        status: 200,
      })) as unknown as typeof fetch;

    const config = resolveExtensionOptions({});
    const result = await fetchTool(config, createRetrievalClient({ fetchImpl })).execute(
      "call_2",
      { url: "https://example.com" },
      new AbortController().signal,
      undefined,
      {} as never,
    );

    expect(result.isError).toBeUndefined();
    // The page already opens with its title as a heading, so none is added.
    expect(result.structuredContent).toEqual({
      url: "https://example.com/",
      title: "Example",
      content: "# Example\nbody",
      truncated: false,
    });
    expect(textOf(result)).toBe("# Example\nbody");
  });

  test("fetch errors return as error results, not throws", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const config = resolveExtensionOptions({});
    // A private host is rejected by the client-side policy before any network.
    const result = await fetchTool(config).execute(
      "call_3",
      { url: "http://127.0.0.1:8080/" },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("private");
  });

  test("a missing key fails as an error result naming the Pi process environment", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const config = resolveExtensionOptions({});
    const result = await fetchTool(config).execute(
      "call_4",
      { url: "https://example.com" },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("environment of the Pi process");
  });
});
