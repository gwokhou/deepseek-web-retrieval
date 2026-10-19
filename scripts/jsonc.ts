/**
 * Minimal JSONC parsing: strips // and block comments plus trailing commas
 * (string-aware), then delegates to JSON.parse. No dependencies.
 */
export function parseJsonc(text: string): unknown {
  let out = ""
  let inString = false
  let lastComma = -1
  let i = 0

  while (i < text.length) {
    const ch = text[i] as string
    const next = text[i + 1]

    if (inString) {
      out += ch
      if (ch === "\\") {
        if (next !== undefined) {
          out += next
          i++
        }
        i++
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      lastComma = -1
      i++
      continue
    }

    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }

    if (ch === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }

    if (ch === ",") {
      out += ch
      lastComma = out.length - 1
      i++
      continue
    }

    if (ch === "}" || ch === "]") {
      if (lastComma !== -1 && out.slice(lastComma + 1).trim() === "") {
        out = out.slice(0, lastComma)
      }
      lastComma = -1
      out += ch
      i++
      continue
    }

    out += ch
    if (ch.trim() !== "") lastComma = -1
    i++
  }

  return JSON.parse(out)
}
