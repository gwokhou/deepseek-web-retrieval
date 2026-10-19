import {
  FETCH_ENDPOINT,
  MAX_ERROR_BODY_CHARS,
  MAX_QUERY_CHARS,
  MAX_RETRY_DELAY_MS,
  SEARCH_ENDPOINT,
} from "./constants"
import { formatApiError, formatTimeoutError, redactSecrets, truncate } from "./format"
import { buildQuery, processResults } from "./search"
import type {
  DeepSeekSearchResult,
  FetchedPage,
  FetchOptions,
  RequestAuth,
  RetryConfig,
  SearchOptions,
  WebSearchResult,
} from "./types"

interface SearchResponse {
  readonly results?: unknown
}

interface FetchResponse {
  readonly title?: unknown
  readonly content?: unknown
}

interface RequestOptions {
  readonly signal: AbortSignal
  readonly auth: RequestAuth
  readonly retry: RetryConfig
}

export class DeepSeekApiError extends Error {
  readonly operation: string
  readonly status: number
  readonly body: string
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(input: {
    operation: string
    status: number
    body: string
    retryAfterMs?: number
  }) {
    const body = redactSecrets(input.body)
    super(formatApiError(input.operation, input.status, body))
    this.name = "DeepSeekApiError"
    this.operation = input.operation
    this.status = input.status
    this.body = body
    this.retryable =
      input.status === 408 ||
      input.status === 425 ||
      input.status === 429 ||
      (input.status >= 500 && input.status <= 599)
    this.retryAfterMs = input.retryAfterMs
  }
}

export async function searchWeb(
  query: string,
  options: SearchOptions,
  request: RequestOptions,
): Promise<WebSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error("DeepSeek search query must not be empty")
  if (Array.from(trimmed).length > MAX_QUERY_CHARS) {
    throw new Error(`DeepSeek search query must be ${MAX_QUERY_CHARS} characters or fewer`)
  }

  const payload = await postJson<SearchResponse>(
    SEARCH_ENDPOINT,
    {
      query: buildQuery(trimmed, options),
      count: options.count,
      need_content: false,
    },
    "DeepSeek Search",
    request,
    options.timeoutMs,
  )

  if (!Array.isArray(payload.results)) {
    throw new Error("DeepSeek Search returned a response without a results array")
  }
  return processResults(payload.results as DeepSeekSearchResult[], options)
}

export async function fetchPage(
  url: URL,
  options: FetchOptions,
  request: RequestOptions,
): Promise<FetchedPage> {
  const payload = await postJson<FetchResponse>(
    FETCH_ENDPOINT,
    { url: url.href },
    "DeepSeek Fetch",
    request,
    options.timeoutMs,
  )
  const title = typeof payload.title === "string" ? payload.title.trim() : ""
  const content = typeof payload.content === "string" ? payload.content : ""
  if (!content.trim()) {
    throw new Error("DeepSeek Fetch returned no page content (the page may be empty or unavailable)")
  }
  return { url: url.href, title, content }
}

async function postJson<T>(
  endpoint: string,
  body: unknown,
  operation: string,
  options: RequestOptions,
  timeoutMs: number,
): Promise<T> {
  const attempts = options.retry.maxRetries + 1
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await requestOnce<T>(endpoint, body, operation, options, timeoutMs)
    } catch (error) {
      lastError = error
      if (!(error instanceof DeepSeekApiError) || !error.retryable || attempt === attempts - 1) {
        throw error
      }
      await sleep(retryDelay(error.retryAfterMs, options.retry.baseDelayMs, attempt), options.signal)
    }
  }

  throw lastError
}

async function requestOnce<T>(
  endpoint: string,
  body: unknown,
  operation: string,
  options: RequestOptions,
  timeoutMs: number,
): Promise<T> {
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.auth.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    options.signal,
    timeoutMs,
    operation,
  )

  if (!response.ok) {
    const text = await readBoundedText(response, MAX_ERROR_BODY_CHARS)
    throw new DeepSeekApiError({
      operation,
      status: response.status,
      body: text,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    })
  }

  const text = await response.text()
  if (!text.trim()) throw new Error(`${operation} returned an empty response body`)

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${operation} returned invalid JSON: ${truncate(redactSecrets(text), 500)}`)
  }
}

async function fetchWithTimeout(
  endpoint: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
  operation: string,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort(signal.reason)
  if (signal.aborted) forwardAbort()
  else signal.addEventListener("abort", forwardAbort, { once: true })

  const timer = signal.aborted
    ? undefined
    : setTimeout(() => {
        timedOut = true
        controller.abort(new Error("timeout"))
      }, timeoutMs)

  try {
    return await fetch(endpoint, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) throw new Error(formatTimeoutError(operation, timeoutMs))
    if (signal.aborted) throw abortReason(signal, operation)
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener("abort", forwardAbort)
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (/^\d+$/.test(trimmed)) {
    return Math.min(MAX_RETRY_DELAY_MS, Number(trimmed) * 1000)
  }

  const timestamp = Date.parse(trimmed)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - Date.now()))
}

function retryDelay(retryAfterMs: number | undefined, baseDelayMs: number, attempt: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs
  return Math.min(MAX_RETRY_DELAY_MS, baseDelayMs * 2 ** attempt)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal, "DeepSeek request"))
    }
    if (signal.aborted) {
      clearTimeout(timer)
      reject(abortReason(signal, "DeepSeek request"))
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

function abortReason(signal: AbortSignal, operation: string): unknown {
  return signal.reason instanceof Error ? signal.reason : new Error(`${operation} request aborted`)
}

/** Reads at most `maxChars + 1` characters, enough for formatApiError to add its marker. */
async function readBoundedText(response: Response, maxChars: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, maxChars + 1)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const limit = maxChars + 1
  let text = ""
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return text.slice(0, limit)
}
