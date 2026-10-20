import { API_KEY_ENV } from "./constants"

export function apiKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const key = env[API_KEY_ENV]?.trim()
  return key ? key : undefined
}
