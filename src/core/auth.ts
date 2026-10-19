export const API_KEY_ENV = "DEEPSEEK_API_KEY"

export function apiKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const key = env[API_KEY_ENV]?.trim()
  return key ? key : undefined
}
