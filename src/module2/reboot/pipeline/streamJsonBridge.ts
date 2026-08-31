/**
 * Extrahiert "bridge" aus partiellem Call-1-JSON-Stream (Key 1).
 */

export type BridgeExtract = {
  value: string | null;
  complete: true;
};

/** @returns null wenn Feld noch nicht lesbar */
export function tryExtractBridgeField(acc: string): BridgeExtract | null {
  const key = '"bridge"';
  const idx = acc.indexOf(key);
  if (idx < 0) return null;
  let i = idx + key.length;
  while (i < acc.length && /\s/.test(acc[i]!)) i += 1;
  if (acc[i] !== ':') return null;
  i += 1;
  while (i < acc.length && /\s/.test(acc[i]!)) i += 1;
  if (acc.slice(i, i + 4) === 'null') {
    return { value: null, complete: true };
  }
  if (acc[i] !== '"') return null;
  i += 1;
  let out = '';
  let escaped = false;
  while (i < acc.length) {
    const ch = acc[i]!;
    if (escaped) {
      if (ch === 'n') out += '\n';
      else if (ch === 't') out += '\t';
      else if (ch === 'r') out += '\r';
      else out += ch;
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      return { value: out.replace(/\s+/g, ' ').trim(), complete: true };
    }
    out += ch;
    i += 1;
  }
  return null;
}
