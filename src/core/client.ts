import {
  DEFAULT_API_BASE_URL,
  FETCH_ENDPOINT_PATH,
  MAX_FETCH_CHARS,
  MAX_ORI_QUESTION_CHARS,
  MAX_QUERY_CHARS,
  SEARCH_ENDPOINT_PATH,
} from "./constants";
import { assertFetchHostPolicy } from "./domains";
import { formatFetchedContent, truncate } from "./format";
import { composeSearchQuery, processResults } from "./search";
import { postJson } from "./transport";
import type {
  DeepSeekSearchResult,
  FetchedDocument,
  FetchedPage,
  FetchOptions,
  RequestAuth,
  RetryOptions,
  SearchOptions,
  SearchOutcome,
} from "./types";
import { parseFetchUrl } from "./url";

export { DeepSeekApiError } from "./transport";

/** The shorter of the configured and per-call timeout always wins. */
function effectiveTimeout(configuredMs: number, perCallMs: number | undefined): number {
  return perCallMs === undefined ? configuredMs : Math.min(configuredMs, perCallMs);
}

/**
 * The per-call budget wins outright, unlike timeouts: a model that just saw a
 * truncation marker is asking for more than the default on purpose, so the
 * configured value stays the default rather than a ceiling.
 */
function effectiveMaxChars(configured: number, perCall: number | undefined): number {
  if (perCall === undefined || !Number.isFinite(perCall)) return configured;
  return Math.min(MAX_FETCH_CHARS, Math.max(0, Math.trunc(perCall)));
}

/**
 * Composes a request endpoint from the resolved base URL (already
 * slash-stripped by resolveBaseUrl; absent means the production default).
 */
function apiUrl(baseUrl: string | undefined, path: string): string {
  return `${baseUrl ?? DEFAULT_API_BASE_URL}${path}`;
}

/**
 * The wire value for ori_question: absent/whitespace-only means "not
 * provided"; longer values are clamped rather than rejected — the field is
 * auxiliary and a hard error would punish the model for verbosity.
 */
function oriQuestionValue(oriQuestion: string | undefined): string | undefined {
  const trimmed = oriQuestion?.trim();
  return trimmed ? truncate(trimmed, MAX_ORI_QUESTION_CHARS) : undefined;
}

interface SearchResponse {
  readonly results?: unknown;
}

interface FetchResponse {
  readonly title?: unknown;
  readonly content?: unknown;
}

export interface RequestOptions {
  /** Optional per-request HTTP dependency; factories bind this once for an adapter. */
  readonly fetchImpl?: typeof fetch;
  readonly signal: AbortSignal;
  readonly auth: RequestAuth;
  readonly retry: RetryOptions;
  /** Per-call cap in milliseconds; the shorter of this and the configured timeout wins. */
  readonly timeoutMs?: number;
  /** Per-call fetch budget in characters; overrides the configured cap for this call. */
  readonly maxChars?: number;
  /**
   * The resolved API root; adapters pass `config.baseUrl` so every request
   * follows the `baseUrl` knob. Absent falls back to the production default
   * (unit tests composing requests by hand rely on that).
   */
  readonly baseUrl?: string;
}

export interface SearchRequest extends RequestOptions {
  /**
   * Per-call only — the option-resolution pipeline never populates this. The
   * user's original question behind the search, sent as DeepSeek's optional
   * ori_question to sharpen intent; adapters fill it from tool input.
   */
  readonly oriQuestion?: string;
}

export async function searchWeb(query: string, options: SearchOptions, request: SearchRequest): Promise<SearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("DeepSeek search query must not be empty");
  const trimmedLength = Array.from(trimmed).length;
  if (trimmedLength > MAX_QUERY_CHARS) {
    // The query rides in the message so the model can see what to shorten.
    throw new Error(
      `DeepSeek search query must be ${MAX_QUERY_CHARS} characters or fewer ` +
        `(got ${trimmedLength}: ${JSON.stringify(truncate(trimmed, 64))})`,
    );
  }

  const composed = composeSearchQuery(trimmed, options);
  const builtQuery = composed.query;

  const timeout = effectiveTimeout(options.timeoutMs, request.timeoutMs);
  const oriQuestion = oriQuestionValue(request.oriQuestion);
  const payload = await postJson<SearchResponse>(
    apiUrl(request.baseUrl, SEARCH_ENDPOINT_PATH),
    {
      query: builtQuery,
      count: options.count,
      need_content: false,
      ...(oriQuestion === undefined ? {} : { ori_question: oriQuestion }),
      ...(options.localization === undefined ? {} : { localization: options.localization }),
    },
    "DeepSeek Search",
    { ...request, timeoutMs: timeout },
  );

  if (!Array.isArray(payload.results)) {
    throw new Error("DeepSeek Search returned a response without a results array");
  }
  const results = processResults(payload.results as DeepSeekSearchResult[], options);
  return {
    results,
    inputQuery: trimmed,
    effectiveQuery: builtQuery,
    notes: composed.notes,
  };
}

export async function fetchPage(url: URL, options: FetchOptions, request: RequestOptions): Promise<FetchedPage> {
  // A URL object is parsed, not necessarily safe: direct core callers must pass
  // the same protocol, credentials, length and host checks as string callers.
  const target = parseFetchUrl(url.href);
  assertFetchHostPolicy(target, options);
  const timeout = effectiveTimeout(options.timeoutMs, request.timeoutMs);
  const payload = await postJson<FetchResponse>(
    apiUrl(request.baseUrl, FETCH_ENDPOINT_PATH),
    { url: target.href },
    "DeepSeek Fetch",
    {
      ...request,
      timeoutMs: timeout,
    },
  );
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const content = typeof payload.content === "string" ? payload.content : "";
  if (!content.trim()) {
    throw new Error("DeepSeek Fetch returned no page content (the page may be empty or unavailable)");
  }
  return { url: target.href, title, content };
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
  const formatted = formatFetchedContent(
    page.title,
    page.content,
    effectiveMaxChars(options.maxChars, request.maxChars),
  );
  return {
    url: page.url,
    title: page.title,
    content: formatted.content,
    truncated: formatted.truncated,
  };
}

/** One client per adapter/test; transport overrides never mutate process globals. */
export function createRetrievalClient(dependencies: { readonly fetchImpl?: typeof fetch } = {}) {
  const bind = (request: RequestOptions): RequestOptions => ({ ...request, ...dependencies });
  return {
    searchWeb: (query: string, options: SearchOptions, request: SearchRequest) =>
      searchWeb(query, options, bind(request)),
    fetchPage: (url: URL, options: FetchOptions, request: RequestOptions) => fetchPage(url, options, bind(request)),
    fetchDocument: (url: string | URL, options: FetchOptions, request: RequestOptions) =>
      fetchDocument(url, options, bind(request)),
  };
}

export type RetrievalClient = ReturnType<typeof createRetrievalClient>;
export const retrievalClient = createRetrievalClient();
