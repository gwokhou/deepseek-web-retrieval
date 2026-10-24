import { describe, expect, test } from "bun:test";
import { FETCH_TRUNCATION_MARKER } from "../../src/core/constants";
import {
  formatApiError,
  formatFetchedContent,
  formatSearchResults,
  redactSecrets,
  toStructuredResult,
  truncate,
} from "../../src/core/format";
import type { SearchResult } from "../../src/core/types";
import { budgetOutput, resultIntegrity } from "../content-budget";
import { CONTENT_BUDGET_CASES, PI_MCP_OUTPUT_BYTES } from "../fixtures/search-content.mjs";

describe("formatting", () => {
  test("truncates ASCII and Unicode without splitting surrogate pairs", () => {
    expect(truncate("abcdef", 3)).toBe("abc");
    expect(truncate("abc", 3)).toBe("abc");
    expect(truncate("abc", 0)).toBe("");
    expect(truncate("a😀b", 2)).toBe("a😀");
    expect(truncate("😀😀", 1)).toBe("😀");
  });

  test("adds a title and counts the truncation marker in the budget", () => {
    expect(formatFetchedContent("Title", "body", 100)).toEqual({
      content: "# Title\n\nbody",
      truncated: false,
    });
    expect(formatFetchedContent("", "", 10)).toEqual({ content: "", truncated: false });

    const truncated = formatFetchedContent("Title", "x".repeat(100), 50);
    expect(truncated.truncated).toBe(true);
    expect(Array.from(truncated.content)).toHaveLength(50);
    expect(truncated.content.endsWith(FETCH_TRUNCATION_MARKER)).toBe(true);
    expect(truncated.content.startsWith("# Title\n\nx")).toBe(true);

    expect(formatFetchedContent("", "body", 2)).toEqual({ content: "bo", truncated: true });
    expect(formatFetchedContent("", "body", 0)).toEqual({ content: "", truncated: true });
  });

  test("does not duplicate a title that already starts the Markdown body", () => {
    expect(formatFetchedContent("Example Domain", "# Example Domain\n\nbody", 100)).toEqual({
      content: "# Example Domain\n\nbody",
      truncated: false,
    });
    expect(formatFetchedContent("Example Domain", "  # example domain\n\nbody", 100)).toEqual({
      content: "# Example Domain\n\nbody",
      truncated: false,
    });
    expect(formatFetchedContent("Example Domain", "\\# Example Domain\n\nbody", 100)).toEqual({
      content: "# Example Domain\n\nbody",
      truncated: false,
    });
    expect(formatFetchedContent("Different", "# Example Domain\n\nbody", 100)).toEqual({
      content: "# Different\n\n# Example Domain\n\nbody",
      truncated: false,
    });
  });

  test("redacts API keys and bearer tokens", () => {
    expect(redactSecrets("key sk-1234567890abcdef and Bearer abcdefghijklmnop")).toBe("key sk-*** and Bearer ***");
  });

  test("formats API errors with hints and redaction", () => {
    expect(formatApiError("DeepSeek Search", 401, '{"error":"bad"}')).toBe(
      'DeepSeek Search failed (HTTP 401, invalid API key): {"error":"bad"}',
    );
    expect(formatApiError("DeepSeek Fetch", 404, "  ")).toBe("DeepSeek Fetch failed (HTTP 404): empty response body");
    expect(formatApiError("DeepSeek Fetch", 429, "slow down")).toContain("rate limited");
    expect(formatApiError("DeepSeek Search", 500, "x".repeat(5000)).endsWith("…")).toBe(true);
    expect(formatApiError("DeepSeek Search", 401, "sk-1234567890abcdef")).not.toContain("1234567890abcdef");
  });

  test("truncates API error bodies by code points", () => {
    const exact = "😀".repeat(2000);
    expect(formatApiError("DeepSeek Search", 500, exact)).toBe(`DeepSeek Search failed (HTTP 500): ${exact}`);

    const message = formatApiError("DeepSeek Search", 500, `${"x".repeat(1999)}😀y`);
    expect(message.endsWith("…")).toBe(true);
    expect(message).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    url: "https://example.com/page",
    title: "Example page",
    content: "A short summary.",
    ...overrides,
  };
}

describe("formatSearchResults", () => {
  test("renders an empty result set as a normal message", () => {
    expect(formatSearchResults([])).toBe("No results found.");
  });

  test("renders each result as a numbered Markdown link with summary and date", () => {
    const text = formatSearchResults([
      result({ published: Date.parse("2026-01-15T00:00:00Z") }),
      result({ url: "https://other.example", title: undefined, content: undefined }),
    ]);
    expect(text).toBe(
      "1. [Example page](https://example.com/page)\n" +
        "   A short summary.\n" +
        "   Published: 2026-01-15\n" +
        "\n" +
        "2. [https://other.example](https://other.example)",
    );
  });

  test("escapes square brackets in titles so links stay intact", () => {
    const text = formatSearchResults([result({ title: "[Not a link]" })]);
    expect(text).toContain("1. [\\[Not a link\\]](https://example.com/page)");
  });

  test("collapses newlines inside summaries", () => {
    const text = formatSearchResults([result({ content: "line one\nline two" })]);
    expect(text).toContain("line one line two");
  });

  test("keeps page-body line structure indented into the list item", () => {
    const text = formatSearchResults([
      result({ content: "# Heading\n\nparagraph one\n- bullet", contentKind: "page" }),
    ]);
    expect(text).toBe(
      "1. [Example page](https://example.com/page)\n" +
        "   # Heading\n" +
        "   \n" +
        "   paragraph one\n" +
        "   - bullet",
    );
  });

  test("appends the quality marker to the heading line", () => {
    const text = formatSearchResults([result({ rerankScore: 2.1, authority: 3, siteName: "GitHub" })]);
    expect(text).toBe(
      "1. [Example page](https://example.com/page) [rerank 2.1 · authority 3 · GitHub]\n   A short summary.",
    );
  });

  test("omits unknown authority from the marker and drops the marker when empty", () => {
    const unknownAuthority = formatSearchResults([result({ rerankScore: 1.9, authority: -1 })]);
    expect(unknownAuthority).toContain("1. [Example page](https://example.com/page) [rerank 1.9]");
    expect(unknownAuthority).not.toContain("authority");

    const siteOnly = formatSearchResults([result({ siteName: "MDN" })]);
    expect(siteOnly).toContain("(https://example.com/page) [MDN]");

    expect(formatSearchResults([result()])).toBe("1. [Example page](https://example.com/page)\n   A short summary.");
  });

  test("adds no header when the effective query matches the input", () => {
    const context = { inputQuery: "bun", effectiveQuery: "bun", notes: [] };
    expect(formatSearchResults([result()], context)).toBe(
      "1. [Example page](https://example.com/page)\n   A short summary.",
    );
  });

  test("headers the effective query when operators changed it, with degradation notes", () => {
    const context = {
      inputQuery: "bun",
      effectiveQuery: "bun lang:zh",
      notes: [],
    };
    expect(formatSearchResults([result()], context)).toBe(
      "Searched for: bun lang:zh\n\n1. [Example page](https://example.com/page)\n   A short summary.",
    );

    const degraded = {
      inputQuery: "bun",
      effectiveQuery: "bu",
      notes: ["query truncated to 2 characters (query length limit)"],
    };
    expect(formatSearchResults([], degraded)).toBe(
      "Searched for: bu — query truncated to 2 characters (query length limit)\n\nNo results found.",
    );
  });
});

describe("toStructuredResult", () => {
  test("mirrors the quality fields, keeping unknown authority faithful", () => {
    expect(toStructuredResult(result({ rerankScore: 2.1, authority: -1, siteName: "GitHub" }))).toEqual({
      url: "https://example.com/page",
      title: "Example page",
      content: "A short summary.",
      rerankScore: 2.1,
      authority: -1,
      siteName: "GitHub",
    });
  });

  test("omits the quality fields when absent", () => {
    expect(toStructuredResult(result())).toEqual({
      url: "https://example.com/page",
      title: "Example page",
      content: "A short summary.",
    });
  });
});

describe("need_content output budgets (UTF-8, before host limits)", () => {
  const expectedBytes: Record<string, number> = {
    "latin-default": 16269,
    "cjk-default": 46069,
    "cjk-large": 230389,
    "mixed-default": 37159,
    "fallback-default": 25759,
    "fallback-budget": 13159,
    "cjk-count-four": 18426,
    "cjk-budget-500": 16139,
    "multiline-default": 53519,
    "long-metadata": 46139,
  };

  for (const scenario of CONTENT_BUDGET_CASES) {
    test(scenario.id, () => {
      const output = budgetOutput(scenario);
      const count = scenario.count ?? 10;
      expect(output.options.count).toBe(count);
      expect(output.options.maxResults).toBe(count);
      expect(output.results).toHaveLength(count);
      expect(resultIntegrity(output.text, output).complete).toHaveLength(count);
      expect(output.text).not.toContain("\uFFFD");
      expect(Buffer.from(output.text, "utf8").toString("utf8")).toBe(output.text);
      // Include titles, URLs, quality/date metadata, newlines, indentation,
      // and the extra ellipsis byte cost; character counts are not byte caps.
      const bytes = Buffer.byteLength(output.text, "utf8");
      expect(bytes).toBe(scenario.expectedBytes ?? expectedBytes[scenario.id]);
      if (scenario.expectedBytes !== undefined) {
        expect(Math.abs(bytes - PI_MCP_OUTPUT_BYTES)).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < count; i++) {
        const actual = output.results[i];
        const raw = output.raw[i];
        expect(output.structured.results[i]?.content).toBe(actual?.content);
        const page = typeof raw?.content === "string" && raw.content.trim() !== "";
        const source = (page ? raw?.content : (raw?.summary ?? raw?.snippet))?.trim() ?? "";
        const cap = page ? output.options.contentMaxChars : output.options.maxSummaryChars;
        const clipped = Array.from(source).length > cap;
        expect(actual?.contentKind).toBe(page ? "page" : "digest");
        expect(Array.from(actual?.content ?? "")).toHaveLength(
          Math.min(Array.from(source).length, cap) + Number(clipped),
        );
        expect(actual?.content?.endsWith("…")).toBe(clipped);
        if (page) expect(actual?.content).not.toContain("摘要");
        else expect(actual?.content).not.toContain("正文");
      }
    });
  }
});
