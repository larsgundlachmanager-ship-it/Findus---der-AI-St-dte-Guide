import type { AppLanguage, BudgetCategory, VoiceId } from '../types/userProfile';
import { getVoice } from '../constants/voices';
import { budgetSpeechFromProfile } from '../constants/budgetHints';

type Dict = Record<string, string>;

const de: Dict = {
  langTitle: 'Sprachauswahl',
  langSubtitle: '',
  deutsch: 'Deutsch',
  continue: 'Weiter',
  skipIntro: 'Weiter',
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
    'Hobbies, Stimmung, was dir wichtig ist — Findus merkt sich das für Tipps.',
  age: 'Alter',
  characterTitle: 'Wie soll ich sein?',
  characterHint:
    'Wähle Persönlichkeit, Ton, Reisezweck und mit wem du unterwegs bist. Bei Barrierefreiheit darfst du auch nichts auswählen. Tippe auf das i für Erklärungen.',
  cityTitle: 'Wohin soll die Reise gehen?',
  nearby: 'In der Nähe',
  otherCities: 'Weitere Städte',
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
  settingsLanguageHint: 'Aktuell spricht Findus Deutsch.',
  settingsCharacter: 'Charakter',
  settingsInterests: 'Interessen',
  settingsCity: 'Stadt',
  settingsCityCurrent: 'Aktuelle Stadt',
  settingsCityLinks: 'Stadtinfo & Karten',
  settingsCityLinkOpen: 'Im Browser öffnen',
  settingsDeveloper: 'Entwicklungseinstellungen',
  settingsLegal: 'Datenschutz & Impressum',
  settingsHelp: 'So funktioniert Findus',
  settingsSetup: 'Einrichtung',
  legalImprintTitle: 'Impressum & Transparenz',
  legalPrivacyTitle: 'Datenschutz',
  affiliateDisclosure:
    'Hinweis: Einige Links in Findus sind sogenannte Affiliate-Links. Wenn du darüber buchst, erhalten wir eine kleine Provision – für dich ändert sich am Preis nichts.',
  cityInstallFailed: 'Stadt konnte nicht installiert werden',
  resetApp: 'App zurücksetzen',
  resetConfirm:
    'Einrichtung löschen und von vorne starten? Lokale Profildaten und Stimmen-Cache werden entfernt.',
  cancel: 'Abbrechen',
  save: 'Speichern',
  close: 'Schließen',
  years: 'Jahre',
  kmAway: 'km entfernt',
  setupDone: 'Einrichtung abgeschlossen',
  gpsSimulation: 'GPS-Simulation',
  gpsSimulationHint:
    'Statt echtem GPS Orte manuell auswählen – praktisch zum Testen.',
  ttsProvider: 'TTS-Engine',
  ttsProviderHint:
    'OpenAI = Cloud-Stimme „nova“. Lokal = Kokoro/Piper auf dem Gerät.',
  ttsProviderOpenAi: 'OpenAI (nova)',
  ttsProviderKokoro: 'Lokal (Kokoro)',
  simOn: 'Simulation an',
  simOff: 'Simulation aus',
  gpsStatusTitle: 'GPS-Status',
  gpsStatusHint: 'Live-Diagnose: Dienste, Berechtigung, letzter Fix.',
  gpsProbe: 'Standort jetzt prüfen',
  gpsProbing: 'Prüfe…',
  voice_standard_m: 'Standard männlich',
  voice_standard_w: 'Standard weiblich',
  voice_prinzessin: 'Prinzessin',
  voice_erzaehler: 'Erzähler',
  voice_dorfaeltester: 'Dorfältester',
  voice_historiker: 'Historiker',
  voice_gen_z: 'Gen Z',
};

export function t(_lang: AppLanguage, key: string): string {
  return de[key] ?? key;
}

export function voiceLabel(_lang: AppLanguage, id: VoiceId): string {
  return t('de', `voice_${id}`);
}

export const INTRO_WELCOME_DE =
  'Hallo und herzlich willkommen. Ich bin Findus. Ich bin kein normaler Audioguide, der einfach nur Texte vorliest. Ich bin das, was du aus mir machst. Gleich darfst du entscheiden, wie ich klingen soll, ob als weiser Historiker, als lockerer Kumpel oder als die gute Seele des Ortes. Lass uns gemeinsam dein Profil anlegen, damit ich dir die Stadt genauso erklären kann, wie es perfekt zu dir passt. Ich freue mich auf dich.';

/** Kurzer Opener – sofort hörbar. */
export const ONBOARDING_INTRO_HEAD_DE =
  'Hallo und herzlich willkommen. Ich bin Findus.';

export type ExplanationHint = 'none' | 'mic' | 'settings';

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
        : voice.id === 'gen_z'
          ? 'Gen-Z Guide'
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
          text: `Das Zahnrad oben öffnet Einstellungen und den Tour-Verlauf — dort passt du mich an, jederzeit.`,
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
          text: `Findus checkt Verbindungen, sagt wo was ist, reserviert Tische, sucht Hotels und bucht Touren. Komm, wir düsen los!`,
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
          text: `Das Zahnrad oben öffnet die Einstellungen sowie den Verlauf besuchter Orte.`,
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
          text: `Zahnrad oben: Settings und der ganze Tour-Verlauf als Recap.`,
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
        text: `Ich halte mein Radar nach ${likeHint} aus, ${budgetHint} sind notiert${introTail}.`,
      },
      {
        hint: 'none',
        text: `So funktioniert's: Du läufst einfach durch ${city}. Oben links siehst du, wo du bist und was gerade läuft. Immer wenn ich etwas Spannendes entdecke, berichte ich dir davon — live, wie ein Concierge neben dir.`,
      },
      {
        hint: 'mic',
        text: `Das Beste: Du musst nur einsprechen, was du willst. Tippe aufs Mikrofon oder halte es und sprich — zum Beispiel „Nächster Bus zum Dom“, „Tisch für zwei um acht“, „Hotel in der Nähe“ oder „Buch mir eine Tour“.`,
      },
      {
        hint: 'settings',
        text: `Über das Zahnrad oben links öffnest du Einrichtung, Hilfe und Datenschutz. Dort passt du mich an und siehst den Tour-Verlauf — also wo du schon warst.`,
      },
      {
        hint: 'none',
        text: `Findus checkt Bus- und Bahnverbindungen, sagt dir wo was liegt, hilft bei Tischreservierungen, sucht Hotels und kann Touren anbahnen — die neueste Reise-App, die wirklich mitdenkt. Viel Spaß beim Erkunden!`,
      },
    ],
  };
}

function explanationTone(
  voiceId: VoiceId,
): 'standard' | 'genz' | 'prinzessin' | 'dorf' | 'historiker' | 'erzaehler' {
  if (voiceId === 'prinzessin') return 'prinzessin';
  if (voiceId === 'gen_z') return 'genz';
  if (voiceId === 'dorfaeltester') return 'dorf';
  if (voiceId === 'historiker') return 'historiker';
  if (voiceId === 'erzaehler') return 'erzaehler';
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
