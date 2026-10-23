import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Env } from "./env";
import { isPlainObject } from "./object";
import type { PluginOptions } from "./types";

/** The user-scope shared config file: one file, under the XDG config home. */
export const SHARED_CONFIG_DIR = "deepseek-web-retrieval";
export const SHARED_CONFIG_FILE = "config.json";

/**
 * The shared file's vocabulary: API-behavior and host-sensitive plugin option
 * keys only. Values pass through raw — validation and clamping stay in
 * resolvePluginOptions so every channel feeds one pipeline. Host-integration
 * keys are deliberately absent (see HOST_INTEGRATION_KEYS).
 */
export const SHARED_CONFIG_KEYS = [
  "count",
  "maxResults",
  "minRerank",
  "minAuthority",
  "allowUnknownAuthority",
  "blockedDomains",
  "includeDomains",
  "language",
  "searchLocalization",
  "maxSummaryChars",
  "searchTimeoutMs",
  "fetchMaxChars",
  "fetchAllowedDomains",
  "fetchBlockedDomains",
  "fetchTimeoutMs",
  "fetchBlockPrivateHosts",
  "maxRetries",
  "retryBaseDelayMs",
] as const;

const SHARED_KEY_SET = new Set<string>(SHARED_CONFIG_KEYS);

/**
 * Host-integration keys describe the host's tool landscape, not the DeepSeek
 * call, so they stay in host-native config; the shared file rejects them.
 */
const HOST_INTEGRATION_KEYS = new Set<string>([
  "searchEnabled",
  "fetchEnabled",
  "setDefaultWebsearch",
  "fetchOverrideWebfetch",
  "fetchRegisterTool",
  "apiKeySource",
]);

/**
 * XDG_CONFIG_HOME is honored only when non-empty; otherwise the XDG default
 * `<home>/.config` applies. Pure so tests inject env and home directly.
 */
export function configFilePath(env: Env, home: string): string {
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configHome, SHARED_CONFIG_DIR, SHARED_CONFIG_FILE);
}

/**
 * Reads the shared config file synchronously (the Pi settings reader's
 * convention — adapters resolve once at startup). Absence is normal and
 * silent; an unreadable or unparseable file and every rejected key warn once
 * on stderr (stdout is the MCP server's JSON-RPC channel) and are otherwise
 * dropped, so a bad file never blocks startup.
 */
export function readFileOptions(file: string): PluginOptions {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") warn(`cannot read ${file} — file ignored`);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    warn(`${file} is not valid JSON — file ignored`);
    return {};
  }
  if (!isPlainObject(parsed)) {
    warn(`${file} is not a JSON object — file ignored`);
    return {};
  }

  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (SHARED_KEY_SET.has(key)) options[key] = value;
    else if (HOST_INTEGRATION_KEYS.has(key)) warn(`"${key}" is a host-integration key (host config only) — ignored`);
    else warn(`unknown key "${key}" — ignored`);
  }
  return options;
}

/** The production entry point: compute the path for this machine and read it. */
export function sharedFileOptions(env: Env = process.env, home: string = homedir()): PluginOptions {
  return readFileOptions(configFilePath(env, home));
}

function warn(line: string): void {
  console.error(`deepseek-web-retrieval config: ${line}`);
}
