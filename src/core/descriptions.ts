/**
 * Capability fact fragments shared by every host's tool descriptions. Hosts
 * compose these with their own framing; the facts must never drift per host.
 */

export const FETCH_SERVICE_LIMITS =
  "DeepSeek does not render JavaScript and cannot reach private networks; PDFs, images, and other binary files are unsupported.";

export const FETCH_OUTPUT_TRUNCATED =
  "Output is truncated to the configured size; the optional maxChars parameter raises or lowers that size for one call.";

export const FETCH_MARKDOWN_ONLY = 'Only format "markdown" is supported.';

export const SEARCH_RANKED_FILTERED =
  "Results are ranked by relevance and source authority, deduplicated by URL, and capped at the configured maximum.";

export const SEARCH_EMPTY_IS_NORMAL = "An empty result list is normal, not an error.";

export const SEARCH_QUERY_OPERATORS =
  "Use site:/-site: operators in the query to include or exclude domains, and after:/before: with a year or date (e.g. after:2025-06-01) to filter by publish time; the full query must stay within 128 characters.";

/**
 * The full tool descriptions, composed from the fact fragments. Every host
 * adapter registers its tools with these verbatim — the MCP server and the Pi
 * extension must never drift on what a tool does.
 */
export const SEARCH_TOOL_DESCRIPTION =
  "Search the web with DeepSeek's in-house search engine and return a short, filtered result " +
  "list (title, URL, summary). " +
  `${SEARCH_RANKED_FILTERED} ` +
  `${SEARCH_EMPTY_IS_NORMAL} ` +
  `${SEARCH_QUERY_OPERATORS} ` +
  "To read one full page in depth, pass a result URL to the deepseek_fetch tool; to carry each result's " +
  "page body in this response, set need_content to true.";

export const FETCH_TOOL_DESCRIPTION =
  "Fetch one web page as clean Markdown through DeepSeek's Fetch API. " +
  `${FETCH_SERVICE_LIMITS} ` +
  `${FETCH_OUTPUT_TRUNCATED}`;

/** Parameter descriptions shared by every adapter's input schema for the two tools. */
export const SEARCH_QUERY_PARAMETER =
  "Search query, 128 characters or fewer including operators (site:, -site:, quoted phrases, lang:, after:, before:).";

export const SEARCH_ORI_QUESTION_PARAMETER =
  "The user's original question or task that triggered this search, in the user's own words rather than a " +
  "reformulated query. Optional; 1-128 characters, and longer values are truncated.";

export const FETCH_URL_PARAMETER = "Absolute http:// or https:// URL to fetch. Credentials are rejected.";

export const FETCH_MAX_CHARS_PARAMETER =
  "Optional per-call character budget for this fetch, 0-1,000,000, title included. Overrides the configured cap " +
  "for this call; a [content truncated] marker is appended when the output is cut.";

export const SEARCH_COUNT_PARAMETER =
  "Optional number of results for this call, 1-50. Overrides the configured count and result cap for this call; " +
  "billing is per request, not per result.";

export const SEARCH_NEED_CONTENT_PARAMETER =
  "Optional; set true to attach each result's page body as Markdown — an excerpt clamped to a configured per-result " +
  "budget, not a full page — in place of its short summary. Slower per call (DeepSeek fetches the result pages) and " +
  "priced the same per request; for a full page, call deepseek_fetch.";
