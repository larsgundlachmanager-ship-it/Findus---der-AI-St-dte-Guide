/**
 * Punctuation-Splitter für Zero-Latency TTS.
 * Splittet früh an . , ! ? : — schützt z. B., Dr., Initialen, Dezimalzahlen.
 */

const SENTENCE_END = /[.!?]/;
const SOFT_SPLIT = /[,:]/;

/** Bekannte DE/EN-Kürzel vor dem Punkt. */
const ABBREV_BEFORE_DOT =
  /\b(?:Dr|Prof|Mr|Mrs|Ms|Nr|Tel|bzw|ca|inkl|zzgl|usw|etc|vgl|Abs|Art|St|Str|Jr|Sr|Co|Inc|Ltd|z|u|d|m|s|hr|min|sek|Jh|Jhdt|bspw|evtl|ggf|max|min|approx)\s*$/i;

const INITIAL_BEFORE_DOT = /(?:^|[\s(„"'])[A-ZÄÖÜ]\s*$/;

/** Mindestlänge vor Komma-Split (außer allererster Hook). */
const MIN_COMMA_LEN = 12;
/** Erster Hook: maximal kurz halten (Time-to-First-Audio). */
export const FIRST_HOOK_MAX_CHARS = 72;
/** Folge-Chunks: ~2 Untertitel-Zeilen — jedes Wort sichtbar, fließender Wechsel. */
export const FOLLOW_CHUNK_TARGET = 90;

export function isProtectedDot(text: string, dotIndex: number): boolean {
  const before = text.slice(0, dotIndex);
  const after = text.slice(dotIndex + 1);

  if (INITIAL_BEFORE_DOT.test(before)) return true;
  if (ABBREV_BEFORE_DOT.test(before)) return true;

  // Mehrpunkt-Kürzel: z. B. / u. a. / d. h. / z.B.
  if (/\b[a-zäöü]\s*$/i.test(before) && /^\s*[a-zäöü]\.?/i.test(after)) {
    return true;
  }
  // z.B. ohne Leerzeichen
  if (/z$/i.test(before.trimEnd()) && /^B\b/i.test(after.trimStart())) {
    return true;
  }

  // Dezimal: 3.5
  if (/\d$/.test(before) && /^\d/.test(after.trimStart())) return true;

  // Ellipsis …
  if (before.endsWith('..') || after.startsWith('.')) return true;

  return false;
}

function isProtectedComma(text: string, commaIndex: number): boolean {
  const before = text.slice(0, commaIndex);
  const after = text.slice(commaIndex + 1);
  // 1,5 / 12,000
  if (/\d$/.test(before) && /^\d/.test(after.trimStart())) return true;
  return false;
}

function isProtectedColon(text: string, colonIndex: number): boolean {
  const before = text.slice(0, colonIndex);
  const after = text.slice(colonIndex + 1);
  // Uhrzeit 8:30
  if (/\d$/.test(before) && /^\d/.test(after.trimStart())) return true;
  return false;
}

function canSplitAt(
  text: string,
  i: number,
  start: number,
  isFirstChunk: boolean,
): boolean {
  const ch = text[i]!;
  if (SENTENCE_END.test(ch)) {
    if (ch === '.' && isProtectedDot(text, i)) return false;
    const next = text[i + 1] ?? '';
    if (next && !/[\s"'»)\]]/.test(next)) return false;
    return true;
  }
  if (SOFT_SPLIT.test(ch)) {
    if (ch === ',' && isProtectedComma(text, i)) return false;
    if (ch === ':' && isProtectedColon(text, i)) return false;
    // Titel-Doppelpunkt („Spider-Man:“ / „Spielzeiten:“) nicht als erster Hook
    if (ch === ':' && isFirstChunk) return false;
    const len = i + 1 - start;
    // Erster Hook: schon ab kurzer Phrase splitten
    if (isFirstChunk && len >= 6) return true;
    if (len >= MIN_COMMA_LEN) return true;
    return false;
  }
  return false;
}

/**
 * Inkrementeller Stream-Chunker: liefert abgeschlossene Phrasen + Restpuffer.
 */
export function extractStreamingChunks(
  buffer: string,
  opts?: { isFirstChunk?: boolean },
): { chunks: string[]; rest: string } {
  let rest = buffer;
  const chunks: string[] = [];
  let isFirst = opts?.isFirstChunk ?? true;

  while (rest.length > 0) {
    let splitAt = -1;
    const target = isFirst ? FIRST_HOOK_MAX_CHARS : FOLLOW_CHUNK_TARGET;

    for (let i = 0; i < rest.length; i++) {
      if (!canSplitAt(rest, i, 0, isFirst)) continue;
      splitAt = i;
      // Erster Hook: sofort am ersten gültigen Satzzeichen
      if (isFirst) break;
      // Folge: bis Target wachsen, aber bei !/?/. hart schneiden
      const ch = rest[i]!;
      if (SENTENCE_END.test(ch) || i + 1 >= target) break;
    }

    if (splitAt < 0) break;

    const piece = rest.slice(0, splitAt + 1).trim();
    rest = rest.slice(splitAt + 1).replace(/^\s+/, '');
    if (piece) {
      chunks.push(piece);
      isFirst = false;
    }
  }

  return { chunks, rest };
}

/**
 * Volltext → Chunk-Liste (Offline / fertige Antworten).
 */
export function splitTextToStreamingChunks(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const { chunks, rest } = extractStreamingChunks(clean, { isFirstChunk: true });
  const out = [...chunks];
  if (rest.trim()) out.push(rest.trim());
  return out.filter(Boolean);
}

/**
 * Token-Stream → frühe Phrase-Chunks (erste Yield = Hook).
 */
export async function* streamingChunksFromTextStream(
  source: AsyncIterable<string>,
): AsyncGenerator<string, void, unknown> {
  let buffer = '';
  let isFirst = true;
  for await (const piece of source) {
    if (!piece) continue;
    buffer += piece;
    const { chunks, rest } = extractStreamingChunks(buffer, {
      isFirstChunk: isFirst,
    });
    buffer = rest;
    for (const c of chunks) {
      yield c;
      isFirst = false;
    }
  }
  const tail = buffer.trim();
  if (tail) yield tail;
}
