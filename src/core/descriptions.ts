/**
 * Capability fact fragments shared by every host's tool descriptions. Hosts
 * compose these with their own framing; the facts must never drift per host.
 */

export const FETCH_SERVICE_LIMITS =
  "DeepSeek does not render JavaScript and cannot reach private networks; PDFs, images, and other binary files are unsupported.";

export const FETCH_OUTPUT_TRUNCATED = "Output is truncated to the configured size.";

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
  "To read a full page, pass a result URL to the deepseek_fetch tool.";

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
