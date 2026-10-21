import { describe, expect, test } from "bun:test";
import {
  assertFetchHostPolicy,
  domainMatches,
  isPrivateHostname,
  normalizeDomains,
  normalizeHostname,
} from "../../src/core/domains";
import { resolveFetchOptions } from "../../src/core/options";
import { parseFetchUrl } from "../../src/core/url";

describe("domains", () => {
  test("normalizes hosts, URLs, ports, and trailing dots", () => {
    expect(
      normalizeDomains([
        "HTTPS://Example.COM./path",
        "sub.example.com:8080",
        "http://user:pass@foo.test/x",
        "ftp://ignored.test",
        "bad host",
      ]),
    ).toEqual(["example.com", "sub.example.com", "foo.test"]);
    expect(normalizeHostname("[::1]")).toBe("::1");
  });

  test("matches only exact domains and true subdomains", () => {
    expect(domainMatches("example.com", "example.com")).toBe(true);
    expect(domainMatches("docs.example.com", "example.com")).toBe(true);
    expect(domainMatches("a.b.example.com", "example.com")).toBe(true);
    expect(domainMatches("EXAMPLE.COM.", "example.com")).toBe(true);
    expect(domainMatches("notexample.com", "example.com")).toBe(false);
    expect(domainMatches("example.com.evil.test", "example.com")).toBe(false);
    expect(domainMatches("examples.com", "example.com")).toBe(false);
    expect(domainMatches("", "example.com")).toBe(false);
  });

  test("recognizes local and private hosts", () => {
    for (const host of [
      "localhost",
      "api.localhost",
      "printer.local",
      "metadata.internal",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:c0a8:101",
      "::ffff:a9fe:a9fe",
      "::7f00:1",
    ]) {
      expect(isPrivateHostname(host)).toBe(true);
    }
    for (const host of ["example.com", "8.8.8.8", "2001:4860:4860::8888", "::ffff:808:808", "::808:808"]) {
      expect(isPrivateHostname(host)).toBe(false);
    }
  });

  test("blocks IPv4-mapped IPv6 addresses after URL normalization", () => {
    const options = resolveFetchOptions();
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:192.168.1.1]/",
      "http://[::7f00:1]/",
    ]) {
      expect(() => assertFetchHostPolicy(new URL(url), options)).toThrow("local/private");
    }
    expect(() => assertFetchHostPolicy(new URL("http://[::ffff:8.8.8.8]/"), options)).not.toThrow();
  });

  test("blocks private hosts before domain allow lists", () => {
    const url = new URL("http://localhost:3000/docs");
    const options = resolveFetchOptions({ fetchAllowedDomains: ["localhost"] });
    expect(() => assertFetchHostPolicy(url, options)).toThrow("local/private");
    expect(() => assertFetchHostPolicy(url, { ...options, blockPrivateHosts: false })).not.toThrow();
  });

  test("blocked domains win and a non-empty allow list requires a match", () => {
    const options = resolveFetchOptions({
      fetchAllowedDomains: ["example.com"],
      fetchBlockedDomains: ["blocked.example.com"],
    });
    expect(() => assertFetchHostPolicy(new URL("https://docs.example.com/a"), options)).not.toThrow();
    expect(() => assertFetchHostPolicy(new URL("https://blocked.example.com/a"), options)).toThrow(
      "fetchBlockedDomains",
    );
    expect(() => assertFetchHostPolicy(new URL("https://notexample.com"), options)).toThrow("fetchAllowedDomains");
    expect(() => assertFetchHostPolicy(new URL("https://example.com.evil.test"), options)).toThrow(
      "fetchAllowedDomains",
    );
  });
});

describe("parseFetchUrl", () => {
  test("accepts absolute HTTP(S) URLs", () => {
    expect(parseFetchUrl("https://example.com/a?b=1").href).toBe("https://example.com/a?b=1");
    expect(parseFetchUrl("http://example.com").protocol).toBe("http:");
  });

  test("rejects invalid protocols, relative URLs, credentials, and empty values", () => {
    expect(() => parseFetchUrl("ftp://example.com/file")).toThrow("http:// or https://");
    expect(() => parseFetchUrl("example.com")).toThrow("absolute");
    expect(() => parseFetchUrl("https://user:pass@example.com")).toThrow("credentials");
    expect(() => parseFetchUrl("   ")).toThrow("empty");
  });

  test("rejects long URLs and missing hosts", () => {
    expect(() => parseFetchUrl(`https://example.com/${"x".repeat(8192)}`)).toThrow("8192");
    expect(() => parseFetchUrl("https://")).toThrow("absolute");
    expect(() => parseFetchUrl("http://.")).toThrow("host");
  });
});
