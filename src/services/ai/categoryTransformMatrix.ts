/**
 * Kategorie → Persona: NUR Stil-Hinweise.
 * Konkrete Hamburg-Beispiele (Nikolai, Landungsbrücken, …) werden dem LLM
 * NICHT mehr als Inhalts-Vorbilder gezeigt — nur Art und Weise.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile, VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';

export type LocationCategory =
  | 'cafe'
  | 'church'
  | 'water'
  | 'museum'
  | 'mall'
  | 'historic'
  | 'station'
  | 'golf'
  | 'nature'
  | 'generic';

export type MatrixPersona =
  | 'standard_m'
  | 'standard_w'
  | 'prinzessin'
  | 'erzaehler'
  | 'dorfaeltester'
  | 'historiker'
  | 'gen_z';

const MATRIX_PERSONAS: MatrixPersona[] = [
  'standard_m',
  'standard_w',
  'prinzessin',
  'erzaehler',
  'dorfaeltester',
  'historiker',
  'gen_z',
];

/** Reine Stil-Anweisungen — keine übernehmbaren Ortsfakten. */
const PERSONA_STYLE_HINTS: Record<MatrixPersona, string> = {
  standard_m:
    'Klar, freundlich, bildhaft; Zahlen nur aus dem Datensatz und greifbar umschreiben.',
  standard_w:
    'Warm, einladend, kurze Szenen; nur belegte Details, keine erfundenen Highlights.',
  prinzessin:
    'Sanft, bildreich, märchenhafter Ton — Inhalt trotzdem nur aus den Fakten.',
  erzaehler:
    'Kino-Voiceover: Spannung und Bilder, aber keine neuen Plot-Points erfinden.',
  dorfaeltester:
    'Gemütlich, „Ach ja…“, Erinnerungston — keine erfundenen Anekdoten als Fakten.',
  historiker:
    'Präzise Ursache→Wirkung; nur Datensatz-Belege, keine Turm-/Höhen-Halluzinationen.',
  gen_z:
    'Locker, Slang dosiert, Energie — Fakten bleiben die aus dem Datensatz.',
};

const CATEGORY_STYLE: Record<
  Exclude<LocationCategory, 'generic'>,
  { labelDe: string; structureHint: string }
> = {
  cafe: {
    labelDe: 'Café / Gastronomie',
    structureHint:
      'Duft/Pause → Ursprung/Idee aus Fakten → was heute hier los ist → ein belegter Highlight-Tipp.',
  },
  church: {
    labelDe: 'Kirche / Sakral',
    structureHint:
      'Stille/Mauern → warum gebaut (nur belegt) → heutige Nutzung → ein belegtes Detail (Höhe nur wenn im Datensatz).',
  },
  water: {
    labelDe: 'Hafen / Wasser',
    structureHint:
      'Kontext-Hook (erfrischend / Badehose / Brise) → Ort am Wasser → historische Funktion aus Fakten → heute → Fun/Quiz → konkretes Ufer-Erkunden.',
  },
  museum: {
    labelDe: 'Museum / Kultur',
    structureHint:
      'Neugier-Hook → Gebäude/Sammlung nur wie belegt → heute erlebbar → ein belegtes Highlight.',
  },
  mall: {
    labelDe: 'Einkaufen / Meile',
    structureHint:
      'Trubel → Entstehung/Idee aus Fakten → heutiges Treiben → ein belegter Fun-Fact.',
  },
  historic: {
    labelDe: 'Historisches Bauwerk',
    structureHint:
      'Ort benennen → Menschen/Idee aus Fakten → Zustand heute → belegter Vergleich/Highlight.',
  },
  station: {
    labelDe: 'Bahnhof / Haltepunkt',
    structureHint:
      'Kontext-Hook (Tüt-tüt / Einsteigen bitte) → Einführung → Bahn-Geschichte aus Fakten → heutiger Nutzen ohne Liniennummern → Fun/Quiz → konkretes Erkunden. Kein Turm, keine Spitze.',
  },
  golf: {
    labelDe: 'Golf / Fairway',
    structureHint:
      'Kontext-Hook (Abschlag / Greens / Handicap) → was ist die Anlage → Lage/Hintergrund aus Fakten → heutige Nutzung → Fun/Quiz → konkretes Erkunden.',
  },
  nature: {
    labelDe: 'Natur / Baumschule',
    structureHint:
      'Kontext-Hook (Pollen / Natur pur) → was liegt hier → Hintergrund aus Fakten → heute → Fun/Quiz → konkretes Hinschauen.',
  },
};

const PERSONALITY_TO_MATRIX: Record<string, MatrixPersona> = {
  gen_z: 'gen_z',
  historiker: 'historiker',
  party: 'gen_z',
  prinzessin: 'prinzessin',
  erzaehler: 'erzaehler',
  dorfaeltester: 'dorfaeltester',
  poet: 'prinzessin',
  fuersorglich: 'standard_w',
  reiseblogger: 'standard_w',
  lokalpatriot: 'dorfaeltester',
  default: 'standard_m',
};

const VOICE_TO_MATRIX: Partial<Record<VoiceId, MatrixPersona>> = {
  daniel: 'gen_z',
  varson: 'gen_z',
  lukas: 'erzaehler',
  sebastian: 'standard_m',
  alina: 'standard_w',
  marlene: 'historiker',
};

/** @deprecated Inhaltliche Matrix-Beispiele entfernt — nur noch Stil. */
export const CATEGORY_TRANSFORM_MATRIX = {} as Record<string, never>;

export function resolveMatrixPersona(
  profile?: UserProfile | null,
  personality?: string | null,
): MatrixPersona {
  const p = profile ?? getCachedUserProfile();
  const voiceId = (p?.voiceId ?? 'alina') as VoiceId;
  if (VOICE_TO_MATRIX[voiceId]) return VOICE_TO_MATRIX[voiceId]!;
  if (personality && PERSONALITY_TO_MATRIX[personality]) {
    return PERSONALITY_TO_MATRIX[personality];
  }
  for (const id of p?.characters ?? []) {
    if (PERSONALITY_TO_MATRIX[id]) return PERSONALITY_TO_MATRIX[id];
  }
  return 'standard_m';
}

export function classifyLocationCategory(poi: PoiWithFacts): LocationCategory {
  const blob =
    `${poi.name} ${poi.facts.map((f) => f.fact_text).join(' ')}`.toLowerCase();

  if (/(golf|fairway|grün|green|abschlag|loch\b|par\s*\d)/i.test(blob)) {
    return 'golf';
  }
  if (/(bahnhof|haltepunkt|gleis|railway|train\s*station)/i.test(blob)) {
    return 'station';
  }
  if (
    /(baumschule|pollen|wald|wiese|natur|knick|gärtnerei|gaertnerei|biotop)/i.test(
      blob,
    )
  ) {
    return 'nature';
  }
  if (
    /(café|cafe|kaffee|bäck|baeck|restaurant|gastronom|imbiss|rösterei|konditorei|wirtshaus|kneipe)/i.test(
      blob,
    )
  ) {
    return 'cafe';
  }
  if (
    /(kirche|dom|kapelle|cathedral|kloster|münster|muenster|sakral|mahnmal)/i.test(
      blob,
    )
  ) {
    return 'church';
  }
  if (
    /(hafen|landungsbrücken|fähre|faehre|fluss|see\b|kanal|schiff|maritim|wasser|elbufer|alster|hadag|teich|pinnau)/i.test(
      blob,
    )
  ) {
    return 'water';
  }
  if (/(museum|galerie|ausstellung|speicher.*museum|kaispeicher)/i.test(blob)) {
    return 'museum';
  }
  if (
    /(einkauf|shopping|mall|passage|meile|geschäft|geschaefte|ladenzeile|mönckeberg|moenckeberg|kaufhaus)/i.test(
      blob,
    )
  ) {
    return 'mall';
  }
  if (
    /(denkmal|historisch|schloss|burg|rathaus|fabrik|mühle|muehle|bauwerk)/i.test(
      blob,
    )
  ) {
    return 'historic';
  }
  return 'generic';
}

/**
 * Prompt-Block: Kategorie + Persona — nur Stil/Struktur, null Beispiel-Inhalt.
 */
export function buildCategoryTransformBlock(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
  personality?: string | null,
): string {
  const category = classifyLocationCategory(poi);
  const persona = resolveMatrixPersona(profile, personality);
  const cat =
    category === 'generic'
      ? null
      : CATEGORY_STYLE[category as Exclude<LocationCategory, 'generic'>];

  return `## Kategorie & Persona — NUR Stil (keine Inhalts-Beispiele!)
1. Persona \`${persona}\`: ${PERSONA_STYLE_HINTS[persona]}
2. Inhalt ausschließlich aus den genehmigten POI-/Chain-Fakten dieses Ortes.
3. Fremde Beispiel-Orte (Nikolai, Landungsbrücken, Speicherstadt, Brauhaus-Geschichten) NIEMALS übernehmen.
4. Zahlen nur umschreiben, wenn sie im Datensatz stehen — sonst weglassen.
5. Fast Hook ggf. schon gesprochen — hier nicht wiederholen.

### Erkannte Kategorie: ${cat?.labelDe ?? 'allgemein'} (\`${category}\`)
Struktur-Hinweis: ${
    cat?.structureHint ??
    'Sound/Ort → Ursprung aus Fakten → Heute → ein belegtes Highlight.'
  }
Aktive Persona-Stilnote: ${PERSONA_STYLE_HINTS[persona]}`;
}

/** Offline: kein Matrix-Satz mit fremdem Ortsinhalt. */
export function pickCategoryOfflineHook(
  _poi: PoiWithFacts,
  _profile?: UserProfile | null,
  _personality?: string | null,
): string | null {
  return null;
}

export { MATRIX_PERSONAS };
