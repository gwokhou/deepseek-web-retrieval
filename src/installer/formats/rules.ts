import { existsSync, readFileSync } from "node:fs";
import type { HostName } from "../types";
import type { AppliedText, FormatCodec } from "./index";

/** Marked-block markers are per host, so multiple hosts can share one rules file. */
function rulesMarkers(host: HostName): { readonly begin: string; readonly end: string } {
  return {
    begin: `<!-- deepseek-web-retrieval:${host}:rules:begin -->`,
    end: `<!-- deepseek-web-retrieval:${host}:rules:end -->`,
  };
}

/** Wraps rule lines in the host's marked block that apply upserts and uninstall remove. */
export function buildRulesBlock(host: HostName, lines: readonly string[]): string {
  const markers = rulesMarkers(host);
  return [markers.begin, ...lines, markers.end].join("\n");
}

/** Replaces the host's existing marked block, or appends one; keeps surrounding text intact. */
export function upsertBlock(host: HostName, text: string, block: string): string {
  const without = removeBlock(host, text);
  const trimmed = without.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

/** Removes the host's marked block if present; returns the text unchanged otherwise. */
export function removeBlock(host: HostName, text: string): string {
  const range = blockRange(host, text);
  if (range === undefined) return text;
  // The upsert joins non-empty neighbors with exactly one blank line; removal
  // mirrors it, so the surrounding spacing stays stable across round-trips
  // instead of collapsing the separator the block used to occupy.
  const before = text.slice(0, range.start).trimEnd();
  const after = text
    .slice(range.end)
    .replace(/^\n{1,2}/, "")
    .trimStart();
  if (before && after) return `${before}\n\n${after}`;
  if (before) return `${before}\n`;
  return after;
}

export function hasBlock(host: HostName, text: string): boolean {
  return blockRange(host, text) !== undefined;
}

/** Only one complete, ordered marker pair establishes which text we may remove. */
function blockRange(host: HostName, text: string): { start: number; end: number } | undefined {
  const markers = rulesMarkers(host);
  const start = text.indexOf(markers.begin);
  const end = text.indexOf(markers.end);
  if (start === -1 && end === -1) return undefined;
  if (
    start === -1 ||
    end < start ||
    text.indexOf(markers.begin, start + markers.begin.length) !== -1 ||
    text.indexOf(markers.end, end + markers.end.length) !== -1
  ) {
    throw new Error(
      `malformed rules block for ${host}: expected one begin marker followed by one end marker; repair the markers before retrying`,
    );
  }
  return { start, end: end + markers.end.length };
}

/** A rules codec is per host: its markers decide which block upsert, verify, and revert touch. */
export function rulesCodec(host: HostName): FormatCodec {
  return {
    format: "rules",
    load: (file) => {
      const exists = existsSync(file);
      const text = exists ? readFileSync(file, "utf8") : "";
      try {
        blockRange(host, text);
        return { exists, text, value: {}, lossy: false };
      } catch (error) {
        return { exists, text, value: {}, lossy: false, parseError: String(error) };
      }
    },
    apply: (text, edit): AppliedText => {
      if (edit.format !== "rules") throw new Error(`rules codec cannot apply a ${edit.format} edit`);
      return { text: upsertBlock(host, text, edit.block), recorded: [], createdParents: [] };
    },
    // Rules files are markdown: the block's presence is the only postcondition.
    verify: (text) => hasBlock(host, text),
    revert: (text) => ({ text: removeBlock(host, text), notes: [] }),
    isEffectivelyEmpty: (text) => text.trim().length === 0,
  };
}
