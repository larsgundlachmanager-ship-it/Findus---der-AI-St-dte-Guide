import type { AppLanguage, BudgetCategory, VoiceId } from '../types/userProfile';
import { getVoice } from '../constants/voices';
import { budgetSpeechFromProfile } from '../constants/budgetHints';

export type { AppLanguage };

type Dict = Record<string, string>;

const de: Dict = {
  langTitle: 'Sprachauswahl',
  langSubtitle: '',
  deutsch: 'Deutsch',
  continue: 'Weiter',
  skipIntro: 'Intro überspringen',
  skipExplanation: 'Erklärung überspringen',
  voiceTitle: 'Was soll ich für eine Stimme haben?',
  voiceMartinHint: 'Standard',
  speechRate: 'Sprechtempo',
  slower: 'Langsamer',
  faster: 'Schneller',
  preview: 'Hörprobe',
  aboutTitle: 'Über dich',
  firstName: 'Vorname',
  lastName: 'Nachname',
  email: 'E-Mail',
  aboutMe: 'Erzähl kurz etwas über dich',
  aboutMeHint:
    'Hobbies, Beruf, Familie oder Solo — plus Telefon & Geschlecht, was Yorro wissen soll…',
  age: 'Alter',
  characterTitle: 'Wie soll ich sein?',
  characterHint:
    'Persönlichkeit und Tonalität: Mehrfachauswahl, jeweils max. 3. Yorro mixt den Stil. Reisezweck und Begleitung dazu. Barrierefreiheit ist optional. Tippe auf das i für Erklärungen.',
  cityTitle: 'Wohin soll die Reise gehen?',
  nearby: 'In der Nähe',
  otherCities: 'Weitere Städte',
  citySearchTitle: 'Städtesuche:',
  zones: 'Zonen',
  places: 'Orte',
  triggers: 'Trigger',
  facts: 'Fakten',
  loadingCities: 'Städte werden geladen…',
  downloadingCity: 'Stadt wird heruntergeladen…',
  continueWith: 'Weiter mit',
  locatingGps: 'Standort wird ermittelt…',
  gpsReady: 'Standort gefunden',
  gpsUnavailable: 'Kein GPS – Städte ohne Entfernung',
  noCities: 'Keine Städte gefunden',
  noCitiesHint: 'Prüfe die Verbindung und versuche es erneut.',
  retryCities: 'Erneut laden',
  experienceTitle: 'Was willst du erleben?',
  wantExperience: 'Was willst du erleben?',
  avoidExperience: 'Was willst du nicht erleben?',
  neutral: 'Neutral',
  prefYes: 'Ja',
  prefNo: 'Nein',
  settings: 'Einstellungen',
  settingsVoice: 'Stimme',
  settingsLanguage: 'Sprache',
  settingsLanguageHint: 'Aktuell spricht Yorro Deutsch.',
  settingsCharacter: 'Yorros Charakter',
  settingsInterests: 'Interessen',
  settingsCity: 'Stadtauswahl',
  settingsCityCurrent: 'Aktuelle Stadt',
  citySearchPlaceholder: 'Stadt, Land, Bundesland, Insel…',
  citySearchHits: 'Treffer',
  citySearchNoHits: 'Keine Treffer',
  settingsDeveloper: 'Entwicklungseinstellungen',
  settingsLegal: 'Datenschutz & Impressum',
  settingsHelp: 'So funktioniert Yorro',
  settingsSetup: 'Einrichtung',
  legalImprintTitle: 'Impressum & Transparenz',
  legalPrivacyTitle: 'Datenschutz',
  affiliateDisclosure:
    'Sternchen (★) an Links: Partner-Links. Wenn du darüber buchst, erhält Yorro eine kleine Provision — Preis für dich gleich. Details in den Einstellungen.',
  cityInstallFailed: 'Stadt konnte nicht installiert werden',
  settingsStorage: 'Offline-Städte',
  settingsStorageHint:
    'Heruntergeladene Stadt-Packs und Offline-Karten. Tippen zum Löschen oder Aktualisieren — Zugang bleibt, Dateien kannst du jederzeit neu laden.',
  settingsStorageEmpty: 'Noch keine Offline-Städte auf dem Gerät.',
  settingsStorageActive: 'Aktiv — zuerst eine andere Stadt wählen',
  settingsStorageDelete: 'Löschen',
  settingsStorageDeleteTitle: 'Datensatz löschen?',
  settingsStorageDeleteBody:
    'Nur die lokale Kopie wird entfernt. Du kannst den Datensatz später wieder herunterladen.',
  settingsStorageTotal: 'Belegt',
  resetApp: 'App zurücksetzen',
  resetConfirm:
    'Einrichtung löschen und von vorne starten? Lokale Profildaten und Stimmen-Cache werden entfernt.',
  cancel: 'Abbrechen',
  save: 'Speichern',
  close: 'Schließen',
  years: 'Jahre',
  kmAway: 'km',
  setupDone: 'Einrichtung abgeschlossen',
  gpsSimulation: 'GPS-Simulation',
  gpsSimulationHint:
    'Echtes GPS aus. Neben dem Mikrofon erscheint „Ort“ — tippen, Modul 1 dort auslösen (als wärst du da).',
  ttsProvider: 'TTS-Engine',
  ttsProviderHint:
    'Cartesia sonic-3.5 ist die primäre Stimme. Offline: native Systemstimme (expo-speech).',
  ttsProviderOpenAi: 'Cartesia (Cloud)',
  ttsProviderSystemLabel: 'System (expo-speech)',
  ttsProviderCartesia: 'Cartesia sonic-3.5',
  ttsProviderSystem: 'System-Fallback',
  simOn: 'Simulation an',
  simOff: 'Simulation aus',
  gpsStatusTitle: 'GPS-Status',
  gpsStatusHint: 'Live-Diagnose: Dienste, Berechtigung, letzter Fix.',
  gpsProbe: 'Standort jetzt prüfen',
  gpsProbing: 'Prüfe…',
  voice_alina: 'Alina',
  voice_sebastian: 'Sebastian',
  voice_klaus: 'Klaus',
  voice_leander: 'Leander',
  voice_lukas: 'Lukas',
  voice_varson: 'Varson',
  voice_alexander: 'Alexander',
  voice_daniel: 'Daniel',
  voice_jaqcline: 'Jaqcline',
  voice_lea: 'Lea',
  voice_rena: 'Rena',
  voice_katie: 'Katie',
  voice_skylar: 'Skylar',
  voice_verini: 'Verini',
  voice_viktoria: 'Viktoria',
  voice_marlene: 'Marlene',
};

export function t(_lang: AppLanguage, key: string): string {
  return de[key] ?? key;
}

export function voiceLabel(_lang: AppLanguage, id: VoiceId): string {
  return t('de', `voice_${id}`);
}

export const INTRO_WELCOME_DE =
  'Kennst du das? Du willst eine Stadt erleben — und landest trotzdem die ganze Zeit am Handy. Google Maps bleibt offen, und wenn du essen willst, scrollst du zwanzig Minuten. Vor einem Gebäude schaust du es an — und fragst dich: was soll das sein? Genau das ändere ich. Hey — ich bin Yorro. Kopfhörer rein, ich lauf mit. Am Ort erzähl ich dir, was das ist — zu dem, was dich interessiert. Du fragst mit der Stimme, ich recherchiere und navigiere. Restaurant, Weg, Unterkunft: dieselbe Stimme. Wie dein Guide auf dem Städtetrip. Ich freu mich — aber zuerst will ich dich kennenlernen.';

/** Kurzer Opener – sofort hörbar (kalter Start). */
export const ONBOARDING_INTRO_HEAD_DE = 'Kennst du das?';

export type ExplanationHint =
  | 'none'
  | 'module1'
  | 'bullets'
  | 'actions'
  | 'mic'
  | 'settings'
  | 'settings_panel'
  | 'settings_voice'
  | 'live_hud'
  | 'passport'
  | 'nav_queue'
  | 'timeline'
  | 'help_prompt'
  | 'swipe'
  | 'location';

export type ExplanationSegment = {
  text: string;
  hint: ExplanationHint;
};

type SummaryProfile = {
  language: AppLanguage;
  firstName: string;
  cityName: string | null;
  characters: string[];
  experiencePrefs: Record<string, string>;
  wantToExperience: string;
  avoidExperience: string;
  voiceId: VoiceId;
  budgetCategory?: BudgetCategory | null;
};

function summaryContext(profile: SummaryProfile) {
  const name = profile.firstName.trim() || 'du';
  const city = profile.cityName ?? 'der Stadt';
  const voice = getVoice(profile.voiceId);

  const likes: string[] = [];
  for (const [key, val] of Object.entries(profile.experiencePrefs)) {
    if (val === 'yes') likes.push(key);
  }

  const likeHint =
    profile.wantToExperience.trim() ||
    (likes.includes('geheimtipps')
      ? 'Geheimtipps'
      : likes.includes('nachtleben')
        ? 'Rooftopbars und Nightlife'
        : likes.includes('insta')
          ? 'foto-taugliche Spots'
          : likes[0] ?? 'spannende Orte');

  const budgetHint = budgetSpeechFromProfile(profile);

  const historyHate =
    profile.experiencePrefs.jahreszahlen === 'no' ||
    profile.experiencePrefs.geschichte === 'no';

  const persona = profile.characters.includes('genz_char')
    ? 'junger Hipper'
    : profile.characters.includes('historiker_char')
      ? 'neugieriger Historiker'
      : profile.characters.includes('fuersorglich')
        ? 'fürsorglicher Begleiter'
        : voice.id === 'daniel' || voice.id === 'varson'
          ? 'dynamischer Guide'
          : 'dein persönlicher Guide';

  const introTail = historyHate
    ? `, und ganz ehrlich — ich als ${persona} interessiere mich jetzt auch nicht so wirklich für endlose Jahreszahlen`
    : `, und als ${persona} freue ich mich richtig darauf`;

  return { name, city, likeHint, budgetHint, introTail };
}

function coreExplanation(
  name: string,
  city: string,
  likeHint: string,
  budgetHint: string,
  introTail: string,
  tone: 'standard' | 'genz' | 'prinzessin' | 'dorf' | 'historiker' | 'erzaehler',
): { opener: string; segments: ExplanationSegment[] } {
  if (tone === 'prinzessin') {
    return {
      opener: `Sei gegrüßt, ${name} — willkommen in ${city}.`,
      segments: [
        {
          hint: 'none',
          text: `Nach ${likeHint} halte ich Ausschau, fein — ${budgetHint}, notiert${introTail}.`,
        },
        {
          hint: 'none',
          text: `Du wanderst einfach durch ${city}. Oben links siehst du, wo du bist und was gerade läuft. Entdeck ich einen Ort von Gewicht, erzähl ich dir davon — sanft und dicht.`,
        },
        {
          hint: 'mic',
          text: `Wünsche einsprechen reicht: Tippe kurz aufs Mikrofon, oder halte es und sprich — Busverbindungen, Tischreservierung, Hotels, Touren.`,
        },
        {
          hint: 'settings',
          text: `Unten rechts unter Einst. passt du mich an — Stimme, Profil, Audio — jederzeit.`,
        },
        {
          hint: 'none',
          text: `Ich finde für dich, wo etwas liegt, checke Verbindungen, suche Hotels und buche Touren, wenn du magst. Nun denn — auf königlichen Pfaden!`,
        },
      ],
    };
  }

  if (tone === 'genz') {
    return {
      opener: `Yo ${name}! Nice — Tour durch ${city} kann los.`,
      segments: [
        {
          hint: 'none',
          text: `Radar auf ${likeHint}, ${budgetHint} notiert${introTail}.`,
        },
        {
          hint: 'none',
          text: `Easy: Du läufst durch ${city}. Oben links siehst du Status und wo du bist. Sieh ich was Fire, sag ich Bescheid. Safe.`,
        },
        {
          hint: 'mic',
          text: `Einfach reinrufen, was du willst: Mikro tippen oder halten — Bus, Tisch, Hotel, Tour. Wir klären das live.`,
        },
        {
          hint: 'settings',
          text: `Zahnrad oben = Settings und dein Spot-Verlauf. Dort tweaken, wenn du willst.`,
        },
        {
          hint: 'none',
          text: `Yorro checkt Verbindungen, sagt wo was ist, reserviert Tische, sucht Hotels und bucht Touren. Komm, wir düsen los!`,
        },
      ],
    };
  }

  if (tone === 'dorf') {
    return {
      opener: `Na, ${name}. Schön, dass du da bist — in ${city} kenn ich mich aus.`,
      segments: [
        {
          hint: 'none',
          text: `Nach ${likeHint} schau ich, und ${budgetHint}, merke ich mir${introTail}.`,
        },
        {
          hint: 'none',
          text: `Du gehst einfach durch ${city}. Oben links siehst du, wo wir sind. Wenn ich was sehe, das sich lohnt, erzähl ich's dir.`,
        },
        {
          hint: 'mic',
          text: `Sag mir einfach, was du brauchst: Tippe aufs Mikrofon oder halte es und sprich — Bus, Essen, Hotel, Tour.`,
        },
        {
          hint: 'settings',
          text: `Über das Zahnrad oben kommst du zu den Einstellungen und siehst den Verlauf.`,
        },
        {
          hint: 'none',
          text: `Ich prüfe Verbindungen, sage wo was liegt, helfe bei Reservierungen und Unterkünften. Viel Freude, mein Kind.`,
        },
      ],
    };
  }

  if (tone === 'historiker') {
    return {
      opener: `Willkommen, ${name}. Die Tour durch ${city} kann beginnen.`,
      segments: [
        {
          hint: 'none',
          text: `Fokus: ${likeHint}; Budget: ${budgetHint}${introTail}.`,
        },
        {
          hint: 'none',
          text: `Gehe durch ${city}. Oben links siehst du Standort und Status. Bei relevanten Orten liefere ich Einordnung und Kontext.`,
        },
        {
          hint: 'mic',
          text: `Rückfragen und Wünsche: Mikrofon tippen zum Schreiben, oder gedrückt halten und sprechen — Verbindungen, Reservierungen, Hotels, Touren.`,
        },
        {
          hint: 'settings',
          text: `Unten rechts unter Einst. öffnest du die Einstellungen; unter Orte suchst und filterst du Plätze.`,
        },
        {
          hint: 'none',
          text: `Ich prüfe Bus und Bahn, nenne dir Lagen, helfe bei Tischen und Unterkünften und kann Touren anbahnen. Viel Erkenntnis beim Erkunden.`,
        },
      ],
    };
  }

  if (tone === 'erzaehler') {
    return {
      opener: `Hey ${name}! Die Kamera läuft — Tour durch ${city}.`,
      segments: [
        {
          hint: 'none',
          text: `Radar auf ${likeHint}, ${budgetHint} im Skript${introTail}.`,
        },
        {
          hint: 'none',
          text: `Du bewegst dich durch ${city}. Oben links: Status und Ort. Entdeck ich eine Szene, schneide ich sie dir live dazu.`,
        },
        {
          hint: 'mic',
          text: `Cut — Wunsch? Mikro tippen oder halten und sprechen: Bus, Tisch, Hotel, Tour. Wir drehen weiter.`,
        },
        {
          hint: 'settings',
          text: `Unten: Timeline für den Tag, Orte zum Suchen, Einst. für Settings.`,
        },
        {
          hint: 'none',
          text: `Verbindungen, Locations, Reservierungen, Hotels, Touren — alles im Paket. Action — viel Spaß!`,
        },
      ],
    };
  }

  return {
    opener: `Hey ${name}! Schön, dass du da bist — Tour durch ${city} kann los.`,
    segments: [
      {
        hint: 'none',
        text: `Kurz zusammengefasst: Ich halte Ausschau nach ${likeHint}, ${budgetHint} sind notiert${introTail}.`,
      },
      {
        hint: 'none',
        text: `Du läufst einfach durch ${city}. Oben links siehst du Ort und Status. Entdeck ich etwas Spannendes, erzähl ich dir live davon.`,
      },
      {
        hint: 'none',
        text: `Dein Home ist die Karte. Oben wischst du durch Live-Karten — Ort, Wetter, Tipps. Unten: Timeline, Orte mit Legende, und Einst.`,
      },
      {
        hint: 'mic',
        text: `Einsprechen reicht: Mikro tippen zum Schreiben, oder halten und sprechen — Bus, Tisch, Hotel, Tour.`,
      },
      {
        hint: 'settings',
        text: `Rechts unten unter Einst. findest du Stimme, Persönlichkeit, Interessen und Datenschutz. Schau einmal rein, dann kennst du alles.`,
      },
      {
        hint: 'none',
        text: `Ich checke Verbindungen, sage wo was liegt, helfe bei Reservierungen und Unterkünften. Viel Spaß beim Erkunden!`,
      },
    ],
  };
}

function explanationTone(
  voiceId: VoiceId,
): 'standard' | 'genz' | 'prinzessin' | 'dorf' | 'historiker' | 'erzaehler' {
  if (voiceId === 'alina' || voiceId === 'lea' || voiceId === 'viktoria') {
    return 'prinzessin';
  }
  if (voiceId === 'daniel' || voiceId === 'varson') return 'genz';
  if (voiceId === 'lukas') return 'erzaehler';
  if (voiceId === 'marlene') return 'historiker';
  if (voiceId === 'klaus') return 'dorf';
  return 'standard';
}

/** Kurzer Opener + Rest-Segmente (Opener startet sofort, Rest in die TTS-Warteschlange). */
export function buildExplanationParts(profile: SummaryProfile): {
  opener: string;
  segments: ExplanationSegment[];
} {
  const { name, city, likeHint, budgetHint, introTail } =
    summaryContext(profile);
  return coreExplanation(
    name,
    city,
    likeHint,
    budgetHint,
    introTail,
    explanationTone(profile.voiceId),
  );
}

/** Charakter-treue Onboarding-Erklärung (Stimme + Stil). */
export function buildExplanationSegments(
  profile: SummaryProfile,
): ExplanationSegment[] {
  const { opener, segments } = buildExplanationParts(profile);
  return [{ hint: 'none', text: opener }, ...segments];
}

export function buildExplanationOpener(profile: SummaryProfile): string {
  return buildExplanationParts(profile).opener;
}

export function buildSummarySpeech(profile: SummaryProfile): string {
  const { opener, segments } = buildExplanationParts(profile);
  return [opener, ...segments.map((s) => s.text)].join(' ');
}
