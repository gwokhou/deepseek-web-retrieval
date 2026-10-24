/**
 * The DeepSeek API root every request is composed from. `baseUrl` overrides it
 * (env `DEEPSEEK_BASE_URL`, shared-file key `baseUrl`) so proxies, enterprise
 * gateways, and mock upstreams can intercept retrieval without touching the
 * adapters; the two endpoints below stay the production default.
 */
export const DEFAULT_API_BASE_URL = "https://api.deepseek.com";
export const SEARCH_ENDPOINT_PATH = "/v1/tools/search";
export const FETCH_ENDPOINT_PATH = "/v1/tools/fetch";

export const SEARCH_ENDPOINT = `${DEFAULT_API_BASE_URL}${SEARCH_ENDPOINT_PATH}`;
export const FETCH_ENDPOINT = `${DEFAULT_API_BASE_URL}${FETCH_ENDPOINT_PATH}`;

/**
 * Search defaults are benchmarked against surveyed AI-native search APIs and
 * DeepSeek's own factory defaults; see docs/research/search-api-defaults.md.
 * Result caps cluster at 10 across vendors, and no surveyed vendor filters
 * results client-side by score or authority — thresholds stay opt-in.
 */
export const DEFAULT_SEARCH_COUNT = 10;
/**
 * The fallback only when neither knob is set; whenever `count` is explicitly
 * configured, an unset `maxResults` follows the effective count instead (see
 * resolveSearchOptions) — the two are coupled in one direction, not independent.
 */
export const DEFAULT_MAX_RESULTS = 10;
export const DEFAULT_MIN_RERANK = 0;
export const DEFAULT_MIN_AUTHORITY = 0;
export const DEFAULT_MAX_SUMMARY_CHARS = 1200;

export const DEFAULT_FETCH_MAX_CHARS = 16000;
export const DEFAULT_TIMEOUT_MS = 30000;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 120000;

export const MAX_QUERY_CHARS = 128;
/** DeepSeek documents ori_question as 1-128 characters; longer values are clamped, not rejected. */
export const MAX_ORI_QUESTION_CHARS = 128;
export const MAX_URL_CHARS = 8192;
export const MAX_ERROR_BODY_CHARS = 2000;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const FETCH_TRUNCATION_MARKER = "\n\n[content truncated]";

export const DEFAULT_API_KEY_SOURCE = "auto";
/**
 * 2, not 0: a transient failure inside a tool call is cheaper to retry here than
 * to leave to the model, whose only fallback is re-issuing the whole billed tool
 * call — the same trade-off behind OpenAI/Anthropic SDKs defaulting to 2; see
 * docs/research/search-api-defaults.md.
 */
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RETRIES = 5;
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
export const MAX_RETRY_DELAY_MS = 10000;

/** The single source for every DEEPSEEK_* environment variable name. */
export const API_KEY_ENV = "DEEPSEEK_API_KEY";
export const BASE_URL_ENV = "DEEPSEEK_BASE_URL";
export const ENABLE_SEARCH_ENV = "DEEPSEEK_ENABLE_SEARCH";
export const ENABLE_FETCH_ENV = "DEEPSEEK_ENABLE_FETCH";
export const SEARCH_LOCALIZATION_ENV = "DEEPSEEK_SEARCH_LOCALIZATION";
