import { describe, expect, test } from "bun:test"
import { formatSearchResults } from "../../src/mcp/format"
import type { WebSearchResult } from "../../src/core/types"

function result(overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  return {
    url: "https://example.com/page",
    title: "Example page",
    content: "A short summary.",
    time: {},
    ...overrides,
  }
}

describe("formatSearchResults", () => {
  test("renders an empty result set as a normal message", () => {
    expect(formatSearchResults([])).toBe("No results found.")
  })

  test("renders each result as a numbered Markdown link with summary and date", () => {
    const text = formatSearchResults([
      result({ time: { published: Date.parse("2026-01-15T00:00:00Z") } }),
      result({ url: "https://other.example", title: undefined, content: undefined }),
    ])
    expect(text).toBe(
      "1. [Example page](https://example.com/page)\n" +
        "   A short summary.\n" +
        "   Published: 2026-01-15\n" +
        "\n" +
        "2. [https://other.example](https://other.example)",
    )
  })

  test("escapes square brackets in titles so links stay intact", () => {
    const text = formatSearchResults([result({ title: "[Not a link]" })])
    expect(text).toContain("1. [\\[Not a link\\]](https://example.com/page)")
  })

  test("collapses newlines inside summaries", () => {
    const text = formatSearchResults([result({ content: "line one\nline two" })])
    expect(text).toContain("line one line two")
  })
})
