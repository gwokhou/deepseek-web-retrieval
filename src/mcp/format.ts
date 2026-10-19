import type { WebSearchResult } from "../core/types"

/**
 * Renders processed search results as Markdown for the text content block.
 * Hosts that ignore `structuredContent` (Gemini CLI, Continue) read this text.
 */
export function formatSearchResults(results: readonly WebSearchResult[]): string {
  if (results.length === 0) return "No results found."

  return results
    .map((result, index) => {
      const title = result.title?.trim() || result.url
      const lines = [`${index + 1}. [${escapeBrackets(title)}](${result.url})`]
      if (result.content) {
        lines.push(`   ${result.content.replaceAll("\n", " ")}`)
      }
      if (result.time.published !== undefined) {
        lines.push(`   Published: ${formatPublished(result.time.published)}`)
      }
      return lines.join("\n")
    })
    .join("\n\n")
}

function escapeBrackets(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]")
}

function formatPublished(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}
