import { afterEach, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createRetrievalClient } from "../../src/core/client";
import { ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV } from "../../src/core/constants";
import {
  FETCH_SERVICE_LIMITS,
  SEARCH_EMPTY_IS_NORMAL,
  SEARCH_ORI_QUESTION_PARAMETER,
} from "../../src/core/descriptions";
import deepSeekWebRetrieval, {
  extensionPrecheck,
  fetchTool,
  resolveExtensionOptions,
  searchTool,
} from "../../src/pi/extension";
import { captureErrors, pinEnvironment, xdgRoot } from "../helpers";

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

/**
 * A stubbed fifth `execute` argument carrying only the session projection the
 * fallback reads — the same boundary-cast idiom the suite uses for `pi` itself.
 * An `Error` payload makes `buildSessionProjection` throw.
 */
function toolContext(messages: readonly unknown[] | Error): ExtensionToolContext {
  return {
    sessionManager: {
      buildSessionProjection: () => {
        if (messages instanceof Error) throw messages;
        return { messages };
      },
    },
  } as never as ExtensionToolContext;
}

/** A search fetch stub: records each parsed request body and returns no results. */
function capturingSearchFetch(bodies: unknown[]): typeof fetch {
  return (async (_input: string | URL | Request, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;
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

  test("search parameters declare the optional original_question", () => {
    const { pi, registered } = fakePi();
    deepSeekWebRetrieval(pi);
    const parameters = registered[0]?.parameters as {
      properties: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    expect(parameters.properties.original_question).toMatchObject({ type: "string" });
    expect(parameters.properties.original_question?.description).toContain(SEARCH_ORI_QUESTION_PARAMETER);
    // The session fallback is a Pi-only fact, so only this adapter's description hints it.
    expect(parameters.properties.original_question?.description).toContain("most recent user message");
    expect(parameters.required).not.toContain("original_question");
    expect(parameters.required).toContain("query");
  });

  test("search output schema declares the optional quality fields", () => {
    const { pi, registered } = fakePi();
    deepSeekWebRetrieval(pi);
    expect(registered[0]?.outputSchema).toMatchObject({
      properties: {
        results: {
          items: {
            properties: {
              rerankScore: { type: "number" },
              authority: { type: "number" },
              siteName: { type: "string" },
            },
          },
        },
      },
    });
  });
});

describe("pi option layering (defaults < shared file < environment < settings)", () => {
  test("the environment outranks the file for the same key; settings stay on top for their switches", () => {
    const xdg = xdgRoot({ count: 20, language: "zh" });
    const env = { XDG_CONFIG_HOME: xdg, DEEPSEEK_SEARCH_COUNT: "30" };

    const resolved = resolveExtensionOptions(env);
    expect(resolved.search.count).toBe(30);
    // A file-only key survives when the environment is silent about it.
    expect(resolved.search.language).toBe("zh");

    // The settings namespace remains the top layer for its two switches.
    expect(resolved.search.enabled).toBe(true);
    expect(resolveExtensionOptions(env, { enableSearch: false }).search.enabled).toBe(false);
    expect(resolveExtensionOptions(env, { enableFetch: false }).fetch.enabled).toBe(false);
  });

  test("file-only keys are effective when the environment omits them", () => {
    const resolved = resolveExtensionOptions({ XDG_CONFIG_HOME: xdgRoot({ count: 20 }) });
    expect(resolved.search.count).toBe(20);
  });

  test("no shared file keeps the built-in defaults", () => {
    const resolved = resolveExtensionOptions({ XDG_CONFIG_HOME: xdgRoot() });
    expect(resolved.search.count).toBe(10);
    expect(resolved.search.language).toBeUndefined();
    expect(resolved.search.enabled).toBe(true);
  });
});

describe("pi registration-time deviation summary", () => {
  test("prints one config line when the layered resolution deviates from defaults", () => {
    const { lines, restore: restoreConsole } = captureErrors();
    const restoreEnv = pinEnvironment(xdgRoot({ count: 20, language: "zh" }));
    try {
      deepSeekWebRetrieval(fakePi().pi);
    } finally {
      restoreConsole();
      restoreEnv();
    }
    // maxResults was not set, so it follows count — the effective value deviates too.
    expect(lines).toEqual(["deepseek-web-retrieval config: count=20 maxResults=20 language=zh"]);
  });

  test("prints no config line when nothing deviates from defaults", () => {
    const { lines, restore: restoreConsole } = captureErrors();
    const restoreEnv = pinEnvironment(xdgRoot());
    try {
      deepSeekWebRetrieval(fakePi().pi);
    } finally {
      restoreConsole();
      restoreEnv();
    }
    expect(lines).toEqual([]);
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
          results: [
            {
              url: "https://a",
              title: "A",
              summary: "summary",
              rerank_score: 2.5,
              authority: 3,
              site_name: "GitHub",
            },
          ],
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
    expect(textOf(result)).toContain("[rerank 2.5 · authority 3 · GitHub]");
    expect(result.structuredContent).toEqual({
      results: [
        { url: "https://a/", title: "A", content: "summary", rerankScore: 2.5, authority: 3, siteName: "GitHub" },
      ],
    });
  });

  test("forwards the optional original_question as ori_question on the search payload", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const bodies: unknown[] = [];
    const fetchImpl = capturingSearchFetch(bodies);

    const config = resolveExtensionOptions({});
    const result = await searchTool(config, createRetrievalClient({ fetchImpl })).execute(
      "call_ori",
      { query: "bun", original_question: "how do I run bun tests?" },
      undefined,
      undefined,
      {} as never,
    );

    expect(result.isError).toBeUndefined();
    expect(bodies[0]).toEqual({
      query: "bun",
      count: 10,
      need_content: false,
      ori_question: "how do I run bun tests?",
    });
  });

  test("derives ori_question from the most recent user message when the input is blank", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const bodies: unknown[] = [];
    const fetchImpl = capturingSearchFetch(bodies);

    const config = resolveExtensionOptions({});
    // The latest user message wins over the older one, the scan skips
    // non-user roles, text blocks join (image parts do not), and the
    // result is trimmed before the core client sees it.
    const ctx = toolContext([
      { role: "user", content: "stale first question", timestamp: 1 },
      { role: "assistant", content: [], timestamp: 2 },
      { role: "toolResult", content: [], timestamp: 3 },
      {
        role: "user",
        content: [
          { type: "text", text: " how do I run bun tests? " },
          { type: "image", data: "", mimeType: "image/png" },
        ],
        timestamp: 4,
      },
    ]);
    const result = await searchTool(config, createRetrievalClient({ fetchImpl })).execute(
      "call_fb",
      { query: "bun" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(bodies[0]).toEqual({
      query: "bun",
      count: 10,
      need_content: false,
      ori_question: "how do I run bun tests?",
    });
  });

  test("a whitespace original_question defers to the session fallback", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const bodies: unknown[] = [];
    const fetchImpl = capturingSearchFetch(bodies);

    const config = resolveExtensionOptions({});
    const ctx = toolContext([{ role: "user", content: "what is bun?", timestamp: 1 }]);
    const result = await searchTool(config, createRetrievalClient({ fetchImpl })).execute(
      "call_ws",
      { query: "bun", original_question: "   " },
      undefined,
      undefined,
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(bodies[0]).toEqual({
      query: "bun",
      count: 10,
      need_content: false,
      ori_question: "what is bun?",
    });
  });

  test("the explicit original_question outranks the session fallback", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const bodies: unknown[] = [];
    const fetchImpl = capturingSearchFetch(bodies);

    const config = resolveExtensionOptions({});
    const ctx = toolContext([{ role: "user", content: "session question", timestamp: 1 }]);
    const result = await searchTool(config, createRetrievalClient({ fetchImpl })).execute(
      "call_win",
      { query: "bun", original_question: "explicit question" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(bodies[0]).toEqual({
      query: "bun",
      count: 10,
      need_content: false,
      ori_question: "explicit question",
    });
  });

  test("an unreadable session degrades to no ori_question, never a failed search", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const bodies: unknown[] = [];
    const fetchImpl = capturingSearchFetch(bodies);

    const tool = searchTool(resolveExtensionOptions({}), createRetrievalClient({ fetchImpl }));
    const unreadable: (readonly unknown[] | Error | undefined)[] = [
      undefined, // no context at all — the runtime may omit it
      [], // empty session
      new Error("projection failed"), // throwing projection
      [{ role: "assistant", content: [], timestamp: 1 }], // no user message
      [{ role: "user", content: [], timestamp: 1 }], // user message without text
    ];
    for (const messages of unreadable) {
      const ctx = messages === undefined ? (undefined as never) : toolContext(messages);
      const result = await tool.execute("call_deg", { query: "bun" }, undefined, undefined, ctx);
      expect(result.isError).toBeUndefined();
    }

    expect(bodies).toHaveLength(unreadable.length);
    for (const body of bodies) {
      expect(body).toEqual({ query: "bun", count: 10, need_content: false });
    }
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
