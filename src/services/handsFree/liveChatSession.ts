/**
 * Live-Chat-Session:
 * Mikro an → segmentieren → Open-Floor Follow-ups ohne Keyword → Idle → aus.
 */

import {
  isCurrentlyListening,
  peekListeningTranscript,
  setListeningPartialHandler,
  unlockListeningPartialHandler,
  startListening,
  stopListening,
} from '../sttService';
import { classifyLiveChatAddress } from './liveChatAddress';
import {
  computeEndpointDelayMs,
  looksLikeFinishedUtterance,
  looksLikeClearSentenceEnd,
  softCommitMsForText,
  MIN_VAD_SILENCE_MS,
  CAPTURE_ENDPOINT_FLOOR_MS,
  CAPTURE_ENDPOINT_EXTRA_MS,
  CAPTURE_MIN_VAD_SILENCE_MS,
  CAPTURE_SOFT_COMMIT_MS,
  CAPTURE_MAX_ENDPOINT_DEFERS,
  CAPTURE_STABLE_FORCE_MS,
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
/** Reisebüro / Overlay: alle Utterances hierhin, ohne Wake-Filter. */
export type LiveChatCapture = {
  onUtterance: (text: string) => Promise<void>;
  onPartial?: (text: string) => void;
  skipAck?: boolean;
  acceptAll?: boolean;
};
let capture: LiveChatCapture | null = null;
/** Tippen: STT pausiert, Session bleibt aktiv. */
let listenPaused = false;
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
const MAX_ENDPOINT_DEFERS = 4;
/** Capture: seit wann das Transkript inhaltlich stabil ist */
let captureStableAt = 0;
let captureStableNorm = '';

const listeners = new Set<(active: boolean, phase: LiveChatPhase) => void>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Nur Buchstaben/Zahlen — STT-Jitter (Groß/Klein, Komma) zählt nicht als Weiterreden. */
function normTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9äöüßàáâãåæçèéêëìíîïñòóôõøùúûüýÿ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True = User hat wirklich weitergesprochen (nicht nur STT-Korrektur). */
function meaningfulTranscriptAdvance(prev: string, next: string): boolean {
  if (!prev) return true;
  if (next === prev) return false;
  const pn = normTranscript(prev);
  const nn = normTranscript(next);
  if (!nn || nn === pn) return false;
  if (nn.startsWith(pn) && nn.length > pn.length) return true;
  if (pn.startsWith(nn) && pn.length - nn.length <= 6) return false;
  const pw = pn.split(' ').filter(Boolean);
  const nw = nn.split(' ').filter(Boolean);
  if (nw.length > pw.length) return true;
  if (nw.length < pw.length) return false;
  if (nw.length === 0) return false;
  return nw[nw.length - 1] !== pw[pw.length - 1];
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

/**
 * Rückfrage: Turn darf weiterwarten, Mic trotzdem wieder auf.
 * Sonst blockt `processing` das nächste „Ja“ / freie Follow-up.
 */
export function releaseLiveChatFloorForAsk(): void {
  if (!active) return;
  processing = false;
  openFloor = true;
  bumpAddressedActivity();
  const gen = listenGeneration;
  void waitSpeechIdleThenListen(gen, { awaitSpeechStartMs: 900 });
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

export function setLiveChatCapture(next: LiveChatCapture | null): void {
  capture = next;
}

export function getLiveChatCapture(): LiveChatCapture | null {
  return capture;
}

export function isLiveChatCaptureActive(): boolean {
  return Boolean(capture?.acceptAll && capture?.onUtterance);
}

export async function forceLiveChatResumeListening(): Promise<void> {
  if (!active) return;
  listenPaused = false;
  processing = false;
  setMicVadTtsGate(false);
  openFloor = true;
  bumpAddressedActivity();
  // Reisebüro-Capture: nach TTS immer hart neu starten — „listening aber taub“ ist häufig
  const captureAll = Boolean(capture?.acceptAll);
  if (isCurrentlyListening() && !captureAll) {
    let sttLive = true;
    let awaitingRestart = false;
    try {
      const { isSttRecognitionLive, isSttAwaitingRestart } = require('../sttService') as {
        isSttRecognitionLive: () => boolean;
        isSttAwaitingRestart: () => boolean;
      };
      sttLive = isSttRecognitionLive();
      awaitingRestart = isSttAwaitingRestart();
    } catch {
      sttLive = true;
    }
    // keepAlive-Hold = kurzer Restart, nicht „taub“
    if (sttLive || awaitingRestart) {
      setPhase('listening');
      return;
    }
    // „Mic an“ in UI, aber STT tot → hart neu starten
    if (__DEV__) console.warn('[liveChat] resume: listening but STT deaf — restart');
    try {
      await stopListening({ tailMs: 0, finalizeMs: 80 });
    } catch {
      /* soft */
    }
  } else if (isCurrentlyListening() && captureAll) {
    try {
      await stopListening({ tailMs: 0, finalizeMs: 80 });
    } catch {
      /* soft */
    }
  }
  await resumeListening(listenGeneration, { echoWarmup: true });
}

export async function setLiveChatListenPaused(paused: boolean): Promise<void> {
  listenPaused = Boolean(paused);
  if (!active) return;
  if (listenPaused) {
    clearEndpoint();
    try {
      await stopListening({ tailMs: 0, finalizeMs: 120 });
    } catch {
      /* soft */
    }
    setPhase('idle');
    return;
  }
  // Tippen zu: Capture/Reisebüro darf nicht an processing kleben bleiben
  if (capture?.acceptAll) {
    processing = false;
    setMicVadTtsGate(false);
    openFloor = true;
    await resumeListening(listenGeneration, { echoWarmup: true });
    return;
  }
  if (processing) return;
  await resumeListening(listenGeneration, { echoWarmup: false });
}

/** Warten bis TTS still (z. B. vor Reisebüro-Mic-Start). */
export async function waitLiveChatSpeechIdle(opts?: {
  postIdleMs?: number;
}): Promise<void> {
  setMicVadTtsGate(true);
  await sleep(60);
  for (let i = 0; i < 80; i += 1) {
    let on = false;
    try {
      const { isSpeechActive } = await import('../../module2/speech/speechQueue');
      on = isSpeechActive();
    } catch {
      on = false;
    }
    if (!on) break;
    await sleep(150);
  }
  await sleep(opts?.postIdleMs ?? 450);
  setMicVadTtsGate(false);
}

/**
 * Nach Start/Antwort: Mikro erst wenn TTS ruhig (kein Echo der Bestätigung).
 */
async function waitSpeechIdleThenListen(
  gen: number,
  opts?: { awaitSpeechStartMs?: number; postIdleMs?: number },
): Promise<void> {
  if (!active || gen !== listenGeneration) return;
  const awaitStart = opts?.awaitSpeechStartMs ?? 900;
  const postIdle = opts?.postIdleMs ?? 400;
  setMicVadTtsGate(true);
  // Pipeline-Lag: Bestätigung startet oft erst nach Return
  await sleep(awaitStart);
  for (let i = 0; i < 120; i++) {
    if (!active || gen !== listenGeneration) return;
    let speechOn = false;
    let generating = false;
    try {
      const { isSpeechActive } = await import('../../module2/speech/speechQueue');
      speechOn = isSpeechActive();
      setMicVadTtsGate(speechOn);
    } catch {
      speechOn = false;
    }
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: { getState: () => { isGenerating?: boolean } };
      };
      generating = Boolean(useFinnusStore.getState().isGenerating);
    } catch {
      generating = false;
    }
    if (!speechOn && !generating) break;
    await sleep(250);
  }
  if (postIdle > 0) await sleep(postIdle);
  if (!active || gen !== listenGeneration) return;
  setMicVadTtsGate(false);
  await resumeListening(gen, { echoWarmup: true });
}

async function resumeListening(
  gen: number,
  opts?: { echoWarmup?: boolean },
): Promise<void> {
  if (!active || gen !== listenGeneration) return;
  if (listenPaused) {
    setPhase('idle');
    return;
  }
  if (isCurrentlyListening()) return;
  setPhase('listening');
  armMicVadWarmup(opts?.echoWarmup ? VAD_ECHO_WARMUP_MS : VAD_WARMUP_MS);
  // Während Echo-Warmup TTS-Gate an; sonst aus
  setMicVadTtsGate(Boolean(opts?.echoWarmup));
  let ok = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!active || gen !== listenGeneration || listenPaused) return;
    const result = await startListening((partial) => {
      if (!active || gen !== listenGeneration) return;
      onPartial(partial);
    }, { keepAlive: true, replaceActive: true });
    if (result.ok) {
      ok = true;
      break;
    }
    if (__DEV__) console.warn('[liveChat] STT resume fail', attempt + 1, (result as { reason?: string }).reason ?? result);
    await sleep(280 + attempt * 220);
  }
  if (ok) {
    if (opts?.echoWarmup) {
      setTimeout(() => {
        if (active && gen === listenGeneration && !listenPaused) setMicVadTtsGate(false);
      }, VAD_ECHO_WARMUP_MS);
    } else {
      setMicVadTtsGate(false);
    }
    return;
  }
  // Capture/Reisebüro: Session nicht killen — später nochmal versuchen
  if (capture?.acceptAll) {
    if (__DEV__) console.warn('[liveChat] capture STT soft-retry');
    setPhase('idle');
    setTimeout(() => {
      if (!active || gen !== listenGeneration || listenPaused) return;
      // processing darf Soft-Retry nicht killen (sonst Mic tot nach TTS)
      if (processing && !capture?.acceptAll) return;
      processing = false;
      void resumeListening(gen, { echoWarmup: true });
    }, 1400);
    return;
  }
  void stopLiveChatSession('stt_failed');
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
  if (listenPaused || processing) return;

  // Echo der eigenen Stimme → ignorieren
  if (looksLikeFindusEcho(text)) {
    if (__DEV__) console.log('[liveChat] echo ignore', text.slice(0, 48));
    return;
  }

  try {
    capture?.onPartial?.(text);
  } catch {
    /* soft */
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

  // Capture: STT-Jitter (Komma/Großschreibung) darf Endpoint nicht neu starten
  if (capture?.acceptAll && !meaningfulTranscriptAdvance(lastPartial, text)) {
    lastPartial = text;
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

  let delay = computeEndpointDelayMs(snapshot);
  // Reisebüro: Denk-/Lufthol-Pausen mitten im Satz nicht als Ende
  if (capture?.acceptAll) {
    delay = Math.max(delay + CAPTURE_ENDPOINT_EXTRA_MS, CAPTURE_ENDPOINT_FLOOR_MS);
    if (!looksLikeClearSentenceEnd(snapshot)) {
      delay = Math.max(delay, CAPTURE_ENDPOINT_FLOOR_MS + 250);
    }
    const norm = normTranscript(snapshot);
    if (norm !== captureStableNorm) {
      captureStableNorm = norm;
      captureStableAt = Date.now();
    }
  }
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
  // Ausnahme (nur Modul 2): klare Satzende → nicht endlos auf Lärm warten
  const patient = Boolean(capture?.acceptAll);
  const finished = patient
    ? looksLikeClearSentenceEnd(snapshot || now)
    : looksLikeFinishedUtterance(snapshot || now);
  const maxDefers = patient ? CAPTURE_MAX_ENDPOINT_DEFERS : MAX_ENDPOINT_DEFERS;
  const minSilence = patient
    ? finished
      ? Math.max(MIN_VAD_SILENCE_MS, 520)
      : CAPTURE_MIN_VAD_SILENCE_MS
    : MIN_VAD_SILENCE_MS;
  // Capture: immer echte Pause — 6 Wörter ≠ Satzende
  const forceSilence = patient;
  // STT-Plateau allein darf Stimme nicht überstimmen (sonst Cut mitten im Monolog)
  const vadSpeaking = hasMicVadSamples() && isMicLikelySpeaking();
  const stableForced =
    patient &&
    !vadSpeaking &&
    captureStableAt > 0 &&
    Date.now() - captureStableAt >= CAPTURE_STABLE_FORCE_MS;

  if (
    !stableForced &&
    (!finished || forceSilence) &&
    vadSpeaking
  ) {
    endpointDeferCount += 1;
    if (endpointDeferCount < maxDefers) {
      if (__DEV__) console.log('[liveChat] continue-speaking (vad) — defer cut');
      scheduleEndpoint(snapshot || now);
      return;
    }
    // Capture: VAD-Lärm darf Cut nicht endlos blockieren (früher: Counter reset → nie cut)
    if (patient) {
      if (endpointDeferCount >= 18) {
        if (__DEV__) console.log('[liveChat] capture vad wall — force soft-commit');
        // fall through → cut
      } else {
        if (__DEV__) console.log('[liveChat] capture speaking — defer cut', endpointDeferCount);
        scheduleEndpoint(snapshot || now);
        return;
      }
    } else if (__DEV__) {
      console.log('[liveChat] vad speaking-cap — force soft-commit');
    }
  }

  // Hybrid: bei verfügbarem VAD Stille abwarten — außer fertige Utterance (außer Capture)
  if (
    !stableForced &&
    (!finished || forceSilence) &&
    hasMicVadSamples() &&
    endpointDeferCount < maxDefers
  ) {
    const silence = getMicSilenceMs();
    if (silence < minSilence) {
      endpointDeferCount += 1;
      endpointTimer = setTimeout(() => {
        endpointTimer = null;
        void onStableElapsed(snapshot);
      }, Math.max(180, minSilence - silence));
      return;
    }
  }

  endpointDeferCount = 0;
  captureStableAt = 0;
  captureStableNorm = '';
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
  let ms = softCommitMsForText(snapshot);
  if (capture?.acceptAll) {
    // Klare Enden (? / Ja.) etwas kürzer, sonst volle Gnadenfrist
    ms = looksLikeClearSentenceEnd(snapshot)
      ? Math.max(ms, Math.round(CAPTURE_SOFT_COMMIT_MS * 0.65))
      : Math.max(ms, CAPTURE_SOFT_COMMIT_MS);
  }
  softCommitTimer = setTimeout(() => {
    softCommitTimer = null;
    const snap = softCommitSnapshot;
    softCommitSnapshot = '';
    void finalizeSoftCommit(snap);
  }, ms);
}

async function finalizeSoftCommit(snapshot: string): Promise<void> {
  if (!active || processing) return;

  const now = peekListeningTranscript().replace(/\s+/g, ' ').trim();
  if (now.length > snapshot.length) {
    endpointDeferCount = 0;
    scheduleEndpoint(now);
    return;
  }
  const patient = Boolean(capture?.acceptAll);
  const maxDefers = patient ? CAPTURE_MAX_ENDPOINT_DEFERS : MAX_ENDPOINT_DEFERS;
  if (hasMicVadSamples() && isMicLikelySpeaking()) {
    // Capture: Stimme → nie cutten, egal ob STT schon „fertig“ aussieht
    const mayCutWhileSpeaking =
      !patient && looksLikeFinishedUtterance(snapshot || now);
    if (!mayCutWhileSpeaking) {
      endpointDeferCount += 1;
      if (endpointDeferCount < maxDefers || patient) {
        if (patient && endpointDeferCount >= maxDefers) {
          endpointDeferCount = Math.max(0, maxDefers - 8);
        }
        if (__DEV__) console.log('[liveChat] soft-commit aborted — still speaking');
        scheduleEndpoint(snapshot || now);
        return;
      }
    }
  }

  await cutAndProcess(snapshot || now);
}

function minLiveChatUtteranceChars(): number {
  try {
    const { getFlightTripSession } = require('../flights/flightTripSession') as {
      getFlightTripSession: () => { pendingAsk?: string | null } | null;
    };
    if (getFlightTripSession()?.pendingAsk) return 2;
  } catch {
    /* soft */
  }
  try {
    const { isPlanAwaitingUserReply } = require('../../module2/planning/planSessionState') as {
      isPlanAwaitingUserReply: () => boolean;
    };
    if (isPlanAwaitingUserReply()) return 2;
  } catch {
    /* soft */
  }
  return MIN_UTTERANCE_CHARS;
}

async function cutAndProcess(snapshot: string): Promise<void> {
  if (!active || processing) return;
  const raw = (snapshot || peekListeningTranscript()).replace(/\s+/g, ' ').trim();
  if (raw.length < minLiveChatUtteranceChars()) return;
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

  // Capture (Reisebüro): NUR Briefing — nie submitUserQuestion / Modul 2
  if (capture?.acceptAll) {
    const sink = capture;
    bumpAddressedActivity();
    openFloor = true;
    setPhase('answering');
    setMicVadTtsGate(true);
    clearLiveChatTurnContext();
    try {
      const { abortActiveModule2Turn } = require('../../module2/pipeline/turnAbort') as {
        abortActiveModule2Turn: (r?: string) => void;
      };
      abortActiveModule2Turn('reisebuero_capture');
    } catch {
      /* soft */
    }
    const reopenMicAfterSpeech = async () => {
      if (!active || gen !== listenGeneration) return;
      // Tippen-Pause darf TTS-Ende nicht „einfrieren“
      listenPaused = false;
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
      await sleep(280);
      if (!active || gen !== listenGeneration) return;
      openFloor = true;
      bumpAddressedActivity();
      processing = false;
      setMicVadTtsGate(false);
      listenPaused = false;
      await resumeListening(gen, { echoWarmup: true });
      // Falls STT noch nicht läuft: ein zweiter Soft-Kick
      if (active && gen === listenGeneration && !isCurrentlyListening()) {
        await sleep(500);
        if (active && gen === listenGeneration && !listenPaused) {
          await resumeListening(gen, { echoWarmup: false });
        }
      }
    };
    try {
      if (__DEV__) console.log('[liveChat] capture utterance:', transcript.slice(0, 80));
      await sink.onUtterance(transcript);
    } catch (err) {
      console.warn('[liveChat] capture submit failed:', err);
    }
    if (active && gen === listenGeneration) {
      if (!processing && isCurrentlyListening()) return;
      await reopenMicAfterSpeech();
    } else {
      processing = false;
    }
    return;
  }

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
    // Live-Chat: Deep Research immer erst fragen — außerhalb immer automatisch
    askBeforeDeepResearch: true,
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
    // Floor schon für Rückfrage freigegeben (releaseLiveChatFloorForAsk) —
    // dann nicht nochmal reopenMicAfterSpeech (doppeltes Listen / Echo).
    if (!processing && isCurrentlyListening()) return;
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
  if (!handlers?.submitUserQuestion && !capture?.onUtterance) {
    return {
      ok: false,
      message:
        'Live-Chat noch nicht bereit — kurz Home öffnen und nochmal versuchen.',
    };
  }

  try {
    const { getCachedUserProfile } = require('../userProfileService') as {
      getCachedUserProfile: () => {
        micListenMode?: string | null;
        hasAcceptedAudioConsent?: boolean;
      } | null;
    };
    const profile = getCachedUserProfile();
    if (
      profile?.micListenMode === 'dont_hear' ||
      !profile?.hasAcceptedAudioConsent ||
      profile?.micListenMode !== 'hear'
    ) {
      const { showAudioConsentMissingAlert } = require('../../utils/permissionAlerts') as {
        showAudioConsentMissingAlert: (o?: {
          force?: boolean;
          onTypeAsk?: () => void;
        }) => void;
      };
      showAudioConsentMissingAlert({ force: true });
      return {
        ok: false,
        message:
          'Mikrofon-Einwilligung fehlt — bitte unter Einstellungen Sprache an aktivieren.',
      };
    }
  } catch {
    /* soft — STT prüft OS-Permission separat */
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

  // Reisebüro: kein Cue — Greeting-TTS war gerade, Cue killt Android-STT
  if (reason !== 'reisebuero') {
    void playLiveChatStartCue().catch(() => undefined);
  }

  const idle = getHandsFreePrefsSync().liveChatIdleSeconds;
  const needKw = getHandsFreePrefsSync().requireKeywordEveryTurn;
  const okMessage = needKw
    ? `Live-Chat an. Sprich mich klar an (Name oder Frage an mich). Nach ${idle} Sekunden ohne mich ist das Mikro aus.`
    : `Live-Chat an — ich höre zu. Frag frei, z. B. „führ mich dahin“. Mit Freunden quatschen stört nicht. Nach ${idle} Sekunden ohne mich schalte ich das Mikro aus.`;

  // Hold->Live: STT laeuft schon — Handler umhaengen, kein Stop/Restart.
  if (isCurrentlyListening()) {
    setListeningPartialHandler((partial) => {
      if (!active || gen !== listenGeneration) return;
      onPartial(partial);
    }, { lock: true });
    armMicVadWarmup(VAD_WARMUP_MS);
    setMicVadTtsGate(false);
    return { ok: true, message: okMessage };
  }

  const swipeStart = reason === 'swipe_left';
  let speechOn = false;
  let generating = false;
  try {
    const { isSpeechActive } = require('../../module2/speech/speechQueue') as {
      isSpeechActive: () => boolean;
    };
    speechOn = isSpeechActive();
  } catch {
    speechOn = false;
  }
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { isGenerating?: boolean } };
    };
    generating = Boolean(useFinnusStore.getState().isGenerating);
  } catch {
    generating = false;
  }

  // Still: sofort zuhoeren — kein kuenstliches Idle-Warten.
  if (!speechOn && !generating) {
    void resumeListening(gen, { echoWarmup: false });
  } else {
    const awaitSpeechStartMs = reason === 'voice' ? 1100 : swipeStart ? 200 : 700;
    void waitSpeechIdleThenListen(gen, {
      awaitSpeechStartMs,
      postIdleMs: swipeStart ? 120 : 400,
    });
  }

  return { ok: true, message: okMessage };
}

export async function stopLiveChatSession(reason = 'manual'): Promise<void> {
  // Auch im Idle: Lock/STT freigeben — sonst blockiert Reisebüro-Mic den Handler.
  if (!active && phase === 'idle') {
    unlockListeningPartialHandler();
    setMicVadTtsGate(false);
    return;
  }
  if (__DEV__) console.log('[liveChat] stop:', reason);
  active = false;
  openFloor = false;
  processing = false;
  listenPaused = false;
  listenGeneration += 1;
  clearIdle();
  clearEndpoint();
  lastPartial = '';
  setMicVadTtsGate(false);
  unlockListeningPartialHandler();
  clearLiveChatTurnContext();
  // UI sofort idle — nicht erst nach stopListening (sonst wirkt Tap tot,
  // nächster Tipp öffnet Tippfeld während Mic noch „live“ aussieht).
  setPhase('idle');
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
    await stopListening({
      tailMs: 0,
      finalizeMs: reason === 'reisebuero_mic' ? 80 : 400,
    });
  } catch {
    /* soft */
  }
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
    /^(live\s+(on|an|ein|start(?:en)?|aktiv)|live[-\s]?chat(?:\s+(an|ein|start(?:en)?|aktiv))?|(?:yorro|findus)[-\s]?live)$/iu.test(
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
    /\b(gespräch\s+(an|starten)|durchgehend\s+zuh[oö]ren|(?:yorro|findus)[-\s]?live)\b/i.test(
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
  if (/^(beenden|stopp|stop|aus|schluss|ende)\.?$/iu.test(head) && isLiveChatActive()) {
    return true;
  }
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
