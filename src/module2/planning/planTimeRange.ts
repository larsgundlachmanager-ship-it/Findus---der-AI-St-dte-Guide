/**
 * HH:mm-Zeitspannen aus User-/LLM-Text (von–bis).
 */

export function normalizeHmLoose(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isFinite(h) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** „14–20“, „von 10 bis 12 Uhr“, „10:00-12:00“ */
export function parseHmRangeFromText(
  text: string,
): { start: string; end: string } | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(
    /\b(?:von\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:uhr\s*)?(?:bis|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?\b/i,
  );
  if (!m) return null;
  const start = normalizeHmLoose(
    `${m[1]}${m[2] != null ? `:${m[2]}` : ''}`,
  );
  const end = normalizeHmLoose(
    `${m[3]}${m[4] != null ? `:${m[4]}` : ''}`,
  );
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const sMin = sh! * 60 + sm!;
  const eMin = eh! * 60 + em!;
  if (eMin <= sMin) return null;
  return { start, end };
}

export function durationMinFromHmRange(
  startHm: string | null | undefined,
  endHm: string | null | undefined,
): number | null {
  const a = normalizeHmLoose(startHm);
  const b = normalizeHmLoose(endHm);
  if (!a || !b) return null;
  const [sh, sm] = a.split(':').map(Number);
  const [eh, em] = b.split(':').map(Number);
  const mins = eh! * 60 + em! - (sh! * 60 + sm!);
  if (mins < 5 || mins > 16 * 60) return null;
  return mins;
}
