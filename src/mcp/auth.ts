import { API_KEY_ENV } from "../core/constants"
import { apiKeyFromEnv } from "../core/auth"
import type { Env } from "../core/env"

export const MISSING_API_KEY_MESSAGE =
  `DeepSeek API key not found. Set ${API_KEY_ENV} in the MCP server's env configuration.`

/** Resolves the API key from the environment or fails with shared guidance. */
export function requireApiKey(env: Env): string {
  const apiKey = apiKeyFromEnv(env)
  if (!apiKey) throw new Error(MISSING_API_KEY_MESSAGE)
  return apiKey
}
