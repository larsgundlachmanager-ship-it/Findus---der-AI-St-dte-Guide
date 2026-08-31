import type { LearnedRule } from './learnedRules';

/** Aktuell nur Deutsch. */
export type AppLanguage = 'de';

export type SwipePreference = 'no' | 'neutral' | 'yes';

/**
 * 16 Cartesia sonic-3.5 Personas (Settings / Onboarding).
 * Tempo systemweit fest 1.0.
 */
export type VoiceId =
  | 'alina'
  | 'sebastian'
  | 'klaus'
  | 'leander'
  | 'lukas'
  | 'varson'
  | 'alexander'
  | 'daniel'
  | 'jaqcline'
  | 'lea'
  | 'rena'
  | 'katie'
  | 'skylar'
  | 'verini'
  | 'viktoria'
  | 'marlene';

export type ExperienceKey = string;

/** Charakter-Engine: visuelle Vergleiche, Anekdoten, Fun Facts, Quiz. */
export type AnecdoteLevel = 'hoch' | 'mittel' | 'aus';

/** Live story length — Masterbook „more/less history“. */
export type StoryDepth = 'short' | 'normal' | 'long';

export type StorytellingSettings = {
  /** „Kino im Kopf“: Zahlen bildlich (Elefanten, Busse, …). */
  visualStyle?: boolean;
  /** Fokus auf menschliche Dramen / Pannen / Skandale. */
  anecdoteLevel?: AnecdoteLevel;
  /** Immer eine kuriose Randnotiz („Fun Fact…“). */
  funFactsEnabled?: boolean;
  /** Rätselfrage am Stationsende. */
  quizMode?: boolean;
  /** Erzähl-Länge: kurz / normal / lang. */
  storyDepth?: StoryDepth;
};

/** TTS-Backend: Cartesia sonic-3.5 (primär). System = expo-speech nur als Dev-Force. */
export type TtsProvider = 'cartesia' | 'system';

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
  | 'umgangssprachlich'
  | 'erzaehlerisch'
  | 'faktisch'
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

export type TouristVsInsider = 'tourist' | 'insider' | 'mix' | 'local_gems';

/** Must-have Reise-Stil (Mehrfachauswahl in Einrichtung). */
export type MustHaveStyleId =
  | 'tourist'
  | 'insider'
  | 'local_gems'
  | 'nightlife';

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
export type EnergyLevel = 'low' | 'medium' | 'high' | 'extreme';

/** Tourlänge in Stops (Concierge / Planung). */
export type TourLengthPref =
  | 'fewer_stops'
  | 'balanced'
  | 'more_stops'
  | 'max_stops';

/** Antwortlänge der KI. */
export type AnswerStyle = 'short' | 'detailed';

/**
 * Modul-1-Verhalten während aktiver Navigation (Settings).
 * quiet = Teaser unterwegs, Full unter 10 km/h (Default).
 */
export type NavExploreMode = 'quiet' | 'mute_until_dest' | 'full';

/**
 * Modul-1 Ankunfts-Detail:
 * full = immersive Hauptstory (Default, bis ~1000).
 * brief = Kurzantwort Name + Zusammenfassung (opt-in, max 400).
 */
export type Module1StoryMode = 'brief' | 'full';

/** Geschlecht — für Ansprache / Reservierungen (optional). */
export type UserGender = 'female' | 'male' | 'diverse' | 'unspecified';

export type ProactiveAlertKind =
  | 'weather'
  | 'parking'
  | 'transit'
  | 'ambientEvents'
  | 'cityWelcome'
  | 'welcomeBack';

/**
 * Audio-Ausgabe:
 * - normal: TTS + Untertitel
 * - mute: kein TTS; Untertitel dürfen trotzdem erscheinen
 * - text_only: kein TTS; Untertitel/Text statt Stimme
 */
export type AudioOutputMode = 'normal' | 'mute' | 'text_only';

/**
 * Die 4 Säulen des Yorro-Profils — konsolidiert für jeden Gemini-Request.
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
  /** Modul-1 Ankunfts-/Deep-Dive-Story → ausführlich, nicht Chat-Kurzmodus */
  module1Narration?: boolean;
  /** UI „Mehr Historie“ */
  module1DeepDive?: boolean;
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

/** Detaillierte Mobilität (Was willst du erleben?). */
export type MobilityPrefs = {
  /** Zu Fuß: primary | rather_not */
  walk?: 'primary' | 'rather_not' | null;
  /** ÖPNV: love | if_needed | avoid */
  transit?: 'love' | 'if_needed' | 'avoid' | null;
  /** Fahrrad: own | rent | no */
  bike?: 'own' | 'rent' | 'no' | null;
  /** E-Scooter: own | rent | no (wie Fahrrad) */
  scooter?: 'own' | 'rent' | 'no' | null;
  /**
   * Gelerntes Fuß-Tempo (km/h) aus GPS-Segmenten — von paceProfile gepflegt.
   * Fallback wenn lokale Pace-Datei fehlt.
   */
  learnedWalkKmh?: number | null;
  /** Gelerntes Rad-Tempo (km/h) */
  learnedBikeKmh?: number | null;
  /** Wann zuletzt Tempo gelernt/gesynct */
  learnedPaceAtMs?: number | null;
  /**
   * Auto/Taxi-Bundle (Legacy car + Taxi-Spiegel):
   * taxi_love | taxi_saves_time | own | none
   * Settings: Taxi = love | if_saves_time | no
   */
  car?:
    | 'taxi_love'
    | 'taxi_saves_time'
    | 'own'
    | 'none'
    | 'own_use'
    | 'own_avoid'
    | null;
  /**
   * Taxi: Ja | nur notfalls | Nein
   * love | if_saves_time | no
   */
  taxi?: 'love' | 'if_saves_time' | 'no' | null;
};

export interface UserProfile {
  version: 1;
  setupComplete: boolean;
  language: AppLanguage;
  voiceId: VoiceId;
  /** Fest 1.0 — Sprechtempo-Slider entfernt. */
  speechRate: number;
  /** Cloud vs. lokale TTS — Default Cartesia, Systemstimme nur Fallback/Dev. */
  ttsProvider?: TtsProvider;
  firstName: string;
  /**
   * Optional: deutsche Buchstaben-Umschreibung nur für TTS
   * (Anzeige/Reservierung bleiben `firstName`).
   * Greift nur bei `firstNameSpeechHintEnabled === true`.
   */
  firstNameSpeechHint?: string;
  /**
   * Manuell: angepasste Aussprache in der Stimme nutzen.
   * Default aus — sonst bleibt die geschriebene Form.
   */
  firstNameSpeechHintEnabled?: boolean;
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
  /** Geschlecht (optional) — Über dich / Ansprache. */
  gender?: UserGender | null;
  age: number;
  /**
   * Schriftgröße: auto = ab 55 groß, sonst normal.
   * Override in Einstellungen oder per Sprache.
   */
  uiTextScale?: 'auto' | 'normal' | 'large';
  /**
   * Button-Größe: auto = ab 55 groß, sonst normal.
   */
  uiButtonScale?: 'auto' | 'normal' | 'large';
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
   * Einmaliges personalisiertes Map-Welcome + UI-Tutorial nach Setup schon gehört.
   */
  firstMapWelcomeDone?: boolean;
  /**
   * Dynamisch gelernte Fakten aus dem Gespräch
   * („Ich bin Vegetarier“, „Hotel Bluezeit“, …).
   */
  learnedFacts?: string[];
  /**
   * Strukturierte Antwort-Regeln aus Korrekturen
   * (Situation → expect/avoid — kein Script-Wortlaut).
   */
  learnedRules?: LearnedRule[];
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
  /**
   * Wie reist du? (Mehrfach: Auto, Bahn, Flieger, Fahrrad, Wandern, Reisebus).
   */
  travelModes?: import('../constants/conciergePrefs').TravelModeId[];
  /** Energielevel. */
  energyLevel?: EnergyLevel | null;
  /** Explizite Ernährungs-Tags. */
  dietaryTags?: string[];
  /**
   * Allergie-/Unverträglichkeits-Chips (IDs aus ALLERGY_INTOLERANCE_OPTIONS).
   * `keine` = explizit keine.
   */
  allergyTags?: string[];
  /** Freitext Allergien (Zusatz zu Chips). */
  allergies?: string;
  /** Antwortstil der KI. */
  answerStyle?: AnswerStyle | null;
  /** Must-see vs. Insider (abgeleitet / Legacy-Single). */
  touristMode?: TouristVsInsider | null;
  /**
   * Must-haves Mehrfachauswahl (Touri / Trubel / versteckt / Nachtleben).
   * Bei mehreren → Mix in touristMode + Prefs.
   */
  mustHaveStyles?: MustHaveStyleId[];
  /**
   * Modul 1 während Navigation (nur Settings, nicht Onboarding).
   * quiet = Default: Teaser unterwegs, Full unter 10 km/h.
   * mute_until_dest = stumm bis Ziel.
   * full = keine Nav-Kürzung.
   */
  navExploreMode?: NavExploreMode;
  /**
   * Modul-1 Ankunft: full = immersive Story (Default, ~1000);
   * brief = Kurzantwort Name + Zusammenfassung (Settings opt-in, max 400).
   */
  module1StoryMode?: Module1StoryMode;
  /** POI-/Tour-Hinweise erwünscht. */
  notificationsEnabled?: boolean;
  /**
   * Granulare Auto-Hinweise (Push + ungefragtes Sprechen).
   * Master: notificationsEnabled === false schaltet alles aus.
   * Fehlende Keys = an (Default).
   */
  proactiveAlerts?: {
    weather?: boolean;
    parking?: boolean;
    transit?: boolean;
    ambientEvents?: boolean;
    cityWelcome?: boolean;
    welcomeBack?: boolean;
  };
  /** Daten sparsam (kürzere Antworten, weniger Prefetch). */
  dataSaverMode?: boolean;
  /**
   * Audio-Ausgabe: Normal / Stumm / Nur Text.
   * Default: normal.
   */
  audioOutputMode?: AudioOutputMode;
  /**
   * Authentifizierter Premium-Subscriber → Gemini Pro erlaubt.
   * Ohne Flag bleibt Flash-Lite Primary.
   */
  isPremiumSubscriber?: boolean;

  /** Persönlichkeits-Matrix (Kat. 1–4). */
  coreRole?: import('../constants/personalityMatrix').CoreRoleId | null;
  vibeTone?: import('../constants/personalityMatrix').VibeToneId | null;
  knowledgeStyle?: import('../constants/personalityMatrix').KnowledgeStyleId | null;
  spleens?: import('../constants/personalityMatrix').SpleenId[];
  /** User hat Stimme manuell gewählt — Auto-Map nicht überschreiben. */
  voicePinnedByUser?: boolean;
  /** Account-Modus: Gast vs. registriert. */
  accountMode?: 'guest' | 'registered' | null;
  /** Newsletter Opt-in. */
  newsletterOptIn?: boolean;
  newsletterOptInAt?: string | null;
  /** Relationship / Companion soft flags. */
  humorOk?: boolean;
  geekMode?: boolean;
  freeChatOk?: boolean;
  openThreads?: string[];
  /** Detaillierte Mobilitäts-Prefs (Onboarding Erleben). */
  mobilityPrefs?: MobilityPrefs;
  /** Tourlänge: Stops, nicht Gehgeschwindigkeit. */
  tourLengthPref?: TourLengthPref | null;
  /** Restaurant-Niveau. */
  diningLevel?: 'fast_cheap' | 'decent' | 'highlights' | null;
  /** Accessibility-Detail gewünscht (öffnet Accessibility-Chips). */
  accessibilityCare?: boolean;
  /** Spotify Connect: Top-Artist-Namen. */
  spotifyTopArtists?: string[];
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

/** Gast: E-Mail + Telefon einmal nachziehen vor erster Reservierung. */
export function needsGuestReservationContact(
  profile: UserProfile | null | undefined,
): boolean {
  if (!profile) return true;
  if (profile.accountMode !== 'guest') return false;
  const email = (profile.email ?? '').trim();
  const phone = (profile.phoneNumber ?? '').replace(/\D/g, '');
  return !/@/.test(email) || phone.length < 6;
}

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

/** Einrichtung + Erklärung schon einmal durch — nach Re-Login nicht nochmal. */
export function profileHasFinishedSetup(
  p: UserProfile | null | undefined,
): boolean {
  if (!p) return false;
  return !!(p.setupComplete || p.firstMapWelcomeDone || p.completedAt);
}

export function createDefaultProfile(): UserProfile {
  return {
    version: 1,
    setupComplete: false,
    language: 'de',
    voiceId: 'alina',
    speechRate: 1,
    ttsProvider: 'cartesia',
    firstName: '',
    firstNameSpeechHint: '',
    firstNameSpeechHintEnabled: false,
    lastName: '',
    email: '',
    aboutMe: '',
    phoneNumber: '',
    gender: null,
    age: 30,
    uiTextScale: 'auto',
    uiButtonScale: 'auto',
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
    firstMapWelcomeDone: false,
    learnedFacts: [],
    learnedRules: [],
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
    travelModes: [],
    energyLevel: null,
    dietaryTags: [],
    allergyTags: [],
    allergies: '',
    answerStyle: 'short',
    touristMode: null,
    mustHaveStyles: [],
    navExploreMode: 'quiet',
    module1StoryMode: 'full',
    notificationsEnabled: true,
    proactiveAlerts: {},
    dataSaverMode: false,
    audioOutputMode: 'normal',
    isPremiumSubscriber: false,
    coreRole: null,
    vibeTone: null,
    knowledgeStyle: null,
    spleens: [],
    voicePinnedByUser: false,
    accountMode: null,
    newsletterOptIn: false,
    newsletterOptInAt: null,
    humorOk: false,
    geekMode: false,
    freeChatOk: false,
    openThreads: [],
    mobilityPrefs: {},
    tourLengthPref: null,
    diningLevel: null,
    accessibilityCare: false,
    spotifyTopArtists: [],
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
  'alina',
  'sebastian',
  'klaus',
  'leander',
  'lukas',
  'varson',
  'alexander',
  'daniel',
  'jaqcline',
  'lea',
  'rena',
  'katie',
  'skylar',
  'verini',
  'viktoria',
  'marlene',
]);

/** Alte Voice-IDs aus früheren Builds → 16 Cartesia-Personas. */
const LEGACY_VOICE_MAP: Record<string, VoiceId> = {
  standard_m: 'sebastian',
  standard_w: 'alina',
  erzaehler: 'lukas',
  dynamisch: 'daniel',
  martin: 'sebastian',
  maennlich: 'sebastian',
  neutral: 'sebastian',
  weiblich: 'alina',
  prinzessin: 'alina',
  genz: 'varson',
  gen_z: 'varson',
  aufgedreht: 'daniel',
  energy: 'daniel',
  energisch: 'daniel',
  ruhig: 'sebastian',
  dorfaelteste: 'klaus',
  dorfaeltester: 'klaus',
  historiker: 'marlene',
  jacqueline: 'jaqcline',
};

export function normalizeVoiceId(raw: string | undefined | null): VoiceId {
  if (!raw) return 'alina';
  if (VALID_VOICES.has(raw)) return raw as VoiceId;
  return LEGACY_VOICE_MAP[raw] ?? 'alina';
}
