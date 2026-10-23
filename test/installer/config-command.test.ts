import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRetrievalClient } from "../../src/core/client";
import { SHARED_CONFIG_KEYS } from "../../src/core/config-file";
import { API_KEY_ENV } from "../../src/core/constants";
import type { Env } from "../../src/core/env";
import { runInstallerCli } from "../../src/installer/cli";
import { runConfigCommand } from "../../src/installer/config-command";

function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) },
    outText: () => out.join("\n"),
    errText: () => err.join("\n"),
  };
}

/** A temp XDG fixture; `config` is written as JSON, or raw when a string (unparseable case). */
function xdgFixture(config?: unknown): { env: Env; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "dwr-config-cmd-"));
  if (config !== undefined) {
    mkdirSync(join(dir, "deepseek-web-retrieval"), { recursive: true });
    writeFileSync(
      join(dir, "deepseek-web-retrieval", "config.json"),
      typeof config === "string" ? config : JSON.stringify(config),
    );
  }
  return { env: { XDG_CONFIG_HOME: dir }, file: join(dir, "deepseek-web-retrieval", "config.json") };
}

/** The transport stub shape test/mcp uses: no response queued means the network must not be reached. */
function createStub() {
  let captured: { url: string; init: RequestInit } | undefined;
  let response: { body: unknown; status: number } | undefined;
  return {
    get captured() {
      return captured;
    },
    respond(body: unknown, status = 200) {
      captured = undefined;
      response = { body, status };
    },
    fetchImpl: (async (url, init) => {
      if (!response) throw new Error("network must not be reached");
      captured = { url: String(url), init: init ?? {} };
      return Response.json(response.body, { status: response.status });
    }) as typeof fetch,
  };
}

describe("config command: effective options with provenance", () => {
  test("prints every knob with its value and source, in the deviation-summary vocabulary order", async () => {
    const { env, file } = xdgFixture({ count: 20, language: "zh", blockedDomains: ["pinterest.com", "x.com"] });
    const { io, outText, errText } = captureIo();
    const code = await runConfigCommand(undefined, io, {
      env: { ...env, DEEPSEEK_SEARCH_MAX_RESULTS: "7", DEEPSEEK_SEARCH_LANGUAGE: "en" },
    });
    expect(code).toBe(0);
    expect(errText()).toBe("");
    const text = outText();
    expect(text).toContain(`Config file: ${file} (exists)`);
    expect(text).toContain("count = 20 (file)");
    expect(text).toContain("blockedDomains = pinterest.com, x.com (file)");
    expect(text).toContain("maxResults = 7 (env)");
    // Same key in both layers: the environment wins, in resolution and in the label.
    expect(text).toContain("language = en (env)");
    expect(text).not.toContain("language = zh");
    expect(text).toContain("searchTimeoutMs = 30000 (default)");
    expect(text).toContain("searchLocalization = unset (default)");
    expect(text).toContain("maxRetries = 2 (default)");
    expect(text).toContain(
      "Host-native layers (OpenCode options, Pi settings) may override file and env values per host.",
    );
    const knobLines = text.split("\n").filter((line) => line.includes(" = "));
    expect(knobLines.map((line) => line.split(" =")[0])).toEqual([...SHARED_CONFIG_KEYS]);
  });

  test("maxResults follows a configured count: the source label says count, not default", async () => {
    // File-sourced count: the derived maxResults is neither the default value
    // nor default-sourced — its source is the count knob that drove it.
    const { env } = xdgFixture({ count: 20 });
    const { io, outText } = captureIo();
    expect(await runConfigCommand(undefined, io, { env })).toBe(0);
    expect(outText()).toContain("maxResults = 20 (count)");

    // Env-sourced count, no file at all: same rule.
    const missing = xdgFixture();
    const envRun = captureIo();
    expect(await runConfigCommand(undefined, envRun.io, { env: missing.env })).toBe(0);
    expect(envRun.outText()).toContain("maxResults = 10 (default)");
    const envCount = captureIo();
    expect(
      await runConfigCommand(undefined, envCount.io, { env: { ...missing.env, DEEPSEEK_SEARCH_COUNT: "30" } }),
    ).toBe(0);
    expect(envCount.outText()).toContain("maxResults = 30 (count)");
  });

  test("a missing file is the normal case: exit 0, no warnings", async () => {
    const { env, file } = xdgFixture();
    const { io, outText, errText } = captureIo();
    expect(await runConfigCommand(undefined, io, { env })).toBe(0);
    expect(outText()).toContain(`Config file: ${file} (missing)`);
    expect(outText()).toContain("count = 10 (default)");
    expect(errText()).toBe("");
  });

  test("file problems replay as warning lines and exit 1 while the report still prints", async () => {
    const { env } = xdgFixture({ retries: 3, searchEnabled: false, count: 20 });
    const { io, outText, errText } = captureIo();
    expect(await runConfigCommand(undefined, io, { env })).toBe(1);
    expect(errText()).toContain('warning: unknown key "retries" — ignored');
    expect(errText()).toContain('warning: "searchEnabled" is a host-integration key (host config only) — ignored');
    expect(outText()).toContain("count = 20 (file)");
  });

  test("an unparseable file warns, contributes nothing, and exits 1", async () => {
    const { env, file } = xdgFixture("{ not json");
    const { io, outText, errText } = captureIo();
    expect(await runConfigCommand(undefined, io, { env })).toBe(1);
    expect(errText()).toContain(`warning: ${file} is not valid JSON — file ignored`);
    expect(outText()).toContain(`Config file: ${file} (exists)`);
    expect(outText()).toContain("count = 10 (default)");
  });

  test("a non-object root warns and exits 1", async () => {
    const { env, file } = xdgFixture(["count"]);
    const { io, outText, errText } = captureIo();
    expect(await runConfigCommand(undefined, io, { env })).toBe(1);
    expect(errText()).toContain(`warning: ${file} is not a JSON object — file ignored`);
    expect(outText()).toContain("maxResults = 10 (default)");
  });
});

describe("config command: CLI dispatch", () => {
  test("runInstallerCli routes config and help documents it", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dwr-config-cli-"));
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    try {
      const { io, outText } = captureIo();
      expect(await runInstallerCli(["config"], io)).toBe(0);
      expect(outText()).toContain(`Config file: ${join(xdg, "deepseek-web-retrieval", "config.json")} (missing)`);

      const help = captureIo();
      expect(await runInstallerCli(["help"], help.io)).toBe(0);
      expect(help.outText()).toContain("deepseek-web-retrieval config [--search <query>]");

      const blank = captureIo();
      expect(await runInstallerCli(["config", "--search", ""], blank.io)).toBe(2);
      expect(blank.errText()).toContain("--search requires a query");
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
    }
  });
});

describe("config --search: end-to-end verifier with a stubbed transport", () => {
  const RESULTS = {
    results: [
      { url: "https://a.example/one", title: "First", summary: "Summary one.", rerank_score: 2.1, authority: 3 },
      { url: "https://b.example/two", title: "Second", snippet: "Snippet two." },
    ],
  };

  test("success: elapsed time, count, formatted results, and the effective config on the wire", async () => {
    const { env } = xdgFixture({ count: 20 });
    const stub = createStub();
    stub.respond(RESULTS);
    const { io, outText } = captureIo();
    const code = await runConfigCommand("deepseek mcp", io, {
      env: { ...env, [API_KEY_ENV]: "sk-test" },
      client: createRetrievalClient({ fetchImpl: stub.fetchImpl }),
    });
    expect(code).toBe(0);
    expect(outText()).toMatch(/search "deepseek mcp" — 2 results in \d+ ms/);
    expect(outText()).toContain("1. [First](https://a.example/one) [rerank 2.1 · authority 3]");
    expect(outText()).toContain("2. [Second](https://b.example/two)");
    // The billed request went out through the effective config and key.
    const body = JSON.parse(String(stub.captured?.init.body)) as {
      query: string;
      count: number;
      need_content: boolean;
    };
    expect(body).toEqual({ query: "deepseek mcp", count: 20, need_content: false });
    const headers = stub.captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  test("zero results is a success with the no-results body", async () => {
    const { env } = xdgFixture();
    const stub = createStub();
    stub.respond({ results: [] });
    const { io, outText } = captureIo();
    const code = await runConfigCommand("obscure query", io, {
      env: { ...env, [API_KEY_ENV]: "sk-test" },
      client: createRetrievalClient({ fetchImpl: stub.fetchImpl }),
    });
    expect(code).toBe(0);
    expect(outText()).toMatch(/search "obscure query" — 0 results in \d+ ms/);
    expect(outText()).toContain("No results found.");
  });

  test("missing key prints the shared guidance and exits 1 without touching the network", async () => {
    const { env } = xdgFixture();
    const stub = createStub(); // no response queued; any fetch attempt throws
    const { io, errText } = captureIo();
    const code = await runConfigCommand("deepseek mcp", io, {
      env,
      client: createRetrievalClient({ fetchImpl: stub.fetchImpl }),
    });
    expect(code).toBe(1);
    expect(errText()).toContain("DeepSeek API key not found");
    expect(errText()).toContain(API_KEY_ENV);
  });

  test("an API error prints the DeepSeekApiError message and exits 1", async () => {
    const { env } = xdgFixture();
    const stub = createStub();
    stub.respond({ error: "bad key" }, 401);
    const { io, errText } = captureIo();
    const code = await runConfigCommand("deepseek mcp", io, {
      env: { ...env, [API_KEY_ENV]: "sk-test" },
      client: createRetrievalClient({ fetchImpl: stub.fetchImpl }),
    });
    expect(code).toBe(1);
    expect(errText()).toContain("DeepSeek Search failed (HTTP 401, invalid API key)");
  });
});
