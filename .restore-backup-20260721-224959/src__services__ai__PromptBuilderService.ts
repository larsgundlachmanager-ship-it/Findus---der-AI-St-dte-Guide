/**
 * Zentrale Prompt-Engine für Findus: Persona, Live-Kontext, Memory, Data Hygiene.
 * Natürlicher Fließtext für Kokoro — keine künstlichen Pause-/Regie-Injektionen.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile, VoiceId } from '../../types/userProfile';
import { EXPERIENCE_CARDS, CHARACTER_CATEGORIES } from '../../constants/onboardingOptions';
import { getCachedUserProfile } from '../userProfileService';
import {
  type FindusPersonality,
  type FindusTone,
  type OpeningHoursStatus,
  type PoiData,
  type PoiLiveContext,
  type PoiUserContext,
  type PromptBuildInput,
  type PromptStyleSettings,
  type VisitedHistory,
  type YearsPreference,
  poiWithFactsToPoiData,
} from './types';

export type {
  FindusPersonality,
  FindusTone,
  OpeningHoursStatus,
  PoiData,
  PoiLiveContext,
  PoiUserContext,
  PromptBuildInput,
  PromptStyleSettings,
  VisitedHistory,
  VisitedHistoryEntry,
  YearsPreference,
} from './types';
export { poiWithFactsToPoiData } from './types';

// ─── Persona / Tone Mapping ────────────────────────────────────────────────

const PERSONALITY_FROM_CHAR: Record<string, FindusPersonality> = {
  genz_char: 'gen_z',
  historiker_char: 'historiker',
  party: 'party',
  fuersorglich: 'fuersorglich',
  poet: 'poet',
  mittelalter: 'mittelalter',
  coach: 'coach',
  lokalpatriot: 'lokalpatriot',
  detektiv: 'detektiv',
  reiseblogger: 'reiseblogger',
};

const PERSONALITY_FROM_VOICE: Partial<Record<VoiceId, FindusPersonality>> = {
  gen_z: 'gen_z',
  historiker: 'historiker',
  energisch: 'party',
  dorfaeltester: 'dorfaeltester',
  erzaehler: 'erzaehler',
  prinzessin: 'prinzessin',
  standard_m: 'standard',
  standard_w: 'standard',
};

const TONE_FROM_ID: Record<string, FindusTone> = {
  ernst: 'ernst',
  kumpelhaft: 'kumpelhaft',
  humorvoll: 'humorvoll',
  sarkastisch: 'sarkastisch',
  herold: 'herold',
  maerchen: 'maerchen',
};

const PERSONALITY_LABEL: Record<FindusPersonality, string> = {
  gen_z: 'Gen Z',
  historiker: 'Historiker',
  poet: 'Poet',
  erzaehler: 'Erzähler / Blockbuster',
  prinzessin: 'Prinzessin',
  dorfaeltester: 'Dorfältester',
  party: 'Party',
  fuersorglich: 'Fürsorglich',
  mittelalter: 'Mittelalter',
  coach: 'Coach',
  lokalpatriot: 'Lokalpatriot',
  detektiv: 'Detektiv',
  reiseblogger: 'Reiseblogger',
  ruhig: 'Ruhig',
  standard: 'Standard',
  default: 'Guide',
};

const TONE_LABEL: Record<FindusTone, string> = {
  ernst: 'Ernst',
  kumpelhaft: 'Kumpelhaft',
  humorvoll: 'Humorvoll',
  sarkastisch: 'Sarkastisch',
  herold: 'Herold',
  maerchen: 'Märchen',
  default: 'Neutral',
};

// ─── Formatter-Pipelines (Persona-spezifische LLM-Regeln) ──────────────────

const PERSONALITY_FORMATTERS: Record<FindusPersonality, string> = {
  gen_z: `FORMATTER gen_z (strikt):
- Slang: Bro, Safe, No Cap, Vibe, Flexen, Spot, City — natürlich einstreuen.
- Kurze, knackige Sätze. Max. 12 Wörter pro Satz, wenn möglich.
- Lockere Du-Ansprache. Kein Lehrbuchton, kein „Willkommen bei…".
- Emojis im Text VERBOTEN — nur gesprochener Fließtext.`,

  poet: `FORMATTER poet (strikt):
- Verfasse in Reimform (AABB oder ABAB) oder bildgewaltigen Versen.
- Jede Reimzeile endet mit Satzzeichen (, oder !), damit TTS Reime betont.
- Bildhafte Metaphern, Atmosphäre — ohne kitschig zu werden.`,

  erzaehler: `FORMATTER erzaehler / Blockbuster (strikt):
- Trailer-Atmosphäre: tiefgründig, bildgewaltig, cineastisch.
- Kurze dramatische Sätze mit Spannungsbögen — wie ein Film-Trailer.
- Natürliche Interpunktion; keine künstlichen Pause-Einschübe.`,

  prinzessin: `FORMATTER prinzessin (strikt):
- Warm, elegant, leicht märchenhaft — wie eine fürsorgliche Königin.
- Sanfte Formulierungen, achtsame Ansprache. Kein Slang.
- Gelegentlich „mein Lieber/meine Liebe" — sparsam.`,

  historiker: `FORMATTER historiker (strikt):
- Fundiert, präzise, akademisch strukturiert — aber fesselnd erklärt.
- Epochen, Ursache→Wirkung, historische Entwicklungen.
- Jahreszahlen klar nennen (z. B. „1888").
- Kein Slang, keine Flapsigkeit.`,

  dorfaeltester: `FORMATTER dorfaeltester (strikt):
- Rau, rustikal, bedacht. „Na mein Kind", „hör mal zu".
- Natürliche Satzlänge, normale Interpunktion.`,

  party: `FORMATTER party (strikt):
- Energie hoch, einladend. Fokus auf Vibes und Treffpunkte.
- Kurze, mitreißende Sätze.`,

  fuersorglich: `FORMATTER fuersorglich (strikt):
- Warm, achtsam, wie ein guter Freund. Sicherheit und Wohlbefinden.
- Sanfte Formulierungen ohne Bevormundung.`,

  mittelalter: `FORMATTER mittelalter (strikt):
- Leichte mittelalterliche Färbung (Zünfte, Sagen, „damals").
- Klar verständlich auf heutigem Deutsch — kein Kauderwelsch.`,

  coach: `FORMATTER coach (strikt):
- Motivierend, direkt, aktivierend. Kleine Challenges erlaubt.
- „Schaffst du das?" — sparsam, nicht aufdringlich.`,

  lokalpatriot: `FORMATTER lokalpatriot (strikt):
- Stolz auf die Gegend, Insider-Perspektive, echte Nachbarschaft.`,

  detektiv: `FORMATTER detektiv (strikt):
- Neugierig, mit Fragen und Spuren. Orte als kleine Rätsel — ohne Fakten zu erfinden.`,

  reiseblogger: `FORMATTER reiseblogger (strikt):
- Tipps wie für Social Media: Foto-Winkel, Caps, „das musst du posten".`,

  ruhig: `FORMATTER ruhig (strikt):
- Besonnen, klare Sätze. Normale Interpunktion.`,

  standard: `FORMATTER standard (strikt):
- Freundlicher, klarer Tourguide. 3–6 Sätze, gut zum Zuhören unterwegs.`,

  default: `FORMATTER default (strikt):
- Freundlicher, klarer Tourguide. 3–6 Sätze, gut zum Zuhören unterwegs.`,
};

const TONE_FORMATTERS: Record<FindusTone, string> = {
  ernst: 'TON ernst: respektvoll, sachlich, ohne Flachs. Ideal für Gedenkorte.',
  kumpelhaft:
    'TON kumpelhaft: Du-Form, locker, wie mit einem Freund. Humor und Augenzwinkern erlaubt.',
  humorvoll:
    'TON humorvoll: witzige Einschübe erlaubt, ohne die Information zu opfern.',
  sarkastisch:
    'TON sarkastisch: trockener Humor, Ironie, Augenzwinkern — nie verletzend.',
  herold:
    'TON herold: feierlich, große Momente ankündigen — ohne peinlich pathetisch zu werden.',
  maerchen:
    'TON märchen: zauberhafte Formulierungen, sanfte Spannung. Gerne Reim wie beim Poet.',
  default: 'TON neutral: freundlich und klar.',
};

/** Natürlicher Vorlese-Text — keine künstlichen Regie-Zeichen. */
export const TTS_PAUSE_ENGINE_RULES = `## Gesprochener Text (verbindlich)
- Schreibe normalen, flüssigen deutschen Text, wie ein Mensch ihn vorliest.
- Nur normale Interpunktion: Punkt, Komma, Fragezeichen, Ausrufezeichen.
- Keine Ellipsen (...), keine Gedankenstrich-Ketten, keine Meta-Einschübe.
- Jahreszahlen als Zahl schreiben (z. B. 1888); die TTS wandelt sie um.
- Keine Tempo-Anweisungen — Kokoro spricht mit natürlicher Geschwindigkeit.`;

export const NATURAL_SPEECH_RATE_RULE = TTS_PAUSE_ENGINE_RULES;

/** Verbindliche Data-Hygiene & Narrations-Regeln. */
export const POI_NARRATION_SYSTEM_RULES = `## Verhaltensregeln für die gesprochene Orts-Narration (streng)

### Keine stumpfe Daten-Auflistung
- Lies NIEMALS Telefonnummern, E-Mail-Adressen oder komplette Öffnungszeiten-Tabellen vor.
- Keine Websites, IBAN, GPS-Koordinaten oder Verwaltungs-IDs.
- Keine Listen „Fakt 1, Fakt 2" — erzähle flüssig.

### Situations-Check Öffnungszeiten
- Ort geöffnet und schließt nicht bald → Öffnungszeiten WEGLASSEN.
- Macht bald zu → konkret einbauen (z. B. „Schließt gleich um 17 Uhr").
- Hat zu / macht bald auf → knapp (z. B. „Macht um 15:00 Uhr auf" / „Hat leider seit 13:00 Uhr zu").

### Einstiegs-Hook (ERSTER Satz)
- NIEMALS mit „Willkommen bei…", „Dies ist…", „Hier befindet sich…" beginnen.
- Starte mit emotionalem Hook, abgestimmt auf Interessen + Ort + Persona.
- Beispiele Kaffee + Bäcker: Gen Z → „Yo Bro! Na, schon Kaffee-Entzug?"
  Sarkastisch → „Endlich Rettung für deinen niedrigen Koffeinspiegel."
  Dorfältester → „Na mein Kind, riechst du auch diesen frischen Bohnenkaffee?"

### Jahreszahlen-Filter
- yearsPreference „wenig": MAXIMAL 1 Jahreszahl — Rest als Geschichten/Anekdoten.
- yearsPreference „viele": präzise Jahresdaten und historische Entwicklungen einbinden.
- yearsPreference „neutral": höchstens 1–2 Jahreszahlen, wenn sie zum Ort gehören.

### Session-Memory
- Wenn der User bereits Orte besucht hat: kurz anknüpfen („Nach dem Markt…"), aber nicht wiederholen.
- Bereits genannte Kernfakte nicht nochmal vorlesen.

### Länge
- Ca. 3–6 Sätze, hörbar unterwegs. Erfinde keine Fakten.`;

const INTEREST_PRIORITY_IDS = new Set([
  'kaffee',
  'budget',
  'fruehstueck',
  'abendessen',
  'streetfood',
  'museen',
  'kirchen',
  'architektur',
  'legenden',
  'nachtleben',
  'events',
  'natur',
  'sportlich',
  'fotografie',
  'geschichte',
  'jahreszahlen',
]);

const WEEKDAY_DE = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
] as const;

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

// ─── Data Hygiene ──────────────────────────────────────────────────────────

const FACT_PREFIX =
  /^\[(Kurzfakt|Erzählung|Detail|Thema:[^\]]+|Hook|Narration|Topic:[^\]]+)\]\s*/u;

function stripFactPrefix(text: string): string {
  return text.replace(FACT_PREFIX, '').trim();
}

function isContactDump(text: string): boolean {
  const body = stripFactPrefix(text);
  return (
    /@[\w.-]+\.\w+/.test(body) ||
    /(\+?\d[\d\s/()-]{6,}\d)/.test(body) ||
    /https?:\/\//i.test(body) ||
    /\b(e-?mail|telefon|tel\.|fax|www\.)\b/i.test(body)
  );
}

function isHoursRelatedFact(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\[thema:(öffnungs|oeffnungs|opening|zeiten|hours)/i.test(text) ||
    /öffnung|oeffnung|geöffnet|geoeffnet|geschlossen|opening|hours|uhrzeit|mo[–\-]fr|mo\s*[-–]/i.test(
      lower,
    )
  );
}

/** Filtert Roh-Fakten für LLM-Kontext: kein Kontakt-Dump. */
export function sanitizeFactsForPrompt(facts: string[]): string[] {
  return facts
    .filter((t) => !isContactDump(t))
    .map((t) => {
      const flags: string[] = [];
      if (isHoursRelatedFact(t)) flags.push('ÖFFNUNGSZEITEN — nur situativ');
      return flags.length ? `${t}  ⟵ [${flags.join(', ')}]` : t;
    });
}

function parseHmToMinutes(hm: string): number | null {
  const m = hm.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Opening Hours Heuristics ────────────────────────────────────────────────

export function evaluateOpeningHours(
  facts: string[],
  now: Date = new Date(),
): Pick<PoiLiveContext, 'hoursStatus' | 'hoursHint'> & {
  rawHoursFacts: string[];
} {
  const rawHoursFacts = facts.filter(isHoursRelatedFact).map(stripFactPrefix);

  if (rawHoursFacts.length === 0) {
    return { hoursStatus: 'unknown', hoursHint: null, rawHoursFacts: [] };
  }

  const joined = rawHoursFacts.join(' | ');
  const weekdayShort = WEEKDAY_SHORT[now.getDay()];
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (
    new RegExp(
      `${weekdayShort}[^|;]*\\b(geschlossen|closed)\\b`,
      'i',
    ).test(joined) ||
    /\bheute\s+geschlossen\b/i.test(joined)
  ) {
    return {
      hoursStatus: 'closed',
      hoursHint: 'Hat leider heute zu.',
      rawHoursFacts,
    };
  }

  const rangeRe =
    /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})|(\d{1,2})\s*[-–—]\s*(\d{1,2})\b/g;
  const ranges: Array<{ open: number; close: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = rangeRe.exec(joined)) !== null) {
    if (match[1] != null && match[3] != null) {
      const open = parseHmToMinutes(`${match[1]}:${match[2]}`);
      const close = parseHmToMinutes(`${match[3]}:${match[4]}`);
      if (open != null && close != null) ranges.push({ open, close });
    } else if (match[5] != null && match[6] != null) {
      const open = Number(match[5]) * 60;
      const close = Number(match[6]) * 60;
      if (close > open) ranges.push({ open, close });
    }
  }

  if (ranges.length === 0) {
    return {
      hoursStatus: 'unknown',
      hoursHint: null,
      rawHoursFacts,
    };
  }

  const active = ranges.find((r) => nowMins >= r.open && nowMins < r.close);
  if (active) {
    const untilClose = active.close - nowMins;
    if (untilClose <= 60) {
      return {
        hoursStatus: 'closing_soon',
        hoursHint: `Schließt gleich um ${formatMinutes(active.close)} Uhr.`,
        rawHoursFacts,
      };
    }
    return { hoursStatus: 'open', hoursHint: null, rawHoursFacts };
  }

  const upcoming = ranges
    .filter((r) => r.open > nowMins)
    .sort((a, b) => a.open - b.open)[0];
  if (upcoming) {
    const untilOpen = upcoming.open - nowMins;
    if (untilOpen <= 90) {
      return {
        hoursStatus: 'opening_soon',
        hoursHint: `Macht um ${formatMinutes(upcoming.open)} Uhr auf.`,
        rawHoursFacts,
      };
    }
    return {
      hoursStatus: 'closed',
      hoursHint: `Hat leider zu — öffnet um ${formatMinutes(upcoming.open)} Uhr.`,
      rawHoursFacts,
    };
  }

  return {
    hoursStatus: 'closed',
    hoursHint: 'Hat leider gerade zu.',
    rawHoursFacts,
  };
}

export function buildLiveContext(
  poi: PoiData,
  now: Date = new Date(),
): PoiLiveContext {
  const hours = evaluateOpeningHours(
    poi.openingHoursFacts.length ? poi.openingHoursFacts : poi.facts,
    now,
  );
  return {
    nowIso: now.toISOString(),
    weekdayDe: WEEKDAY_DE[now.getDay()],
    timeHm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    hoursStatus: hours.hoursStatus,
    hoursHint: hours.hoursHint,
  };
}

// ─── User Context Resolution ─────────────────────────────────────────────────

export function resolvePromptStyleSettings(
  profile?: UserProfile | null,
): PromptStyleSettings {
  const p = profile ?? getCachedUserProfile();
  const voiceId = (p?.voiceId ?? 'standard_m') as VoiceId;

  let personality: FindusPersonality = 'default';
  for (const id of p?.characters ?? []) {
    if (PERSONALITY_FROM_CHAR[id]) {
      personality = PERSONALITY_FROM_CHAR[id];
      break;
    }
  }
  const fromVoice = PERSONALITY_FROM_VOICE[voiceId];
  if (
    fromVoice &&
    (personality === 'default' ||
      ['dorfaeltester', 'gen_z', 'prinzessin', 'standard', 'party'].includes(
        fromVoice,
      ))
  ) {
    personality = fromVoice;
  }

  let tone: FindusTone = 'default';
  for (const id of p?.tonalities ?? []) {
    if (TONE_FROM_ID[id]) {
      tone = TONE_FROM_ID[id];
      break;
    }
  }

  return {
    personality,
    tone,
    voiceId,
    personalityLabel: PERSONALITY_LABEL[personality],
    toneLabel: TONE_LABEL[tone],
  };
}

export function resolveYearsPreference(
  profile?: UserProfile | null,
): YearsPreference {
  const prefs = profile?.experiencePrefs ?? {};
  if (prefs.jahreszahlen === 'no' || prefs.geschichte === 'no') return 'wenig';
  if (prefs.jahreszahlen === 'yes') return 'viele';
  return 'neutral';
}

export function resolveUserInterests(profile?: UserProfile | null): {
  labels: string[];
  ids: string[];
} {
  const prefs = profile?.experiencePrefs ?? {};
  const labels: string[] = [];
  const ids: string[] = [];

  for (const card of EXPERIENCE_CARDS) {
    if (prefs[card.id] !== 'yes') continue;
    if (
      INTEREST_PRIORITY_IDS.has(card.id) ||
      card.category === 'essen' ||
      card.category === 'wissen' ||
      card.category === 'vibes'
    ) {
      labels.push(card.labelDe);
      ids.push(card.id);
    }
  }

  for (const motiveId of profile?.motives ?? []) {
    for (const cat of CHARACTER_CATEGORIES) {
      const opt = cat.options.find((o) => o.id === motiveId);
      if (opt) {
        labels.push(opt.labelDe);
        ids.push(motiveId);
        break;
      }
    }
  }

  const free = profile?.wantToExperience?.trim();
  if (free) labels.push(free);

  return {
    labels: [...new Set(labels)].slice(0, 12),
    ids: [...new Set(ids)],
  };
}

export function resolvePoiUserContext(
  profile?: UserProfile | null,
): PoiUserContext {
  const p = profile ?? getCachedUserProfile();
  const style = resolvePromptStyleSettings(p);
  const interests = resolveUserInterests(p);
  return {
    personality: style.personality,
    personalityLabel: style.personalityLabel,
    tone: style.tone,
    toneLabel: style.toneLabel,
    interests: interests.labels,
    interestIds: interests.ids,
    yearsPreference: resolveYearsPreference(p),
    firstName: p?.firstName?.trim() || null,
    cityName: p?.cityName ?? p?.cityId ?? null,
  };
}

// ─── Emotional Hooks ─────────────────────────────────────────────────────────

type HookContext = {
  poiName: string;
  poiCategory: string | null;
  personality: FindusPersonality;
  tone: FindusTone;
  interestIds: string[];
  interests: string[];
};

function isCoffeeSpot(name: string, category: string | null): boolean {
  const hay = `${name} ${category ?? ''}`.toLowerCase();
  return /(bäck|baeck|café|cafe|kaffee|rösterei|bohnen)/i.test(hay);
}

function isBudgetSpot(name: string, category: string | null): boolean {
  const hay = `${name} ${category ?? ''}`.toLowerCase();
  return /(markt|laden|shop|discount|bude|imbiss)/i.test(hay);
}

function isHistorySpot(name: string, category: string | null): boolean {
  const hay = `${name} ${category ?? ''}`.toLowerCase();
  return /(museum|kirche|schloss|denkmal|burg|kapelle|rathaus)/i.test(hay);
}

function isNightlifeSpot(name: string, category: string | null): boolean {
  const hay = `${name} ${category ?? ''}`.toLowerCase();
  return /(bar|club|kneipe|pub|biergarten)/i.test(hay);
}

/** Persona-spezifische Einstiegs-Hooks für den LLM-Prompt. */
export function buildEmotionalHookGuide(ctx: HookContext): string {
  const hasCoffee =
    (ctx.interestIds.includes('kaffee') ||
      ctx.interestIds.includes('fruehstueck') ||
      ctx.interests.some((i) => /kaffee|frühstück/i.test(i))) &&
    isCoffeeSpot(ctx.poiName, ctx.poiCategory);

  const hasBudget =
    ctx.interestIds.includes('budget') &&
    isBudgetSpot(ctx.poiName, ctx.poiCategory);

  const hasHistory =
    (ctx.interestIds.includes('geschichte') ||
      ctx.interestIds.includes('museen') ||
      ctx.interests.some((i) => /geschichte|museum/i.test(i))) &&
    isHistorySpot(ctx.poiName, ctx.poiCategory);

  const hasNightlife =
    ctx.interestIds.includes('nachtleben') &&
    isNightlifeSpot(ctx.poiName, ctx.poiCategory);

  const examples: string[] = [];

  if (hasCoffee) {
    if (ctx.personality === 'gen_z' || ctx.tone === 'kumpelhaft') {
      examples.push('„Yo Bro! Na, schon Kaffee-Entzug?"');
    }
    if (ctx.tone === 'sarkastisch') {
      examples.push('„Endlich Rettung für deinen niedrigen Koffeinspiegel."');
    }
    if (ctx.personality === 'dorfaeltester') {
      examples.push(
        '„Na mein Kind, riechst du auch diesen frischen Bohnenkaffee?"',
      );
    }
    if (ctx.personality === 'prinzessin' || ctx.tone === 'maerchen') {
      examples.push('„Hier duftet es nach warmen Träumen und frischem Kaffee."');
    }
    if (ctx.personality === 'historiker') {
      examples.push('„Seit Jahrhunderten duftet es hier nach gerösteten Bohnen."');
    }
  }

  if (hasBudget) {
    examples.push('„Portemonnaie-freundlich und trotzdem ein Fund — schau mal hin."');
  }
  if (hasHistory) {
    examples.push('„Hier liegt Geschichte in der Luft — magst du kurz eintauchen?"');
  }
  if (hasNightlife) {
    examples.push('„Nachtleben-Radar piept — dieser Spot gehört dazu."');
  }

  if (examples.length === 0) {
    return `Erster Satz = emotionaler Hook zu „${ctx.poiName}" — KEIN „Willkommen bei…".`;
  }

  return `Beispiel-Hooks für diesen Ort (adaptieren, nicht wörtlich kopieren):\n${examples.map((e) => `- ${e}`).join('\n')}`;
}

// ─── Session Memory Block ────────────────────────────────────────────────────

function buildSessionMemoryBlock(memory?: VisitedHistory): string {
  if (!memory?.entries?.length) {
    return 'Noch keine vorherigen Stopps in dieser Tour.';
  }

  const lines = memory.entries.slice(-5).map((e) => {
    const facts =
      e.keyFacts.length > 0
        ? ` (bereits genannt: ${e.keyFacts.slice(0, 2).join('; ')})`
        : '';
    return `- ${e.name}${facts}`;
  });

  return `Bereits besucht in dieser Tour:\n${lines.join('\n')}\n→ Kurz anknüpfen erlaubt, aber Fakten nicht wiederholen.`;
}

// ─── Personality Style Block ─────────────────────────────────────────────────

export function buildPersonalityStyleBlock(
  settings?: PromptStyleSettings,
): string {
  const s = settings ?? resolvePromptStyleSettings();
  const effectivePersonality =
    s.personality === 'default' ? 'standard' : s.personality;

  return `## Sprachstil & Persönlichkeit
Du bist Findus, ein hochempathischer lokaler Guide.
Persönlichkeit: ${s.personalityLabel}
Tonfall: ${s.toneLabel}

${PERSONALITY_FORMATTERS[effectivePersonality] ?? PERSONALITY_FORMATTERS.standard}

${TONE_FORMATTERS[s.tone]}

${TTS_PAUSE_ENGINE_RULES}`;
}

export function buildDynamicSystemPrompt(options?: {
  profile?: UserProfile | null;
  cityName?: string;
}): string {
  const profile = options?.profile ?? getCachedUserProfile();
  const style = resolvePromptStyleSettings(profile);
  const city =
    options?.cityName ?? profile?.cityName ?? profile?.cityId ?? 'der Stadt';
  const name = profile?.firstName?.trim();

  return `Du bist Findus, ein lokaler Audio-Tourguide für ${city}.
${name ? `Du darfst ${name} gelegentlich direkt ansprechen.` : ''}
Sprich klar und hörbar unterwegs (ca. 3–6 Sätze), auf Deutsch.
Nutze die mitgelieferten Fakten als Grundlage — erfinde keine Daten.

${buildPersonalityStyleBlock(style)}`;
}

// ─── Main POI Narration Prompt ───────────────────────────────────────────────

export function buildPoiContextPrompt(
  poiData: PoiWithFacts,
  userProfile: UserProfile,
  sessionMemory?: VisitedHistory,
): string {
  return promptBuilderService.buildPoiNarrationPrompt({
    userProfile,
    poi: poiWithFactsToPoiData(poiData),
    sessionMemory,
  });
}

export function buildDeepStoryPrompt(
  poiData: PoiWithFacts,
  userProfile: UserProfile,
  fastHook: string,
  sessionMemory?: VisitedHistory,
): string {
  return promptBuilderService.buildDeepStoryPrompt(
    {
      userProfile,
      poi: poiWithFactsToPoiData(poiData),
      sessionMemory,
    },
    fastHook,
  );
}

class PromptBuilderService {
  buildPoiNarrationPrompt(input: PromptBuildInput): string {
    const now = input.now ?? new Date();
    const live = buildLiveContext(input.poi, now);
    const user = resolvePoiUserContext(input.userProfile);
    const style = resolvePromptStyleSettings(input.userProfile);
    const sanitizedFacts = sanitizeFactsForPrompt(input.poi.facts);

    const contextJson = {
      live: {
        now: live.nowIso,
        weekday: live.weekdayDe,
        time: live.timeHm,
        openingHours: {
          status: live.hoursStatus,
          hint: live.hoursHint,
        },
      },
      user: {
        personality: user.personality,
        tone: user.tone,
        interests: user.interests,
        yearsPreference: user.yearsPreference,
        firstName: user.firstName,
        cityName: user.cityName,
      },
      poi: {
        name: input.poi.name,
        category: input.poi.category,
        budgetLevel: input.poi.budgetLevel,
        description: input.poi.description,
      },
    };

    const hoursRuleExtra =
      live.hoursStatus === 'open' && !live.hoursHint
        ? 'Ort ist geöffnet und schließt nicht bald → Öffnungszeiten NICHT erwähnen.'
        : live.hoursHint
          ? `Situations-Hinweis: ${live.hoursHint} — nur das knapp einbauen, keine Tabelle.`
          : 'Öffnungsstatus unklar → nur erwähnen, wenn aus den Fakten klar und situationsrelevant.';

    const hookGuide = buildEmotionalHookGuide({
      poiName: input.poi.name,
      poiCategory: input.poi.category,
      personality: user.personality,
      tone: user.tone,
      interestIds: user.interestIds,
      interests: user.interests,
    });

    const memoryBlock = buildSessionMemoryBlock(input.sessionMemory);

    return `${buildDynamicSystemPrompt({
      profile: input.userProfile,
      cityName: user.cityName ?? undefined,
    })}

${POI_NARRATION_SYSTEM_RULES}

${buildPersonalityStyleBlock(style)}

## Live- & User-Kontext (JSON)
\`\`\`json
${JSON.stringify(contextJson, null, 2)}
\`\`\`

## Session-Memory
${memoryBlock}

## Öffnungszeiten-Lage jetzt
${hoursRuleExtra}

## Einstiegs-Hook
${hookGuide}

## Gefilterte Fakten zum Ort „${input.poi.name}"
${sanitizedFacts.length ? sanitizedFacts.map((f) => `- ${f}`).join('\n') : '(keine Fakten hinterlegt)'}

## Auftrag
Schreibe JETZT die gesprochene Begrüßungs-Narration für „${input.poi.name}".
Erster Satz = emotionaler Hook. yearsPreference=${user.yearsPreference}, personality=${user.personality}, tone=${user.tone}.
Nur fließender Text zum Vorlesen — keine Meta-Kommentare, keine Aufzählungszeichen.`;
  }

  /** Phase 2 — Deep Story: Hauptteil OHNE Einstiegs-Hook (Hook wurde bereits gesprochen). */
  buildDeepStoryPrompt(input: PromptBuildInput, fastHook: string): string {
    const now = input.now ?? new Date();
    const live = buildLiveContext(input.poi, now);
    const user = resolvePoiUserContext(input.userProfile);
    const style = resolvePromptStyleSettings(input.userProfile);
    const sanitizedFacts = sanitizeFactsForPrompt(input.poi.facts);
    const memoryBlock = buildSessionMemoryBlock(input.sessionMemory);

    const hoursRuleExtra =
      live.hoursStatus === 'open' && !live.hoursHint
        ? 'Ort ist geöffnet → Öffnungszeiten NICHT erwähnen.'
        : live.hoursHint
          ? `Situations-Hinweis: ${live.hoursHint} — nur knapp einbauen.`
          : 'Öffnungsstatus unklar → nur situativ erwähnen.';

    return `${buildDynamicSystemPrompt({
      profile: input.userProfile,
      cityName: user.cityName ?? undefined,
    })}

${POI_NARRATION_SYSTEM_RULES}

${buildPersonalityStyleBlock(style)}

## Bereits gesprochen (Fast Hook — NICHT wiederholen)
„${fastHook}"

## Session-Memory
${memoryBlock}

## Öffnungszeiten-Lage jetzt
${hoursRuleExtra}

## Gefilterte Fakten zum Ort „${input.poi.name}"
${sanitizedFacts.length ? sanitizedFacts.map((f) => `- ${f}`).join('\n') : '(keine Fakten hinterlegt)'}

## Auftrag — Deep Story (Hauptteil)
Der Einstiegs-Hook wurde BEREITS gesprochen. Schreibe JETZT den HAUPTTEIL (2–5 Sätze).
- KEIN erneuter Hook, kein „Willkommen", kein Wiederholen des ersten Satzes.
- yearsPreference=${user.yearsPreference}, personality=${user.personality}, tone=${user.tone}.
- Beachte Session-Memory: keine Wiederholung bereits genannter Kernfakten.
- Nur fließender Text zum Vorlesen — keine Meta-Kommentare.`;
  }

  /**
   * Leichte Text-Hygiene vor TTS — kein Pause-/Slang-Spam.
   * Persona steckt im Prompt; Kokoro macht Prosodie + G2P selbst.
   */
  applyPersonalityFormat(
    text: string,
    _settings?: PromptStyleSettings,
  ): string {
    return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  /** Offline-Narration ohne LLM — mit Filter, Hooks und Memory. */
  buildOfflineNarration(
    poi: PoiWithFacts,
    profile?: UserProfile | null,
    sessionMemory?: VisitedHistory,
  ): string {
    const p = profile ?? getCachedUserProfile();
    const poiData = poiWithFactsToPoiData(poi);
    const user = resolvePoiUserContext(p);
    const live = buildLiveContext(poiData);
    const style = resolvePromptStyleSettings(p);

    const bodies = poiData.facts
      .filter((t) => !isContactDump(t))
      .filter((t) => !isHoursRelatedFact(t) || live.hoursStatus !== 'open')
      .map(stripFactPrefix);

    const narration =
      bodies.find((b) =>
        poi.facts.some(
          (f) =>
            f.fact_text.includes(b) &&
            /^\[(Erzählung|Narration)\]/i.test(f.fact_text),
        ),
      ) ?? bodies[0];

    const hooks = bodies
      .filter((b) => b !== narration)
      .slice(0, user.yearsPreference === 'viele' ? 3 : 2)
      .map((b) =>
        user.yearsPreference === 'wenig'
          ? b
              .replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, '')
              .replace(/\s{2,}/g, ' ')
              .trim()
          : b,
      )
      .filter(Boolean);

    const hookGuide = buildEmotionalHookGuide({
      poiName: poiData.name,
      poiCategory: poiData.category,
      personality: user.personality,
      tone: user.tone,
      interestIds: user.interestIds,
      interests: user.interests,
    });

    const hookLine = hookGuide.includes('Beispiel-Hooks')
      ? hookGuide
          .split('\n')
          .find((l) => l.startsWith('- '))
          ?.replace(/^-\s*/, '')
          .replace(/^„|"$|"/g, '') ?? `Hey — ${poiData.name}.`
      : `Hey — ${poiData.name}. Kurz innehalten lohnt sich.`;

    const memoryRef =
      sessionMemory?.entries?.length &&
      sessionMemory.entries[sessionMemory.entries.length - 1]?.name !==
        poiData.name
        ? `Nach ${sessionMemory.entries[sessionMemory.entries.length - 1].name}… `
        : '';

    const hoursLine =
      live.hoursHint && live.hoursStatus !== 'open' ? live.hoursHint : null;

    const parts = [
      memoryRef ? `${memoryRef}${hookLine}` : hookLine,
      narration && narration !== hookLine ? narration : null,
      ...hooks.slice(0, 2),
      hoursLine,
    ].filter(Boolean) as string[];

    if (parts.length === 0) {
      parts.push(`Schön, dass du am ${poiData.name} bist — schau dich ruhig um.`);
    }

    return this.applyPersonalityFormat(parts.join(' '), style);
  }
}

export const promptBuilderService = new PromptBuilderService();

// Backward-compatible aliases
export const applyOfflinePersonalityPolish = (
  text: string,
  settings?: PromptStyleSettings,
) => promptBuilderService.applyPersonalityFormat(text, settings);

export const buildContextAwareOfflineNarration = (
  poi: PoiWithFacts,
  profile?: UserProfile | null,
  sessionMemory?: VisitedHistory,
) => promptBuilderService.buildOfflineNarration(poi, profile, sessionMemory);

export function extractKeyFactsFromPoi(poi: PoiWithFacts, max = 3): string[] {
  return poi.facts
    .map((f) => stripFactPrefix(f.fact_text))
    .filter((t) => !isContactDump(t) && !isHoursRelatedFact(t))
    .slice(0, max);
}
