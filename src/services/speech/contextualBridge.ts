/**
 * Menschliche Bridge — Flash-Lite, kontextuell, keine 0815-Floskeln.
 * Führt die spätere Antwort ein; Synthese bekommt denselben Text (Kontinuität).
 * Mic + Reboot teilen dieselbe In-Flight-Promise (kein Doppel-Speak).
 *
 * Immer ein neu formulierter Satz aus dem User-Verständnis.
 * Kein Heuristik-Kleben von Ziel/wann/muss vor eine Floskel.
 * LLM-Fail → ein Retry, dann Notfall-Satz ohne Slots.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { getCachedUserProfile } from '../userProfileService';
import { getVoiceSettingsForTour } from '../ttsService';
import { speakRuntimeText } from '../../runtime/speechModule';
import { latencyMark } from '../debug/latencyTiming';
import { noteFallback } from '../debug/fallbackLabel';
import { formatUserMemoryForPrompt } from '../../store/useUserMemoryStore';
import type { JobClassification } from '../../module2/jobs/types';

let lastBridgeLine = '';
let lastBridgeAtMs = 0;
let lastSpokenBridge = '';
let lastSpokenAtMs = 0;
let inFlight: Promise<string> | null = null;
let speakGate: Promise<void> | null = null;
const BRIDGE_GAP_MS = 1_800;
const SPOKEN_WINDOW_MS = 25_000;

export function getLastBridgeLine(): string | null {
  if (!lastBridgeLine) return null;
  if (Date.now() - lastBridgeAtMs > 120_000) return null;
  return lastBridgeLine;
}

export function clearLastBridgeLine(): void {
  lastBridgeLine = '';
  lastBridgeAtMs = 0;
}

/** Von Wait-Bridge/Manager: Mic-Fire-and-Forget soll nicht nachziehen. */
export function rememberSpokenBridgeLine(line: string): void {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return;
  lastSpokenBridge = t;
  lastSpokenAtMs = Date.now();
  rememberBridge(t);
}

export function isBridgeAlreadySpoken(line?: string | null): boolean {
  const t = (line ?? lastBridgeLine).replace(/\s+/g, ' ').trim();
  if (!t || !lastSpokenBridge) return false;
  if (Date.now() - lastSpokenAtMs > SPOKEN_WINDOW_MS) return false;
  return t === lastSpokenBridge;
}

function rememberBridge(line: string): void {
  lastBridgeLine = line.trim();
  lastBridgeAtMs = Date.now();
}

async function speakBridgeLineOnce(line: string): Promise<void> {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return;
  if (isBridgeAlreadySpoken(t)) return;
  try {
    const { hadRecentLatencyAck } = require('./floskelEngine') as {
      hadRecentLatencyAck: (ms?: number) => boolean;
    };
    // Pitch/Manager-Wait hat schon gebridgt → Mic-Bridge nicht nochmal
    if (hadRecentLatencyAck(12_000)) {
      rememberBridge(t);
      return;
    }
  } catch {
    /* soft */
  }
  if (speakGate) {
    await speakGate;
    return;
  }
  speakGate = (async () => {
    if (isBridgeAlreadySpoken(t)) return;
    try {
      const { hadRecentLatencyAck } = require('./floskelEngine') as {
        hadRecentLatencyAck: (ms?: number) => boolean;
      };
      if (hadRecentLatencyAck(12_000)) {
        rememberBridge(t);
        return;
      }
    } catch {
      /* soft */
    }
    lastSpokenBridge = t;
    lastSpokenAtMs = Date.now();
    rememberBridge(t);
    try {
      const { noteLatencyAck } = require('./floskelEngine') as {
        noteLatencyAck: (p?: string | null) => void;
      };
      noteLatencyAck(t);
    } catch {
      /* soft */
    }
    try {
      const cached = getCachedUserProfile();
      const voice = cached
        ? { voiceId: cached.voiceId, speechRate: 1 as const }
        : await getVoiceSettingsForTour();
      await speakRuntimeText(
        t,
        { voiceId: voice.voiceId, speechRate: voice.speechRate },
        { priority: 'system', deliveryKind: 'assistant' },
      );
    } catch {
      noteFallback('Bridge-TTS', 'speakRuntimeText fehlgeschlagen');
    }
  })();
  try {
    await speakGate;
  } finally {
    speakGate = null;
  }
}

/**
 * Flash-Lite: Verstanden + Zusagen — Bezug zum User, noch keine Call-2-Fakten.
 */
function isEmptyBridgeFloskel(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim();
  if (/^(ich schau mal|gute frage|alles klar|moment|mega plan|lass mich)[.!?]*$/iu.test(t)) {
    return true;
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && /\b(ich schau|gute frage|alles klar|moment|ich recherch)\b/iu.test(t)) {
    return true;
  }
  return false;
}

function isTaxiRideUtterance(text: string): boolean {
  try {
    const { wantsTaxiRide } = require('../mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    return wantsTaxiRide(text);
  } catch {
    return false;
  }
}

export type BridgeStance = {
  isNewTopic: boolean;
  jobId: string | null;
  jobHint: string | null;
  destHint: string | null;
  kind: 'taxi' | 'fresh' | 'continue';
};

/** Ob die Bridge ein neues Thema oder die Fortsetzung ist — nur aktueller Satz. */
export function resolveBridgeStance(userText: string): BridgeStance {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  let jobId: string | null = null;
  let jobHint: string | null = null;
  try {
    const { classifyJob } = require('../../module2/jobs/classifyJob') as {
      classifyJob: (s: string) => {
        jobId: string;
        contract?: { agentIntent?: string };
      };
    };
    const job = classifyJob(t);
    jobId = job.jobId;
    jobHint = job.contract?.agentIntent ?? null;
  } catch {
    /* soft */
  }

  let destHint: string | null = null;
  try {
    const {
      extractStreetAddressFromUtterance,
    } = require('../navigation/streetAddressQuery') as {
      extractStreetAddressFromUtterance: (s: string) => string | null;
    };
    const addr = extractStreetAddressFromUtterance(t);
    if (addr && /\b(navi|navigier|route|bring|führ|fuehr|zum|zur|nach|ziel)\b/iu.test(t)) {
      destHint = addr;
      return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
    }
  } catch {
    /* soft */
  }

  const taxi = isTaxiRideUtterance(t) || jobId === 'taxi_rideshare';
  if (taxi) {
    try {
      const { extractTaxiDestName } = require('../mobility/taxiRideIntent') as {
        extractTaxiDestName: (s: string) => string;
      };
      destHint = extractTaxiDestName(t) || null;
    } catch {
      destHint = null;
    }
    return { isNewTopic: true, jobId, jobHint, destHint, kind: 'taxi' };
  }

  try {
    const { getTopicCutContext } = require('../memory/conversationThreads') as {
      getTopicCutContext: () => {
        openLoop: string | null;
        lastClosedTopic: string | null;
        foregroundLabel: string | null;
      };
    };
    const { decideTopicCut, shouldScrubDeadThread } = require('../../module2/kernel/turnKernel') as {
      decideTopicCut: (o: {
        userText: string;
        openLoop?: string | null;
        lastClosedTopic?: string | null;
        foregroundLabel?: string | null;
      }) => string;
      shouldScrubDeadThread: (m: string) => boolean;
    };
    const ctx = getTopicCutContext();
    const mode = decideTopicCut({
      userText: t,
      openLoop: ctx.openLoop,
      lastClosedTopic: ctx.lastClosedTopic,
      foregroundLabel: ctx.foregroundLabel,
    });
    // Harte Weiche: aktueller Satz ist Flug → Bridge nie an totem Pitch/Wetter kleben.
    try {
      const { classifyUtteranceFamily } = require('../../module2/kernel/utteranceFamily') as {
        classifyUtteranceFamily: (s: string) => { family: string };
      };
      const nextFam = classifyUtteranceFamily(t).family;
      if (nextFam === 'flight') {
        if (mode === 'new' || mode === 'closed_new') {
          return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
        }
        const openFam = classifyUtteranceFamily(ctx.openLoop || '').family;
        if (
          ctx.openLoop &&
          openFam !== 'flight' &&
          openFam !== 'clock'
        ) {
          return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
        }
        const fgFam = classifyUtteranceFamily(ctx.foregroundLabel || '').family;
        if (
          !ctx.openLoop &&
          ctx.foregroundLabel &&
          fgFam !== 'flight' &&
          fgFam !== 'clock'
        ) {
          return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
        }
      }
    } catch {
      /* soft */
    }
    if (mode === 'weave') {
      return {
        isNewTopic: false,
        jobId,
        jobHint,
        destHint: ctx.openLoop,
        kind: 'continue',
      };
    }
    if (mode === 'continue') {
      return { isNewTopic: false, jobId, jobHint, destHint, kind: 'continue' };
    }
    if (shouldScrubDeadThread(mode as never)) {
      return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
    }
  } catch {
    /* soft */
  }

  let fresh = false;
  try {
    const { looksLikeFreshSessionOpener } = require('../memory/conversationThreads') as {
      looksLikeFreshSessionOpener: (s: string) => boolean;
    };
    fresh = looksLikeFreshSessionOpener(t);
  } catch {
    try {
      const { looksLikeNewConcreteDestination } = require('../mobility/taxiRideIntent') as {
        looksLikeNewConcreteDestination: (s: string) => boolean;
      };
      fresh = looksLikeNewConcreteDestination(t);
    } catch {
      fresh = false;
    }
  }

  if (fresh) {
    return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
  }

  try {
    const { decideTopicCut, shouldScrubDeadThread } = require('../../module2/kernel/turnKernel') as {
      decideTopicCut: (o: {
        userText: string;
        foregroundLabel?: string | null;
      }) => string;
      shouldScrubDeadThread: (m: string) => boolean;
    };
    let fgLabel: string | null = null;
    try {
      const { getForegroundThread } = require('../memory/conversationThreads') as {
        getForegroundThread: () => { label?: string; summary?: string } | null;
      };
      const fg = getForegroundThread();
      fgLabel = fg?.label || fg?.summary || null;
    } catch {
      fgLabel = null;
    }
    const mode = decideTopicCut({ userText: t, foregroundLabel: fgLabel });
    if (shouldScrubDeadThread(mode as never)) {
      return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
    }
  } catch {
    /* soft */
  }

  try {
    const {
      getForegroundThread,
      inferThreadCategory,
      looksLikeNewConcreteDestination,
    } = require('../memory/conversationThreads') as {
      getForegroundThread: () => { category?: string } | null;
      inferThreadCategory: (o: { userText: string }) => string;
      looksLikeNewConcreteDestination?: (s: string) => boolean;
    };
    let newDest = false;
    try {
      const { looksLikeNewConcreteDestination: destFn } = require('../mobility/taxiRideIntent') as {
        looksLikeNewConcreteDestination: (s: string) => boolean;
      };
      newDest = destFn(t);
    } catch {
      newDest = Boolean(looksLikeNewConcreteDestination?.(t));
    }
    const fg = getForegroundThread();
    const cat = inferThreadCategory({ userText: t });
    if (
      fg?.category &&
      cat !== 'other' &&
      fg.category !== cat &&
      newDest
    ) {
      return { isNewTopic: true, jobId, jobHint, destHint, kind: 'fresh' };
    }
  } catch {
    /* soft */
  }

  return { isNewTopic: false, jobId, jobHint, destHint, kind: 'continue' };
}

export async function generateContextualBridge(opts: {
  userText: string;
  jobId?: string | null;
  jobHint?: string | null;
}): Promise<string | null> {
  const userText = opts.userText.replace(/\s+/g, ' ').trim();
  if (userText.length < 4) return null;
  if (!hasGeminiApiKey()) {
    noteFallback('Bridge-LLM', 'kein Gemini-Key');
    return null;
  }

  const stance = resolveBridgeStance(userText);
  const jobId = opts.jobId || stance.jobId;
  const jobHint = opts.jobHint || stance.jobHint;

  let memory = '';
  if (!stance.isNewTopic) {
    try {
      memory = formatUserMemoryForPrompt()?.slice(0, 500) ?? '';
    } catch {
      memory = '';
    }
  }
  const profile = getCachedUserProfile();
  let name: string | null = null;
  try {
    const { canSayUserName } = require('../persona/userNameThrottle') as {
      canSayUserName: () => boolean;
    };
    const n = profile?.firstName?.trim() || null;
    name = n && canSayUserName() ? n : null;
  } catch {
    name = profile?.firstName?.trim() || null;
  }
  let city: string | null = null;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { lastGpsLat: number | null; lastGpsLng: number | null };
      };
    };
    const { nearestCityName, loadNearbyCitiesFromIndex } = require('../navigation/fuzzyCityResolve') as {
      nearestCityName: (
        lat: number | null,
        lng: number | null,
        cities: Array<{ name: string; lat: number; lng: number }>,
      ) => string | null;
      loadNearbyCitiesFromIndex: () => Array<{ name: string; lat: number; lng: number }>;
    };
    const gps = useFinnusStore.getState();
    city = nearestCityName(
      gps.lastGpsLat,
      gps.lastGpsLng,
      loadNearbyCitiesFromIndex(),
    );
  } catch {
    city = profile?.cityName?.trim() || null;
  }

  let familyLine = '';
  try {
    const { classifyUtteranceFamily } = require('../../module2/kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    const fam = classifyUtteranceFamily(userText).family;
    if (fam && fam !== 'unknown') {
      familyLine =
        `Auftrag-Familie (nur Weiche): ${fam}. Bridge nur für DIESE Hilfe — Wortlaut frei, neu formuliert.`;
    }
  } catch {
    familyLine = '';
  }

  const topicLage = stance.isNewTopic
    ? stance.kind === 'taxi'
      ? 'THEMA-LAGE: NEUES THEMA. Der vorherige Chat gilt nicht. Auftrag: Taxi/Uber zum im User-Satz genannten Ziel jetzt organisieren. Bridge = Zusage auf DIESE Fahrt. Keine Minuten, keine Uhrzeit, keine Links erfinden — das kommt in der nächsten Nachricht als Fortsetzung.'
      : 'THEMA-LAGE: NEUES THEMA. Der aktuelle Satz ist ein neuer Auftrag, nicht die Fortsetzung des letzten Chats. Bridge = Verstanden + Zusagen (was du jetzt tust). Keine Zahlen/Venue-Namen erfinden — die kommen in der nächsten Nachricht.'
    : 'THEMA-LAGE: Fortsetzung. Knüpfe an das laufende Thema an, ohne neu vorzustellen.';

  const prompt = [
    'Du bist Yorro — warmer Reise-/Alltagsbegleiter auf Deutsch.',
    'Schreib 1–2 kurze Sätze als BRIDGE (Call 1): Verstanden + Zuspruch/Zusagen — noch NICHT die Hauptantwort mit Optionen/Preisen/Minuten.',
    'Das ist Beat 1 von 2: Call 2 kommt direkt danach mit den echten Fakten und setzt NAHTLOS an (ohne den Wunsch nochmal zu loben).',
    'Kürze: starker Anfang reicht — nicht mit Extra-Sätzen auffüllen.',
    '',
    topicLage,
    familyLine,
    '',
    'PFLICHT:',
    '- Zeig, dass du DEN Satz verstanden hast (Wunsch/Ort/Anlass spiegeln). Würdige die Idee oder sage klar, was du jetzt tust.',
    '- Reagiere KONKRET auf DIESES Satz — nicht auf geparkte/tote Themen.',
    '- Isolation: Städte/Ziele aus dem aktuellen Satz DÜRFEN vorkommen. Tote Threads nicht.',
    '- NUR der aktuelle User-Satz zählt. Kein Mittagessen/Wetter/Trivia aus dem Chat davor, wenn DER Satz Flug/Nav/neues Thema ist.',
    stance.destHint && !stance.isNewTopic
      ? '- Offener Auftrag noch aktiv — wenn der User etwas dazwischen will, weben (auf dem Weg), nicht totstellen. Details nur aus dem User-Satz, keine Fragmente kleben.'
      : '',
    '- Keine Recherche-Ergebnisse spoilern (keine Minuten/Preise/Links/Venue-Namen erfinden).',
    '- Flug: keine Pauschal-Vorlaufzeit (nicht „zwei Stunden vorher“). Security/Check-in kommen aus der Recherche.',
    '- Wortlaut frei, organisch, an Persona/Kontext angepasst.',
    '- Immer einen NEUEN, grammatisch runden Satz schreiben. Nie User-Wörter (Ziel, nach, wann, muss) vor eine Floskel kleben.',
    '',
    'VERBOTEN:',
    '- Nur leere 0815-Floskeln („Ich schau mal“, „Gute Frage“, allein „Alles klar“, „Moment“, „Mega Plan“) ohne Bezug zum Wunsch.',
    '- Schon die Call-2-Antwort: Restaurantnamen, Event-Titel, Gehminuten, Preise, Dual-Option-Pitch.',
    '- „Ich suche dir Optionen / mehrere Vorschläge raus“ bei Wetter, Outfit oder reinen Faktenfragen.',
    '- Markdown, Emoji-Overkill, zweite Frage-Spirale.',
    '- Taxi/Uber nur wenn DER Satz Taxi will. Essenswunsch: kein Taxi-Faden.',
    '- Kleben: „[Ziel] klingt richtig gut“, „nach [Stadt] musst …“ als Satzanfang aus Parser-Fragmenten.',
    '',
    'Richtung (nur Ablauf, Wortlaut nie übernehmen):',
    '- Essen-Suche klar → Idee gut — Optionen kommen gleich, ohne Namen zu erfinden.',
    '- Wetter / Outfit / „wie vorbereitet sein“ → Wunsch verstanden + kurze Zusage zum Wettercheck; KEINE Options-Suche. Fakten kommen in Call 2.',
    '- Essen + Wetter im selben Satz → Idee würdigen; Bridge endet bei Verstehen/Zusage — Wetter-Fakten und ggf. Orte erst Call 2, ohne in der Bridge „Optionen“ zu versprechen wenn Call 2 vor allem Wetter ist.',
    '- Aktivität (SUP, Sport) + Wetter im Kontext → Entscheidung würdigen; Details/Preis erst Call 2.',
    '- Navigation starten → knappe Zusage, dass die Navigation jetzt startet; ETA erst Call 2.',
    '- Events heute Abend → Zusagen, den Eventkalender der genannten Stadt kurz zu durchstöbern; Programme erst Call 2.',
    '- Genannter Spielplan/Team/Halle → Cover: Verstanden + Zusagen, dass du Termin/Spielplan checkst — kein Pitch-Opener, keine Lob-Floskel.',
    '- Outfit/Kälte → Wir wollen nicht, dass du frierst.',
    '- Taxi/Uber rufen → Zusagen, dass DIESE Fahrt jetzt organisiert wird. Nie die Taxizentrale als Ziel.',
    '- Flug / Ankunft am Flughafen → Zusage auf den Rückwärts-Plan, keine Uhrzeiten und keine zwei Stunden erfinden.',
    'Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an den aktuellen Kontext und die aktuelle Stadt an.',
    '',
    name ? `User-Vorname: ${name}` : '',
    !stance.isNewTopic && city
      ? `Stadt (nur Kontext, nicht als Home erzwingen): ${city}`
      : '',
    jobId ? `Interner Job (nur Ton-Hinweis): ${jobId}` : '',
    jobHint ? `Job-Hinweis: ${jobHint}` : '',
    memory ? `Kontext/Memory:\n${memory}` : '',
    '',
    `User gerade: „${userText.slice(0, 280)}“`,
    '',
    'Nur die Bridge-Sätze ausgeben, nichts sonst.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      tier: 'lite',
      maxTokens: 120,
      temperature: 0.85,
      useFindusSystem: false,
    });
    let line = (raw || '')
      .replace(/\s+/g, ' ')
      .replace(/^["„]|["“]$/g, '')
      .trim();
    const cut = line.search(/[.!?…](?=\s|$)/);
    const after1 = cut > 8 ? line.slice(cut + 1) : '';
    const cut2 = after1.search(/[.!?…](?=\s|$)/);
    const after2 = cut2 > 8 ? after1.slice(cut2 + 1) : '';
    const cut3 = after2.search(/[.!?…](?=\s|$)/);
    if (cut > 8 && cut2 > 8 && cut3 > 8) {
      line = line.slice(0, cut + 1 + cut2 + 1 + cut3 + 1).trim();
    } else if (cut > 8 && cut2 > 8) {
      line = line.slice(0, cut + 1 + cut2 + 1).trim();
    } else if (cut > 8 && line.length > 220) {
      line = line.slice(0, cut + 1).trim();
    }
    if (line.length < 6 || line.length > 420) {
      noteFallback('Bridge-LLM', 'Antwort zu kurz/lang');
      return null;
    }
    try {
      const { speechInventedAirportLead, isFlightTripQuery } = require('../flights/flightTripIntent') as {
        speechInventedAirportLead: (s: string) => boolean;
        isFlightTripQuery: (s: string) => boolean;
      };
      if (isFlightTripQuery(userText) && speechInventedAirportLead(line)) {
        noteFallback('Bridge-LLM', 'erfundene Flughafen-Vorlaufzeit');
        return null;
      }
    } catch {
      /* soft */
    }
    if (isEmptyBridgeFloskel(line)) {
      noteFallback('Bridge-LLM', 'Floskel-artig verworfen');
      return null;
    }
    try {
      const { sanitizeBridgeText } = require('../../module2/chat/butlerOfferBus') as {
        sanitizeBridgeText: (s: string | null) => string | null;
      };
      const cleaned = sanitizeBridgeText(line);
      if (!cleaned) {
        noteFallback('Bridge-LLM', 'Kleb-Satz verworfen');
        return null;
      }
      line = cleaned;
    } catch {
      /* soft */
    }
    try {
      const { resolveTurnBridgePace } = require('../../module2/kernel/turnKernel') as {
        resolveTurnBridgePace: (s: string) => { bridgeMaxWords: number };
      };
      const { clipBridgeToWordLimit } = require('../../module2/router/paceBudget') as {
        clipBridgeToWordLimit: (s: string, n: number) => string | null;
      };
      const clipped = clipBridgeToWordLimit(
        line,
        resolveTurnBridgePace(userText).bridgeMaxWords,
      );
      if (clipped) line = clipped;
    } catch {
      /* soft */
    }
    return line;
  } catch (err) {
    noteFallback(
      'Bridge-LLM',
      err instanceof Error ? err.message.slice(0, 80) : 'Fehler',
    );
    return null;
  }
}

/** Letzter Notnagel — kompletter Satz, keine User-Slots. */
export function emergencyBridgeLine(): string {
  return 'Genau das setz ich jetzt um — die konkreten Zahlen kommen direkt hinterher.';
}

async function ensureBridgeLine(
  userText: string,
  job?: JobClassification | null,
): Promise<string> {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { resolveTurnBridgePace } = require('../../module2/kernel/turnKernel') as {
        resolveTurnBridgePace: (s: string) => { bridgeMaxWords: number };
      };
      if (resolveTurnBridgePace(t).bridgeMaxWords <= 0) {
        return '';
      }
    } catch {
      /* soft */
    }
    latencyMark('ack', job?.jobId ?? 'contextual');
    let j = job ?? null;
    if (!j) {
      try {
        const { classifyJob } = require('../../module2/jobs/classifyJob') as {
          classifyJob: (s: string) => JobClassification;
        };
        j = classifyJob(t);
      } catch {
        j = null;
      }
    }
    const opts = {
      userText: t,
      jobId: j?.jobId ?? null,
      jobHint: j?.contract?.agentIntent ?? null,
    };
    let line = await generateContextualBridge(opts);
    if (!line) {
      line = await generateContextualBridge(opts);
    }
    if (!line) {
      noteFallback('Bridge-LLM', 'Notfall-Satz ohne Slot-Kleben');
      line = emergencyBridgeLine();
    }
    rememberBridge(line);
    return line;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

function isSilentFollowUp(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (t.length < 4) return true;
  try {
    const {
      wantsLiveChatVoiceCommand,
      wantsStopLiveChatVoiceCommand,
    } = require('../handsFree/liveChatSession') as {
      wantsLiveChatVoiceCommand: (s: string) => boolean;
      wantsStopLiveChatVoiceCommand: (s: string) => boolean;
    };
    if (wantsLiveChatVoiceCommand(t) || wantsStopLiveChatVoiceCommand(t)) {
      return true;
    }
  } catch {
    /* soft */
  }
  if (
    /\berzähl\s+mir\s+noch\s+mehr\s+zu\b/iu.test(t) ||
    /\bmehr\s+(zur\s+)?(historie|geschichte)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /^(ja|jo|jap|jep|yes|genau|stimmt|ok|okay|klar|gerne|los|mach)(?:\s+bitte)?[.!?]?$/iu.test(
      t,
    )
  ) {
    return true;
  }
  try {
    const { isInventoryFollowUp } = require('../../module2/router/liveInventoryGate') as {
      isInventoryFollowUp: (s: string) => boolean;
    };
    if (isInventoryFollowUp(t)) return true;
  } catch {
    /* soft */
  }
  return false;
}

/**
 * Fire-and-forget vom Mic — neu formulierte Bridge während Recherche läuft.
 * Kurze Follow-ups („ja“, „mehr Historie“) bleiben still.
 * Manager spricht dieselbe Zeile nicht nochmal (alreadySpoken / getLastBridgeLine).
 */
export function speakContextualBridgeFireAndForget(
  userText: string,
  opts?: { job?: JobClassification | null; allowLiveChat?: boolean },
): void {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (t.length < 4) return;
  try {
    const { isBesideConversationActive } = require('../handsFree/besideConversationMode') as {
      isBesideConversationActive: () => boolean;
    };
    if (isBesideConversationActive()) return;
  } catch {
    /* soft */
  }
  try {
    const { isLiveChatTurnActive } = require('../handsFree/liveChatTurnContext') as {
      isLiveChatTurnActive: () => boolean;
    };
    if (isLiveChatTurnActive() && !opts?.allowLiveChat) return;
  } catch {
    /* soft */
  }
  if (isSilentFollowUp(t)) {
    return;
  }
  void (async () => {
    try {
      const line = await ensureBridgeLine(t, opts?.job);
      if (line?.trim()) await speakBridgeLineOnce(line);
    } catch {
      noteFallback('Bridge-TTS', 'contextual fire-and-forget');
    }
  })();
}

/**
 * Legacy Reboot-Pfad — DEAKTIVIERT (gleiche Zeile wie Mic).
 * Nutze Manager-Bridge in runConciergeTurn.
 */
export async function resolveContextualBridgeLine(
  _userText: string,
  _job?: JobClassification | null,
  _opts?: { speak?: boolean },
): Promise<string | null> {
  return getLastBridgeLine();
}
