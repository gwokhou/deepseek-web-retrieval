import { describe, expect, test } from "bun:test";
import { resolveSearchOptions } from "../../src/core/options";
import { composeSearchQuery, parsePublished, processResults } from "../../src/core/search";
import type { DeepSeekSearchResult } from "../../src/core/types";

const defaults = resolveSearchOptions(undefined);

describe("composeSearchQuery", () => {
  test("appends blocked, included, and language operators", () => {
    expect(
      composeSearchQuery("  typescript  ", {
        blockedDomains: ["pinterest.com"],
        includeDomains: ["nodejs.org", "https://developer.mozilla.org/en-US"],
        language: "zh,en",
      }),
    ).toEqual({
      query: "typescript -site:pinterest.com site:nodejs.org OR site:developer.mozilla.org lang:zh,en",
      notes: [],
    });
  });

  test("leaves the query alone when no modifiers are configured", () => {
    expect(composeSearchQuery("bun runtime", defaults)).toEqual({ query: "bun runtime", notes: [] });
  });

  test("accepts a language that already has the lang: prefix", () => {
    expect(composeSearchQuery("bun", { ...defaults, language: "lang:ja" })).toEqual({
      query: "bun lang:ja",
      notes: [],
    });
  });

  test("truncates the body before dropping any operator", () => {
    // -site:pinterest.com occupies 19+1 characters of the 40-character budget.
    const composed = composeSearchQuery("q".repeat(99), { ...defaults, blockedDomains: ["pinterest.com"] }, 40);
    expect(Array.from(composed.query).length).toBe(40);
    expect(composed.query.endsWith("-site:pinterest.com")).toBe(true);
    expect(composed.notes).toEqual(["query truncated to 20 characters (query length limit)"]);
  });

  test("drops the language filter before the include list", () => {
    // Keeping every operator leaves only 5 characters of the 24-character
    // budget — under the 8-character floor — so the language filter goes.
    const composed = composeSearchQuery("bodybody", { ...defaults, includeDomains: ["a.com"], language: "zh" }, 24);
    expect(composed.query).toBe("bodybody site:a.com");
    expect(composed.notes).toEqual(["language filter dropped (query length limit)"]);
  });

  test("drops the include list last", () => {
    const composed = composeSearchQuery(
      "body",
      { ...defaults, includeDomains: ["averylongdomainname.example"], language: "zh" },
      16,
    );
    expect(composed.query).toBe("body");
    expect(composed.notes).toEqual([
      "language filter dropped (query length limit)",
      "includeDomains filter dropped (query length limit)",
    ]);
  });

  test("never drops blocked domains: oversized -site: lists fail the call", () => {
    const blockedDomains = Array.from({ length: 20 }, (_value, index) => `domain${index}.example`);
    expect(() => composeSearchQuery("q".repeat(100), { ...defaults, blockedDomains })).toThrow("cannot fit");
  });
});

describe("processResults", () => {
  const passing: DeepSeekSearchResult = {
    url: "https://example.com/a",
    title: "  Example  ",
    summary: "  A useful summary.  ",
    snippet: "snippet",
    rerank_score: 2.4,
    authority: 3,
    date: "2026-06-01T00:00:00+00:00",
  };

  test("filters quality, authority, missing scores, unsafe URLs, and empty URLs when thresholds are set", () => {
    const options = resolveSearchOptions({
      minRerank: 1.5,
      minAuthority: 2,
      allowUnknownAuthority: false,
    });
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
    ];

    expect(processResults(raw, options)).toEqual([
      {
        url: "https://example.com/a",
        title: "Example",
        content: "A useful summary.",
        published: Date.parse("2026-06-01T00:00:00+00:00"),
        rerankScore: 2.4,
        authority: 3,
      },
    ]);
  });

  test("passes quality fields through, keeping unknown authority faithful", () => {
    const raw: DeepSeekSearchResult[] = [
      { url: "https://full", rerank_score: 2.1, authority: 3, site_name: "  GitHub  " },
      { url: "https://unknown", rerank_score: 1.9, authority: -1, site_name: "  " },
      { url: "https://absent" },
      { url: "https://invalid", rerank_score: Number.NaN, authority: Number.POSITIVE_INFINITY, site_name: null },
    ];
    expect(processResults(raw, resolveSearchOptions({ allowUnknownAuthority: true }))).toEqual([
      { url: "https://full/", rerankScore: 2.1, authority: 3, siteName: "GitHub" },
      { url: "https://unknown/", rerankScore: 1.9, authority: -1 },
      { url: "https://absent/" },
      { url: "https://invalid/" },
    ]);
  });

  test("keeps missing rerank_score only while no positive threshold is set", () => {
    const raw: DeepSeekSearchResult[] = [
      { url: "https://missing", authority: 4 },
      { url: "https://non-finite", rerank_score: Number.NaN, authority: 4 },
      { url: "https://negative", rerank_score: -1, authority: 4 },
    ];
    // Default (minRerank 0): the pass-through default returns what DeepSeek
    // ranked, so unscored results stay; a present score still compares.
    expect(processResults(raw, resolveSearchOptions()).map((result) => result.url)).toEqual([
      "https://missing/",
      "https://non-finite/",
    ]);
    // Any positive threshold requires a score to compare against it.
    expect(processResults(raw, resolveSearchOptions({ minRerank: 0.5 }))).toEqual([]);
  });

  test("optionally keeps unknown authority", () => {
    const options = resolveSearchOptions({ allowUnknownAuthority: true });
    const raw: DeepSeekSearchResult[] = [
      { url: "https://unknown", rerank_score: 2, authority: -1 },
      { url: "https://missing", rerank_score: 2 },
      { url: "https://known", rerank_score: 2, authority: 2 },
    ];
    expect(processResults(raw, options).map((result) => result.url)).toEqual([
      "https://unknown/",
      "https://missing/",
      "https://known/",
    ]);
  });

  test("falls back to snippet, truncates summaries with a marker, and omits invalid dates", () => {
    const options = resolveSearchOptions({ maxSummaryChars: 5 });
    const raw: DeepSeekSearchResult[] = [
      { url: "https://a", summary: "   ", snippet: "abcdefgh", rerank_score: 2, authority: 3 },
      { url: "https://b", date: "not a date", rerank_score: 2, authority: 3 },
    ];
    expect(processResults(raw, options)).toEqual([
      // The snippet was cut at 5 characters; the ellipsis marks the cut.
      { url: "https://a/", content: "abcde…", rerankScore: 2, authority: 3 },
      { url: "https://b/", rerankScore: 2, authority: 3 },
    ]);
  });

  test("does not mark a summary the cap did not shorten", () => {
    const options = resolveSearchOptions({ maxSummaryChars: 5 });
    const raw: DeepSeekSearchResult[] = [{ url: "https://a", summary: "abcde", rerank_score: 2, authority: 3 }];
    expect(processResults(raw, options)).toEqual([
      { url: "https://a/", content: "abcde", rerankScore: 2, authority: 3 },
    ]);
  });

  test("deduplicates normalized URLs and caps maxResults", () => {
    const options = resolveSearchOptions({ maxResults: 2 });
    const raw: DeepSeekSearchResult[] = [
      { url: "https://duplicate", rerank_score: 1, authority: 3 },
      { url: "https://duplicate/", rerank_score: 2, authority: 3, summary: "winner" },
      { url: "https://second", rerank_score: 2, authority: 3 },
      { url: "https://third", rerank_score: 2, authority: 3 },
    ];
    expect(processResults(raw, options).map((result) => result.url)).toEqual(["https://duplicate/", "https://second/"]);
    expect(processResults(raw, options)[0]?.content).toBeUndefined();
  });

  test("maxResults zero returns no results", () => {
    expect(processResults([passing], resolveSearchOptions({ maxResults: 0 }))).toEqual([]);
  });
});

describe("parsePublished", () => {
  test("accepts RFC 3339 strings only", () => {
    expect(parsePublished("2026-06-01T00:00:00+00:00")).toBe(Date.parse("2026-06-01T00:00:00+00:00"));
    expect(parsePublished("not a date")).toBeUndefined();
    expect(parsePublished(1780272000000)).toBeUndefined();
    expect(parsePublished(null)).toBeUndefined();
  });
});
