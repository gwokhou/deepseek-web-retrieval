import { describe, expect, test } from "bun:test"
import { resolveSearchOptions } from "../../src/core/options"
import { buildQuery, parsePublished, processResults } from "../../src/core/search"
import type { DeepSeekSearchResult } from "../../src/core/types"

const defaults = resolveSearchOptions(undefined)

describe("buildQuery", () => {
  test("appends blocked, included, and language operators", () => {
    expect(
      buildQuery("  typescript  ", {
        blockedDomains: ["pinterest.com"],
        includeDomains: ["nodejs.org", "https://developer.mozilla.org/en-US"],
        language: "zh,en",
      }),
    ).toBe(
      "typescript -site:pinterest.com site:nodejs.org OR site:developer.mozilla.org lang:zh,en",
    )
  })

  test("leaves the query alone when no modifiers are configured", () => {
    expect(buildQuery("bun runtime", defaults)).toBe("bun runtime")
  })

  test("accepts a language that already has the lang: prefix", () => {
    expect(buildQuery("bun", { ...defaults, language: "lang:ja" })).toBe("bun lang:ja")
  })
})

describe("processResults", () => {
  const passing: DeepSeekSearchResult = {
    url: "https://example.com/a",
    title: "  Example  ",
    summary: "  A useful summary.  ",
    snippet: "snippet",
    rerank_score: 2.4,
    authority: 3,
    date: "2026-06-01T00:00:00+00:00",
  }

  test("filters quality, authority, missing scores, unsafe URLs, and empty URLs when thresholds are set", () => {
    const options = resolveSearchOptions({
      minRerank: 1.5,
      minAuthority: 2,
      allowUnknownAuthority: false,
    })
    const raw: DeepSeekSearchResult[] = [
      passing,
      { url: "https://low-rerank", rerank_score: 1.2, authority: 4 },
      { url: "https://low-authority", rerank_score: 2, authority: 1 },
      { url: "https://unknown-authority", rerank_score: 2, authority: -1 },
      { url: "https://missing-authority", rerank_score: 2 },
      { url: "https://missing-rerank", authority: 4 },
      { url: "javascript:alert(1)", rerank_score: 2, authority: 4 },
      { url: "https://user:pass@example.com/private", rerank_score: 2, authority: 4 },
      { url: "", rerank_score: 2, authority: 4 },
    ]

    expect(processResults(raw, options)).toEqual([
      {
        url: "https://example.com/a",
        title: "Example",
        content: "A useful summary.",
        published: Date.parse("2026-06-01T00:00:00+00:00"),
      },
    ])
  })

  test("keeps missing rerank_score only while no positive threshold is set", () => {
    const raw: DeepSeekSearchResult[] = [
      { url: "https://missing", authority: 4 },
      { url: "https://non-finite", rerank_score: Number.NaN, authority: 4 },
      { url: "https://negative", rerank_score: -1, authority: 4 },
    ]
    // Default (minRerank 0): the pass-through default returns what DeepSeek
    // ranked, so unscored results stay; a present score still compares.
    expect(processResults(raw, resolveSearchOptions()).map((result) => result.url)).toEqual([
      "https://missing/",
      "https://non-finite/",
    ])
    // Any positive threshold requires a score to compare against it.
    expect(processResults(raw, resolveSearchOptions({ minRerank: 0.5 }))).toEqual([])
  })

  test("optionally keeps unknown authority", () => {
    const options = resolveSearchOptions({ allowUnknownAuthority: true })
    const raw: DeepSeekSearchResult[] = [
      { url: "https://unknown", rerank_score: 2, authority: -1 },
      { url: "https://missing", rerank_score: 2 },
      { url: "https://known", rerank_score: 2, authority: 2 },
    ]
    expect(processResults(raw, options).map((result) => result.url)).toEqual([
      "https://unknown/",
      "https://missing/",
      "https://known/",
    ])
  })

  test("falls back to snippet, truncates summaries, and omits invalid dates", () => {
    const options = resolveSearchOptions({ maxSummaryChars: 5 })
    const raw: DeepSeekSearchResult[] = [
      { url: "https://a", summary: "   ", snippet: "abcdefgh", rerank_score: 2, authority: 3 },
      { url: "https://b", date: "not a date", rerank_score: 2, authority: 3 },
    ]
    expect(processResults(raw, options)).toEqual([
      { url: "https://a/", content: "abcde" },
      { url: "https://b/" },
    ])
  })

  test("deduplicates normalized URLs and caps maxResults", () => {
    const options = resolveSearchOptions({ maxResults: 2 })
    const raw: DeepSeekSearchResult[] = [
      { url: "https://duplicate", rerank_score: 1, authority: 3 },
      { url: "https://duplicate/", rerank_score: 2, authority: 3, summary: "winner" },
      { url: "https://second", rerank_score: 2, authority: 3 },
      { url: "https://third", rerank_score: 2, authority: 3 },
    ]
    expect(processResults(raw, options).map((result) => result.url)).toEqual([
      "https://duplicate/",
      "https://second/",
    ])
    expect(processResults(raw, options)[0]?.content).toBeUndefined()
  })

  test("maxResults zero returns no results", () => {
    expect(processResults([passing], resolveSearchOptions({ maxResults: 0 }))).toEqual([])
  })
})

describe("parsePublished", () => {
  test("accepts RFC 3339 strings only", () => {
    expect(parsePublished("2026-06-01T00:00:00+00:00")).toBe(
      Date.parse("2026-06-01T00:00:00+00:00"),
    )
    expect(parsePublished("not a date")).toBeUndefined()
    expect(parsePublished(1780272000000)).toBeUndefined()
    expect(parsePublished(null)).toBeUndefined()
  })
})
