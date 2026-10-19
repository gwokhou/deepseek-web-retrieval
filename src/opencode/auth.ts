import type { Context } from "@opencode/plugin/promise/plugin"
import { apiKeyFromEnv, missingApiKeyError } from "../core/auth"
import type { ApiKeySource } from "../core/types"

const DEEPSEEK_INTEGRATION_ID = "deepseek"

/**
 * Resolves the DeepSeek key for one request. The OpenCode credential is
 * preferred because it is the same key the model provider already uses.
 * `DEEPSEEK_API_KEY` remains available for headless setups.
 */
export async function resolveApiKey(ctx: Context, source: ApiKeySource): Promise<string> {
  const envKey = apiKeyFromEnv(process.env)

  if (source === "env") {
    if (envKey) return envKey
    throw missingApiKeyError("env")
  }

  let stored: string | undefined
  let storedError: unknown
  try {
    const connection = await ctx.integration.connection.active(DEEPSEEK_INTEGRATION_ID)
    const credential = connection
      ? await ctx.integration.connection.resolve(connection)
      : undefined
    if (credential?.type === "key") {
      const key = credential.key.trim()
      if (key) stored = key
    }
  } catch (error) {
    storedError = error
  }

  if (stored) return stored
  if (source === "opencode") {
    if (storedError) {
      throw new Error(
        'Could not read the DeepSeek credential from OpenCode. Run "opencode auth login" and connect DeepSeek.',
        { cause: storedError },
      )
    }
    throw missingApiKeyError("opencode")
  }
  if (envKey) return envKey
  if (storedError) {
    throw new Error(
      `DeepSeek API key is not configured, and the OpenCode credential could not be read. ` +
        `Set DEEPSEEK_API_KEY or run "opencode auth login".`,
      { cause: storedError },
    )
  }
  throw missingApiKeyError("auto")
}
