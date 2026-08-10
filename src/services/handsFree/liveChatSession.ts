/**
 * Live-Chat-Session:
 * Mikro an → segmentieren → Open-Floor Follow-ups ohne Keyword → Idle → aus.
 */

import {
  isCurrentlyListening,
  peekListeningTranscript,
  startListening,
  stopListening,
} from '../sttService';
import { classifyLiveChatAddress } from './liveChatAddress';
import { playLiveChatStartCue } from './micStartCue';
import {
  getHandsFreePrefsSync,
  loadHandsFreePrefs,
} from './handsFreePrefs';
import {
  clearLiveChatTurnContext,
  setLiveChatTurnContext,
} from './liveChatTurnContext';

export const LIVE_CHAT_IDLE_DEFAULT_MS = 30_000;
/** Endpoint: schneller finalisieren → weniger Hänger nach Loslassen */
const ENDPOINT_STABLE_MS = 700;
const MIN_UTTERANCE_CHARS = 3;
/** Max. Warten bis TTS fertig, bevor Mic wieder aufgeht */
const SPEECH_WAIT_TICKS = 40;

export type LiveChatPhase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'answering';

type Handlers = {
  submitUserQuestion: (text: string) => Promise<void>;
  onPhaseChange?: (phase: LiveChatPhase) => void;
  onWakeOnly?: () => void;
};

let handlers: Handlers | null = null;
let active = false;
/** Nach Start/Antwort: Follow-ups ohne Keyword bis Idle */
let openFloor = false;
let phase: LiveChatPhase = 'idle';
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let endpointTimer: ReturnType<typeof setTimeout> | null = null;
let lastPartial = '';
let processing = false;
let listenGeneration = 0;

const listeners = new Set<(active: boolean, phase: LiveChatPhase) => void>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function idleMs(): number {
  const s = getHandsFreePrefsSync().liveChatIdleSeconds ?? 30;
  return s * 1000;
}

function setPhase(next: LiveChatPhase): void {
  phase = next;
  handlers?.onPhaseChange?.(next);
  for (const l of listeners) {
    try {
      l(active, phase);
    } catch {
      /* soft */
    }
  }
}

function clearIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function clearEndpoint(): void {
  if (endpointTimer) {
    clearTimeout(endpointTimer);
    endpointTimer = null;
  }
}

function bumpAddressedActivity(): void {
  clearIdle();
  if (!active) return;
  idleTimer = setTimeout(() => {
    void stopLiveChatSession('idle_timeout');
  }, idleMs());
}

export function isLiveChatActive(): boolean {
  return active;
}

export function isLiveChatOpenFloor(): boolean {
  return active && openFloor;
}

export function getLiveChatPhase(): LiveChatPhase {
  return phase;
}

export function subscribeLiveChat(
  fn: (active: boolean, phase: LiveChatPhase) => void,
): () => void {
  listeners.add(fn);
  fn(active, phase);
  return () => {
    listeners.delete(fn);
  };
}

export function registerLiveChatHandlers(h: Handlers | null): void {
  handlers = h;
}

async function resumeListening(gen: number): Promise<void> {
  if (!active || gen !== listenGeneration) return;
  if (isCurrentlyListening()) return;
  setPhase('listening');
  const result = await startListening((partial) => {
    if (!active || gen !== listenGeneration) return;
    onPartial(partial);
  }, { keepAlive: true, replaceActive: true });
  if (!result.ok) {
    void stopLiveChatSession('stt_failed');
  }
}

function onPartial(partial: string): void {
  const text = partial.replace(/\s+/g, ' ').trim();
  if (!text || text === lastPartial) {
    if (text && text === lastPartial && text.length >= MIN_UTTERANCE_CHARS) {
      scheduleEndpoint(text);
    }
    return;
  }
  lastPartial = text;
  clearEndpoint();
  scheduleEndpoint(text);
}

function scheduleEndpoint(snapshot: string): void {
  clearEndpoint();
  // Parallel vordenken, sobald Utterance stabil wirkt
  try {
    const {
      detectTravelModeVoiceOverride,
      forceBikeModeFromVoice,
      setPreferredTravelMode,
    } = require('../navigation/travelModeContext') as {
      detectTravelModeVoiceOverride: (t: string) => 'bike' | 'foot' | 'transit' | null;
      forceBikeModeFromVoice: () => void;
      setPreferredTravelMode: (m: 'bike' | 'foot' | 'transit' | null) => void;
    };
    const mode = detectTravelModeVoiceOverride(snapshot);
    if (mode === 'bike') forceBikeModeFromVoice();
    else if (mode === 'foot') setPreferredTravelMode('foot');
  } catch {
    /* soft */
  }
  endpointTimer = setTimeout(() => {
    endpointTimer = null;
    const now = peekListeningTranscript().replace(/\s+/g, ' ').trim();
    if (now !== snapshot && now.length > snapshot.length) {
      scheduleEndpoint(now);
      return;
    }
    void cutAndProcess(snapshot || now);
  }, ENDPOINT_STABLE_MS);
}

async function cutAndProcess(snapshot: string): Promise<void> {
  if (!active || processing) return;
  const raw = (snapshot || peekListeningTranscript()).replace(/\s+/g, ' ').trim();
  if (raw.length < MIN_UTTERANCE_CHARS) return;

  processing = true;
  clearEndpoint();
  setPhase('processing');
  const gen = listenGeneration;
  await loadHandsFreePrefs();
  const prefs = getHandsFreePrefsSync();

  let transcript = raw;
  try {
    // Live-Chat: kürzer finalisieren — Parallel-Antwort statt 1s Extra-Warten
    transcript =
      (await stopListening({ tailMs: 100, finalizeMs: 400 })).trim() || raw;
  } catch {
    transcript = raw;
  }

  lastPartial = '';
  const useOpenFloor = openFloor && !prefs.requireKeywordEveryTurn;
  const verdict = classifyLiveChatAddress(transcript, {
    openFloor: useOpenFloor,
  });

  if (!verdict.addressed) {
    if (__DEV__) {
      console.log('[liveChat] ignore:', verdict.reason, transcript.slice(0, 80));
    }
    processing = false;
    if (active && gen === listenGeneration) {
      await resumeListening(gen);
    }
    return;
  }

  bumpAddressedActivity();
  openFloor = true;

  if (verdict.reason === 'wake_only' || !verdict.cleanText.trim()) {
    try {
      handlers?.onWakeOnly?.();
    } catch {
      /* soft */
    }
    processing = false;
    if (active && gen === listenGeneration) {
      await resumeListening(gen);
    }
    return;
  }

  setPhase('answering');
  setLiveChatTurnContext({
    active: true,
    humanTone: prefs.humanConversationTone,
    askBeforeDeepResearch: prefs.askBeforeDeepResearch,
  });
  try {
    await handlers?.submitUserQuestion(verdict.cleanText);
  } catch (err) {
    console.warn('[liveChat] submit failed:', err);
  } finally {
    clearLiveChatTurnContext();
  }

  for (let i = 0; i < SPEECH_WAIT_TICKS; i++) {
    if (!active || gen !== listenGeneration) break;
    try {
      const { isSpeechActive } = await import('../../module2/speech/speechQueue');
      if (!isSpeechActive()) break;
    } catch {
      break;
    }
    await sleep(500);
  }

  openFloor = true;
  bumpAddressedActivity();
  processing = false;
  if (active && gen === listenGeneration) {
    await resumeListening(gen);
  }
}

export async function startLiveChatSession(
  reason = 'manual',
): Promise<{ ok: boolean; message?: string }> {
  await loadHandsFreePrefs();
  if (active) {
    openFloor = true;
    bumpAddressedActivity();
    return { ok: true, message: 'Live-Chat läuft schon — einfach weiterreden.' };
  }
  if (!handlers?.submitUserQuestion) {
    return {
      ok: false,
      message:
        'Live-Chat noch nicht bereit — kurz Home öffnen und nochmal versuchen.',
    };
  }

  active = true;
  openFloor = true; // sofort freie Follow-ups im Fenster
  processing = false;
  lastPartial = '';
  listenGeneration += 1;
  const gen = listenGeneration;
  bumpAddressedActivity();
  setPhase('listening');

  if (__DEV__) console.log('[liveChat] start:', reason);

  // Cue nicht blockieren — Mikro sofort auf
  void playLiveChatStartCue().catch(() => undefined);

  await resumeListening(gen);
  if (!active) {
    return { ok: false, message: 'Mikrofon konnte nicht starten.' };
  }

  const idle = getHandsFreePrefsSync().liveChatIdleSeconds;
  const needKw = getHandsFreePrefsSync().requireKeywordEveryTurn;
  return {
    ok: true,
    message: needKw
      ? `Live-Chat an. Sprich mich klar an (Name oder Frage an mich). Nach ${idle} Sekunden ohne mich ist das Mikro aus.`
      : `Live-Chat an — ich höre zu. Frag frei, z. B. „führ mich dahin“. Mit Freunden quatschen stört nicht. Nach ${idle} Sekunden ohne mich schalte ich das Mikro aus.`,
  };
}

export async function stopLiveChatSession(reason = 'manual'): Promise<void> {
  if (!active && phase === 'idle') return;
  if (__DEV__) console.log('[liveChat] stop:', reason);
  active = false;
  openFloor = false;
  processing = false;
  listenGeneration += 1;
  clearIdle();
  clearEndpoint();
  lastPartial = '';
  clearLiveChatTurnContext();
  try {
    await stopListening({ tailMs: 0, finalizeMs: 400 });
  } catch {
    /* soft */
  }
  setPhase('idle');
}

export async function maybeStartLiveChatFromHandsFree(): Promise<boolean> {
  await loadHandsFreePrefs();
  if (!getHandsFreePrefsSync().liveChatOnHandsFree) return false;
  const r = await startLiveChatSession('handsfree');
  return r.ok;
}

export function wantsLiveChatVoiceCommand(text: string): boolean {
  return (
    /\b(live[-\s]?chat|gesprächs?modus|unterhaltungs?modus|durchgehend\s+zuh[oö]ren)\b/i.test(
      text,
    ) ||
    /\b(findus[-\s]?live|gespräch\s+(an|starten))\b/i.test(text) ||
    /\b(live[-\s]?chat|gesprächsmodus)\s+(an|start|aktiv)/i.test(text)
  );
}

export function wantsStopLiveChatVoiceCommand(text: string): boolean {
  return (
    /\b(live[-\s]?chat|gesprächs?modus)\s+(aus|stopp|beend)/i.test(text) ||
    /\b(aufhören\s+zuzuhören|nicht\s+mehr\s+zuhören|mikro\s+aus)\b/i.test(text)
  );
}
