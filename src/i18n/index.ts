import type { AppLanguage, VoiceId } from '../types/userProfile';
import { getVoice } from '../constants/voices';

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
  age: 'Alter',
  characterTitle: 'Wie soll ich sein?',
  characterHint:
    'Wähle einen KI-Charakter mit mindestens einer Eigenschaft pro Kategorie. Bei Barrierefreiheit darfst du auch nichts auswählen. Tippe auf das i für Erklärungen.',
  cityTitle: 'Wohin soll die Reise gehen?',
  nearby: 'In der Nähe',
  otherCities: 'Weitere Städte',
  zones: 'Zonen',
  places: 'Orte',
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
  settingsDeveloper: 'Entwickler',
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
  simOn: 'Simulation an',
  simOff: 'Simulation aus',
  voice_standard_m: 'Standard (männlich)',
  voice_standard_w: 'Standard (weiblich)',
  voice_prinzessin: 'Prinzessin',
  voice_erzaehler: 'Erzähler',
  voice_dorfaeltester: 'Dorfältester',
  voice_historiker: 'Historiker',
  voice_gen_z: 'Gen Z',
  voice_energisch: 'Energisch',
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
        : likes[0] ?? 'spannende Orte');

  const budgetHint =
    profile.experiencePrefs.budget === 'no'
      ? 'günstige Preise'
      : profile.experiencePrefs.budget === 'yes'
        ? 'ein großzügiges Budget'
        : 'ein mittleres Budget';

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

/** Charakter-treue Onboarding-Erklärung (Stimme + Stil). */
export function buildExplanationSegments(
  profile: SummaryProfile,
): ExplanationSegment[] {
  const { name, city, likeHint, budgetHint, introTail } =
    summaryContext(profile);
  const voiceId = profile.voiceId;

  if (voiceId === 'prinzessin') {
    return [
      {
        hint: 'none',
        text: `Sei gegrüßt, ${name}... Willkommen in ${city}, wo Geheimnisse blühn. Nach ${likeHint} halte ich Ausschau, fein — ${budgetHint}, notiert, so soll's sein.`,
      },
      {
        hint: 'none',
        text: `Du wanderst durch Gassen und Licht. Entdeck ich einen Ort von Gewicht, erzähl ich dir davon — sanft und dicht.`,
      },
      {
        hint: 'mic',
        text: `Hast du eine Frage im Sinn: Tippe kurz aufs Mikrofon, oder halte es fest und sprich — dann hör ich dich, klar und schlicht.`,
      },
      {
        hint: 'settings',
        text: `Das Zahnrad öffnet Einstellungen weit. Dort passt du mich an, jederzeit — und siehst den Verlauf der Tour beiseit.`,
      },
      {
        hint: 'none',
        text: `Nun denn, werter Gast: Auf königlichen Pfaden — viel Freude, die hält!`,
      },
    ];
  }

  if (voiceId === 'gen_z') {
    return [
      {
        hint: 'none',
        text: `Yo ${name}! Schön, dass du da bist. Tour durch ${city} kann los — Radar auf ${likeHint}, ${budgetHint} notiert${introTail}.`,
      },
      {
        hint: 'none',
        text: `Easy: Du läufst durch ${city}. Sieh ich was Fire, sag ich Bescheid. Safe.`,
      },
      {
        hint: 'mic',
        text: `Frage? Mikro tippen zum Tippen, oder halten und sprechen — dann klären wir das live.`,
      },
      {
        hint: 'settings',
        text: `Zahnrad = Settings. Dort tweaken und am Ende den ganzen Spot-Verlauf checken.`,
      },
      { hint: 'none', text: `Let's go — viel Spaß!` },
    ];
  }

  if (voiceId === 'dorfaeltester') {
    return [
      {
        hint: 'none',
        text: `Na, ${name}. Schön, dass du da bist. In ${city} kenn ich mich aus. Nach ${likeHint} schau ich, und ${budgetHint}, merke ich mir${introTail}.`,
      },
      {
        hint: 'none',
        text: `Du gehst einfach durch ${city}. Wenn ich was sehe, das sich lohnt, erzähl ich's dir.`,
      },
      {
        hint: 'mic',
        text: `Frage? Tippe aufs Mikrofon, oder halte es und sprich, dann hör ich zu.`,
      },
      {
        hint: 'settings',
        text: `Über das Zahnrad kommst du zu den Einstellungen. Dort kannst du mich anpassen und den Verlauf sehen.`,
      },
      { hint: 'none', text: `Viel Freude, mein Kind.` },
    ];
  }

  if (voiceId === 'historiker') {
    return [
      {
        hint: 'none',
        text: `Willkommen, ${name}. Die Tour durch ${city} kann beginnen. Fokus: ${likeHint}; Budget-Hinweis: ${budgetHint}${introTail}.`,
      },
      {
        hint: 'none',
        text: `Gehe durch ${city}. Bei relevanten Orten liefere ich Einordnung und Kontext.`,
      },
      {
        hint: 'mic',
        text: `Rückfragen: Mikrofon tippen zum Schreiben, oder gedrückt halten und sprechen.`,
      },
      {
        hint: 'settings',
        text: `Das Zahnrad öffnet die Einstellungen sowie den Verlauf besuchter Orte.`,
      },
      { hint: 'none', text: `Viel Erkenntnis beim Erkunden.` },
    ];
  }

  if (voiceId === 'erzaehler') {
    return [
      {
        hint: 'none',
        text: `Hey ${name}! Die Kamera läuft — Tour durch ${city}. Radar auf ${likeHint}, ${budgetHint} im Skript${introTail}.`,
      },
      {
        hint: 'none',
        text: `Du bewegst dich durch ${city}. Entdeck ich eine Szene, schneide ich sie dir live dazu.`,
      },
      {
        hint: 'mic',
        text: `Cut — Rückfrage? Mikro tippen oder halten und sprechen.`,
      },
      {
        hint: 'settings',
        text: `Zahnrad: Settings und der ganze Tour-Verlauf als Recap.`,
      },
      { hint: 'none', text: `Action — viel Spaß!` },
    ];
  }

  if (voiceId === 'energisch') {
    return [
      {
        hint: 'none',
        text: `Hey ${name}! Schön, dass du da bist — Tour durch ${city}, los! Radar auf ${likeHint}, ${budgetHint} notiert${introTail}.`,
      },
      {
        hint: 'none',
        text: `Du läufst durch ${city}. Seh ich was Cooles — sofort Report!`,
      },
      {
        hint: 'mic',
        text: `Frage? Mikro tippen oder halten und sprechen — wir klären das!`,
      },
      {
        hint: 'settings',
        text: `Zahnrad: Einstellungen und dein kompletter Spot-Verlauf.`,
      },
      { hint: 'none', text: `Volle Power — viel Spaß!` },
    ];
  }

  // standard_m / standard_w / Fallback
  return [
    {
      hint: 'none',
      text: `Hey ${name}! Schön, dass du da bist. Nun kann die Tour durch ${city} losgehen. Ich halte mein Radar nach ${likeHint} aus, ${budgetHint} sind notiert${introTail}.`,
    },
    {
      hint: 'none',
      text: `Wie geht's weiter? Du läufst einfach jetzt durch ${city}. Immer wenn ich etwas Schönes sehe und entdecke, berichte ich dir davon.`,
    },
    {
      hint: 'mic',
      text: `Hast du eine Rückfrage, dann drück einfach auf das Mikrofon. Kurz tippen zum Schreiben, oder gedrückt halten und sprechen – dann stelle ich deine Frage direkt.`,
    },
    {
      hint: 'settings',
      text: `Über das Zahnrad öffnest du die Einstellungen. Dort kannst du mich weiter anpassen oder am Ende einen kompletten Verlauf über alle besuchten Orte sehen.`,
    },
    {
      hint: 'none',
      text: `Viel Spaß beim Erkunden!`,
    },
  ];
}

export function buildSummarySpeech(profile: SummaryProfile): string {
  return buildExplanationSegments(profile)
    .map((s) => s.text)
    .join(' ');
}
