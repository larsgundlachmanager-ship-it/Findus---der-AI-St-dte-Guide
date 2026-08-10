/**
 * Satz-Extraktion für LLM→TTS.
 * Wichtig: KEINE Splits an Initialen (C. Jensen), Abkürzungen (Dr., z.B.) oder Dezimalzahlen.
 */

import { splitTextToStreamingChunks } from '../audio/punctuationChunker';

const SENTENCE_END_CHAR = /[.!?]/;

/** Bekannte DE/EN-Kürzel vor dem Punkt. */
const ABBREV_BEFORE_DOT =
  /\b(?:Dr|Prof|Mr|Mrs|Ms|Nr|Tel|Tel\.|bzw|ca|inkl|zzgl|usw|etc|vgl|Abs|Art|St|Str|Jr|Sr|Co|Inc|Ltd|z|u|d|m|s|hr|min|sek|Jh|Jhdt)\s*$/i;

/** Einzelbuchstaben-Initiale: „C.“ / „A.“ */
const INITIAL_BEFORE_DOT = /(?:^|[\s(„"'])[A-ZÄÖÜ]\s*$/;

function isProtectedDot(text: string, dotIndex: number): boolean {
  const before = text.slice(0, dotIndex);
  const after = text.slice(dotIndex + 1);

  // Initiale: „Coiffeur C.“ / „van C.“
  if (INITIAL_BEFORE_DOT.test(before)) return true;

  // Abkürzungen: Dr. Prof. z.B. usw.
  if (ABBREV_BEFORE_DOT.test(before)) return true;

  // Mehrpunkt-Kürzel: z. B. / u. a. / d. h.
  if (/\b[a-zäöü]\s*$/i.test(before) && /^\s*[a-zäöü]\./i.test(after)) {
    return true;
  }

  // Dezimalzahl: 3.5 / 12, nicht Satzende
  if (/\d$/.test(before) && /^\d/.test(after.trimStart())) return true;

  // Ellipsis …
  if (before.endsWith('..') || after.startsWith('.')) return true;

  return false;
}

/**
 * Teilt Text an echten Satzenden (. ! ?), schützt Initialen/Abkürzungen.
 */
export function splitIntoSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (!SENTENCE_END_CHAR.test(ch)) continue;
    if (ch === '.' && isProtectedDot(clean, i)) continue;

    // Satzende nur, wenn danach Leerzeichen/Ende oder schließendes Anführungszeichen+Space
    const next = clean[i + 1] ?? '';
    if (next && !/[\s"'»]/.test(next)) continue;

    const piece = clean.slice(start, i + 1).trim();
    if (piece) parts.push(piece);
    while (i + 1 < clean.length && /\s/.test(clean[i + 1]!)) i += 1;
    start = i + 1;
  }

  const tail = clean.slice(start).trim();
  if (tail) parts.push(tail);

  return mergeBrokenFragments(parts);
}

/** Klebt „… C.“ + „Jensen.“ wieder zusammen. */
function mergeBrokenFragments(parts: string[]): string[] {
  if (parts.length <= 1) return parts;
  const out: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    let cur = parts[i]!;
    while (i + 1 < parts.length) {
      const next = parts[i + 1]!;
      const curT = cur.trim();
      const nextT = next.trim();

      // Initiale am Ende + Name danach
      if (
        /(?:^|[\s(])[A-ZÄÖÜ]\.$/.test(curT) &&
        /^[A-ZÄÖÜÄÖÜ][\p{L}'-]/u.test(nextT)
      ) {
        cur = `${curT} ${nextT}`.replace(/\s+/g, ' ');
        i += 1;
        continue;
      }

      // Sehr kurzes Fragment ohne !/? (oft Abkürzungs-Fehlsplit)
      if (
        curT.length < 28 &&
        /\.$/.test(curT) &&
        !/[!?]$/.test(curT) &&
        nextT.length > 0
      ) {
        cur = `${curT} ${nextT}`.replace(/\s+/g, ' ');
        i += 1;
        continue;
      }

      break;
    }
    out.push(cur.replace(/\s+/g, ' ').trim());
  }

  return out.filter(Boolean);
}

/** Nimmt Rohpuffer, gibt abgeschlossene Sätze + Rest zurück. */
export function extractCompletedSentences(buffer: string): {
  sentences: string[];
  rest: string;
} {
  const sentences: string[] = [];
  let rest = buffer;
  let searchFrom = 0;

  while (searchFrom < rest.length) {
    const slice = rest.slice(searchFrom);
    let found = -1;
    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i]!;
      if (!SENTENCE_END_CHAR.test(ch)) continue;
      const abs = searchFrom + i;
      if (ch === '.' && isProtectedDot(rest, abs)) continue;
      const next = rest[abs + 1] ?? '';
      if (next && !/[\s"'»]/.test(next)) continue;
      found = i;
      break;
    }
    if (found < 0) break;

    const end = searchFrom + found + 1;
    const candidate = rest.slice(0, end).trim();
    rest = rest.slice(end).replace(/^\s+/, '');
    searchFrom = 0;
    if (candidate.length > 0) sentences.push(candidate);
  }

  return {
    sentences: mergeBrokenFragments(sentences),
    rest,
  };
}

/** Teilt Text an Satzenden und — für schnellen TTS-Start — auch an Kommas. */
export function splitForFastTts(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    let isSplit = false;

    if (SENTENCE_END_CHAR.test(ch)) {
      if (ch === '.' && isProtectedDot(clean, i)) continue;
      const next = clean[i + 1] ?? '';
      if (next && !/[\s"'»]/.test(next)) continue;
      isSplit = true;
    } else if (ch === ',' && i - start >= 14) {
      isSplit = true;
    }

    if (!isSplit) continue;

    const piece = clean.slice(start, i + 1).trim();
    if (piece) parts.push(piece);
    while (i + 1 < clean.length && /\s/.test(clean[i + 1]!)) i += 1;
    start = i + 1;
  }

  const tail = clean.slice(start).trim();
  if (tail) parts.push(tail);

  return mergeBrokenFragments(parts);
}

/** Bekannten Volltext satzweise yielden (Offline / fertige Antwort). */
export async function* sentencesFromFullText(
  text: string,
): AsyncGenerator<string, void, unknown> {
  const parts = splitTextToStreamingChunks(text);
  if (parts.length > 0) {
    for (const p of parts) {
      if (p.trim()) yield p.trim();
    }
    return;
  }
  const fallback = text.replace(/\s+/g, ' ').trim();
  if (fallback) yield fallback;
}

/**
 * Token-/Partial-Stream → Satz-Stream.
 */
export async function* sentencesFromPartials(
  partials: AsyncIterable<string>,
  options?: { isDelta?: boolean },
): AsyncGenerator<string, void, unknown> {
  let buffer = '';
  const isDelta = options?.isDelta ?? false;

  for await (const piece of partials) {
    if (!piece) continue;
    buffer = isDelta ? buffer + piece : piece;
    const { sentences, rest } = extractCompletedSentences(buffer);
    buffer = rest;
    for (const s of sentences) yield s;
  }

  const tail = buffer.trim();
  if (tail) yield tail;
}
