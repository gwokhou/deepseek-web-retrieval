export type ApiKeySource = "auto" | "opencode" | "env";

export interface PluginOptions {
  readonly [key: string]: unknown;
}

export interface SearchOptions {
  readonly count: number;
  readonly maxResults: number;
  readonly minRerank: number;
  readonly minAuthority: number;
  readonly allowUnknownAuthority: boolean;
  readonly blockedDomains: readonly string[];
  readonly includeDomains: readonly string[];
  readonly language?: string;
  /**
   * Deployment-level only — never a per-call tool parameter. A valid IPv4 or
   * IPv6 address sent as DeepSeek's optional `localization` to prefer
   * geo-localized results; invalid values are dropped at option resolution.
   */
  readonly localization?: string;
  readonly maxSummaryChars: number;
  /**
   * Deployment-level only — never a per-call tool parameter. The budget a
   * need_content page body is clamped to per result; the per-call boolean is
   * `SearchRequest.needContent`.
   */
  readonly contentMaxChars: number;
  /** Deployment-level only; the timeout a need_content call uses instead of `timeoutMs`. */
  readonly contentTimeoutMs: number;
  readonly timeoutMs: number;
  readonly enabled: boolean;
}

export interface FetchOptions {
  readonly maxChars: number;
  readonly allowedDomains: readonly string[];
  readonly blockedDomains: readonly string[];
  readonly timeoutMs: number;
  readonly blockPrivateHosts: boolean;
  readonly enabled: boolean;
}

export interface AuthOptions {
  readonly source: ApiKeySource;
}

export interface RetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
}

export interface ResolvedOptions {
  readonly search: SearchOptions;
  readonly fetch: FetchOptions;
  readonly auth: AuthOptions;
  readonly retry: RetryOptions;
  /**
   * The API root both retrieval endpoints are composed from. Infrastructure
   * routing, not a result-shaping knob: proxies and mock upstreams override it;
   * anything but an http(s) URL is dropped at resolution back to the default.
   */
  readonly baseUrl: string;
}

export interface DeepSeekSearchResult {
  readonly rerank_score?: number;
  readonly authority?: number;
  readonly site_name?: string | null;
  readonly title?: string | null;
  readonly url?: string | null;
  readonly snippet?: string | null;
  readonly summary?: string | null;
  /** The need_content page body; an empty string when need_content is false or the content is unavailable. */
  readonly content?: string | null;
  readonly date?: string | null;
}

/** A neutral, host-agnostic search result. */
export interface SearchResult {
  readonly url: string;
  readonly title?: string;
  readonly content?: string;
  /** Which wire field `content` came from: a need_content page body or the summary/snippet digest. */
  readonly contentKind?: "page" | "digest";
  readonly published?: number;
  readonly rerankScore?: number;
  /** Faithful to the wire: -1 means unknown authority. */
  readonly authority?: number;
  readonly siteName?: string;
}

/** What one search call executed: the processed results plus the query actually sent. */
export interface SearchOutcome {
  readonly results: readonly SearchResult[];
  /** The query as the caller provided it, trimmed. */
  readonly inputQuery: string;
  /** The query sent to DeepSeek, operators included. */
  readonly effectiveQuery: string;
  /** One entry per degradation applied to fit the query budget; empty means nothing was adjusted. */
  readonly notes: readonly string[];
}

export interface FetchedPage {
  readonly url: string;
  readonly title: string;
  readonly content: string;
}

export interface FormattedFetchContent {
  readonly content: string;
  readonly truncated: boolean;
}

/** A fetched page formatted for the model, with truncation reported. */
export interface FetchedDocument {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly truncated: boolean;
}

export interface RequestAuth {
  readonly apiKey: string;
}
