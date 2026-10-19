export const SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search"
export const FETCH_ENDPOINT = "https://api.deepseek.com/v1/tools/fetch"

export const DEFAULT_SEARCH_COUNT = 10
export const DEFAULT_MAX_RESULTS = 5
export const DEFAULT_MIN_RERANK = 1.5
export const DEFAULT_MIN_AUTHORITY = 2
export const DEFAULT_MAX_SUMMARY_CHARS = 1200

export const DEFAULT_FETCH_MAX_CHARS = 16000
export const DEFAULT_TIMEOUT_MS = 30000
export const MIN_TIMEOUT_MS = 1000
export const MAX_TIMEOUT_MS = 120000

export const MAX_QUERY_CHARS = 128
export const MAX_URL_CHARS = 8192
export const MAX_ERROR_BODY_CHARS = 2000
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const FETCH_TRUNCATION_MARKER = "\n\n[content truncated]"

export const DEFAULT_API_KEY_SOURCE = "auto"
export const DEFAULT_MAX_RETRIES = 0
export const MAX_RETRIES = 5
export const DEFAULT_RETRY_BASE_DELAY_MS = 250
export const MAX_RETRY_DELAY_MS = 10000
