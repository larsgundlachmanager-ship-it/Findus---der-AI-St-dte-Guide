/**
 * Satz-Extraktion für LLM→TTS-Streaming.
 * Liefert fertige Sätze, sobald ., ! oder ? erreicht ist.
 */

const SENTENCE_END = /[.!?]/;

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
    const m = SENTENCE_END.exec(slice);
    if (!m || m.index == null) break;
    const end = searchFrom + m.index + 1;
    const candidate = rest.slice(0, end).trim();
    rest = rest.slice(end).replace(/^\s+/, '');
    searchFrom = 0;
    if (candidate.length > 0) sentences.push(candidate);
  }

  return { sentences, rest };
}

/** Bekannten Volltext satzweise yielden (Offline / fertige Antwort). */
export async function* sentencesFromFullText(
  text: string,
): AsyncGenerator<string, void, unknown> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;

  const parts = clean
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    yield clean;
    return;
  }

  for (const p of parts) {
    yield p;
  }
}

/**
 * Token-/Partial-Stream → Satz-Stream.
 * onPartial liefert wachsenden Gesamttext oder Deltas (isDelta).
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
