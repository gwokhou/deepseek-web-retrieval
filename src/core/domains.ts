import { isIP } from "node:net"
import type { FetchOptions } from "./types"

export function normalizeDomain(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return undefined
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return undefined

  let hostname: string
  try {
    // Parsing with a synthetic scheme also strips paths, ports, and userinfo.
    hostname = new URL(hasScheme ? trimmed : `http://${trimmed}`).hostname
  } catch {
    return undefined
  }
  return normalizeHostname(hostname)
}

/** Lowercases a URL hostname and removes brackets and trailing root-label dots. */
export function normalizeHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.+$/, "")
}

/**
 * Exact or subdomain match only. `example.com` matches `docs.example.com`
 * but not `notexample.com` or `example.com.evil.test`.
 */
export function domainMatches(hostname: string, domain: string): boolean {
  const host = normalizeHostname(hostname)
  const target = normalizeHostname(domain)
  if (!host || !target) return false
  return host === target || host.endsWith(`.${target}`)
}

export function normalizeDomains(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const domains = new Set<string>()
  for (const value of values) {
    if (typeof value !== "string") continue
    const domain = normalizeDomain(value)
    if (domain) domains.add(domain)
  }
  return [...domains]
}

/**
 * Whether a hostname points at a local/private network that the DeepSeek
 * service cannot reach. Blocking these by default avoids sending internal URLs
 * to a remote service and fails early instead of producing a confusing 404.
 */
export function isPrivateHostname(value: string): boolean {
  const host = normalizeHostname(value)
  if (!host) return true
  if (host === "localhost" || host === "local") return true
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa")
  ) {
    return true
  }

  const version = isIP(host)
  if (version === 4) return isPrivateIpv4(host)
  if (version === 6) return isPrivateIpv6(host)
  return false
}

export function assertFetchHostPolicy(
  url: URL,
  options: Pick<FetchOptions, "allowedDomains" | "blockedDomains" | "blockPrivateHosts">,
): void {
  const host = normalizeHostname(url.hostname)

  if (options.blockPrivateHosts && isPrivateHostname(host)) {
    throw new Error(
      `Fetch blocked for ${host}: local/private addresses are not reachable by DeepSeek. ` +
        "Set fetchBlockPrivateHosts=false only if you really need to send the URL.",
    )
  }

  const blocked = options.blockedDomains.find((domain) => domainMatches(host, domain))
  if (blocked) {
    throw new Error(`Fetch blocked for ${host}: matched fetchBlockedDomains entry "${blocked}"`)
  }
  if (
    options.allowedDomains.length > 0 &&
    !options.allowedDomains.some((domain) => domainMatches(host, domain))
  ) {
    throw new Error(
      `Fetch not allowed for ${host}: add it to fetchAllowedDomains (exact host or subdomain)`,
    )
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIpv6(host: string): boolean {
  const value = host.toLowerCase()
  if (value === "::" || value === "::1") return true
  if (value.startsWith("fc") || value.startsWith("fd")) return true
  if (/^fe[89ab]/.test(value)) return true

  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mapped) return isPrivateIpv4(mapped)
  return false
}

