/** Aktuell nur Deutsch. */
export type AppLanguage = 'de';

export type SwipePreference = 'no' | 'neutral' | 'yes';

/**
 * 8 Rollen-Profile → 4 native deutsche Kokoro-Basisstimmen.
 * Tempo systemweit fest 1.0.
 */
export type VoiceId =
  | 'standard_m'
  | 'standard_w'
  | 'prinzessin'
  | 'erzaehler'
  | 'dorfaeltester'
  | 'historiker'
  | 'gen_z'
  | 'energisch';

export type ExperienceKey = string;

/** Charakter-Engine: visuelle Vergleiche, Anekdoten, Fun Facts, Quiz. */
export type AnecdoteLevel = 'hoch' | 'mittel' | 'aus';

export type StorytellingSettings = {
  /** „Kino im Kopf“: Zahlen bildlich (Elefanten, Busse, …). */
  visualStyle?: boolean;
  /** Fokus auf menschliche Dramen / Pannen / Skandale. */
  anecdoteLevel?: AnecdoteLevel;
  /** Immer eine kuriose Randnotiz („Fun Fact…“). */
  funFactsEnabled?: boolean;
  /** Rätselfrage am Stationsende. */
  quizMode?: boolean;
};

export interface UserProfile {
  version: 1;
  setupComplete: boolean;
  language: AppLanguage;
  voiceId: VoiceId;
  /** Fest 1.0 — Sprechtempo-Slider entfernt. */
  speechRate: number;
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  characters: string[];
  tonalities: string[];
  motives: string[];
  accessibility: string[];
  socialDynamics: string[];
  extraTraits: string[];
  cityId: string | null;
  cityName: string | null;
  experiencePrefs: Record<ExperienceKey, SwipePreference>;
  /** Erweiterte Storytelling-Regler (optional, Defaults via Resolver). */
  storytelling?: StorytellingSettings;
  wantToExperience: string;
  avoidExperience: string;
  completedAt: string | null;
}

export function createDefaultProfile(): UserProfile {
  return {
    version: 1,
    setupComplete: false,
    language: 'de',
    voiceId: 'standard_m',
    speechRate: 1,
    firstName: '',
    lastName: '',
    email: '',
    age: 30,
    characters: [],
    tonalities: [],
    motives: [],
    accessibility: [],
    socialDynamics: [],
    extraTraits: [],
    cityId: null,
    cityName: null,
    experiencePrefs: {},
    storytelling: {},
    wantToExperience: '',
    avoidExperience: '',
    completedAt: null,
  };
}

export function isGermanLanguage(_lang?: AppLanguage): boolean {
  return true;
}

/** UI ist fest Deutsch. */
export function uiLang(_lang?: AppLanguage): 'de' {
  return 'de';
}

/** Legacy-Profile (en/en-US/en-GB) → immer Deutsch. */
export function normalizeLanguage(_raw?: string | null): AppLanguage {
  return 'de';
}

const VALID_VOICES: ReadonlySet<string> = new Set([
  'standard_m',
  'standard_w',
  'prinzessin',
  'erzaehler',
  'dorfaeltester',
  'historiker',
  'gen_z',
  'energisch',
]);

/** Alte Voice-IDs aus früheren Builds. */
const LEGACY_VOICE_MAP: Record<string, VoiceId> = {
  martin: 'standard_m',
  maennlich: 'standard_m',
  neutral: 'standard_m',
  weiblich: 'standard_w',
  genz: 'gen_z',
  aufgedreht: 'energisch',
  energy: 'energisch',
  ruhig: 'standard_m',
  dorfaelteste: 'dorfaeltester',
};

export function normalizeVoiceId(raw: string | undefined | null): VoiceId {
  if (!raw) return 'standard_m';
  if (VALID_VOICES.has(raw)) return raw as VoiceId;
  return LEGACY_VOICE_MAP[raw] ?? 'standard_m';
}
