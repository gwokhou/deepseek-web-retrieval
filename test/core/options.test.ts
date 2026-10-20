import { describe, expect, test } from "bun:test"
import {
  resolveAuthOptions,
  resolveFetchOptions,
  resolveFetchTimeoutMs,
  resolvePluginOptions,
  resolveRetryOptions,
  resolveSearchOptions,
} from "../../src/core/options"

describe("resolve options", () => {
  test("uses documented defaults", () => {
    expect(resolvePluginOptions(undefined)).toEqual({
      search: {
        count: 10,
        maxResults: 5,
        minRerank: 1.5,
        minAuthority: 2,
        allowUnknownAuthority: false,
        blockedDomains: [],
        includeDomains: [],
        language: undefined,
        maxSummaryChars: 1200,
        timeoutMs: 30000,
        enabled: true,
      },
      fetch: {
        maxChars: 16000,
        allowedDomains: [],
        blockedDomains: [],
        timeoutMs: 30000,
        blockPrivateHosts: true,
        enabled: true,
      },
      auth: { source: "auto" },
      retry: { maxRetries: 0, baseDelayMs: 250 },
    })
  })

  test("clamps numbers and ignores invalid types", () => {
    const options = resolveSearchOptions({
      count: 0,
      maxResults: 99,
      minRerank: "high",
      minAuthority: Number.NaN,
      maxSummaryChars: -1,
      searchTimeoutMs: 5,
      allowUnknownAuthority: "yes",
    })
    expect(options.count).toBe(1)
    expect(options.maxResults).toBe(50)
    expect(options.minRerank).toBe(1.5)
    expect(options.minAuthority).toBe(2)
    expect(options.maxSummaryChars).toBe(0)
    expect(options.timeoutMs).toBe(1000)
    expect(options.allowUnknownAuthority).toBe(false)
  })

  test("normalizes domains and language", () => {
    const options = resolveSearchOptions({
      blockedDomains: ["https://Pinterest.com/path", 42],
      includeDomains: ["nodejs.org"],
      language: " zh,en ",
    })
    expect(options.blockedDomains).toEqual(["pinterest.com"])
    expect(options.includeDomains).toEqual(["nodejs.org"])
    expect(options.language).toBe("zh,en")
  })

  test("resolves fetch safety limits", () => {
    expect(resolveFetchOptions({ fetchBlockPrivateHosts: false }).blockPrivateHosts).toBe(false)
    expect(resolveFetchOptions({ fetchMaxChars: -1 }).maxChars).toBe(0)
    expect(resolveFetchOptions({ fetchTimeoutMs: 999_999 }).timeoutMs).toBe(120000)
  })

  test("keeps capabilities enabled by default and disables them explicitly", () => {
    expect(resolveSearchOptions({}).enabled).toBe(true)
    expect(resolveSearchOptions({ searchEnabled: false }).enabled).toBe(false)
    expect(resolveSearchOptions({ searchEnabled: "false" }).enabled).toBe(true)
    expect(resolveFetchOptions({}).enabled).toBe(true)
    expect(resolveFetchOptions({ fetchEnabled: false }).enabled).toBe(false)
  })

  test("validates auth source and retry settings", () => {
    expect(resolveAuthOptions({ apiKeySource: "env" }).source).toBe("env")
    expect(resolveAuthOptions({ apiKeySource: "opencode" }).source).toBe("opencode")
    expect(resolveAuthOptions({ apiKeySource: "nonsense" }).source).toBe("auto")
    expect(resolveRetryOptions({ maxRetries: 99 }).maxRetries).toBe(5)
    expect(resolveRetryOptions({ maxRetries: -1 }).maxRetries).toBe(0)
    expect(resolveRetryOptions({ retryBaseDelayMs: 1 }).baseDelayMs).toBe(1)
  })

  test("resolves the shorter of the plugin and per-call timeout", () => {
    expect(resolveFetchTimeoutMs(30000, 5)).toBe(5000)
    expect(resolveFetchTimeoutMs(30000, 60)).toBe(30000)
    expect(resolveFetchTimeoutMs(30000, 0.001)).toBe(1)
    expect(resolveFetchTimeoutMs(30000, 0)).toBe(30000)
    expect(resolveFetchTimeoutMs(30000, "5")).toBe(30000)
  })
})
