import { MAX_ERROR_BODY_CHARS, MAX_RESPONSE_BYTES, MAX_RETRY_DELAY_MS } from "./constants";
import { formatApiError, formatTimeoutError, redactSecrets, truncate } from "./format";
import type { RequestAuth, RetryOptions } from "./types";

/** Everything one POST needs; `fetchImpl` is injectable so tests need no monkey-patching. */
export interface TransportOptions {
  readonly signal: AbortSignal;
  readonly auth: RequestAuth;
  readonly retry: RetryOptions;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

export class DeepSeekApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(input: {
    operation: string;
    status: number;
    body: string;
    retryAfterMs?: number;
  }) {
    const body = redactSecrets(input.body);
    super(formatApiError(input.operation, input.status, body));
    this.name = "DeepSeekApiError";
    this.operation = input.operation;
    this.status = input.status;
    this.body = body;
    this.retryable =
      input.status === 408 ||
      input.status === 425 ||
      input.status === 429 ||
      (input.status >= 500 && input.status <= 599);
    this.retryAfterMs = input.retryAfterMs;
  }
}

export async function postJson<T>(
  endpoint: string,
  body: unknown,
  operation: string,
  opts: TransportOptions,
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const attempts = opts.retry.maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await requestOnce<T>(endpoint, body, operation, opts, fetchImpl);
    } catch (error) {
      lastError = error;
      if (!(error instanceof DeepSeekApiError) || !error.retryable || attempt === attempts - 1) {
        throw error;
      }
      await sleep(retryDelay(error.retryAfterMs, opts.retry.baseDelayMs, attempt), opts.signal);
    }
  }

  throw lastError;
}

async function requestOnce<T>(
  endpoint: string,
  body: unknown,
  operation: string,
  opts: TransportOptions,
  fetchImpl: typeof fetch,
): Promise<T> {
  return fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.auth.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    opts.signal,
    opts.timeoutMs,
    operation,
    fetchImpl,
    async (response) => {
      if (!response.ok) {
        const text = await readBoundedText(response, MAX_ERROR_BODY_CHARS);
        throw new DeepSeekApiError({
          operation,
          status: response.status,
          body: text,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
        });
      }

      const text = await readResponseText(response, MAX_RESPONSE_BYTES, operation);
      if (!text.trim()) throw new Error(`${operation} returned an empty response body`);

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`${operation} returned invalid JSON: ${truncate(redactSecrets(text), 500)}`);
      }
    },
  );
}

/**
 * Runs the request and the callback that consumes its body inside one
 * timeout/abort scope. The timer must stay active while the response body is
 * read, otherwise a slow or stalled body can outlive the configured timeout.
 */
async function fetchWithTimeout<T>(
  endpoint: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
  operation: string,
  fetchImpl: typeof fetch,
  handleResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal.aborted) forwardAbort();
  else signal.addEventListener("abort", forwardAbort, { once: true });

  const timer = signal.aborted
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("timeout"));
      }, timeoutMs);

  try {
    const response = await fetchImpl(endpoint, { ...init, signal: controller.signal });
    return await handleResponse(response);
  } catch (error) {
    if (timedOut) throw new Error(formatTimeoutError(operation, timeoutMs));
    if (signal.aborted) throw abortReason(signal, operation);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", forwardAbort);
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    return Math.min(MAX_RETRY_DELAY_MS, Number(trimmed) * 1000);
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - Date.now()));
}

export function retryDelay(retryAfterMs: number | undefined, baseDelayMs: number, attempt: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  return Math.min(MAX_RETRY_DELAY_MS, baseDelayMs * 2 ** attempt);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal, "DeepSeek request"));
    };
    if (signal.aborted) {
      clearTimeout(timer);
      reject(abortReason(signal, "DeepSeek request"));
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal, operation: string): unknown {
  return signal.reason instanceof Error ? signal.reason : new Error(`${operation} request aborted`);
}

/** Reads at most `maxChars + 1` characters, enough for formatApiError to add its marker. */
async function readBoundedText(response: Response, maxChars: number): Promise<string> {
  if (!response.body) return truncate(await response.text(), maxChars + 1);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const limit = maxChars + 1;
  let text = "";
  let chars = 0;
  try {
    while (chars < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      chars += Array.from(chunk).length;
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return truncate(text, limit);
}

/** Reads a successful response body, rejecting payloads above `maxBytes`. */
async function readResponseText(response: Response, maxBytes: number, operation: string): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`${operation} response exceeded ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new Error(`${operation} response exceeded ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return text;
}
