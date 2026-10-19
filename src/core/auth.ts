import type { ApiKeySource } from "./types"

export const API_KEY_ENV = "DEEPSEEK_API_KEY"

export function apiKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const key = env[API_KEY_ENV]?.trim()
  return key ? key : undefined
}

export function requireEnvApiKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const key = apiKeyFromEnv(env)
  if (key) return key
  throw new Error(
    `${API_KEY_ENV} is not set. Export it before starting OpenCode, or store a DeepSeek credential with "opencode auth login".`,
  )
}

export function missingApiKeyError(source: ApiKeySource): Error {
  if (source === "env") {
    return new Error(`${API_KEY_ENV} is not set. Export it before starting OpenCode.`)
  }
  if (source === "opencode") {
    return new Error(
      'No DeepSeek credential is stored in OpenCode. Run "opencode auth login" and connect DeepSeek, or set apiKeySource to "env".',
    )
  }
  return new Error(
    `DeepSeek API key is not configured. Connect DeepSeek in OpenCode ("opencode auth login") or set ${API_KEY_ENV}.`,
  )
}
