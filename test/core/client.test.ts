import { afterEach, describe, expect, test } from "bun:test"
import { DeepSeekApiError, fetchPage, searchWeb } from "../../src/core/client"
import { resolveFetchOptions, resolveRetryOptions, resolveSearchOptions } from "../../src/core/options"
import type { RequestAuth, RetryConfig } from "../../src/core/types"

const originalFetch = globalThis.fetch
const auth: RequestAuth = { apiKey: "sk-test" }
const noRetry: RetryConfig = { maxRetries: 0, baseDelayMs: 0 }

afterEach(() => {
  globalThis.fetch = originalFetch
})

function request(signal = new AbortController().signal, retry: RetryConfig = noRetry) {
  return { signal, auth, retry }
}

/** A successful response whose body stalls until the fetch signal is aborted. */
function stalledResponse(signal: AbortSignal | null | undefined): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal?.aborted) {
        controller.error(signal.reason ?? new Error("aborted"))
        return
      }
      controller.enqueue(new TextEncoder().encode('{"results": ['))
      signal?.addEventListener(
        "abort",
        () => controller.error(signal.reason ?? new Error("aborted")),
        { once: true },
      )
    },
  })
  return new Response(stream, { status: 200 })
}

describe("DeepSeek client", () => {
  test("search posts the query, asks for no content, and maps results", async () => {
    let captured: { url: string; init: RequestInit } | undefined
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit) => {
      captured = { url: String(input), init }
      return new Response(
        JSON.stringify({
          results: [
            { url: "https://a", title: "A", summary: "summary", rerank_score: 2.5, authority: 3 },
            { url: "https://b", title: "B", summary: "low", rerank_score: 1, authority: 4 },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const results = await searchWeb("bun", resolveSearchOptions({ count: 20 }), request())

    expect(results).toEqual([
      { url: "https://a/", title: "A", content: "summary", time: {} },
    ])
    expect(captured!.url).toBe("https://api.deepseek.com/v1/tools/search")
    expect(JSON.parse(String(captured!.init.body))).toEqual({
      query: "bun",
      count: 20,
      need_content: false,
    })
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test")
  })

  test("fetch posts the URL and returns title/content", async () => {
    let captured: { url: string; init: RequestInit } | undefined
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit) => {
      captured = { url: String(input), init }
      return new Response(JSON.stringify({ title: "  Example  ", content: "# Body" }), {
        status: 200,
      })
    }) as typeof fetch

    const page = await fetchPage(
      new URL("https://example.com/page"),
      resolveFetchOptions(),
      request(),
    )

    expect(page).toEqual({ url: "https://example.com/page", title: "Example", content: "# Body" })
    expect(captured!.url).toBe("https://api.deepseek.com/v1/tools/fetch")
    expect(JSON.parse(String(captured!.init.body))).toEqual({ url: "https://example.com/page" })
  })

  test("fetch enforces the host policy before any request", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response("{}")
    }) as unknown as typeof fetch

    const blocked = resolveFetchOptions({ fetchBlockedDomains: ["example.com"] })
    await expect(
      fetchPage(new URL("https://docs.example.com/page"), blocked, request()),
    ).rejects.toThrow("fetchBlockedDomains")
    await expect(
      fetchPage(new URL("http://localhost:3000/docs"), resolveFetchOptions(), request()),
    ).rejects.toThrow("local/private")
    expect(calls).toBe(0)
  })

  test("rejects empty and overlong queries before making a request", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response("{}")
    }) as unknown as typeof fetch

    await expect(searchWeb("   ", resolveSearchOptions(), request())).rejects.toThrow("empty")
    await expect(
      searchWeb("x".repeat(129), resolveSearchOptions(), request()),
    ).rejects.toThrow("128")
    expect(calls).toBe(0)
  })

  test("does not retry non-retryable HTTP errors and redacts keys", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response("bad key sk-1234567890abcdef", { status: 401 })
    }) as unknown as typeof fetch

    const error = await searchWeb("bun", resolveSearchOptions(), request()).catch((value) => value)
    expect(error).toBeInstanceOf(DeepSeekApiError)
    expect(error.message).toContain("invalid API key")
    expect(error.message).not.toContain("1234567890abcdef")
    expect(calls).toBe(1)
  })

  test("retries retryable HTTP errors up to maxRetries", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) return new Response("unavailable", { status: 503 })
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const results = await searchWeb(
      "bun",
      resolveSearchOptions(),
      request(new AbortController().signal, { maxRetries: 1, baseDelayMs: 0 }),
    )
    expect(results).toEqual([])
    expect(calls).toBe(2)
  })

  test("honors Retry-After for 429 responses", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } })
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await searchWeb(
      "bun",
      resolveSearchOptions(),
      request(new AbortController().signal, { maxRetries: 1, baseDelayMs: 1000 }),
    )
    expect(calls).toBe(2)
  })

  test("reports invalid JSON and empty fetch content", async () => {
    globalThis.fetch = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch
    await expect(searchWeb("bun", resolveSearchOptions(), request())).rejects.toThrow(
      "invalid JSON",
    )

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ title: "Empty", content: "  " }), {
        status: 200,
      })) as unknown as typeof fetch
    await expect(
      fetchPage(new URL("https://example.com"), resolveFetchOptions(), request()),
    ).rejects.toThrow("no page content")
  })

  test("times out a stalled request", async () => {
    globalThis.fetch = ((_input: string | URL | Request, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })) as typeof fetch

    await expect(
      searchWeb("bun", { ...resolveSearchOptions(), timeoutMs: 5 }, request()),
    ).rejects.toThrow("timed out after 5 ms")
  })

  test("times out while reading a stalled response body", async () => {
    globalThis.fetch = ((_input: string | URL | Request, init: RequestInit) =>
      Promise.resolve(stalledResponse(init.signal))) as typeof fetch

    await expect(
      searchWeb("bun", { ...resolveSearchOptions(), timeoutMs: 5 }, request()),
    ).rejects.toThrow("timed out after 5 ms")
  })

  test("aborts while reading a stalled response body", async () => {
    const controller = new AbortController()
    globalThis.fetch = ((_input: string | URL | Request, init: RequestInit) =>
      Promise.resolve(stalledResponse(init.signal))) as typeof fetch

    const pending = searchWeb(
      "bun",
      { ...resolveSearchOptions(), timeoutMs: 10000 },
      request(controller.signal),
    )
    setTimeout(() => controller.abort(new Error("stop reading")), 10)

    await expect(pending).rejects.toThrow("stop reading")
  })

  test("rejects a query that exceeds the limit after search modifiers", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(JSON.stringify({ results: [] }))
    }) as unknown as typeof fetch

    await expect(
      searchWeb(
        "q".repeat(100),
        resolveSearchOptions({
          blockedDomains: ["pinterest.com", "facebook.com", "x.com"],
        }),
        request(),
      ),
    ).rejects.toThrow("after applying")
    expect(calls).toBe(0)
  })

  test("allows a query exactly at the final query limit", async () => {
    let sent: string | undefined
    globalThis.fetch = (async (_input: string | URL | Request, init: RequestInit) => {
      sent = JSON.parse(String(init.body)).query
      return new Response(JSON.stringify({ results: [] }))
    }) as typeof fetch

    await searchWeb("q".repeat(120), resolveSearchOptions({ language: "en" }), request())

    expect(sent?.length).toBe(128)
  })

  test("rejects oversized successful responses", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x78)
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 6; index++) controller.enqueue(chunk)
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    }) as unknown as typeof fetch

    await expect(searchWeb("bun", resolveSearchOptions(), request())).rejects.toThrow(
      "exceeded",
    )
  })
})
