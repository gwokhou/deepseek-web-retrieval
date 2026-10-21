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
  readonly maxSummaryChars: number;
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
}

export interface DeepSeekSearchResult {
  readonly rerank_score?: number;
  readonly authority?: number;
  readonly title?: string | null;
  readonly url?: string | null;
  readonly snippet?: string | null;
  readonly summary?: string | null;
  readonly date?: string | null;
}

/** A neutral, host-agnostic search result. */
export interface SearchResult {
  readonly url: string;
  readonly title?: string;
  readonly content?: string;
  readonly published?: number;
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
