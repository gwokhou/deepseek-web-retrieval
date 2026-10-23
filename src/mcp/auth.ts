import { apiKeyFromEnv, MISSING_API_KEY_MESSAGE } from "../core/auth";
import type { Env } from "../core/env";

export { MISSING_API_KEY_MESSAGE };

/** Resolves the API key from the environment or fails with shared guidance. */
export function requireApiKey(env: Env): string {
  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) throw new Error(MISSING_API_KEY_MESSAGE);
  return apiKey;
}
