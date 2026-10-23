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
 * What reading the shared config file produced: the accepted options plus the
 * problems as structured data. `readFileOptions` prints the warnings; other
 * consumers (the config command) replay them through their own channel.
 */
export interface FileOptionsReport {
  readonly options: PluginOptions;
  /** One entry per problem the runtime would warn about on stderr. */
  readonly warnings: readonly string[];
  /** False only when the file is absent — the normal, silent case. */
  readonly exists: boolean;
}

/**
 * Reads the shared config file synchronously (the Pi settings reader's
 * convention — adapters resolve once at startup) and reports what happened.
 * Absence is normal and silent; an unreadable or unparseable file and every
 * rejected key produce one warning each and are otherwise dropped, so a bad
 * file never blocks startup.
 */
export function readFileOptionsReport(file: string): FileOptionsReport {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { options: {}, warnings: [], exists: false };
    }
    return { options: {}, warnings: [`cannot read ${file} — file ignored`], exists: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { options: {}, warnings: [`${file} is not valid JSON — file ignored`], exists: true };
  }
  if (!isPlainObject(parsed)) {
    return { options: {}, warnings: [`${file} is not a JSON object — file ignored`], exists: true };
  }

  const options: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (SHARED_KEY_SET.has(key)) options[key] = value;
    else if (HOST_INTEGRATION_KEYS.has(key))
      warnings.push(`"${key}" is a host-integration key (host config only) — ignored`);
    else warnings.push(`unknown key "${key}" — ignored`);
  }
  return { options, warnings, exists: true };
}

/**
 * Reads the shared config file and warns about problems on stderr (stdout is
 * the MCP server's JSON-RPC channel). See readFileOptionsReport for the
 * structured shape; this is the production entry adapters use.
 */
export function readFileOptions(file: string): PluginOptions {
  const report = readFileOptionsReport(file);
  for (const warning of report.warnings) warn(warning);
  return report.options;
}

/** The production entry point: compute the path for this machine and read it. */
export function sharedFileOptions(env: Env = process.env, home: string = homedir()): PluginOptions {
  return readFileOptions(configFilePath(env, home));
}

function warn(line: string): void {
  console.error(`deepseek-web-retrieval config: ${line}`);
}
