import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_RETRIES, MAX_RETRY_DELAY_MS, SEARCH_ENDPOINT } from "../../src/core/constants";
import type { TransportOptions } from "../../src/core/transport";
import { DeepSeekApiError, parseRetryAfter, postJson, retryDelay } from "../../src/core/transport";
import type { RequestAuth } from "../../src/core/types";

const auth: RequestAuth = { apiKey: "sk-test" };

function opts(overrides: Partial<TransportOptions> = {}): TransportOptions {
  return {
    signal: new AbortController().signal,
    auth,
    retry: { maxRetries: 0, baseDelayMs: 0 },
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("transport postJson", () => {
  test("waits out an HTTP-date Retry-After before retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        const retryAfter = new Date(Date.now() + 50).toUTCString();
        return new Response("slow down", { status: 429, headers: { "retry-after": retryAfter } });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const payload = await postJson<{ results: unknown[] }>(
      SEARCH_ENDPOINT,
      { query: "bun" },
      "DeepSeek Search",
      opts({ retry: { maxRetries: 1, baseDelayMs: 1000 }, fetchImpl }),
    );

    expect(payload).toEqual({ results: [] });
    expect(calls).toBe(2);
  });

  test("the default retries a transient failure twice and succeeds on the third attempt", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const payload = await postJson<{ results: unknown[] }>(
      SEARCH_ENDPOINT,
      { query: "bun" },
      "DeepSeek Search",
      opts({ retry: { maxRetries: DEFAULT_MAX_RETRIES, baseDelayMs: 0 }, fetchImpl }),
    );

    expect(payload).toEqual({ results: [] });
    expect(calls).toBe(3);
  });

  test("aborts during the retry sleep with the abort reason", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    }) as unknown as typeof fetch;

    const pending = postJson(
      SEARCH_ENDPOINT,
      { query: "bun" },
      "DeepSeek Search",
      opts({
        signal: controller.signal,
        retry: { maxRetries: 1, baseDelayMs: 1000 },
        fetchImpl,
      }),
    );
    setTimeout(() => controller.abort(new Error("stop waiting")), 10);

    await expect(pending).rejects.toThrow("stop waiting");
    expect(calls).toBe(1);
  });

  test("reads the error body through text() when the response has no stream", async () => {
    const fetchImpl = (async () =>
      ({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => "boom",
      }) as unknown as Response) as unknown as typeof fetch;

    const error = await postJson(SEARCH_ENDPOINT, { query: "bun" }, "DeepSeek Search", opts({ fetchImpl })).catch(
      (value) => value,
    );

    expect(error).toBeInstanceOf(DeepSeekApiError);
    expect((error as DeepSeekApiError).message).toContain("boom");
  });

  test("rejects a 200 with an empty body without retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const pending = postJson(SEARCH_ENDPOINT, { query: "bun" }, "DeepSeek Search", opts({ fetchImpl }));
    await expect(pending).rejects.toThrow("DeepSeek Search returned an empty response body");
    expect(calls).toBe(1);
  });

  test("a network error is thrown as-is, never retried", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;

    const pending = postJson(
      SEARCH_ENDPOINT,
      { query: "bun" },
      "DeepSeek Search",
      opts({ retry: { maxRetries: 2, baseDelayMs: 0 }, fetchImpl }),
    );
    await expect(pending).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
  });
});

describe("parseRetryAfter", () => {
  test("honors numeric seconds and caps every form at the maximum delay", () => {
    expect(parseRetryAfter(new Date(Date.now() + 60_000).toUTCString())).toBe(MAX_RETRY_DELAY_MS);
    expect(parseRetryAfter("30")).toBe(MAX_RETRY_DELAY_MS);
    expect(parseRetryAfter("2")).toBe(2000);
  });
});

describe("retryDelay", () => {
  test("prefers Retry-After and falls back to capped exponential backoff", () => {
    expect(retryDelay(2500, 100, 0)).toBe(2500);
    expect(retryDelay(undefined, 100, 0)).toBe(100);
    expect(retryDelay(undefined, 100, 3)).toBe(800);
    expect(retryDelay(undefined, 6000, 2)).toBe(MAX_RETRY_DELAY_MS);
  });
});
