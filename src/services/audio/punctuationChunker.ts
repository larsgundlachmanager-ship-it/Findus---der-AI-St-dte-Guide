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
/** Erster Hook: am ersten Satzzeichen, Cap gegen Endlos-Token. TTS_SENTENCE_PIPELINE_LOCK */
export const FIRST_HOOK_MAX_CHARS = 100;
/** Folge-Sätze: hart schneiden wenn ein Satz extrem lang ist. */
export const FOLLOW_SENTENCE_MAX = 220;

/** Letztes Wortende vor `max` — für Hard-Cap ohne Satzzeichen. */
function forceSplitAtWord(text: string, max: number): number {
  const limit = Math.min(text.length, Math.max(8, max));
  let cut = limit;
  // Nicht mitten in der PLZ / Hausnummer schneiden
  if (cut < text.length && /\d/.test(text[cut]!) && /\d/.test(text[cut - 1] ?? '')) {
    let end = cut;
    while (end < text.length && /\d/.test(text[end]!)) end += 1;
    if (end - cut <= 5) cut = end;
    else {
      let start = cut;
      while (start > 0 && /\d/.test(text[start - 1]!)) start -= 1;
      if (start >= 8) cut = start;
    }
  }
  const slice = text.slice(0, cut);
  const sp = slice.lastIndexOf(' ');
  if (sp >= 6) return sp; // vor dem Leerzeichen schneiden → Wort bleibt im Rest
  return Math.max(7, cut - 1);
}

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
  // Adresse: „Ulmenallee 23, 25421 Pinneberg“
  if (/^\s*\d{4,5}\b/.test(after)) return true;
  // „Pinneberg, Deutschland“
  if (
    /^\s*(Deutschland|Germany|Österreich|Schweiz|Niederlande|Frankreich|Italien|Polen|Dänemark|Belgien|Tschechien)\b/i.test(
      after,
    )
  ) {
    return true;
  }
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
    // Folge-Clips = ganze Sätze; Komma nur für den Fast-Hook
    if (!isFirstChunk) return false;
    if (ch === ':' && isFirstChunk) return false;
    const len = i + 1 - start;
    if (isFirstChunk && len >= 4) return true;
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
    const target = isFirst ? FIRST_HOOK_MAX_CHARS : FOLLOW_SENTENCE_MAX;

    for (let i = 0; i < rest.length; i++) {
      if (!canSplitAt(rest, i, 0, isFirst)) {
        if (isFirst && i + 1 >= FIRST_HOOK_MAX_CHARS) {
          splitAt = forceSplitAtWord(rest, FIRST_HOOK_MAX_CHARS);
          break;
        }
        if (!isFirst && i + 1 >= FOLLOW_SENTENCE_MAX) {
          splitAt = forceSplitAtWord(rest, FOLLOW_SENTENCE_MAX);
          break;
        }
        continue;
      }
      splitAt = i;
      if (isFirst) {
        if (splitAt + 1 > FIRST_HOOK_MAX_CHARS) {
          splitAt = forceSplitAtWord(rest, FIRST_HOOK_MAX_CHARS);
        }
        break;
      }
      const ch = rest[i]!;
      if (SENTENCE_END.test(ch) || i + 1 >= target) break;
    }

    // Volltext-Pfad: Puffer schon länger als Cap, aber kein Split gefunden
    if (splitAt < 0 && isFirst && rest.length >= FIRST_HOOK_MAX_CHARS) {
      splitAt = forceSplitAtWord(rest, FIRST_HOOK_MAX_CHARS);
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
