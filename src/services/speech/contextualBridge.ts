/**
 * Menschliche Bridge — Flash-Lite, kontextuell, keine 0815-Floskeln.
 * Führt die spätere Antwort ein; Synthese bekommt denselben Text (Kontinuität).
 * Mic + Reboot teilen dieselbe In-Flight-Promise (kein Doppel-Speak).
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
 * Flash-Lite: 1 kurzer menschlicher Satz — Bezug zum User, keine Meta-Recherche.
 */
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

  let memory = '';
  try {
    memory = formatUserMemoryForPrompt()?.slice(0, 500) ?? '';
  } catch {
    memory = '';
  }
  const profile = getCachedUserProfile();
  const name = profile?.firstName?.trim() || null;
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

  const prompt = [
    'Du bist Findus — warmer Reise-/Alltagsbegleiter auf Deutsch.',
    'Schreib 1–2 kurze Sätze (max. 42 Wörter). Das füllt die Recherche-Zeit — konkret auf den User, keine Meta-Suche.',
    'Das ist das EINZIGE Vorgeplänkel vor der echten Antwort.',
    '',
    'PFLICHT:',
    '- Reagiere KONKRET auf das, was der User gesagt hat (Sieg, Hitze, Zoo, Plan, Emotion).',
    '- Wie ein Mensch: Glückwunsch, Zustimmung, Empathie, Witz — wenn passend.',
    '- Leite natürlich zur kommenden Hilfe über, ohne Fakten zu spoilern.',
    '- Wortlaut frei, organisch, an Persona/Kontext angepasst.',
    '',
    'VERBOTEN:',
    '- 0815-Floskeln („Ich schau mal“, „Gute Frage“, „Alles klar“, „Moment“, „Mega Plan“).',
    '- Meta über Recherche/API/„ich suche jetzt“.',
    '- Markdown, Emoji-Overkill, zweite Frage-Spirale.',
    '- Die eigentliche Lösung vorwegnehmen (keine Zahlen/Orte erfinden).',
    '',
    'Richtung (nur Ablauf, Wortlaut nie übernehmen):',
    '- Outfit/Kälte → Wir wollen nicht, dass du frierst.',
    '- Hitze → Heute ist kein Tag zum Durchhalten in der falschen Schicht.',
    '- Abend/Events → Heute Abend soll was Echtes laufen.',
    '- Weg/Ankommen → Du willst ankommen, nicht erst raten.',
    '- Tickets/Fähre → Die Überfahrt soll sitzen, nicht irgendwo versacken.',
    'Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an den aktuellen Kontext und die aktuelle Stadt an.',
    '',
    name ? `User-Vorname: ${name}` : '',
    city
      ? `Stadt (nur Kontext, nicht als Home erzwingen): ${city}`
      : '',
    opts.jobId ? `Interner Job (nur Ton-Hinweis): ${opts.jobId}` : '',
    opts.jobHint ? `Job-Hinweis: ${opts.jobHint}` : '',
    memory ? `Kontext/Memory:\n${memory}` : '',
    '',
    `User gerade: „${userText.slice(0, 280)}“`,
    '',
    'Nur den einen Satz ausgeben, nichts sonst.',
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
    const cut2 =
      cut > 8 ? line.slice(cut + 1).search(/[.!?…](?=\s|$)/) : -1;
    if (cut > 8 && cut2 > 8) {
      line = line.slice(0, cut + 1 + cut2 + 1).trim();
    } else if (cut > 8 && line.length > 220) {
      line = line.slice(0, cut + 1).trim();
    }
    if (line.length < 6 || line.length > 280) {
      noteFallback('Bridge-LLM', 'Antwort zu kurz/lang');
      return null;
    }
    if (
      /\b(ich schau|gute frage|alles klar|moment|ich recherch|lass mich)\b/iu.test(
        line,
      )
    ) {
      noteFallback('Bridge-LLM', 'Floskel-artig verworfen');
      return null;
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

function heuristicBridgeFallback(userText: string): string {
  const t = userText.toLowerCase();
  if (/\b(eis|gelato|ice\s*cream|kugel)\b/u.test(t)) {
    return 'Eis bei dem Wetter ist genau die richtige Idee — ich hol dir die nächsten guten Optionen.';
  }
  if (/\b(gewonnen|gewinn|sieg|turnier|erste\s+runde)\b/u.test(t)) {
    return 'Krass, Glückwunsch — und jetzt schauen wir, was als Nächstes Sinn ergibt.';
  }
  if (/\b(heiß|heiss|schwül|hitze|so\s+warm)\b/u.test(t)) {
    return 'Stimmt, heute ist richtig heiß — lass uns das sinnvoll angehen.';
  }
  if (/\b(zoo|tierpark)\b/u.test(t)) {
    return 'Genau, Zoo geht in jedem Alter — ich pass dir das an.';
  }
  if (/\b(café|cafe|kaffee|kuchen)\b/u.test(t)) {
    return 'Café-Pause klingt richtig — ich mach dir klar, worauf du achten kannst.';
  }
  if (/\b(hotel|übernacht|günstigste)\b/u.test(t)) {
    return 'Übernachtung, klar — ich zieh dir echte Preise und die beste Lage raus.';
  }
  return 'Verstehe dich — ich setz genau da an.';
}

async function ensureBridgeLine(
  userText: string,
  job?: JobClassification | null,
): Promise<string> {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    latencyMark('ack', job?.jobId ?? 'contextual');
    const line =
      (await generateContextualBridge({
        userText: t,
        jobId: job?.jobId ?? null,
        jobHint: job?.contract?.agentIntent ?? null,
      })) ?? heuristicBridgeFallback(t);
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
 * Fire-and-forget vom Mic — menschliche Bridge während Recherche läuft.
 * Follow-ups bleiben still; bei langer Recherche darf ein kurzes Wait-Ack.
 * Manager spricht dieselbe Zeile nicht nochmal (alreadySpoken / getLastBridgeLine).
 */
export function speakContextualBridgeFireAndForget(
  userText: string,
  opts?: { job?: JobClassification | null },
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
    // Live-Chat Instant-Ack deckt Bridge ab — keine Doppel-Bridge
    if (isLiveChatTurnActive()) return;
  } catch {
    /* soft */
  }
  if (isSilentFollowUp(t)) {
    try {
      const {
        wantsLiveChatVoiceCommand,
        wantsStopLiveChatVoiceCommand,
      } = require('../handsFree/liveChatSession') as {
        wantsLiveChatVoiceCommand: (s: string) => boolean;
        wantsStopLiveChatVoiceCommand: (s: string) => boolean;
      };
      if (wantsLiveChatVoiceCommand(t) || wantsStopLiveChatVoiceCommand(t)) {
        return;
      }
    } catch {
      /* soft */
    }
    try {
      const {
        shouldSpeakLatencyFloskel,
        speakLatencyFloskelFireAndForget,
      } = require('./floskelEngine') as {
        shouldSpeakLatencyFloskel: (s: string) => boolean;
        speakLatencyFloskelFireAndForget: (s: string) => void;
      };
      if (shouldSpeakLatencyFloskel(t)) {
        speakLatencyFloskelFireAndForget(t);
      }
    } catch {
      /* still */
    }
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
