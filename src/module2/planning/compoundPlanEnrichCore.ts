/**
 * Compound-Plan: Wunsch ↔ Fanout-Fakten (Node-smoke-sicher, kein RN).
 */

import type { IngestOpenWish } from './planningTypes';

export type CompoundFactHint = {
  placeName: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  /** Kurze belegte Notiz (Preis, Höhe, …) */
  note: string | null;
  factText: string;
  lane: string | null;
  jobHint: string | null;
};

const WISH_FACT_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bpann|fisch|elbblick|\bessen\b|\babendessen\b/i, /\bpann|fisch|restaurant|dining|elbblick/i],
  [/\bmichel\b/i, /\bmichel|michaelis|kirch/i],
  [/\bfrühstück|fruehstueck/i, /\bfrühstück|fruehstueck|breakfast|cafe|café/i],
  [/\btour\b|erkunden|highlight/i, /\btour|sightseeing|highlight|sight/i],
  [/\bsonnenuntergang|sunset\b/i, /\bsonnenuntergang|sunset|abend|wetter/i],
  [/\banreise|abfahrt|\blos\b|bahn|zug/i, /\bbahn|zug|reise|anreise|transit|s-?bahn|abfahrt/i],
];

const LANE_WISH: Array<[RegExp, RegExp]> = [
  [/dining|places|gastro/i, /\bpann|fisch|elbblick|abendessen|\bessen\b/i],
  [/pack|poi|knowledge|fact/i, /\bmichel|kirch|turm|\bhoch\b|teuer|was\s+ist/i],
  [/transit|nav|mobility/i, /\banreise|abfahrt|\blos\b|bahn|zug/i],
  [/weather|umwelt/i, /\bsonnenuntergang|sunset|outfit|wetter/i],
  [/sight|tour|pitch/i, /\btour|highlight|sight/i],
];

export function wishMatchesCompoundFact(
  wish: IngestOpenWish,
  opts: {
    placeName: string;
    factText: string;
    userText: string;
    lane?: string | null;
    jobHint?: string | null;
  },
): boolean {
  return scoreWishFactMatch(wish, opts) > 0;
}

export function scoreWishFactMatch(
  wish: IngestOpenWish,
  opts: {
    placeName: string;
    factText: string;
    userText: string;
    lane?: string | null;
    jobHint?: string | null;
  },
): number {
  const blob = `${wish.title} ${wish.context}`.toLowerCase();
  // Catch-all „Stadt erkunden“ nur als letzter Fallback
  const exploreDump =
    wish.priority === 6 ||
    /\berkunden\b/i.test(wish.title) ||
    blob.length > 160;

  let score = 0;
  const place = opts.placeName.trim().toLowerCase();
  if (place.length >= 4) {
    const needle = place.slice(0, Math.min(place.length, 24));
    if (blob.includes(needle)) score += 10;
    // Teil-Tokens aus Place (Elbblick, Michaelis)
    for (const tok of place.split(/[^a-zäöüß0-9]+/i).filter((x) => x.length >= 5)) {
      if (blob.includes(tok)) score += 6;
    }
  }
  // Nur Fakt-Inhalt — nicht die volle User-Äußerung (sonst matcht alles).
  const factLow =
    `${opts.factText} ${opts.placeName} ${opts.jobHint ?? ''} ${opts.lane ?? ''}`.toLowerCase();
  for (const [wishRx, factRx] of WISH_FACT_PAIRS) {
    if (wishRx.test(blob) && factRx.test(factLow)) score += 5;
  }
  const laneBlob = `${opts.lane ?? ''} ${opts.jobHint ?? ''}`;
  for (const [laneRx, wishRx] of LANE_WISH) {
    if (laneRx.test(laneBlob) && wishRx.test(blob)) score += 4;
  }
  if (exploreDump) score = Math.min(score, 3);
  return score;
}

/** Preise / Höhe / Eintritt aus Speech/Bullets — nur belegte Muster. */
export function extractFactNotes(text: string): string[] {
  const t = text || '';
  const notes: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const n = s.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    notes.push(n);
  };
  for (const m of t.matchAll(
    /(\d{2,4}(?:[.,]\d{1,2})?\s*(?:m|meter|€|euro|eur))/giu,
  )) {
    if (m[1]) push(m[1]);
  }
  for (const m of t.matchAll(
    /\b(?:eintritt|höhe|hoehe|preis)[:\s]+([^.\n]{3,40})/giu,
  )) {
    if (m[0]) push(String(m[0]).slice(0, 60));
  }
  for (const m of t.matchAll(/\bca\.?\s*\d{2,3}\s*m\b/giu)) {
    if (m[0]) push(m[0]);
  }
  return notes.slice(0, 3);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/** Hint aus Agent-/Task-Meta + Buttons + Draft. */
export function hintFromFactSource(opts: {
  draftText?: string;
  bullets?: string[];
  meta?: Record<string, unknown> | null;
  buttons?: Array<{ payload?: unknown }>;
  lane?: string | null;
  jobHint?: string | null;
  taskId?: string | null;
}): CompoundFactHint | null {
  const meta = opts.meta ?? {};
  let placeName =
    str(meta.placeName) ||
    str(meta.destName) ||
    str(meta.venueName) ||
    str(meta.name) ||
    '';
  let lat = num(meta.destLat) ?? num(meta.lat);
  let lng = num(meta.destLng) ?? num(meta.lng);
  let address =
    str(meta.address) ||
    str(meta.formattedAddress) ||
    str(meta.vicinity);

  for (const b of opts.buttons ?? []) {
    const p = b.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') continue;
    if (p.kind === 'navigate') {
      const nLat = num(p.lat);
      const nLng = num(p.lng);
      if (nLat != null && nLng != null) {
        lat = lat ?? nLat;
        lng = lng ?? nLng;
      }
      const label = str(p.label);
      if (label && !placeName) placeName = label;
    }
  }

  const factText = [opts.draftText, ...(opts.bullets ?? [])]
    .filter(Boolean)
    .join('\n')
    .trim();
  const notes = extractFactNotes(factText);
  const priceMeta = num(meta.priceEur) ?? num(meta.price);
  if (priceMeta != null) notes.unshift(`${priceMeta} €`);

  if (!placeName && (lat == null || lng == null) && notes.length === 0) {
    return null;
  }

  return {
    placeName,
    lat,
    lng,
    address,
    note: notes.length ? notes.join(' · ') : null,
    factText: factText.slice(0, 800),
    lane: opts.lane ?? null,
    jobHint: opts.jobHint ?? opts.taskId ?? null,
  };
}

/**
 * Merged Fanout-Draft oft als `### task (lane)\n…` — Abschnitte als eigene Hints.
 */
export function hintsFromMergedDraft(
  draftText: string,
  meta?: Record<string, unknown> | null,
): CompoundFactHint[] {
  const t = draftText || '';
  const sections = t
    .split(/(?:^|\n)###\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: CompoundFactHint[] = [];
  if (sections.length <= 1) {
    const one = hintFromFactSource({ draftText: t, meta: meta ?? null });
    if (one) out.push(one);
    return out;
  }
  for (const sec of sections) {
    const head = sec.split('\n')[0] || '';
    const laneMatch = head.match(/\(([^)]+)\)/);
    const lane = laneMatch?.[1]?.split(',')[0]?.trim() ?? null;
    const taskId = head.replace(/\([^)]*\)/g, '').trim() || null;
    const body = sec.slice(head.length).trim();
    const h = hintFromFactSource({
      draftText: body,
      lane,
      taskId,
      meta: null,
    });
    if (h) out.push(h);
  }
  const top = hintFromFactSource({ draftText: '', meta: meta ?? null });
  if (top && (top.lat != null || top.placeName)) {
    const dup = out.some(
      (h) =>
        h.lat === top.lat &&
        h.lng === top.lng &&
        h.placeName === top.placeName,
    );
    if (!dup) out.unshift(top);
  }
  return out;
}

/**
 * Hint-zentriert: jeder Fakt → bester Wunsch (kein Spray auf Anreise/Frühstück).
 */
export function applyCompoundFactHintsToWishes(
  wishes: IngestOpenWish[],
  hints: CompoundFactHint[],
  _userText: string,
): { wishes: IngestOpenWish[]; changed: boolean } {
  if (!wishes.length || !hints.length) {
    return { wishes, changed: false };
  }

  const next = wishes.map((w) => ({ ...w }));
  const claimed = new Set<number>();
  let changed = false;

  const rankedHints = [...hints].sort((a, b) => {
    const ac = a.lat != null && a.lng != null ? 1 : 0;
    const bc = b.lat != null && b.lng != null ? 1 : 0;
    if (bc !== ac) return bc - ac;
    return (b.note ? 1 : 0) - (a.note ? 1 : 0);
  });

  for (const h of rankedHints) {
    let bestIdx = -1;
    let bestScore = 0;
    next.forEach((w, i) => {
      if (claimed.has(i)) return;
      const score = scoreWishFactMatch(w, {
        placeName: h.placeName,
        factText: h.factText,
        userText: '',
        lane: h.lane,
        jobHint: h.jobHint,
      });
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    // Mindest-Score: Lane/Paar oder Place-Token
    if (bestIdx < 0 || bestScore < 5) continue;

    const w = next[bestIdx]!;
    claimed.add(bestIdx);

    const hasCoords =
      typeof h.lat === 'number' &&
      typeof h.lng === 'number' &&
      Number.isFinite(h.lat) &&
      Number.isFinite(h.lng);
    const canSetCoords = hasCoords && (w.lat == null || w.lng == null);
    const noteBits: string[] = [];
    if (
      h.placeName &&
      !w.context.toLowerCase().includes(h.placeName.toLowerCase().slice(0, 12))
    ) {
      noteBits.push(h.placeName);
    }
    if (h.note && !w.context.includes(h.note.slice(0, 12))) {
      noteBits.push(h.note);
    }
    if (!canSetCoords && !noteBits.length && !h.address) continue;

    changed = true;
    const context = noteBits.length
      ? `${w.context}; ${noteBits.join(' · ')}`.slice(0, 280)
      : w.context;
    const completeness =
      canSetCoords || (w.lat != null && w.lng != null)
        ? (0 as const)
        : w.estimatedTime || noteBits.length
          ? (1 as const)
          : w.completeness;

    next[bestIdx] = {
      ...w,
      ...(canSetCoords ? { lat: h.lat, lng: h.lng } : {}),
      address: h.address ?? w.address ?? null,
      context,
      completeness,
    };
  }

  return { wishes: next, changed };
}
