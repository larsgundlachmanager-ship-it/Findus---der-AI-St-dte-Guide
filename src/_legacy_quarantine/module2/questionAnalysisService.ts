/**
 * Modul 2 — Fragen zerlegen, Kontext binden, Self-Check vor Antwort.
 * Strukturierter Reasoning-Block für Gemini (kein User-Template-Text).
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { formatGpsTrackForPrompt, getMovementSummary } from '../navigation/gpsTrackBuffer';
import { formatSessionMemoryForPrompt } from '../ai/sessionMemory';
import { formatUserMemoryForPrompt } from '../../store/useUserMemoryStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';

export type QuestionAnalysis = {
  /** Fakten die der User mitgibt („ich fliege um 10:15“) */
  statedFacts: string[];
  /** Explizite Teilfragen */
  subQuestions: string[];
  /** Kern-Intent in einem Satz */
  userGoal: string;
  /** new_topic | follow_up | clarification */
  topicMode: 'new_topic' | 'follow_up' | 'clarification';
  /** Bezug zu vorherigem Turn? */
  relatesToPrior: boolean;
  priorTopicHint: string | null;
  /** Was muss recherchiert / geprüft werden */
  researchTasks: string[];
  /** Validierungen vor Antwort (Öffnungszeiten, Route, Bewertung …) */
  sanityChecks: string[];
  /** Mögliche User-Rückfragen antizipieren */
  anticipatedFollowUps: string[];
  /** Prompt-Block für System */
  promptBlock: string;
};

const FACT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ich|wir)\s+(flieg\w*|nehme?\w*\s+(den|einen)\s+flug)/iu, 'Flug/Reise genannt'],
  [/\bum\s+\d{1,2}[:\.]?\d{0,2}\s*uhr/iu, 'Konkrete Uhrzeit genannt'],
  [/\b(morgen|heute|übermorgen|uebermorgen|abends?|früh|frueh)\b/iu, 'Zeitbezug'],
  [/\b(\d+)\s*(person(en|s)?|leute|pax)\b/iu, 'Personenzahl'],
  [/\b(vegetarisch|vegan|gluten|allerg)/iu, 'Ernährung/Allergie'],
  [/\b(hotel|unterkunft|zimmer)\b/iu, 'Unterkunft-Kontext'],
  [/\b(durst|durstig|wasser|bier|trinken)\b/iu, 'Getränke-Bedarf'],
  [/\b(strand|sonne|creme|sonnenschutz)\b/iu, 'Strand/Wetter-Kontext'],
];

const SUB_Q_PATTERNS: Array<[RegExp, string]> = [
  [/\bwann\s+(muss|soll|kann|müsste|muesste)\b/iu, 'Wann / Timing'],
  [/\bwie\s+(teuer|viel\s+kostet|spät|weit|lange)\b/iu, 'Wie (Kosten/Distanz/Dauer)'],
  [/\bwo\s+(bin\s+ich|stehe\s+ich|ist|gibt\s+es|kann\s+ich)\b/iu, 'Wo / Ort'],
  [/\b(hat\s+.*\s+auf|geöffnet|geoeffnet|offen)\b/iu, 'Öffnungsstatus'],
  [/\b(reservier|tisch|platz|buchen|ticket)\b/iu, 'Buchung/Reservierung'],
  [/\b(route|navigier|hinbringen|weg\s+dahin)\b/iu, 'Navigation'],
  [/\b(speisekarte|menü|menu|gerichte|spezialität)/iu, 'Speisekarte/Inhalt'],
  [/\b(was\s+geht|events?|programm|heute\s+abend)\b/iu, 'Events/Programm'],
];

function extractByPatterns(text: string, patterns: Array<[RegExp, string]>): string[] {
  const out: string[] = [];
  for (const [re, label] of patterns) {
    if (re.test(text)) out.push(label);
  }
  return [...new Set(out)];
}

function inferTopicMode(
  text: string,
  lastAssistant: string | null,
): Pick<QuestionAnalysis, 'topicMode' | 'relatesToPrior' | 'priorTopicHint'> {
  const t = text.trim();
  const pivot =
    /\b(übrigens|uebrigens|ach\s+so|neue\s+frage|anderes\s+thema|stattdessen|eigentlich|vergiss|egal)\b/iu.test(
      t,
    );
  const follow =
    /\b(da|dazu|damit|noch\s+mal|genauer|und\s+(was|wann|wo|wie))\b/iu.test(t) ||
    /\b(ja|nein|okay|ok)\b/iu.test(t);

  if (pivot || (!follow && lastAssistant && t.length < 30)) {
    return {
      topicMode: 'new_topic',
      relatesToPrior: false,
      priorTopicHint: null,
    };
  }
  if (follow && lastAssistant) {
    return {
      topicMode: 'follow_up',
      relatesToPrior: true,
      priorTopicHint: lastAssistant.slice(0, 120),
    };
  }
  if (/\?\s*$/.test(t) && lastAssistant) {
    return {
      topicMode: 'clarification',
      relatesToPrior: true,
      priorTopicHint: lastAssistant.slice(0, 120),
    };
  }
  return {
    topicMode: 'new_topic',
    relatesToPrior: false,
    priorTopicHint: lastAssistant?.slice(0, 80) ?? null,
  };
}

export function buildHeuristicAnalysis(text: string): QuestionAnalysis {
  const store = useFinnusStore.getState();
  const history = store.chatHistory;
  const lastAssistant =
    [...history].reverse().find((m) => m.role === 'assistant')?.content ?? null;
  const topic = inferTopicMode(text, lastAssistant);
  const movement = getMovementSummary();
  const profile = getCachedUserProfile();

  const statedFacts = extractByPatterns(text, FACT_PATTERNS);
  const subQuestions = extractByPatterns(text, SUB_Q_PATTERNS);
  if (subQuestions.length === 0 && /\?/.test(text)) {
    subQuestions.push('Hauptfrage (siehe User-Text)');
  }

  const researchTasks: string[] = [];
  const sanityChecks: string[] = [];
  const anticipated: string[] = [];

  if (/\b(restaurant|essen|bistro|café|cafe)\b/iu.test(text)) {
    researchTasks.push('Öffnungszeiten + Speisekarte/PDF + Bewertung');
    sanityChecks.push('Hat das Lokal JETZT auf? Passt Ernährung?');
    anticipated.push('Wie teuer?', 'Speisekarte?', 'Route dorthin?');
  }
  if (/\b(flug|flieger|inselflieger|flughafen|flugplatz)\b/iu.test(text)) {
    researchTasks.push('Konkreter Flugplatz + morgen/heute Slots + Preise live');
    researchTasks.push('Hotel→Flugplatz ETA + Ankunftspuffer (Security/Check-in)');
    researchTasks.push('Hotel Checkout + Frühstück live nachschlagen');
    researchTasks.push('Gepäck-Optionen (Hotel / Spot / mitnehmen)');
    sanityChecks.push('Passt Personenzahl zu freien Plätzen?');
    sanityChecks.push('Leave-by = Abflug − Fußweg − Puffer?');
    anticipated.push('Preis für Gruppe?', 'Gepäck?', 'Route zum Flugplatz?', 'Zeitlücke füllen?');
  }
  if (/\b(erinner|pünktlich|puenktlich).{0,40}\b(flieg|flug)|(?:flieg|flug).{0,40}\b(erinner|pünktlich)/iu.test(text)) {
    researchTasks.push('Flight-Day Orchestrator: Leave-by + Reminder + Session-Plan');
  }
  if (/\b(wo\s+bin\s+ich|wo\s+stehe\s+ich|was\s+ist\s+das)\b/iu.test(text)) {
    researchTasks.push('GPS + Blickrichtung → aktueller POI/Facts oder Web');
    sanityChecks.push('Stimmt POI mit Position?');
    anticipated.push('Mehr Geschichte?', 'Route woanders hin?');
  }
  if (/\b(schaff|reicht\s+(?:die\s+)?zeit|noch\s+(?:zum|zur|an)|vor\s+(?:dem|meinem)\s+flug|bevor\s+(?:ich\s+)?flieg)\b/iu.test(text)) {
    researchTasks.push('Side-Trip vs. Leave-by: Hin+Rück+Aufenthalt vs. Flug-Deadline');
    sanityChecks.push('Puffer ≥15 Min? Verspätung prüfen.');
    anticipated.push('Route trotzdem?', 'Alternative vorschlagen?');
  }
  if (/\b(verzehrgutschein|gutschein|erinner.{0,30}gutschein)\b/iu.test(text)) {
    researchTasks.push('Verzehrgutschein speichern + im Abreiseplan erwähnen');
    anticipated.push('Vor Abflug einlösen?');
  }
  if (/\b(heute\s+abend|abendessen|essen\s+gehen|restaurant.{0,30}(vorschlag|empfehl)|sonnenuntergang.{0,30}essen)\b/iu.test(text)) {
    researchTasks.push('Evening Dining: Hotel-Distanz · Budget · Bewertung · Aussicht · Öffnung');
    sanityChecks.push('Offen zur Wunschzeit? Im Budget oder ehrlich drüber?');
    anticipated.push('Tisch reservieren?', 'Speisekarte?', 'Route?', 'Weiter suchen?');
  }
  if (/\b(durst|wasser|kiosk|supermarkt|trinken|bier)\b/iu.test(text)) {
    researchTasks.push('Kiosk/Supermarkt in Gehrichtung (GPS-Bearing)');
    sanityChecks.push('Hat auf? Entfernung plausibel?');
    anticipated.push('Route?', 'Alternativen?');
  }
  if (/\b(toilette|klo|wc|geldautomat|atm|wlan|wifi|trinkwasser)\b/iu.test(text)) {
    researchTasks.push('Nächste praktische Infra (OSM/Discovery) + Route-Button');
    sanityChecks.push('Offen / erreichbar?');
    anticipated.push('Route starten?');
  }
  if (/\b(öffnungszeit|oeffnungszeit|hat\s+.*\s+auf|geöffnet|geoeffnet)\b/iu.test(text)) {
    researchTasks.push('Öffnungszeiten live / Web — nichts schätzen');
    sanityChecks.push('Quelle belegt?');
    anticipated.push('Route?', 'Speisekarte?');
  }
  if (/\b(ticket|tickets|eintritt)\b/iu.test(text)) {
    researchTasks.push('Ticket/Eintritt: Kauf-Link oder ehrlicher Hinweis');
    anticipated.push('OPEN_URL Ticket?', 'Route?');
  }
  if (/\b(richtige\s+richtung|gehe?\s+ich\s+richtig|richtig\s+unterwegs)\b/iu.test(text)) {
    researchTasks.push('Aktive Navigation vs. Bewegungsvektor prüfen');
    sanityChecks.push('Nav aktiv?');
  }
  if (/\b(speisekarte|menü|menu|übersetz|uebersetz)\b/iu.test(text)) {
    researchTasks.push('Speisekarte-URL fetchen + Gerichte auf Deutsch erklären');
    sanityChecks.push('URL vorhanden? Sonst ehrlich sagen.');
  }
  if (/\b(notfall|notruf|krankenhaus|apotheke|verloren|verlaufen)\b/iu.test(text)) {
    researchTasks.push('112 + nächste Hilfe/Hotel — nie so tun als würde Notruf abgesetzt');
  }
  if (/\b(plane\s+.*reise|wochenende\s+in|was\s+soll\s+ich\s+machen)\b/iu.test(text)) {
    researchTasks.push('Leichter Multi-Stop aus Session/Memory (Pack-Center ok ohne GPS)');
    anticipated.push('Tour starten?', 'Ersten Stopp navigieren?');
  }
  if (/\b(strand|sonne|warm|hitze)\b/iu.test(text)) {
    researchTasks.push('Wetter + Strand-Tipp');
    sanityChecks.push('Sonnenschutz-Hinweis sinnvoll?');
    anticipated.push('Route Strand?', 'Sonnencreme kaufen?');
  }

  const userGoal =
    subQuestions.length > 0
      ? subQuestions.join(' · ')
      : 'User-Anliegen aus Freitext verstehen und konkret helfen';

  const promptBlock = [
    '=== FRAGEN-ANALYSE (PFLICHT DURCHARBEITEN) ===',
    `User-Ziel: ${userGoal}`,
    topic.topicMode === 'new_topic'
      ? 'TOPIC-CUT: Neue Frage — vorheriges Thema nicht weiterführen unless User verbindet.'
      : `FOLLOW-UP zu: „${topic.priorTopicHint ?? '—'}“`,
    statedFacts.length
      ? `Mitgegebene Fakten: ${statedFacts.join(' · ')}`
      : 'Keine expliziten Fakten erkannt — trotzdem alles aus Satz extrahieren.',
    subQuestions.length
      ? `Teilfragen (ALLE beantworten): ${subQuestions.map((q, i) => `${i + 1}) ${q}`).join(' · ')}`
      : '',
    movement.bearingDeg != null
      ? `Bewegung: ~${movement.speedKmh?.toFixed(1) ?? '?'} km/h Richtung ${Math.round(movement.bearingDeg)}°`
      : '',
    store.currentLocationName
      ? `Aktueller Ort laut App: ${store.currentLocationName}`
      : '',
    profile?.cityName ? `Stadt: ${profile.cityName}` : '',
    researchTasks.length ? `Recherche: ${researchTasks.join(' · ')}` : '',
    sanityChecks.length ? `Vor Antwort prüfen: ${sanityChecks.join(' · ')}` : '',
    anticipated.length ? `Antizipierte Rückfragen einweben: ${anticipated.join(' · ')}` : '',
    '',
    'SELF-CHECK vor JSON-Ausgabe:',
    '1) Habe ich JEDE Teilfrage beantwortet?',
    '2) Macht mein Vorschlag Sinn (offen, erreichbar, bewertet)?',
    '3) speechText kompakt — KEINE Adressen unless User fragt explizit.',
    '4) quickActions = genau das Gesagte (Route · PDF · Ticket · Speisekarte).',
    '5) Keine Dead-End-Antwort — JUST-DO-IT (findusResponsePolicy): Ergebnis liefern, nicht „Soll ich nachschauen?“.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    statedFacts,
    subQuestions,
    userGoal,
    ...topic,
    researchTasks,
    sanityChecks,
    anticipatedFollowUps: anticipated,
    promptBlock,
  };
}

/**
 * Heuristik + optional Gemini-Verfeinerung für komplexe Multi-Intent-Fragen.
 */
export async function analyzeUserQuestion(
  text: string,
): Promise<QuestionAnalysis> {
  const base = buildHeuristicAnalysis(text);
  const complex =
    (base.subQuestions.length >= 2 || base.statedFacts.length >= 2) &&
    text.trim().length > 40;

  if (!complex) return base;

  const offline = await isDeviceOffline();
  if (offline || !hasGeminiApiKey()) return base;

  try {
    const raw = await generateGeminiText(
      [
        'Zerlege die User-Frage strukturiert. Antworte NUR JSON:',
        '{',
        '  "statedFacts": ["..."],',
        '  "subQuestions": ["..."],',
        '  "userGoal": "ein Satz",',
        '  "topicMode": "new_topic|follow_up|clarification",',
        '  "relatesToPrior": true|false,',
        '  "researchTasks": ["..."],',
        '  "sanityChecks": ["..."],',
        '  "anticipatedFollowUps": ["..."]',
        '}',
        '',
        `GPS-Kontext:\n${formatGpsTrackForPrompt()}`,
        `Memory:\n${formatUserMemoryForPrompt().slice(0, 600)}`,
        '',
        `User: „${text.trim().slice(0, 500)}“`,
      ].join('\n'),
      { task: 'generic', maxTokens: 500, temperature: 0.2, useFindusSystem: false },
    );
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return base;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<QuestionAnalysis>;
    return {
      ...base,
      statedFacts: Array.isArray(parsed.statedFacts)
        ? parsed.statedFacts.map(String).slice(0, 8)
        : base.statedFacts,
      subQuestions: Array.isArray(parsed.subQuestions)
        ? parsed.subQuestions.map(String).slice(0, 6)
        : base.subQuestions,
      userGoal: String(parsed.userGoal ?? base.userGoal),
      topicMode:
        parsed.topicMode === 'follow_up' ||
        parsed.topicMode === 'clarification' ||
        parsed.topicMode === 'new_topic'
          ? parsed.topicMode
          : base.topicMode,
      relatesToPrior: Boolean(parsed.relatesToPrior ?? base.relatesToPrior),
      researchTasks: Array.isArray(parsed.researchTasks)
        ? parsed.researchTasks.map(String).slice(0, 6)
        : base.researchTasks,
      sanityChecks: Array.isArray(parsed.sanityChecks)
        ? parsed.sanityChecks.map(String).slice(0, 6)
        : base.sanityChecks,
      anticipatedFollowUps: Array.isArray(parsed.anticipatedFollowUps)
        ? parsed.anticipatedFollowUps.map(String).slice(0, 5)
        : base.anticipatedFollowUps,
      promptBlock: [
        base.promptBlock,
        '',
        '=== GEMINI-ZERLEGUNG ===',
        parsed.userGoal ? `Ziel: ${parsed.userGoal}` : '',
        Array.isArray(parsed.subQuestions)
          ? `Teilfragen: ${parsed.subQuestions.join(' · ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  } catch {
    return base;
  }
}
