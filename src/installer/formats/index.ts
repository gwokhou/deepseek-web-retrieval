import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConfigOp, FileEdit, HostName, RecordedFile, RecordedOp } from "../types";
import { jsonCodec } from "./json";
import { rulesCodec } from "./rules";
import { tomlCodec } from "./toml";

export type ConfigFormat = FileEdit["format"];

/** A config file as the codec read it: parsed, or carrying the parse error. */
export interface LoadedConfig {
  readonly exists: boolean;
  readonly text: string;
  readonly value: Record<string, unknown>;
  /** True when serializing the parsed value would drop comments (TOML only; JSON edits preserve them). */
  readonly lossy: boolean;
  readonly parseError?: string;
}

/** What applying one edit produced, beyond the new text: everything undo needs. */
export interface AppliedText {
  readonly text: string;
  readonly recorded: readonly RecordedOp[];
  readonly createdParents: readonly (readonly string[])[];
}

/** What reverting one recorded file produced: the text plus notes about skipped work. */
export interface RevertedText {
  readonly text: string;
  readonly notes: readonly string[];
}

/**
 * One codec per config format, behind a single registry: load parses, apply edits,
 * verify checks postconditions (per op for json/toml, block presence for rules),
 * revert reverses a recorded file, and isEffectivelyEmpty gates whole-file deletion.
 */
export interface FormatCodec {
  readonly format: ConfigFormat;
  load(file: string): LoadedConfig;
  apply(text: string, edit: FileEdit): AppliedText;
  verify(text: string, edit: FileEdit, op?: ConfigOp): boolean;
  revert(text: string, recorded: RecordedFile): RevertedText;
  isEffectivelyEmpty(text: string): boolean;
}

/** Shared write step: every codec consumer writes config files through this. */
export function writeConfig(file: string, serialized: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialized);
}

/** The one entry point to a format's codec; only the rules codec cares about the host. */
export function codecFor(format: ConfigFormat, host: HostName): FormatCodec {
  if (format === "json") return jsonCodec;
  if (format === "toml") return tomlCodec;
  return rulesCodec(host);
}
