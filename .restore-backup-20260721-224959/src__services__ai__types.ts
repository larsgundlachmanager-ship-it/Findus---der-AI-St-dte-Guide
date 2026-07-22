/**
 * Eingangs-Typen für die Prompt-Engine (Findus Narration & Chat).
 */

import type { PoiWithFacts } from '../../db/types';

/** Normalisierte POI-Daten für Prompt-Building (aus DB oder Remote). */
export type PoiData = {
  id: number;
  name: string;
  description: string | null;
  facts: string[];
  openingHoursFacts: string[];
  budgetLevel: 'low' | 'mid' | 'high' | null;
  location: { lat: number; lng: number } | null;
  category: string | null;
};

/** Session-Gedächtnis: bereits besuchte Orte in dieser Tour. */
export type VisitedHistoryEntry = {
  poiId: number;
  name: string;
  /** 1–3 Kernfakten, die Findus bereits genannt hat */
  keyFacts: string[];
  visitedAt: number;
};

export type VisitedHistory = {
  entries: VisitedHistoryEntry[];
};

/** Live-Kontext zur aktuellen Uhrzeit. */
export type PoiLiveContext = {
  nowIso: string;
  weekdayDe: string;
  timeHm: string;
  hoursStatus: OpeningHoursStatus;
  hoursHint: string | null;
};

export type OpeningHoursStatus =
  | 'open'
  | 'closed'
  | 'opening_soon'
  | 'closing_soon'
  | 'unknown';

/** Kanonische Persönlichkeiten (Onboarding + Voice). */
export type FindusPersonality =
  | 'gen_z'
  | 'historiker'
  | 'poet'
  | 'erzaehler'
  | 'prinzessin'
  | 'dorfaeltester'
  | 'party'
  | 'fuersorglich'
  | 'mittelalter'
  | 'coach'
  | 'lokalpatriot'
  | 'detektiv'
  | 'reiseblogger'
  | 'ruhig'
  | 'standard'
  | 'default';

/** Kanonische Tonalitäten aus Onboarding. */
export type FindusTone =
  | 'ernst'
  | 'kumpelhaft'
  | 'humorvoll'
  | 'sarkastisch'
  | 'herold'
  | 'maerchen'
  | 'default';

export type YearsPreference = 'wenig' | 'neutral' | 'viele';

export type PromptStyleSettings = {
  personality: FindusPersonality;
  tone: FindusTone;
  voiceId: string;
  personalityLabel: string;
  toneLabel: string;
};

export type PoiUserContext = {
  personality: FindusPersonality;
  personalityLabel: string;
  tone: FindusTone;
  toneLabel: string;
  interests: string[];
  interestIds: string[];
  yearsPreference: YearsPreference;
  firstName: string | null;
  cityName: string | null;
};

/** Vollständiger Input für POI-Narrations-Prompts. */
export type PromptBuildInput = {
  userProfile: import('../../types/userProfile').UserProfile;
  poi: PoiData;
  sessionMemory?: VisitedHistory;
  now?: Date;
};

/** Konvertiert DB-POI → PoiData für die Prompt-Engine. */
export function poiWithFactsToPoiData(poi: PoiWithFacts): PoiData {
  const rawFacts = poi.facts.map((f) => f.fact_text.trim());
  const narration = rawFacts.find((t) =>
    /^\[(Erzählung|Narration)\]/i.test(t),
  );
  const categoryFact = rawFacts.find((t) =>
    /^\[Thema:(kategorie|category|typ)/i.test(t),
  );
  const budgetFact = rawFacts.find((t) =>
    /\b(budget|preis|günstig|teuer|preiswert|€)\b/i.test(t),
  );

  let budgetLevel: PoiData['budgetLevel'] = null;
  if (budgetFact) {
    const lower = budgetFact.toLowerCase();
    if (/günstig|preiswert|budget|billig|low/i.test(lower)) budgetLevel = 'low';
    else if (/teuer|premium|high|luxus/i.test(lower)) budgetLevel = 'high';
    else budgetLevel = 'mid';
  }

  const openingHoursFacts = rawFacts.filter((t) =>
    /öffnung|oeffnung|geöffnet|geoeffnet|geschlossen|opening|hours|uhrzeit|mo[–\-]fr/i.test(
      t.toLowerCase(),
    ),
  );

  const categoryMatch = categoryFact?.match(/\[Thema:[^\]]+\]\s*(.+)/i);
  const category = categoryMatch?.[1]?.trim() ?? null;

  return {
    id: poi.id,
    name: poi.name,
    description: narration
      ? narration.replace(/^\[[^\]]+\]\s*/, '').trim()
      : null,
    facts: rawFacts,
    openingHoursFacts,
    budgetLevel,
    location: { lat: poi.lat, lng: poi.lng },
    category,
  };
}
