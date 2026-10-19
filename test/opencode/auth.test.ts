import { afterEach, describe, expect, test } from "bun:test"
import { apiKeyFromEnv, requireEnvApiKey } from "../../src/core/auth"
import { resolveApiKey } from "../../src/opencode/auth"

const originalKey = process.env.DEEPSEEK_API_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalKey
})

function context(credential: unknown, error?: Error) {
  return {
    integration: {
      connection: {
        active: async () => {
          if (error) throw error
          return credential === undefined
            ? undefined
            : { type: "credential", id: "cred_test", label: "DeepSeek", method: "key" }
        },
        resolve: async () => credential,
      },
    },
  } as never
}

describe("API key resolution", () => {
  test("reads and trims the environment variable", () => {
    expect(apiKeyFromEnv({ DEEPSEEK_API_KEY: "  sk-test  " })).toBe("sk-test")
    expect(apiKeyFromEnv({})).toBeUndefined()
    expect(requireEnvApiKey({ DEEPSEEK_API_KEY: "sk-test" })).toBe("sk-test")
    expect(() => requireEnvApiKey({})).toThrow("DEEPSEEK_API_KEY is not set")
  })

  test("auto prefers the stored OpenCode credential", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-env"
    await expect(resolveApiKey(context({ type: "key", key: "  sk-stored  " }), "auto")).resolves.toBe(
      "sk-stored",
    )
  })

  test("auto falls back to the environment when no stored key exists", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-env"
    await expect(resolveApiKey(context(undefined), "auto")).resolves.toBe("sk-env")
  })

  test("env mode ignores the stored credential", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-env"
    await expect(
      resolveApiKey(context({ type: "key", key: "sk-stored" }), "env"),
    ).resolves.toBe("sk-env")
  })

  test("opencode mode fails clearly without a stored key", async () => {
    delete process.env.DEEPSEEK_API_KEY
    await expect(resolveApiKey(context(undefined), "opencode")).rejects.toThrow(
      "No DeepSeek credential is stored in OpenCode",
    )
  })

  test("auto falls back to env if reading the credential store fails", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-env"
    await expect(
      resolveApiKey(context(undefined, new Error("store unavailable")), "auto"),
    ).resolves.toBe("sk-env")
  })

  test("reports a combined error when the store fails and env is absent", async () => {
    delete process.env.DEEPSEEK_API_KEY
    await expect(
      resolveApiKey(context(undefined, new Error("store unavailable")), "auto"),
    ).rejects.toThrow("could not be read")
  })

  test("ignores non-key credentials", async () => {
    delete process.env.DEEPSEEK_API_KEY
    await expect(
      resolveApiKey(context({ type: "oauth", access: "token" }), "auto"),
    ).rejects.toThrow("DeepSeek API key is not configured")
  })
})
