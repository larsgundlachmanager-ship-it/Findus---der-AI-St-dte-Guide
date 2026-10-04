/**
 * Event-Pitch Quota — rein (Ambient + Venue-Walk-By teilen Fenster).
 */

/** Mindestens so lange zwischen zwei ungefragten Event-Ansagen. */
export const EVENT_PITCH_COOLDOWN_MS = 2 * 60 * 60_000;

/** Max. Ansagen im Fenster — 1 = nur alle 2 Stunden. */
export const MAX_EVENT_PITCHES_PER_WINDOW = 1;

export type EventPitchRecord = {
  atMs: number;
  venueName: string;
  offerKey: string;
};

export type EventPitchQuotaMemory = {
  recentPitches: EventPitchRecord[];
};

export function normalizeEventPitchVenue(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

/** Stabiler Schlüssel für „derselbe Vorschlag“ (nicht nur Ort). */
export function buildEventOfferKey(input: {
  whenLabel?: string | null;
  titleOrHook?: string | null;
  venueName?: string | null;
}): string {
  const when = (input.whenLabel || '').trim().toLowerCase();
  let body = (input.titleOrHook || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const venue = normalizeEventPitchVenue(input.venueName || '');
  if (venue && body.startsWith(venue)) {
    body = body.slice(venue.length).replace(/^[\s:—–-]+/, '').trim();
  }
  return `${when}|${body.slice(0, 96)}`;
}

export function pitchesInEventWindow(
  memory: EventPitchQuotaMemory | null | undefined,
  nowMs: number,
): EventPitchRecord[] {
  const cutoff = nowMs - EVENT_PITCH_COOLDOWN_MS;
  return (memory?.recentPitches ?? []).filter((p) => p.atMs >= cutoff);
}

export function eventPitchQuotaExhausted(
  memory: EventPitchQuotaMemory | null | undefined,
  nowMs: number,
): boolean {
  return pitchesInEventWindow(memory, nowMs).length >= MAX_EVENT_PITCHES_PER_WINDOW;
}

export function isDuplicateEventPitch(
  memory: EventPitchQuotaMemory | null | undefined,
  nowMs: number,
  candidate: { venueName: string; offerKey: string },
): boolean {
  const venue = normalizeEventPitchVenue(candidate.venueName);
  const offer = candidate.offerKey.trim().toLowerCase();
  for (const p of pitchesInEventWindow(memory, nowMs)) {
    if (normalizeEventPitchVenue(p.venueName) === venue) return true;
    if (offer.length > 3 && p.offerKey.trim().toLowerCase() === offer) {
      return true;
    }
  }
  return false;
}

export function canEventPitch(
  memory: EventPitchQuotaMemory | null | undefined,
  nowMs: number,
  candidate: { venueName: string; offerKey: string },
): { ok: true } | { ok: false; reason: 'quota' | 'duplicate' } {
  if (eventPitchQuotaExhausted(memory, nowMs)) {
    return { ok: false, reason: 'quota' };
  }
  if (isDuplicateEventPitch(memory, nowMs, candidate)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true };
}

export function normalizePitchRecords(raw: unknown): EventPitchRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: EventPitchRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<EventPitchRecord>;
    if (typeof r.atMs !== 'number' || !Number.isFinite(r.atMs)) continue;
    const venueName =
      typeof r.venueName === 'string' ? r.venueName.trim().slice(0, 80) : '';
    const offerKey =
      typeof r.offerKey === 'string' ? r.offerKey.trim().slice(0, 120) : '';
    if (!venueName) continue;
    out.push({
      atMs: r.atMs,
      venueName,
      offerKey: offerKey || buildEventOfferKey({ venueName }),
    });
  }
  return out.sort((a, b) => b.atMs - a.atMs).slice(0, 12);
}

export function migrateLegacyPitches(
  mem: EventPitchQuotaMemory & {
    lastPitchAtMs?: number | null;
    lastPitchName?: string | null;
  },
): EventPitchQuotaMemory & {
  lastPitchAtMs?: number | null;
  lastPitchName?: string | null;
} {
  if (mem.recentPitches.length > 0) return mem;
  if (mem.lastPitchAtMs == null) return mem;
  return {
    ...mem,
    recentPitches: [
      {
        atMs: mem.lastPitchAtMs,
        venueName: (mem.lastPitchName || '').slice(0, 80),
        offerKey: buildEventOfferKey({
          venueName: mem.lastPitchName,
          titleOrHook: mem.lastPitchName,
        }),
      },
    ],
  };
}
