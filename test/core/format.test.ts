import { describe, expect, test } from "bun:test"
import { FETCH_TRUNCATION_MARKER } from "../../src/core/constants"
import {
  formatApiError,
  formatFetchedContent,
  redactSecrets,
  truncate,
} from "../../src/core/format"

describe("formatting", () => {
  test("truncates ASCII and Unicode without splitting surrogate pairs", () => {
    expect(truncate("abcdef", 3)).toBe("abc")
    expect(truncate("abc", 3)).toBe("abc")
    expect(truncate("abc", 0)).toBe("")
    expect(truncate("a😀b", 2)).toBe("a😀")
    expect(truncate("😀😀", 1)).toBe("😀")
  })

  test("adds a title and counts the truncation marker in the budget", () => {
    expect(formatFetchedContent("Title", "body", 100)).toEqual({
      content: "# Title\n\nbody",
      truncated: false,
    })
    expect(formatFetchedContent("", "", 10)).toEqual({ content: "", truncated: false })

    const truncated = formatFetchedContent("Title", "x".repeat(100), 50)
    expect(truncated.truncated).toBe(true)
    expect(Array.from(truncated.content)).toHaveLength(50)
    expect(truncated.content.endsWith(FETCH_TRUNCATION_MARKER)).toBe(true)
    expect(truncated.content.startsWith("# Title\n\nx")).toBe(true)

    expect(formatFetchedContent("", "body", 2)).toEqual({ content: "bo", truncated: true })
    expect(formatFetchedContent("", "body", 0)).toEqual({ content: "", truncated: true })
  })

  test("does not duplicate a title that already starts the Markdown body", () => {
    expect(formatFetchedContent("Example Domain", "# Example Domain\n\nbody", 100)).toEqual({
      content: "# Example Domain\n\nbody",
      truncated: false,
    })
    expect(formatFetchedContent("Example Domain", "  # example domain\n\nbody", 100)).toEqual({
      content: "# Example Domain\n\nbody",
      truncated: false,
    })
    expect(formatFetchedContent("Example Domain", "\\# Example Domain\n\nbody", 100)).toEqual({
      content: "# Example Domain\n\nbody",
      truncated: false,
    })
    expect(formatFetchedContent("Different", "# Example Domain\n\nbody", 100)).toEqual({
      content: "# Different\n\n# Example Domain\n\nbody",
      truncated: false,
    })
  })

  test("redacts API keys and bearer tokens", () => {
    expect(redactSecrets("key sk-1234567890abcdef and Bearer abcdefghijklmnop")).toBe(
      "key sk-*** and Bearer ***",
    )
  })

  test("formats API errors with hints and redaction", () => {
    expect(formatApiError("DeepSeek Search", 401, '{"error":"bad"}')).toBe(
      "DeepSeek Search failed (HTTP 401, invalid API key): {\"error\":\"bad\"}",
    )
    expect(formatApiError("DeepSeek Fetch", 404, "  ")).toBe(
      "DeepSeek Fetch failed (HTTP 404): empty response body",
    )
    expect(formatApiError("DeepSeek Fetch", 429, "slow down")).toContain("rate limited")
    expect(formatApiError("DeepSeek Search", 500, "x".repeat(5000)).endsWith("…")).toBe(true)
    expect(formatApiError("DeepSeek Search", 401, "sk-1234567890abcdef")).not.toContain(
      "1234567890abcdef",
    )
  })
})
