import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temp XDG root, optionally carrying a shared config file. */
export function xdgRoot(configFile?: Record<string, unknown>, prefix = "dwr-test-xdg-"): string {
  const xdg = mkdtempSync(join(tmpdir(), prefix));
  if (configFile) {
    mkdirSync(join(xdg, "deepseek-web-retrieval"), { recursive: true });
    writeFileSync(join(xdg, "deepseek-web-retrieval", "config.json"), JSON.stringify(configFile));
  }
  return xdg;
}

/**
 * Makes process.env hermetic for an adapter's own resolution: XDG_CONFIG_HOME
 * pinned to the given root, the given DEEPSEEK_* overrides applied, every
 * other DEEPSEEK_* variable cleared. Returns the restore.
 */
export function pinEnvironment(xdg: string, env: Record<string, string> = {}): () => void {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedDeepseek = Object.entries(process.env).filter(([key]) => key.startsWith("DEEPSEEK_"));
  process.env.XDG_CONFIG_HOME = xdg;
  for (const [key] of savedDeepseek) delete process.env[key];
  Object.assign(process.env, env);
  return () => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("DEEPSEEK_")) delete process.env[key];
    }
    for (const [key, value] of savedDeepseek) process.env[key] = value;
  };
}

/** Captures console.error lines so the deviation summary is asserted, not tolerated. */
export function captureErrors(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalError = console.error;
  console.error = (line: string) => lines.push(line);
  return { lines, restore: () => (console.error = originalError) };
}

/**
 * The transport stub shared by the MCP-server and config-command tests: queue a
 * response with respond(), drop it with reject(); no queued response means the
 * network must not be reached.
 */
export function createStub() {
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
    reject() {
      captured = undefined;
      response = undefined;
    },
    fetchImpl: (async (url, init) => {
      if (!response) throw new Error("network must not be reached");
      captured = { url: String(url), init: init ?? {} };
      return Response.json(response.body, { status: response.status });
    }) as typeof fetch,
  };
}
