import { FETCH_ENDPOINT, MAX_QUERY_CHARS, SEARCH_ENDPOINT } from "./constants";
import { assertFetchHostPolicy } from "./domains";
import { formatFetchedContent } from "./format";
import { buildQuery, processResults } from "./search";
import { postJson } from "./transport";
import type {
  DeepSeekSearchResult,
  FetchedDocument,
  FetchedPage,
  FetchOptions,
  RequestAuth,
  RetryOptions,
  SearchOptions,
  SearchResult,
} from "./types";
import { parseFetchUrl } from "./url";

export { DeepSeekApiError } from "./transport";

/** The shorter of the configured and per-call timeout always wins. */
function effectiveTimeout(configuredMs: number, perCallMs: number | undefined): number {
  return perCallMs === undefined ? configuredMs : Math.min(configuredMs, perCallMs);
}

interface SearchResponse {
  readonly results?: unknown;
}

interface FetchResponse {
  readonly title?: unknown;
  readonly content?: unknown;
}

export interface RequestOptions {
  readonly signal: AbortSignal;
  readonly auth: RequestAuth;
  readonly retry: RetryOptions;
  /** Per-call cap in milliseconds; the shorter of this and the configured timeout wins. */
  readonly timeoutMs?: number;
}

export async function searchWeb(
  query: string,
  options: SearchOptions,
  request: RequestOptions,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("DeepSeek search query must not be empty");
  if (Array.from(trimmed).length > MAX_QUERY_CHARS) {
    throw new Error(`DeepSeek search query must be ${MAX_QUERY_CHARS} characters or fewer`);
  }

  const builtQuery = buildQuery(trimmed, options);
  const builtQueryLength = Array.from(builtQuery).length;
  if (builtQueryLength > MAX_QUERY_CHARS) {
    throw new Error(
      `DeepSeek search query must be ${MAX_QUERY_CHARS} characters or fewer after applying ` +
        `blockedDomains, includeDomains, and language ` +
        `(built query is ${builtQueryLength} characters)`,
    );
  }

  const timeout = effectiveTimeout(options.timeoutMs, request.timeoutMs);
  const payload = await postJson<SearchResponse>(
    SEARCH_ENDPOINT,
    {
      query: builtQuery,
      count: options.count,
      need_content: false,
    },
    "DeepSeek Search",
    { signal: request.signal, auth: request.auth, retry: request.retry, timeoutMs: timeout },
  );

  if (!Array.isArray(payload.results)) {
    throw new Error("DeepSeek Search returned a response without a results array");
  }
  return processResults(payload.results as DeepSeekSearchResult[], options);
}

export async function fetchPage(url: URL, options: FetchOptions, request: RequestOptions): Promise<FetchedPage> {
  // Enforced here so direct core consumers cannot bypass the policy. Adapters
  // may also pre-check to reject before a permission prompt.
  assertFetchHostPolicy(url, options);
  const timeout = effectiveTimeout(options.timeoutMs, request.timeoutMs);
  const payload = await postJson<FetchResponse>(FETCH_ENDPOINT, { url: url.href }, "DeepSeek Fetch", {
    signal: request.signal,
    auth: request.auth,
    retry: request.retry,
    timeoutMs: timeout,
  });
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const content = typeof payload.content === "string" ? payload.content : "";
  if (!content.trim()) {
    throw new Error("DeepSeek Fetch returned no page content (the page may be empty or unavailable)");
  }
  return { url: url.href, title, content };
}

/** Parses the URL and enforces the host policy in one call, returning the fetch target. */
export function inspectFetchTarget(url: string, options: FetchOptions): URL {
  const target = parseFetchUrl(url);
  assertFetchHostPolicy(target, options);
  return target;
}

/**
 * The full fetch pipeline adapters share: fetch the page (a URL skips
 * re-parsing) and format it for the model within its budget.
 */
export async function fetchDocument(
  url: string | URL,
  options: FetchOptions,
  request: RequestOptions,
): Promise<FetchedDocument> {
  if (typeof url !== "string" && !(url instanceof URL)) throw new Error('"url" must be a string or URL');
  const page = await fetchPage(url instanceof URL ? url : parseFetchUrl(url), options, request);
  const formatted = formatFetchedContent(page.title, page.content, options.maxChars);
  return {
    url: page.url,
    title: page.title,
    content: formatted.content,
    truncated: formatted.truncated,
  };
}
