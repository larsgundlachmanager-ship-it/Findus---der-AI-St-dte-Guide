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
import {
  computeEndpointDelayMs,
  looksLikeFinishedUtterance,
  softCommitMsForText,
  MIN_VAD_SILENCE_MS,
  VAD_ECHO_WARMUP_MS,
  VAD_WARMUP_MS,
} from './liveChatEndpoint';
import { playLiveChatStartCue } from './micStartCue';
import {
  getHandsFreePrefsSync,
  loadHandsFreePrefs,
} from './handsFreePrefs';
import {
  clearLiveChatTurnContext,
  setLiveChatTurnContext,
} from './liveChatTurnContext';
import {
  armMicVadWarmup,
  getMicSilenceMs,
  hasMicVadSamples,
  isMicLikelySpeaking,
  setMicVadTtsGate,
} from './micVad';
import { looksLikeFindusEcho } from './echoGuard';

export const LIVE_CHAT_IDLE_DEFAULT_MS = 30_000;
const MIN_UTTERANCE_CHARS = 3;

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
let softCommitTimer: ReturnType<typeof setTimeout> | null = null;
let lastPartial = '';
let processing = false;
let listenGeneration = 0;
/** Soft-Commit: Cut angedacht, warte ob User doch weiterredet */
let softCommitSnapshot = '';
/** VAD darf Cut nicht endlos blockieren (Straßenlärm → silence nie „echt“) */
let endpointDeferCount = 0;
const MAX_ENDPOINT_DEFERS = 8;

const listeners = new Set<(active: boolean, phase: LiveChatPhase) => void>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Session-Override (z. B. Modul 5 Planung = 60s), unabhängig von Prefs. */
let idleOverrideMs: number | null = null;

export function setLiveChatIdleOverrideMs(ms: number | null): void {
  idleOverrideMs =
    ms != null && Number.isFinite(ms) && ms >= 5_000 ? Math.round(ms) : null;
}

export function clearLiveChatIdleOverride(): void {
  idleOverrideMs = null;
}

function idleMs(): number {
  if (idleOverrideMs != null) return idleOverrideMs;
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
  if (softCommitTimer) {
    clearTimeout(softCommitTimer);
    softCommitTimer = null;
  }
  softCommitSnapshot = '';
  // endpointDeferCount bewusst NICHT resetten — Cap gegen VAD-Endlosschleife
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

/** Sync-Getter — UI-Register ohne Race auf null. */
export function getLiveChatHandlers(): Handlers | null {
  return handlers;
}

/**
 * Nach Start/Antwort: Mikro erst wenn TTS ruhig (kein Echo der Bestätigung).
 */
async function waitSpeechIdleThenListen(
  gen: number,
  opts?: { awaitSpeechStartMs?: number },
): Promise<void> {
  if (!active || gen !== listenGeneration) return;
  const awaitStart = opts?.awaitSpeechStartMs ?? 900;
  setMicVadTtsGate(true);
  // Pipeline-Lag: Bestätigung startet oft erst nach Return
  await sleep(awaitStart);
  for (let i = 0; i < 60; i++) {
    if (!active || gen !== listenGeneration) return;
    try {
      const { isSpeechActive } = await import('../../module2/speech/speechQueue');
      setMicVadTtsGate(isSpeechActive());
      if (!isSpeechActive()) break;
    } catch {
      break;
    }
    await sleep(250);
  }
  await sleep(400);
  if (!active || gen !== listenGeneration) return;
  setMicVadTtsGate(false);
  await resumeListening(gen, { echoWarmup: true });
}

async function resumeListening(
  gen: number,
  opts?: { echoWarmup?: boolean },
): Promise<void> {
  if (!active || gen !== listenGeneration) return;
  if (isCurrentlyListening()) return;
  setPhase('listening');
  armMicVadWarmup(opts?.echoWarmup ? VAD_ECHO_WARMUP_MS : VAD_WARMUP_MS);
  // Während Echo-Warmup TTS-Gate an; sonst aus
  setMicVadTtsGate(Boolean(opts?.echoWarmup));
  const result = await startListening((partial) => {
    if (!active || gen !== listenGeneration) return;
    onPartial(partial);
  }, { keepAlive: true, replaceActive: true });
  if (!result.ok) {
    void stopLiveChatSession('stt_failed');
  }
}

function noteWarmupFromPartial(text: string): void {
  try {
    const { notePartialForManagerWarmup } = require('../../module2/router/managerWarmup') as {
      notePartialForManagerWarmup: (
        t: string,
        ctx?: { cityHint?: string | null; navActive?: boolean; calendarOpen?: boolean },
      ) => void;
    };
    let cityHint: string | null = null;
    let navActive = false;
    let calendarOpen = false;
    try {
      const { getShortTerm } = require('../../module2/context/shortTermContext') as {
        getShortTerm: () => { lastMentionedCity?: string | null };
      };
      cityHint = getShortTerm().lastMentionedCity ?? null;
    } catch {
      /* soft */
    }
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: { getState: () => { navActive?: boolean } };
      };
      navActive = Boolean(useFinnusStore.getState().navActive);
    } catch {
      /* soft */
    }
    try {
      const { usePlanCalendarUiStore } = require('../../module2/timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: { getState: () => { calendarVisible: boolean } };
      };
      calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
    } catch {
      /* soft */
    }
    notePartialForManagerWarmup(text, { cityHint, navActive, calendarOpen });
  } catch {
    /* soft */
  }
}

function onPartial(partial: string): void {
  const text = partial.replace(/\s+/g, ' ').trim();
  if (!text) return;

  // Echo der eigenen Stimme → ignorieren
  if (looksLikeFindusEcho(text)) {
    if (__DEV__) console.log('[liveChat] echo ignore', text.slice(0, 48));
    return;
  }

  if (text === lastPartial) {
    // Gleicher Text erneut: Timer NICHT resetten (sonst nie Cut bei STT-Spam)
    if (
      text.length >= MIN_UTTERANCE_CHARS &&
      !endpointTimer &&
      !softCommitTimer &&
      !processing
    ) {
      scheduleEndpoint(text);
    }
    return;
  }
  // User redet weiter → Soft-Commit / Endpoint abbrechen
  lastPartial = text;
  endpointDeferCount = 0;
  clearEndpoint();
  noteWarmupFromPartial(text);
  scheduleEndpoint(text);
}

function noteTravelModeFromPartial(snapshot: string): void {
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
}

/**
 * Hybrid: Transcript-Stable + (optional) VAD-Stille.
 * Wenn VAD Stimme sieht → Delay verlängern (User denkt / redet weiter).
 */
function scheduleEndpoint(snapshot: string): void {
  clearEndpoint();
  noteTravelModeFromPartial(snapshot);

  const delay = computeEndpointDelayMs(snapshot);
  endpointTimer = setTimeout(() => {
    endpointTimer = null;
    void onStableElapsed(snapshot);
  }, delay);
}

async function onStableElapsed(snapshot: string): Promise<void> {
  if (!active || processing) return;

  const now = peekListeningTranscript().replace(/\s+/g, ' ').trim();
  if (now !== snapshot && now.length > snapshot.length) {
    endpointDeferCount = 0;
    scheduleEndpoint(now);
    return;
  }

  // „Ah, geht doch weiter“ — VAD hört noch Stimme → Cut verschieben (mit Cap)
  // Ausnahme: klare Satzende („…?“ / „Ja.“) → fertig reden erkannt, nicht auf Lärm warten
  const finished = looksLikeFinishedUtterance(snapshot || now);
  if (!finished && hasMicVadSamples() && isMicLikelySpeaking()) {
    endpointDeferCount += 1;
    if (endpointDeferCount < MAX_ENDPOINT_DEFERS) {
      if (__DEV__) console.log('[liveChat] continue-speaking (vad) — defer cut');
      scheduleEndpoint(snapshot || now);
      return;
    }
    if (__DEV__) {
      console.log('[liveChat] vad speaking-cap — force soft-commit');
    }
  }

  // Hybrid: bei verfügbarem VAD Stille abwarten — außer fertige Utterance
  if (
    !finished &&
    hasMicVadSamples() &&
    endpointDeferCount < MAX_ENDPOINT_DEFERS
  ) {
    const silence = getMicSilenceMs();
    if (silence < MIN_VAD_SILENCE_MS) {
      endpointDeferCount += 1;
      endpointTimer = setTimeout(() => {
        endpointTimer = null;
        void onStableElapsed(snapshot);
      }, Math.max(80, MIN_VAD_SILENCE_MS - silence));
      return;
    }
  }

  endpointDeferCount = 0;
  beginSoftCommit(snapshot || now);
}

/**
 * Soft-Commit: Cut angedacht — kurze Gnadenfrist für Weiterreden.
 * Gute Idee: spart False Cuts bei 450 ms Base, ohne wieder träge zu werden.
 */
function beginSoftCommit(snapshot: string): void {
  if (softCommitTimer) {
    clearTimeout(softCommitTimer);
    softCommitTimer = null;
  }
  softCommitSnapshot = snapshot;
  softCommitTimer = setTimeout(() => {
    softCommitTimer = null;
    const snap = softCommitSnapshot;
    softCommitSnapshot = '';
    void finalizeSoftCommit(snap);
  }, softCommitMsForText(snapshot));
}

async function finalizeSoftCommit(snapshot: string): Promise<void> {
  if (!active || processing) return;

  const now = peekListeningTranscript().replace(/\s+/g, ' ').trim();
  if (now.length > snapshot.length) {
    endpointDeferCount = 0;
    scheduleEndpoint(now);
    return;
  }
  if (hasMicVadSamples() && isMicLikelySpeaking()) {
    if (!looksLikeFinishedUtterance(snapshot || now)) {
      endpointDeferCount += 1;
      if (endpointDeferCount < MAX_ENDPOINT_DEFERS) {
        if (__DEV__) console.log('[liveChat] soft-commit aborted — still speaking');
        scheduleEndpoint(snapshot || now);
        return;
      }
    }
  }

  await cutAndProcess(snapshot || now);
}

async function cutAndProcess(snapshot: string): Promise<void> {
  if (!active || processing) return;
  const raw = (snapshot || peekListeningTranscript()).replace(/\s+/g, ' ').trim();
  if (raw.length < MIN_UTTERANCE_CHARS) return;
  if (looksLikeFindusEcho(raw)) {
    if (__DEV__) console.log('[liveChat] echo cut skip');
    return;
  }

  processing = true;
  endpointDeferCount = 0;
  clearEndpoint();
  setPhase('processing');
  const gen = listenGeneration;
  await loadHandsFreePrefs();
  const prefs = getHandsFreePrefsSync();

  let transcript = raw;
  try {
    transcript =
      (await stopListening({ tailMs: 50, finalizeMs: 300 })).trim() || raw;
  } catch {
    transcript = raw;
  }

  if (looksLikeFindusEcho(transcript)) {
    processing = false;
    if (active && gen === listenGeneration) {
      await resumeListening(gen, { echoWarmup: true });
    }
    return;
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

  // Erst JETZT vorherige Antwort killen — nicht bei Side-Chat/Ambient
  try {
    const { latencyStartTurn } = require('../debug/latencyTiming') as {
      latencyStartTurn: (meta?: string) => string | null;
    };
    latencyStartTurn('live_chat_cut');
  } catch {
    /* soft */
  }
  try {
    const { abortActiveModule2Turn } = require('../../module2/pipeline/turnAbort') as {
      abortActiveModule2Turn: (r?: string) => void;
    };
    abortActiveModule2Turn('live_chat_barge_in');
  } catch {
    /* soft */
  }
  try {
    const { bargeInFlush, isSpeechActive } = await import(
      '../../module2/speech/speechQueue'
    );
    if (isSpeechActive()) {
      await bargeInFlush();
    }
  } catch {
    /* soft */
  }

  setPhase('answering');
  setMicVadTtsGate(true);
  setLiveChatTurnContext({
    active: true,
    humanTone: prefs.humanConversationTone !== false,
    askBeforeDeepResearch: prefs.askBeforeDeepResearch,
  });

  // Sofort-Ack nur bei langsamer Recherche — sonst labert er dauernd
  // Planungs-Gates: kein Ack (Antwort geht still an Modul 5)
  const skipAck =
    verdict.reason === 'planning_gate' ||
    (() => {
      try {
        const { usePlanSessionStore } = require('../../module2/planning/planSessionState') as {
          usePlanSessionStore: {
            getState: () => {
              waitingLocation?: boolean;
              waitingConfirm?: boolean;
              waitingConflict?: boolean;
            };
          };
        };
        const s = usePlanSessionStore.getState();
        return Boolean(
          s.waitingLocation || s.waitingConfirm || s.waitingConflict,
        );
      } catch {
        return false;
      }
    })();
  if (prefs.humanConversationTone !== false && !skipAck) {
    try {
      const { isBesideConversationActive } = require('./besideConversationMode') as {
        isBesideConversationActive: () => boolean;
      };
      if (isBesideConversationActive()) {
        /* Beside: kein Ack */
      } else {
        const { speakLiveChatInstantAck } = require('../speech/floskelEngine') as {
          speakLiveChatInstantAck: (t: string) => void;
        };
        speakLiveChatInstantAck(verdict.cleanText);
      }
    } catch {
      try {
        const { speakLiveChatInstantAck } = require('../speech/floskelEngine') as {
          speakLiveChatInstantAck: (t: string) => void;
        };
        speakLiveChatInstantAck(verdict.cleanText);
      } catch {
        /* soft */
      }
    }
  }

  /**
   * Mic erst wieder auf, wenn TTS ruhig ist — sonst Feedback-Loop
   * (eigene Stimme → neuer Cut → neuer Ack → labern).
   */
  const reopenMicAfterSpeech = async () => {
    if (!active || gen !== listenGeneration) return;
    for (let i = 0; i < 60; i++) {
      if (!active || gen !== listenGeneration) return;
      try {
        const { isSpeechActive } = await import('../../module2/speech/speechQueue');
        setMicVadTtsGate(isSpeechActive());
        if (!isSpeechActive()) break;
      } catch {
        break;
      }
      await sleep(250);
    }
    await sleep(400);
    if (!active || gen !== listenGeneration) return;
    openFloor = true;
    bumpAddressedActivity();
    processing = false;
    setMicVadTtsGate(false);
    await resumeListening(gen, { echoWarmup: true });
  };

  try {
    await handlers?.submitUserQuestion(verdict.cleanText);
  } catch (err) {
    console.warn('[liveChat] submit failed:', err);
  } finally {
    clearLiveChatTurnContext();
  }

  if (active && gen === listenGeneration) {
    await reopenMicAfterSpeech();
  } else {
    processing = false;
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

  // Cue nicht blockieren — Mikro erst nach Cue/Bestätigungs-TTS (kein Echo)
  void playLiveChatStartCue().catch(() => undefined);
  void waitSpeechIdleThenListen(gen, {
    awaitSpeechStartMs: reason === 'voice' ? 1100 : 700,
  });

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
  setMicVadTtsGate(false);
  clearLiveChatTurnContext();
  try {
    const { clearManagerWarmup } = require('../../module2/router/managerWarmup') as {
      clearManagerWarmup: () => void;
    };
    clearManagerWarmup();
  } catch {
    /* soft */
  }
  try {
    const { abortActiveModule2Turn } = require('../../module2/pipeline/turnAbort') as {
      abortActiveModule2Turn: (r?: string) => void;
    };
    abortActiveModule2Turn('live_chat_stop');
  } catch {
    /* soft */
  }
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
  const raw = (text || '').trim();
  if (!raw) return false;
  // Manager hängt `[TASK …]` an — nur erste Zeile für Kurzbefehle
  const head = raw.split(/\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!head && !t) return false;
  if (
    /^(live\s+(on|an|ein|start(?:en)?|aktiv)|live[-\s]?chat(?:\s+(an|ein|start(?:en)?|aktiv))?|findus[-\s]?live)$/iu.test(
      head,
    )
  ) {
    return true;
  }
  // Nur mit Aktivierungs-Verb — bloßes „Live-Chat“ im Satz startet nicht
  return (
    /\b(live[-\s]?chat|gesprächs?modus|unterhaltungs?modus)\s+(an|ein|start(?:en)?|aktiv)\b/i.test(
      t,
    ) ||
    /\b(gespräch\s+(an|starten)|durchgehend\s+zuh[oö]ren|findus[-\s]?live)\b/i.test(
      t,
    ) ||
    /\blive\s+(on|an|ein)\b/i.test(t)
  );
}

export function wantsStopLiveChatVoiceCommand(text: string): boolean {
  const raw = (text || '').trim();
  if (!raw) return false;
  const head = raw.split(/\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const t = raw.replace(/\s+/g, ' ').trim();
  if (
    /^(live\s+(off|aus|stopp)|live[-\s]?chat\s+(aus|stopp|beend\w*))$/iu.test(
      head,
    )
  ) {
    return true;
  }
  return (
    /\b(live[-\s]?chat|gesprächs?modus)\s+(aus|stopp|beend)/i.test(t) ||
    /\blive\s+(off|aus)\b/i.test(t) ||
    /\b(aufhören\s+zuzuhören|nicht\s+mehr\s+zuhören|mikro\s+aus)\b/i.test(t)
  );
}
