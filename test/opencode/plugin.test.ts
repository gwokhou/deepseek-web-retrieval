import { afterEach, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import plugin from "../../index";
import { createRetrievalClient } from "../../src/core/client";
import { FETCH_MARKDOWN_ONLY, FETCH_OUTPUT_TRUNCATED } from "../../src/core/descriptions";
import { createOpenCodePlugin, resolveRegistration } from "../../src/opencode/plugin";
import { captureErrors, pinEnvironment, xdgRoot } from "../helpers";

interface CapturedTool {
  name: string;
  description?: string;
  input: unknown;
  options?: { codemode?: boolean; permission?: string };
  execute: (input: unknown, context: unknown) => Promise<{ content?: string; metadata?: unknown }>;
}

interface Captured {
  provider?: {
    id: string;
    name: string;
    execute: (input: { query: string }, context: { signal: AbortSignal }) => Promise<unknown>;
  };
  tool?: CapturedTool;
  tools: Map<string, CapturedTool>;
  added: CapturedTool[];
  builtinWebfetch: CapturedTool;
  permissions: Array<Record<string, unknown>>;
  defaultProvider?: string;
}

const originalKey = process.env.DEEPSEEK_API_KEY;
let integrationKey: string | undefined;

afterEach(() => {
  integrationKey = undefined;
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

async function setup(options: Record<string, unknown> = {}, fetchImpl?: typeof fetch) {
  const builtinWebfetch: CapturedTool = {
    name: "webfetch",
    description: "built-in webfetch",
    input: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    execute: async () => ({ content: "built-in" }),
  };
  const tools = new Map<string, CapturedTool>([["webfetch", builtinWebfetch]]);
  const captured: Captured = {
    permissions: [],
    tools,
    added: [],
    builtinWebfetch,
  };
  const ctx = {
    options,
    websearch: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          add: (provider: Captured["provider"]) => {
            captured.provider = provider;
          },
          default: {
            get: () => captured.defaultProvider,
            set: (id: string) => {
              captured.defaultProvider = id;
            },
          },
        });
      },
    },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          add: (tool: CapturedTool) => {
            captured.added.push(tool);
            tools.set(tool.name, tool);
            if (tool.name === "deepseek_fetch") captured.tool = tool;
          },
          remove: (id: string) => tools.delete(id),
          get: (id: string) => tools.get(id),
          list: () => [...tools.values()],
          namespace: () => {},
        });
      },
    },
    permission: {
      assert: async (input: Record<string, unknown>) => {
        captured.permissions.push(input);
      },
    },
    integration: {
      connection: {
        active: async (id: string) =>
          id === "deepseek" && integrationKey !== undefined
            ? { type: "credential", id: "cred_test", label: "DeepSeek", method: "key" }
            : undefined,
        resolve: async () => (integrationKey === undefined ? undefined : { type: "key", key: integrationKey }),
      },
    },
  };
  const configured = fetchImpl ? createOpenCodePlugin(createRetrievalClient({ fetchImpl })) : plugin;
  await configured.setup(ctx as never);
  return captured;
}

function toolContext() {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
  };
}

/** A search fetch stub that records the resolved count from the request body. */
function countingSearchFetch(counter: { count?: number }): typeof fetch {
  return (async (_input: string | URL | Request, init: RequestInit) => {
    counter.count = (JSON.parse(String(init.body)) as { count: number }).count;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;
}

/**
 * Runs one pinned search round and returns the count that reached the API.
 * The deviation line setup prints for these fixtures is expected behavior
 * (asserted by its own tests), so it is captured rather than leaked.
 */
async function effectiveSearchCount(
  xdg: string,
  env: Record<string, string>,
  options: Record<string, unknown>,
): Promise<number> {
  const counter: { count?: number } = {};
  const { restore: restoreConsole } = captureErrors();
  const restore = pinEnvironment(xdg, env);
  try {
    const captured = await setup(options, countingSearchFetch(counter));
    assert.ok(captured.provider, "Search provider must be registered");
    await captured.provider.execute({ query: "bun" }, { signal: new AbortController().signal });
  } finally {
    restore();
    restoreConsole();
  }
  assert.ok(counter.count !== undefined, "Search request must be captured");
  return counter.count;
}

describe("OpenCode plugin wiring", () => {
  test("registers the DeepSeek search provider and fetch tool", async () => {
    const captured = await setup({ count: 8, maxResults: 3 });
    expect(captured.provider?.id).toBe("deepseek");
    expect(captured.provider?.name).toBe("DeepSeek");
    expect(captured.tool?.name).toBe("deepseek_fetch");
    expect(captured.tool?.options).toEqual({ codemode: false, permission: "deepseek_fetch" });
    expect(captured.tool?.input).toMatchObject({ type: "object", required: ["url"] });
    expect(captured.defaultProvider).toBeUndefined();
  });

  test("registers nothing search-related when searchEnabled is false", async () => {
    const captured = await setup({ searchEnabled: false });
    expect(captured.provider).toBeUndefined();
    expect(captured.defaultProvider).toBeUndefined();
    // The fetch side is unaffected.
    expect(captured.tool?.name).toBe("deepseek_fetch");
  });

  test("registers nothing fetch-related when fetchEnabled is false", async () => {
    const captured = await setup({ fetchEnabled: false, fetchOverrideWebfetch: true });
    expect(captured.provider?.id).toBe("deepseek");
    expect(captured.added).toEqual([]);
    expect(captured.tools.has("webfetch")).toBe(true);
  });

  test("can set DeepSeek as the default websearch provider", async () => {
    const captured = await setup({ setDefaultWebsearch: true });
    expect(captured.defaultProvider).toBe("deepseek");
  });

  test("search uses the Search API and maps results", async () => {
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
            { url: "https://b", title: "B", summary: "low", rerank_score: 1, authority: 4 },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const captured = await setup({ count: 20 }, fetchImpl);
    assert.ok(captured.provider, "Search provider must be registered");
    const results = await captured.provider.execute({ query: "bun" }, { signal: new AbortController().signal });

    expect(results).toEqual([
      { url: "https://a/", title: "A", content: "summary [rerank 2.5 · authority 3 · GitHub]", time: {} },
      { url: "https://b/", title: "B", content: "low [rerank 1 · authority 4]", time: {} },
    ]);
    assert.ok(request, "Search request must be captured");
    expect(request.url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(JSON.parse(String(request.init.body))).toEqual({
      query: "bun",
      count: 20,
      need_content: false,
    });
    expect((request.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  test("search appends the quality marker to the content string without unknown fields", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { url: "https://u", title: "U", summary: "snip", rerank_score: 1.9, authority: -1 },
            { url: "https://bare", title: "Bare" },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const captured = await setup({}, fetchImpl);
    assert.ok(captured.provider, "Search provider must be registered");
    const results = (await captured.provider.execute(
      { query: "quality" },
      { signal: new AbortController().signal },
    )) as { url: string; title?: string; content?: string; time: unknown }[];

    expect(results[0]).toEqual({ url: "https://u/", title: "U", content: "snip [rerank 1.9]", time: {} });
    expect(results[1]).toEqual({ url: "https://bare/", title: "Bare", time: {} });
  });

  test("uses the DeepSeek credential stored by OpenCode when env is absent", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    integrationKey = "sk-integration";
    let authorization: string | undefined;
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit) => {
      authorization = (init.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;

    const captured = await setup({ count: 1 }, fetchImpl);
    assert.ok(captured.provider, "Search provider must be registered");
    await captured.provider.execute({ query: "bun" }, { signal: new AbortController().signal });

    expect(authorization).toBe("Bearer sk-integration");
  });

  test("apiKeySource=env ignores a stored OpenCode credential", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    integrationKey = "sk-integration";
    const captured = await setup({ apiKeySource: "env" });

    assert.ok(captured.provider, "Search provider must be registered");
    await expect(captured.provider.execute({ query: "bun" }, { signal: new AbortController().signal })).rejects.toThrow(
      "DEEPSEEK_API_KEY is not set",
    );
  });

  test("reports a clear error when no credential is available", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const captured = await setup();

    assert.ok(captured.provider, "Search provider must be registered");
    await expect(captured.provider.execute({ query: "bun" }, { signal: new AbortController().signal })).rejects.toThrow(
      "DeepSeek API key is not configured",
    );
  });

  test("fetch asks for permission with the custom action and returns Markdown", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    let body: unknown;
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ title: "Example", content: "Body" }), { status: 200 });
    }) as typeof fetch;

    const captured = await setup({ fetchMaxChars: 100 }, fetchImpl);
    assert.ok(captured.tool, "Fetch tool must be registered");
    const result = await captured.tool.execute({ url: "https://example.com/page" }, toolContext());

    expect(captured.permissions).toEqual([
      {
        sessionID: "ses_test",
        agent: "build",
        action: "deepseek_fetch",
        resources: ["https://example.com/page"],
        save: ["https://example.com/page"],
        metadata: { url: "https://example.com/page" },
        source: { type: "tool", messageID: "msg_test", id: "call_test" },
      },
    ]);
    expect(body).toEqual({ url: "https://example.com/page" });
    expect(result.content).toBe("# Example\n\nBody");
  });

  test("a per-call maxChars budget overrides the configured cap", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const fetchImpl = (async () =>
      Response.json({ title: "Example", content: "x".repeat(300) })) as unknown as typeof fetch;

    const captured = await setup({ fetchMaxChars: 400 }, fetchImpl);
    assert.ok(captured.tool, "Fetch tool must be registered");
    const tighter = await captured.tool.execute({ url: "https://example.com/page", maxChars: 50 }, toolContext());

    expect(Array.from(tighter.content ?? "").length).toBeLessThanOrEqual(50);
    expect(tighter.metadata).toMatchObject({ truncated: true });

    const full = await captured.tool.execute({ url: "https://example.com/page" }, toolContext());
    expect(full.metadata).toMatchObject({ truncated: false });
  });

  test("default mode leaves the built-in webfetch untouched", async () => {
    const captured = await setup();

    expect(captured.tools.get("webfetch")).toBe(captured.builtinWebfetch);
    expect(captured.added.map((tool) => tool.name)).toEqual(["deepseek_fetch"]);
    expect(captured.tools.size).toBe(2);
  });

  test("override mode replaces webfetch without registering it twice", async () => {
    const captured = await setup({ fetchOverrideWebfetch: true });
    const replacement = captured.tools.get("webfetch");

    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(captured.builtinWebfetch);
    expect(replacement?.options).toEqual({ codemode: false, permission: "webfetch" });
    expect(captured.added.map((tool) => tool.name)).toEqual(["deepseek_fetch", "webfetch"]);
    expect(captured.tools.size).toBe(2);
  });

  test("override webfetch uses the standard permission action", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    let body: unknown;
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ title: "Example", content: "Body" }), { status: 200 });
    }) as typeof fetch;

    const captured = await setup({ fetchOverrideWebfetch: true, fetchMaxChars: 100 }, fetchImpl);
    const webfetch = captured.tools.get("webfetch");
    assert.ok(webfetch, "Webfetch tool must be registered");
    const result = await webfetch.execute({ url: "https://example.com/page" }, toolContext());

    expect(body).toEqual({ url: "https://example.com/page" });
    expect(result.content).toBe("# Example\n\nBody");
    expect(result.metadata).toEqual({
      url: "https://example.com/page",
      title: "Example",
      truncated: false,
    });
    expect(captured.permissions[0]).toMatchObject({
      action: "webfetch",
      resources: ["https://example.com/page"],
      save: ["*"],
    });
  });

  test("override webfetch rejects unsupported formats before network access", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    const captured = await setup({ fetchOverrideWebfetch: true }, fetchImpl);
    const webfetch = captured.tools.get("webfetch");
    assert.ok(webfetch, "Webfetch tool must be registered");
    await expect(webfetch.execute({ url: "https://example.com/page", format: "text" }, toolContext())).rejects.toThrow(
      "only returns Markdown",
    );
    expect(called).toBe(false);
    expect(captured.permissions).toEqual([]);
  });

  test("blocks private hosts and domain policy before permission/network", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    const captured = await setup({ fetchBlockedDomains: ["example.com"] }, fetchImpl);
    assert.ok(captured.tool, "Fetch tool must be registered");
    await expect(captured.tool.execute({ url: "https://docs.example.com/page" }, toolContext())).rejects.toThrow(
      "fetchBlockedDomains",
    );
    await expect(captured.tool.execute({ url: "http://localhost:3000/docs" }, toolContext())).rejects.toThrow(
      "local/private",
    );

    expect(called).toBe(false);
    expect(captured.permissions).toEqual([]);
  });

  test("fetch rejects a non-string url before permission and network", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    const captured = await setup({}, fetchImpl);
    assert.ok(captured.tool, "Fetch tool must be registered");
    await expect(captured.tool.execute({ url: 42 } as never, toolContext())).rejects.toThrow("must be a string");
    expect(called).toBe(false);
    expect(captured.permissions).toEqual([]);
  });

  test("fetch fails fast when no credential is configured", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const captured = await setup();

    assert.ok(captured.tool, "Fetch tool must be registered");
    await expect(captured.tool.execute({ url: "https://example.com/page" }, toolContext())).rejects.toThrow(
      "DeepSeek API key is not configured",
    );
    expect(captured.permissions).toEqual([]);
  });

  test("can disable the separate deepseek_fetch tool", async () => {
    const captured = await setup({ fetchRegisterTool: false });
    expect(captured.tool).toBeUndefined();
    expect(captured.added).toEqual([]);
    expect(captured.tools.get("webfetch")).toBe(captured.builtinWebfetch);
  });

  test("resolves the registration knobs where they are consumed", () => {
    expect(resolveRegistration()).toEqual({
      setDefault: false,
      overrideWebfetch: false,
      registerTool: true,
    });
    expect(
      resolveRegistration({
        setDefaultWebsearch: true,
        fetchOverrideWebfetch: true,
        fetchRegisterTool: false,
      }),
    ).toEqual({ setDefault: true, overrideWebfetch: true, registerTool: false });
    expect(resolveRegistration({ setDefaultWebsearch: "yes" }).setDefault).toBe(false);
    expect(resolveRegistration({ fetchRegisterTool: "no" }).registerTool).toBe(true);
  });

  test("composes the fetch descriptions from the shared capability fragments", async () => {
    const captured = await setup({ fetchOverrideWebfetch: true });

    expect(captured.tool?.description).toContain(FETCH_MARKDOWN_ONLY);
    expect(captured.tool?.description).toContain(FETCH_OUTPUT_TRUNCATED);
    const webfetch = captured.tools.get("webfetch");
    expect(webfetch?.description).toContain(FETCH_MARKDOWN_ONLY);
    expect(webfetch?.description).toContain(FETCH_OUTPUT_TRUNCATED);
  });
});

describe("option layering (defaults < shared file < environment < opencode.json options)", () => {
  test("resolves file < DEEPSEEK_* environment < opencode.json options for the same key", async () => {
    const xdg = xdgRoot({ count: 20 });

    // File-only: the shared config file configures this host too.
    expect(await effectiveSearchCount(xdg, { DEEPSEEK_API_KEY: "sk-test" }, {})).toBe(20);
    // The environment outranks the file for the same key.
    expect(await effectiveSearchCount(xdg, { DEEPSEEK_API_KEY: "sk-test", DEEPSEEK_SEARCH_COUNT: "30" }, {})).toBe(30);
    // ctx.options keeps winning exactly as before.
    expect(
      await effectiveSearchCount(xdg, { DEEPSEEK_API_KEY: "sk-test", DEEPSEEK_SEARCH_COUNT: "30" }, { count: 5 }),
    ).toBe(5);
  });

  test("registration keeps reading ctx.options only, with the file present", async () => {
    const { restore: restoreConsole } = captureErrors();
    const restore = pinEnvironment(xdgRoot({ count: 20 }));
    try {
      const captured = await setup({ setDefaultWebsearch: true, fetchRegisterTool: false });
      expect(captured.defaultProvider).toBe("deepseek");
      expect(captured.tool).toBeUndefined();
      expect(captured.added).toEqual([]);
      expect(captured.tools.get("webfetch")).toBe(captured.builtinWebfetch);
    } finally {
      restore();
      restoreConsole();
    }
  });

  test("no shared file keeps the current resolution", async () => {
    expect(await effectiveSearchCount(xdgRoot(), { DEEPSEEK_API_KEY: "sk-test" }, {})).toBe(10);
  });
});

describe("setup-time deviation summary", () => {
  test("prints one config line when the layered resolution deviates from defaults", async () => {
    const { lines, restore: restoreConsole } = captureErrors();
    const restoreEnv = pinEnvironment(xdgRoot({ count: 20, language: "zh" }));
    try {
      await setup();
    } finally {
      restoreConsole();
      restoreEnv();
    }
    // maxResults was not set, so it follows count — the effective value deviates too.
    expect(lines).toEqual(["deepseek-web-retrieval config: count=20 maxResults=20 language=zh"]);
  });

  test("prints no config line when nothing deviates from defaults", async () => {
    const { lines, restore: restoreConsole } = captureErrors();
    const restoreEnv = pinEnvironment(xdgRoot());
    try {
      const captured = await setup();
      expect(captured.provider?.id).toBe("deepseek");
    } finally {
      restoreConsole();
      restoreEnv();
    }
    expect(lines).toEqual([]);
  });
});
