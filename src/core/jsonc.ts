import { parse } from "jsonc-parser/lib/esm/main.js";

/**
 * Parses JSONC (JSON with comments and trailing commas) via jsonc-parser,
 * the library behind VS Code's JSON support. Throws a SyntaxError when the
 * text has errors beyond tolerated comments and trailing commas.
 */
export function parseJsonc(text: string): unknown {
  const errors: { error: number; offset: number; length: number }[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new SyntaxError(`JSONC parse error at offset ${first.offset} (code ${first.error})`);
  }
  return value;
}
