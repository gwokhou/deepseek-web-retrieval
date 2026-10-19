import { MAX_URL_CHARS } from "./constants"
import { normalizeHostname } from "./domains"

export function parseFetchUrl(value: string): URL {
  const input = value.trim()
  if (!input) throw new Error("URL must not be empty")
  if (input.length > MAX_URL_CHARS) {
    throw new Error(`URL must be ${MAX_URL_CHARS} characters or fewer`)
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("URL must be an absolute http:// or https:// URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http:// or https://")
  }
  if (!url.hostname || !normalizeHostname(url.hostname)) {
    throw new Error("URL must include a host")
  }
  if (url.username || url.password) {
    throw new Error("URL must not contain credentials")
  }
  return url
}

/** Normalizes a search-result URL and drops anything that is not public HTTP(S). */
export function normalizeResultUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const input = value.trim()
  if (!input || input.length > MAX_URL_CHARS) return undefined
  try {
    const url = new URL(input)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (!url.hostname || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}
