/** Aktuell nur Deutsch. */
export type AppLanguage = 'de';

export type SwipePreference = 'no' | 'neutral' | 'yes';

/**
 * 7 Rollen-Profile → 7 native deutsche Piper-Stimmen.
 * Tempo systemweit fest 1.0. Timbre nur über Piper-Modell.
 */
export type VoiceId =
  | 'standard_m'
  | 'standard_w'
  | 'prinzessin'
  | 'erzaehler'
  | 'dorfaeltester'
  | 'historiker'
  | 'gen_z';

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

/** TTS-Backend: lokal (Kokoro/Piper) oder OpenAI Speech (nova). */
export type TtsProvider = 'kokoro' | 'openai';

/** 4 Säulen — Persona & Ton. */
export type FindusPersona =
  | 'gen_z'
  | 'party_guide'
  | 'coach'
  | 'poet'
  | 'historiker'
  | 'mittelalter'
  | 'standard';

export type FindusToneStyle =
  | 'kumpelhaft'
  | 'sarkastisch'
  | 'ernst'
  | 'maerchen'
  | 'quizmaster'
  | 'krimi'
  | 'doku';

export type TravelPurpose =
  | 'business'
  | 'leisure'
  | 'layover'
  | 'backpacker'
  | 'family';

export type MobilityMode = 'foot' | 'bike' | 'public_transit' | 'car';

export type PaceMode = 'relaxed' | 'fast_explore';

export type TouristVsInsider = 'tourist' | 'insider' | 'mix';

/** Onboarding-Pfad. */
export type OnboardingMode = 'express' | 'standard';

/** Budget-Kategorie (Express & Profil). */
export type BudgetCategory = 'sparsam' | 'mittel' | 'komfort';

/**
 * Mikrofon-Modus:
 * hear = Spracheingabe erlaubt (nur bei aktivem Tippen/Halten)
 * dont_hear = nur Tippen, kein Mikrofon
 */
export type MicListenMode = 'hear' | 'dont_hear';

/** Reisende Gruppe. */
export type TravelParty = 'solo' | 'couple' | 'date' | 'family' | 'friends';

/** Energielevel / Tagesrhythmus. */
export type EnergyLevel = 'low' | 'medium' | 'high';

/** Antwortlänge der KI. */
export type AnswerStyle = 'short' | 'detailed';

/**
 * Die 4 Säulen des Findus-Profils — konsolidiert für jeden Gemini-Request.
 * (Onboarding-Felder auf UserProfile werden via resolvePersonaEngine hierher gemappt.)
 */
export interface PersonaEngineProfile {
  // Pillar 1: Persona, Tone & Style
  persona: FindusPersona;
  toneStyle: FindusToneStyle;
  answerStyle: AnswerStyle;
  /** Charakter-Flavor für Prompt (auch wenn Persona gemappt ist). */
  characterFlavor?: string;

  // Pillar 2: Demographics, Safety & Accessibility
  age?: number;
  accessibility: {
    wheelchairRequired: boolean;
    visuallyImpaired: boolean;
    hearingImpaired: boolean;
    pregnantOrLowStamina: boolean;
    noiseSensitive: boolean;
    withDog: boolean;
  };

  // Pillar 3: Travel Context & Constraints
  travelPurpose: TravelPurpose;
  travelParty: TravelParty;
  mobilityMode: MobilityMode;
  timeBudgetMinutes?: number;
  pace: PaceMode;
  energyLevel: EnergyLevel;
  budgetCategory: BudgetCategory;

  // Pillar 4: Preferences, Memory & Implicit Learning
  preferences: {
    wantsDatesAndHistory: boolean;
    likesChurches: boolean;
    likesMuseums: boolean;
    likesFamousPeople: boolean;
    nightlifeAndEvents: boolean;
    touristSpotsVsLocalSecrets: TouristVsInsider;
    dietaryRestrictions: string[];
    allergies: string[];
    dislikes: string[];
  };
  notificationsEnabled: boolean;
  dataSaverMode: boolean;
  learnedFacts: string[];
}

/** Alias — Master-Prompt-Profil (4 Säulen). */
export type FindusMasterProfile = PersonaEngineProfile;

export type PoiImportance = 'major' | 'minor' | 'standard';

export type MasterPromptContext = {
  isFirstPoi: boolean;
  poiImportance: PoiImportance;
  /** Einmaliger App-Tip für diese Story (oder null). */
  featureTipId?: string | null;
  /** Ort hat mehr Stoff — Beispiel-Rückfrage. */
  surplusExampleQuestion?: string | null;
  /** Navigation-Reminder erlaubt (Sub + nie genutzt). */
  allowNavReminder?: boolean;
  /** Feature-Tip-Promptblock (fertig formatiert). */
  featureTipsBlock?: string;
  /** Verwandter Ort → Wahl-Outro (mehr Geschichte vs. hin). */
  relatedBridgeBlock?: string;
};

/** Optionale Overrides / Persistenz der Engine-Felder. */
export type PersonaEngineOverrides = Partial<{
  persona: FindusPersona;
  toneStyle: FindusToneStyle;
  travelPurpose: TravelPurpose;
  mobilityMode: MobilityMode;
  timeBudgetMinutes: number;
  pace: PaceMode;
  answerStyle: AnswerStyle;
  energyLevel: EnergyLevel;
  preferences: Partial<PersonaEngineProfile['preferences']>;
}>;

export interface UserProfile {
  version: 1;
  setupComplete: boolean;
  language: AppLanguage;
  voiceId: VoiceId;
  /** Fest 1.0 — Sprechtempo-Slider entfernt. */
  speechRate: number;
  /** Cloud vs. lokale TTS — Default openai. */
  ttsProvider?: TtsProvider;
  firstName: string;
  lastName: string;
  email: string;
  /**
   * Freitext „Über dich“ — was der Nutzer von sich erzählt (Onboarding).
   * Fließt in Persona/Prompts ein.
   */
  aboutMe?: string;
  /**
   * Mobilnummer für Reservierungen / Rückrufe (E.164 oder DE-Format).
   * Einmalig in den Einstellungen hinterlegen.
   */
  phoneNumber?: string;
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
  /**
   * Dynamisch gelernte Fakten aus dem Gespräch
   * („Ich bin Vegetarier“, „Hotel Bluezeit“, …).
   */
  learnedFacts?: string[];
  /** Explizite Overrides für die Persona-Engine (optional). */
  personaEngine?: PersonaEngineOverrides;

  /** Express vs. Standard Onboarding. */
  onboardingMode?: OnboardingMode | null;
  /** Freitext Reisezeitraum (z. B. „3.–10. August“ / „Wochenende“). */
  travelPeriod?: string;
  /** Budget-Kategorie für Express-Setup & Concierge. */
  budgetCategory?: BudgetCategory | null;
  /** Mikrofon-Modus nach Onboarding-Consent. */
  micListenMode?: MicListenMode | null;
  /** DSGVO: Datenschutzerklärung akzeptiert. */
  hasAcceptedPrivacyPolicy?: boolean;
  privacyAcceptedAt?: string | null;
  /** DSGVO: Audio-/Mikrofon-Einwilligung. */
  hasAcceptedAudioConsent?: boolean;
  audioConsentAt?: string | null;

  /** Reisende Gruppe. */
  travelParty?: TravelParty | null;
  /** Primäre Mobilität (First-Class, überschreibt Experience-Swipes). */
  mobilityMode?: MobilityMode | null;
  /** Energielevel. */
  energyLevel?: EnergyLevel | null;
  /** Explizite Ernährungs-Tags. */
  dietaryTags?: string[];
  /** Freitext Allergien. */
  allergies?: string;
  /** Antwortstil der KI. */
  answerStyle?: AnswerStyle | null;
  /** Must-see vs. Insider. */
  touristMode?: TouristVsInsider | null;
  /** POI-/Tour-Hinweise erwünscht. */
  notificationsEnabled?: boolean;
  /** Daten sparsam (kürzere Antworten, weniger Prefetch). */
  dataSaverMode?: boolean;
}

/** Kontaktblock für Concierge-Reservierungen. */
export type ReservationContact = {
  fullName: string;
  email: string;
  phoneNumber: string;
  /** true wenn Name + E-Mail für E-Mail-Reservierung reichen */
  canSendEmail: boolean;
  /** true wenn Telefon für KI-Anruf / Dial hinterlegt */
  canCall: boolean;
};

export function getReservationContact(
  profile: UserProfile | null | undefined,
): ReservationContact {
  const fullName = [profile?.firstName, profile?.lastName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  const email = (profile?.email ?? '').trim();
  const phoneNumber = (profile?.phoneNumber ?? '').trim();
  return {
    fullName,
    email,
    phoneNumber,
    canSendEmail: fullName.length >= 2 && /@/.test(email),
    canCall: phoneNumber.replace(/\D/g, '').length >= 6,
  };
}

export function createDefaultProfile(): UserProfile {
  return {
    version: 1,
    setupComplete: false,
    language: 'de',
    voiceId: 'standard_m',
    speechRate: 1,
    ttsProvider: 'openai',
    firstName: '',
    lastName: '',
    email: '',
    aboutMe: '',
    phoneNumber: '',
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
    learnedFacts: [],
    personaEngine: {},
    onboardingMode: null,
    travelPeriod: '',
    budgetCategory: null,
    micListenMode: null,
    hasAcceptedPrivacyPolicy: false,
    privacyAcceptedAt: null,
    hasAcceptedAudioConsent: false,
    audioConsentAt: null,
    travelParty: null,
    mobilityMode: null,
    energyLevel: null,
    dietaryTags: [],
    allergies: '',
    answerStyle: null,
    touristMode: null,
    notificationsEnabled: true,
    dataSaverMode: false,
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
]);

/** Alte Voice-IDs aus früheren Builds. */
const LEGACY_VOICE_MAP: Record<string, VoiceId> = {
  martin: 'standard_m',
  maennlich: 'standard_m',
  neutral: 'standard_m',
  weiblich: 'standard_w',
  genz: 'gen_z',
  aufgedreht: 'gen_z',
  energy: 'gen_z',
  energisch: 'gen_z',
  ruhig: 'standard_m',
  dorfaelteste: 'dorfaeltester',
};

export function normalizeVoiceId(raw: string | undefined | null): VoiceId {
  if (!raw) return 'standard_m';
  if (VALID_VOICES.has(raw)) return raw as VoiceId;
  return LEGACY_VOICE_MAP[raw] ?? 'standard_m';
}
