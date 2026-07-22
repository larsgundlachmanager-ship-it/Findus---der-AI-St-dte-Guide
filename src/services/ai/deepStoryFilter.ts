/**
 * Deep-Story-Filter: POI-Fakten für Narration bereinigen.
 * Jahreszahlen nach User-Wunsch, Kontakt-Daten weg, Öffnungszeiten situativ.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  buildLiveContext,
  resolveYearsPreference,
  yearToHumanEra,
  type YearsPreference,
} from './promptBuilder';
import type { SessionMemory } from './sessionMemory';

const YEAR_RE = /\b(1[0-9]{3}|20[0-9]{2})\b/g;
const CONTACT_RE =
  /(@[\w.-]+\.\w+)|(\+?\d[\d\s/()-]{6,}\d)|(https?:\/\/\S+)|(\b(e-?mail|telefon|tel\.|fax|www\.)\b)/gi;

export type DeepStoryFact = {
  id: number;
  text: string;
  hasYear: boolean;
  isHours: boolean;
};

export type DeepStoryBundle = {
  poiId: number;
  poiName: string;
  yearsPreference: YearsPreference;
  alreadyVisited: boolean;
  hoursHint: string | null;
  facts: DeepStoryFact[];
  promptFactsBlock: string;
};

function stripPrefix(text: string): string {
  return text
    .replace(
      /^\[(Kurzfakt|Erzählung|Detail|Thema:[^\]]+|Hook|Narration|Topic:[^\]]+)\]\s*/u,
      '',
    )
    .trim();
}

function isHoursRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\[thema:(öffnungs|oeffnungs|opening|zeiten|hours)/i.test(text) ||
    /öffnung|oeffnung|geöffnet|geoeffnet|geschlossen|opening|hours/i.test(
      lower,
    )
  );
}

function isContactDump(text: string): boolean {
  CONTACT_RE.lastIndex = 0;
  return CONTACT_RE.test(text);
}

function scrubContact(text: string): string {
  return text
    .replace(CONTACT_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Bei "wenig": Jahreszahlen → Epochenformulierungen (max. 1 behalten). */
function rewriteYearsForPreference(
  text: string,
  pref: YearsPreference,
  keepYear: boolean,
): string {
  if (pref === 'viele') return text;
  if (pref === 'wenig' && !keepYear) {
    return text
      .replace(YEAR_RE, () => '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (pref === 'wenig' || pref === 'neutral') {
    return text
      .replace(YEAR_RE, (raw) => {
        const y = Number(raw);
        return Number.isFinite(y) ? yearToHumanEra(y) : raw;
      })
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return text;
}

export function filterDeepStoryFacts(
  poi: PoiWithFacts,
  options?: {
    profile?: UserProfile | null;
    sessionMemory?: SessionMemory | null;
    visitedPoiIds?: Iterable<number> | null;
    lastVisitedPoiId?: number | null;
  },
): DeepStoryBundle {
  const profile = options?.profile ?? getCachedUserProfile();
  const yearsPreference = resolveYearsPreference(profile);
  const live = buildLiveContext(poi);

  const visited = new Set(options?.visitedPoiIds ?? []);
  if (options?.lastVisitedPoiId != null) visited.add(options.lastVisitedPoiId);
  for (const e of options?.sessionMemory?.entries ?? []) {
    visited.add(e.poiId);
  }

  const alreadyVisited = visited.has(poi.id);
  const facts: DeepStoryFact[] = [];
  let yearSlotsUsed = 0;
  const maxYears =
    yearsPreference === 'wenig' ? 1 : yearsPreference === 'neutral' ? 2 : 99;

  for (const f of poi.facts) {
    const raw = f.fact_text.trim();
    if (!raw) continue;
    if (isContactDump(raw)) continue;

    const hours = isHoursRelated(raw);
    if (hours && live.hoursStatus === 'open' && !live.hoursHint) continue;

    let text = scrubContact(stripPrefix(raw));
    if (!text) continue;

    const hasYear = YEAR_RE.test(text);
    YEAR_RE.lastIndex = 0;

    if (hasYear) {
      const keep = yearSlotsUsed < maxYears;
      if (keep) yearSlotsUsed += 1;
      text = rewriteYearsForPreference(text, yearsPreference, keep);
      if (!text.replace(/[^\wäöüÄÖÜß]/gi, '').trim()) continue;
    }

    facts.push({
      id: f.id,
      text,
      hasYear,
      isHours: hours,
    });
  }

  // Harter Relevanz-Filter: nur die spannendsten ~20% (min 2, max 4)
  const ranked = [...facts]
    .map((f) => ({ f, score: scoreDeepFact(f) }))
    .sort((a, b) => b.score - a.score);
  const keepN = Math.max(2, Math.min(4, Math.ceil(ranked.length * 0.2) || 1));
  const topFacts = ranked.slice(0, keepN).map((x) => x.f);

  const humanHoursHint =
    live.hoursHint && live.hoursStatus !== 'open'
      ? humanizeHoursHint(live.hoursHint, live.hoursStatus)
      : null;

  const promptFactsBlock =
    topFacts.length === 0
      ? '(keine sprechbaren Fakten nach Filter)'
      : topFacts.map((f) => `- ${f.text}`).join('\n');

  return {
    poiId: poi.id,
    poiName: poi.name,
    yearsPreference,
    alreadyVisited,
    hoursHint: humanHoursHint,
    facts: topFacts,
    promptFactsBlock,
  };
}

function scoreDeepFact(f: DeepStoryFact): number {
  if (f.isHours) return -5;
  let score = 1;
  const lower = f.text.toLowerCase();
  if (
    /(legende|sage|skandal|geheim|überrasch|erstmals|höchste|älteste|einzige|drama|liebe|brand|krieg|mahnmal|kurios|baumeister|architekt)/i.test(
      lower,
    )
  ) {
    score += 8;
  }
  if (/(meter|turm|tonne|aussicht|fahrstuhl|stufen)/i.test(lower)) score += 4;
  if (f.text.length > 80) score += 2;
  if (/^(erbaut|gebaut|baujahr|fläche|räume)/i.test(lower)) score -= 4;
  if (f.hasYear && f.text.length < 40) score -= 2;
  return score;
}

function humanizeHoursHint(
  hint: string,
  status: string,
): string {
  if (/auf/i.test(hint) && /uhr/i.test(hint)) {
    return hint.replace(/^Macht/, 'Hat leider erst').replace(/ auf\.$/, ' offen.');
  }
  if (status === 'closed') {
    return hint.startsWith('Hat') ? hint : `Hat leider gerade zu. ${hint}`;
  }
  return hint;
}
