/**
 * Research-Pack für Call 2 — Backend-Ergebnis strukturiert.
 * Kriterien-Scores (z. B. 5/6), Shortlist, Ambient (Sunset/Wetter).
 */

import type { PitchCandidate, PitchWish } from '../../pitch/types';

export type CriteriaId =
  | 'dish_specialty'
  | 'view_elbblick'
  | 'sunset_view'
  | 'open_at_visit'
  | 'budget_fit'
  | 'diet_fit'
  | 'timeline_nearby'
  | 'hard_match'
  | 'rating_ok'
  | 'distance_ok';

export type CriteriaHit = {
  id: CriteriaId | string;
  label: string;
  met: boolean;
  note?: string;
};

export type ShortlistEntry = {
  rank: number;
  name: string;
  lat?: number;
  lng?: number;
  metCount: number;
  totalCriteria: number;
  criteria: CriteriaHit[];
  whyMissing: string[];
  rating?: number | null;
  distM?: number | null;
  priceHint?: string | null;
  openNow?: boolean | null;
};

export type ResearchPack = {
  /** Call-1 Intent / authorIntent */
  authorIntent: string | null;
  /** Spoken Bridge (Call 2 setzt fort) */
  spokenBridge: string | null;
  /** Ambient facts (Sunset, Wetter, …) */
  ambient: Record<string, string | number | boolean | null>;
  /** Top-5 Shortlist mit Kriterien */
  shortlist: ShortlistEntry[];
  /** Empfohlene Speak-Picks (Indizes 0-based in shortlist) */
  speakPicks: number[];
  /** Timeline-Hinweis */
  timelineNote: string | null;
  /** Modus */
  mode: 'pitch' | 'flight' | 'chat' | 'nav' | 'plan' | 'cinema';
};

const LABEL: Record<string, string> = {
  dish_specialty: 'Gericht/Spezialität',
  view_elbblick: 'Elbblick/Aussicht',
  sunset_view: 'Sonnenuntergang sichtbar',
  open_at_visit: 'Offen zum Besuch',
  budget_fit: 'Budget',
  diet_fit: 'Ernährung',
  timeline_nearby: 'Nah am Tagesplan',
  hard_match: 'Hard-Match',
  rating_ok: 'Bewertung',
  distance_ok: 'Entfernung',
};

function blobOf(c: PitchCandidate): string {
  return `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')}`
    .toLowerCase();
}

/** Kriterien aus Wishes + Ambient ableiten. */
export function criteriaFromWishes(
  wishes: PitchWish[],
  userText: string,
): Array<{ id: CriteriaId; test: (c: PitchCandidate, visitAtMs: number) => boolean }> {
  const t = `${userText} ${wishes.map((w) => w.text).join(' ')}`.toLowerCase();
  const out: Array<{
    id: CriteriaId;
    test: (c: PitchCandidate, visitAtMs: number) => boolean;
  }> = [];

  if (/pannfisch|steak|döner|doener|sushi|pizza|schnitzel|burger/.test(t)) {
    out.push({
      id: 'dish_specialty',
      test: (c) => {
        const b = blobOf(c);
        if (/pannfisch|pannenfisch/.test(t)) {
          return /pann|fisch/.test(b) || (c.hardEvidence ?? []).length > 0;
        }
        if (/steak/.test(t)) return /steak|grill|fleisch/.test(b);
        if (/döner|doener|kebab/.test(t)) return /döner|doener|kebab|imbiss/.test(b);
        return (c.hardEvidence ?? []).length > 0 || wishes.some((w) => b.includes(w.text.toLowerCase()));
      },
    });
  }
  if (/elbblick|elbe|meerblick|wasserblick|förde|foerde/.test(t)) {
    out.push({
      id: 'view_elbblick',
      test: (c) => /elbblick|elbe|meer|wasser|förde|foerde|blick|view|terrasse/.test(blobOf(c)),
    });
  }
  if (/sonnenuntergang|sunset/.test(t)) {
    out.push({
      id: 'sunset_view',
      test: (c) =>
        /sonnenuntergang|sunset|west|terrasse|elb|meer|blick|rooftop|außen|aussen/.test(
          blobOf(c),
        ),
    });
  }
  out.push({
    id: 'open_at_visit',
    test: (c) => !(c.openNow === false || c.closedOnVisitDay === true),
  });
  if (/günstig|guenstig|budget|billig/.test(t)) {
    out.push({
      id: 'budget_fit',
      test: (c) => c.priceTotalEur == null || c.priceTotalEur < 80,
    });
  }
  if (/vegan|vegetar/.test(t)) {
    out.push({
      id: 'diet_fit',
      test: (c) => /vegan|vegetar/.test(blobOf(c)),
    });
  }
  out.push({
    id: 'hard_match',
    test: (c) => (c.hardEvidence ?? []).length >= 1,
  });
  out.push({
    id: 'rating_ok',
    test: (c) => (c.rating ?? 0) >= 4.0 && (c.ratingCount ?? 0) >= 20,
  });
  out.push({
    id: 'distance_ok',
    test: (c) => (c.distFromAnchorM ?? 99_000) < 15_000,
  });
  return out;
}

export function scoreCandidateCriteria(
  c: PitchCandidate,
  wishes: PitchWish[],
  userText: string,
  visitAtMs: number,
): { criteria: CriteriaHit[]; metCount: number; total: number } {
  const defs = criteriaFromWishes(wishes, userText);
  const criteria: CriteriaHit[] = defs.map((d) => {
    const met = d.test(c, visitAtMs);
    return {
      id: d.id,
      label: LABEL[d.id] || d.id,
      met,
      note: met ? undefined : 'nicht belegt',
    };
  });
  const metCount = criteria.filter((x) => x.met).length;
  return { criteria, metCount, total: criteria.length };
}

export function buildDiningResearchPack(opts: {
  authorIntent: string | null;
  spokenBridge: string | null;
  userText: string;
  wishes: PitchWish[];
  visitAtMs: number;
  shortlist: PitchCandidate[];
  ambient?: Record<string, string | number | boolean | null>;
  timelineNote?: string | null;
}): ResearchPack {
  const entries: ShortlistEntry[] = opts.shortlist.slice(0, 5).map((c, i) => {
    const scored = scoreCandidateCriteria(
      c,
      opts.wishes,
      opts.userText,
      opts.visitAtMs,
    );
    return {
      rank: i + 1,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      metCount: scored.metCount,
      totalCriteria: scored.total,
      criteria: scored.criteria,
      whyMissing: scored.criteria.filter((x) => !x.met).map((x) => x.label),
      rating: c.rating,
      distM: c.distFromAnchorM ?? null,
      priceHint:
        c.dishPriceHint ||
        (c.priceTotalEur != null ? `${Math.round(c.priceTotalEur)}€` : null),
      openNow: c.openNow ?? null,
    };
  });

  // Speak picks: beste metCount, bei Gleichstand Ranking-Reihenfolge; Call 2 darf umranken
  const sorted = [...entries].sort((a, b) => {
    if (b.metCount !== a.metCount) return b.metCount - a.metCount;
    return a.rank - b.rank;
  });
  const speakPicks = sorted.slice(0, 2).map((e) => e.rank - 1);

  return {
    authorIntent: opts.authorIntent,
    spokenBridge: opts.spokenBridge,
    ambient: opts.ambient ?? {},
    shortlist: entries,
    speakPicks,
    timelineNote: opts.timelineNote ?? null,
    mode: 'pitch',
  };
}

export function formatResearchPackForPrompt(pack: ResearchPack): string {
  const ambient =
    Object.keys(pack.ambient).length > 0
      ? `AMBIENT: ${JSON.stringify(pack.ambient)}`
      : 'AMBIENT: —';
  const lines = pack.shortlist.map((e) => {
    const miss = e.whyMissing.length
      ? ` fehlt: ${e.whyMissing.join(', ')}`
      : '';
    return `${e.rank}) ${e.name} — ${e.metCount}/${e.totalCriteria} Kriterien${miss}` +
      (e.rating != null ? ` · ★${e.rating}` : '') +
      (e.distM != null ? ` · ${Math.round(e.distM)}m` : '');
  });
  const picks = pack.speakPicks
    .map((i) => pack.shortlist[i]?.name)
    .filter(Boolean)
    .join(' + ');
  return [
    '=== RESEARCH_PACK (Backend → Call 2) ===',
    pack.authorIntent ? `INTENT: ${pack.authorIntent}` : '',
    pack.spokenBridge
      ? `BRIDGE (schon gesprochen): ${pack.spokenBridge}`
      : 'BRIDGE: keine',
    ambient,
    pack.timelineNote ? `TIMELINE: ${pack.timelineNote}` : 'TIMELINE: —',
    `MODE: ${pack.mode}`,
    'SHORTLIST (Top 5):',
    ...lines,
    `BACKEND_SPEAK_HINT: ${picks || '—'}`,
    'Call 2 darf Speak-Picks umranken (Preis-Leistung, Blick) — nur aus SHORTLIST, nichts erfinden. Favorit + Alternative pitchen.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Tagesplan-Gerüst für Call 2 / Walk — keine Venue-Erfindung. */
export function buildDayPlanResearchPack(opts: {
  authorIntent: string | null;
  spokenBridge: string | null;
  destCity: string | null;
  slots: Array<{ title: string; estimatedTime?: string | null; kind?: string }>;
  ambient?: Record<string, string | number | boolean | null>;
}): ResearchPack {
  const lines = opts.slots.slice(0, 8).map((s, i) => ({
    rank: i + 1,
    name: `${s.estimatedTime ? `${s.estimatedTime} · ` : ''}${s.title}`,
    metCount: 1,
    totalCriteria: 1,
    criteria: [
      {
        id: s.kind || 'slot',
        label: s.kind || 'slot',
        met: true,
      },
    ],
    whyMissing: [] as string[],
  }));
  return {
    authorIntent: opts.authorIntent,
    spokenBridge: opts.spokenBridge,
    ambient: {
      dest_city: opts.destCity,
      ...(opts.ambient ?? {}),
    },
    shortlist: lines,
    speakPicks: [0],
    timelineNote: `Walk: Frühstück → Abend → Landmarke Q&A → Tour → Stay/Heim`,
    mode: 'plan',
  };
}
