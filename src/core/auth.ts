import { API_KEY_ENV } from "./constants";

/** Shared missing-key guidance; every surface that needs a key prints this one message. */
export const MISSING_API_KEY_MESSAGE = `DeepSeek API key not found. Set ${API_KEY_ENV} in the MCP server's env configuration.`;

export function apiKeyFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const key = env[API_KEY_ENV]?.trim();
  return key ? key : undefined;
}
