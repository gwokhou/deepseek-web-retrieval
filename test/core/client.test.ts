import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createRetrievalClient, DeepSeekApiError, fetchDocument, fetchPage, searchWeb } from "../../src/core/client";
import { resolveFetchOptions, resolveSearchOptions } from "../../src/core/options";
import type { RequestAuth, RetryOptions } from "../../src/core/types";

const auth: RequestAuth = { apiKey: "sk-test" };
const noRetry: RetryOptions = { maxRetries: 0, baseDelayMs: 0 };

function request(fetchImpl?: typeof fetch, signal = new AbortController().signal, retry: RetryOptions = noRetry) {
  return { signal, auth, retry, fetchImpl };
}

/** A successful response whose body stalls until the fetch signal is aborted. */
function stalledResponse(signal: AbortSignal | null | undefined): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal?.aborted) {
        controller.error(signal.reason ?? new Error("aborted"));
        return;
      }
      controller.enqueue(new TextEncoder().encode('{"results": ['));
      signal?.addEventListener("abort", () => controller.error(signal.reason ?? new Error("aborted")), { once: true });
    },
  });
  return new Response(stream, { status: 200 });
}

describe("DeepSeek client", () => {
  test("search posts the query, asks for no content, and maps results", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (input: string | URL | Request, init: RequestInit) => {
      captured = { url: String(input), init };
      return new Response(
        JSON.stringify({
          results: [
            { url: "https://a", title: "A", summary: "summary", rerank_score: 2.5, authority: 3 },
            { url: "https://b", title: "B", summary: "low", rerank_score: 1, authority: 4 },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const results = await searchWeb("bun", resolveSearchOptions({ count: 20 }), request(fetchImpl));

    expect(results).toEqual([
      { url: "https://a/", title: "A", content: "summary", rerankScore: 2.5, authority: 3 },
      { url: "https://b/", title: "B", content: "low", rerankScore: 1, authority: 4 },
    ]);
    assert.ok(captured, "Search request must be captured");
    expect(captured.url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(JSON.parse(String(captured.init.body))).toEqual({
      query: "bun",
      count: 20,
      need_content: false,
    });
    expect((captured.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  test("search sends ori_question when the option is set, trimmed, and clamped to 128 code points", async () => {
    const capturedBodies: unknown[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;

    await searchWeb("bun", resolveSearchOptions(), {
      ...request(fetchImpl),
      oriQuestion: "  how do I test bun?  ",
    });
    await searchWeb("bun", resolveSearchOptions(), { ...request(fetchImpl), oriQuestion: `😀${"x".repeat(129)}` });

    expect(capturedBodies[0]).toEqual({
      query: "bun",
      count: 10,
      need_content: false,
      ori_question: "how do I test bun?",
    });
    // 130 code points (the emoji counts as one) clamp to the first 128.
    const clamped = String((capturedBodies[1] as { ori_question: string }).ori_question);
    expect(Array.from(clamped)).toHaveLength(128);
    expect(Array.from(clamped)[0]).toBe("😀");
  });

  test("search omits ori_question when absent or whitespace-only", async () => {
    const capturedBodies: unknown[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;

    await searchWeb("bun", resolveSearchOptions(), request(fetchImpl));
    await searchWeb("bun", resolveSearchOptions(), { ...request(fetchImpl), oriQuestion: "   " });

    for (const body of capturedBodies) {
      expect(body).toEqual({ query: "bun", count: 10, need_content: false });
    }
  });

  test("search sends localization only when a valid IP resolved it", async () => {
    const capturedBodies: unknown[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;

    await searchWeb("bun", resolveSearchOptions({ searchLocalization: "203.0.113.7" }), request(fetchImpl));
    await searchWeb("bun", resolveSearchOptions({ searchLocalization: "not-an-ip" }), request(fetchImpl));
    await searchWeb("bun", resolveSearchOptions(), request(fetchImpl));

    expect(capturedBodies[0]).toEqual({
      query: "bun",
      count: 10,
      need_content: false,
      localization: "203.0.113.7",
    });
    // An invalid value never resolves onto SearchOptions, so the field is absent.
    expect(capturedBodies[1]).toEqual({ query: "bun", count: 10, need_content: false });
    expect(capturedBodies[2]).toEqual({ query: "bun", count: 10, need_content: false });
  });

  test("fetch posts the URL and returns title/content", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (input: string | URL | Request, init: RequestInit) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ title: "  Example  ", content: "# Body" }), {
        status: 200,
      });
    }) as typeof fetch;

    const page = await fetchPage(new URL("https://example.com/page"), resolveFetchOptions(), request(fetchImpl));

    expect(page).toEqual({ url: "https://example.com/page", title: "Example", content: "# Body" });
    assert.ok(captured, "Fetch request must be captured");
    expect(captured.url).toBe("https://api.deepseek.com/v1/tools/fetch");
    expect(JSON.parse(String(captured.init.body))).toEqual({ url: "https://example.com/page" });
  });

  test("fetch enforces the host policy before any request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}");
    }) as unknown as typeof fetch;

    const blocked = resolveFetchOptions({ fetchBlockedDomains: ["example.com"] });
    await expect(fetchPage(new URL("https://docs.example.com/page"), blocked, request(fetchImpl))).rejects.toThrow(
      "fetchBlockedDomains",
    );
    await expect(
      fetchPage(new URL("http://localhost:3000/docs"), resolveFetchOptions(), request(fetchImpl)),
    ).rejects.toThrow("local/private");
    expect(calls).toBe(0);
  });

  test("URL objects enforce the same protocol, credentials, and length limits as strings", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json({ title: "Example", content: "body" });
    }) as unknown as typeof fetch;
    const options = resolveFetchOptions();
    const invalid = [
      ["https://user:review-password@example.com/page", "credentials"],
      ["ftp://example.com/file", "http:// or https://"],
      [`https://example.com/${"x".repeat(8192)}`, "8192"],
    ];
    for (const [url, message] of invalid) {
      await expect(fetchDocument(url, options, request(fetchImpl))).rejects.toThrow(message);
      await expect(fetchDocument(new URL(url), options, request(fetchImpl))).rejects.toThrow(message);
      await expect(fetchPage(new URL(url), options, request(fetchImpl))).rejects.toThrow(message);
    }
    expect(calls).toBe(0);
    const document = await fetchDocument(new URL("https://example.com/page"), options, request(fetchImpl));
    expect(document.url).toBe("https://example.com/page");
    expect(calls).toBe(1);
  });

  test("rejects empty and overlong queries before making a request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}");
    }) as unknown as typeof fetch;

    await expect(searchWeb("   ", resolveSearchOptions(), request(fetchImpl))).rejects.toThrow("empty");
    await expect(searchWeb("x".repeat(129), resolveSearchOptions(), request(fetchImpl))).rejects.toThrow("128");
    expect(calls).toBe(0);
  });

  test("does not retry non-retryable HTTP errors and redacts keys", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("bad key sk-1234567890abcdef", { status: 401 });
    }) as unknown as typeof fetch;

    const error = await searchWeb("bun", resolveSearchOptions(), request(fetchImpl)).catch((value) => value);
    expect(error).toBeInstanceOf(DeepSeekApiError);
    expect(error.message).toContain("invalid API key");
    expect(error.message).not.toContain("1234567890abcdef");
    expect(calls).toBe(1);
  });

  test("retries retryable HTTP errors up to maxRetries", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const results = await searchWeb(
      "bun",
      resolveSearchOptions(),
      request(fetchImpl, new AbortController().signal, { maxRetries: 1, baseDelayMs: 0 }),
    );
    expect(results).toEqual([]);
    expect(calls).toBe(2);
  });

  test("honors Retry-After for 429 responses", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await searchWeb(
      "bun",
      resolveSearchOptions(),
      request(fetchImpl, new AbortController().signal, { maxRetries: 1, baseDelayMs: 1000 }),
    );
    expect(calls).toBe(2);
  });

  test("reports invalid JSON and empty fetch content", async () => {
    let fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    await expect(searchWeb("bun", resolveSearchOptions(), request(fetchImpl))).rejects.toThrow("invalid JSON");

    fetchImpl = (async () =>
      new Response(JSON.stringify({ title: "Empty", content: "  " }), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(fetchPage(new URL("https://example.com"), resolveFetchOptions(), request(fetchImpl))).rejects.toThrow(
      "no page content",
    );
  });

  test("times out a stalled request", async () => {
    const fetchImpl = ((_input: string | URL | Request, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as typeof fetch;

    await expect(searchWeb("bun", { ...resolveSearchOptions(), timeoutMs: 5 }, request(fetchImpl))).rejects.toThrow(
      "timed out after 5 ms",
    );
  });

  test("a per-call timeout caps the configured search timeout", async () => {
    const fetchImpl = ((_input: string | URL | Request, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as typeof fetch;

    await expect(
      searchWeb("bun", resolveSearchOptions(), {
        signal: new AbortController().signal,
        auth,
        retry: noRetry,
        timeoutMs: 5,
        fetchImpl,
      }),
    ).rejects.toThrow("timed out after 5 ms");
  });

  test("times out while reading a stalled response body", async () => {
    const fetchImpl = ((_input: string | URL | Request, init: RequestInit) =>
      Promise.resolve(stalledResponse(init.signal))) as typeof fetch;

    await expect(searchWeb("bun", { ...resolveSearchOptions(), timeoutMs: 5 }, request(fetchImpl))).rejects.toThrow(
      "timed out after 5 ms",
    );
  });

  test("aborts while reading a stalled response body", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_input: string | URL | Request, init: RequestInit) =>
      Promise.resolve(stalledResponse(init.signal))) as typeof fetch;

    const pending = searchWeb(
      "bun",
      { ...resolveSearchOptions(), timeoutMs: 10000 },
      request(fetchImpl, controller.signal),
    );
    setTimeout(() => controller.abort(new Error("stop reading")), 10);

    await expect(pending).rejects.toThrow("stop reading");
  });

  test("rejects a query that exceeds the limit after search modifiers", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ results: [] }));
    }) as unknown as typeof fetch;

    await expect(
      searchWeb(
        "q".repeat(100),
        resolveSearchOptions({
          blockedDomains: ["pinterest.com", "facebook.com", "x.com"],
        }),
        request(fetchImpl),
      ),
    ).rejects.toThrow("after applying");
    expect(calls).toBe(0);
  });

  test("allows a query exactly at the final query limit", async () => {
    let sent: string | undefined;
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit) => {
      sent = JSON.parse(String(init.body)).query;
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;

    await searchWeb("q".repeat(120), resolveSearchOptions({ language: "en" }), request(fetchImpl));

    expect(sent?.length).toBe(128);
  });

  test("rejects oversized successful responses", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x78);
    const fetchImpl = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 6; index++) controller.enqueue(chunk);
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    await expect(searchWeb("bun", resolveSearchOptions(), request(fetchImpl))).rejects.toThrow("exceeded");
  });
});

test("concurrent retrieval clients keep their transport, authentication, and results isolated", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const makeClient = (name: string) =>
    createRetrievalClient({
      fetchImpl: (async (_url, init) => {
        calls.push(`${name}:${new Headers(init?.headers).get("Authorization")}`);
        await Bun.sleep(name === "first" ? 10 : 1);
        return Response.json({ title: name, content: `body-${name}` });
      }) as typeof fetch,
    });
  const [first, second] = await Promise.all([
    makeClient("first").fetchDocument("https://example.com", resolveFetchOptions(), {
      ...request(),
      auth: { apiKey: "key-first" },
    }),
    makeClient("second").fetchDocument("https://example.com", resolveFetchOptions(), {
      ...request(),
      auth: { apiKey: "key-second" },
    }),
  ]);
  expect(first.title).toBe("first");
  expect(second.title).toBe("second");
  expect(calls.sort()).toEqual(["first:Bearer key-first", "second:Bearer key-second"]);
  expect(globalThis.fetch).toBe(original);
});
