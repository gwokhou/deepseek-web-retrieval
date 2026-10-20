import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stateDir } from "./paths"
import type { InstallerInput, InstallRecord } from "./types"

export function statePathFor(input: InstallerInput): string {
  return join(stateDir(input, input.scope), `install.${input.host}.json`)
}

export function readRecord(input: InstallerInput): InstallRecord | undefined {
  const file = statePathFor(input)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as InstallRecord
  } catch {
    return undefined
  }
}

/**
 * Install records carry snapshots of replaced values, so they are written with
 * owner-only permissions regardless of umask.
 */
export function writeRecord(input: InstallerInput, record: InstallRecord): void {
  const file = statePathFor(input)
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
}

export function deleteRecord(input: InstallerInput): void {
  const file = statePathFor(input)
  if (existsSync(file)) rmSync(file)
}

/** Lists install records found in both scope locations for the given home and cwd. */
export function listRecords(home: string, cwd: string): InstallRecord[] {
  const records: InstallRecord[] = []
  for (const scope of ["global", "project"] as const) {
    const dir = stateDir({ home, cwd }, scope)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("install.") || !name.endsWith(".json")) continue
      try {
        records.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as InstallRecord)
      } catch {
        // Unreadable records are skipped; uninstall reports them as absent.
      }
    }
  }
  return records
}
