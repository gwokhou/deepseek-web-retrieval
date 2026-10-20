/**
 * Capability fact fragments shared by every host's tool descriptions. Hosts
 * compose these with their own framing; the facts must never drift per host.
 */

export const FETCH_SERVICE_LIMITS =
  "DeepSeek does not render JavaScript and cannot reach private networks; PDFs, images, and other binary files are unsupported."

export const FETCH_OUTPUT_TRUNCATED = "Output is truncated to the configured size."

export const FETCH_MARKDOWN_ONLY = 'Only format "markdown" is supported.'

export const SEARCH_RANKED_FILTERED =
  "Results are ranked by relevance and source authority, deduplicated by URL, and capped at the configured maximum."

export const SEARCH_EMPTY_IS_NORMAL = "An empty result list is normal, not an error."

export const SEARCH_QUERY_OPERATORS =
  "Use site:/-site: operators in the query to include or exclude domains; the full query must stay within 128 characters."
