import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isPlainObject } from "../core/object"

/** The settings.json namespace the installer writes capability switches into. */
export const SETTINGS_NAMESPACE = "deepseekWebRetrieval"

/** The namespace shape. Only an explicit false is meaningful, mirroring the env switches. */
export interface ExtensionSettings {
  readonly enableSearch?: boolean
  readonly enableFetch?: boolean
}

/**
 * Reads the namespace from Pi's settings files, project over global (Pi's own
 * merge order — a project key overrides a global one, so a project can
 * re-enable against a global off). Pi 1.3.0 tolerates unknown keys in
 * settings.json — reads ignore them and Pi's own rewrites preserve them
 * (verified against 1.3.0: `pi install` rewriting the file kept the namespace
 * intact), so the installer can sit its keys next to Pi's own. Missing or
 * unparseable files contribute nothing.
 */
export function readExtensionSettings(home: string, cwd: string): ExtensionSettings {
  const merged: Record<string, unknown> = {
    ...readNamespace(join(home, ".pi", "agent", "settings.json")),
    ...readNamespace(join(cwd, ".pi", "settings.json")),
  }
  return {
    ...(merged.enableSearch === false ? { enableSearch: false } : {}),
    ...(merged.enableFetch === false ? { enableFetch: false } : {}),
  }
}

function readNamespace(file: string): Record<string, unknown> {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isPlainObject(parsed)) return {}
    const namespace = parsed[SETTINGS_NAMESPACE]
    return isPlainObject(namespace) ? namespace : {}
  } catch {
    return {}
  }
}
