/**
 * Eigenes Brainstorming-Mikro — nicht Home-Live-Chat, nicht Concierge.
 * Standard: immer zuhören. Aus nur bei Modul-zu oder User-Mute.
 */

import {
  isCurrentlyListening,
  isSttRecognitionLive,
  peekListeningTranscript,
  startListening,
  stopListening,
} from '../services/sttService';
import { reisebueroEndpointDelayMs } from './reisebueroEndpoint';
import {
  armMicVadWarmup,
  hasMicVadSamples,
  isMicLikelySpeaking,
} from '../services/handsFree/micVad';
import { looksLikeFindusEcho } from '../services/handsFree/echoGuard';

export type ReisebueroMicPhase = 'idle' | 'listening' | 'processing';

type Handlers = {
  onUtterance: (text: string) => Promise<void>;
  onPartial?: (text: string) => void;
  onPhase?: (phase: ReisebueroMicPhase) => void;
  getAskContext?: () => { turnIndex: number; lastAskOpen: boolean };
};

const MIN_CHARS = 3;
const MAX_DEFERS = 16;

let handlers: Handlers | null = null;
let active = false;
let processing = false;
let gen = 0;
let lastPartial = '';
let endpointTimer: ReturnType<typeof setTimeout> | null = null;
let deferCount = 0;
let phase: ReisebueroMicPhase = 'idle';

const listeners = new Set<(active: boolean, phase: ReisebueroMicPhase) => void>();

let watchdog: ReturnType<typeof setInterval> | null = null;
let ttsHold = false;
let typingHold = false;

let processingWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearProcessingWatchdog(): void {
  if (processingWatchdog) {
    clearTimeout(processingWatchdog);
    processingWatchdog = null;
  }
}

function armProcessingWatchdog(myGen: number): void {
  clearProcessingWatchdog();
  processingWatchdog = setTimeout(() => {
    processingWatchdog = null;
    if (!active || myGen !== gen) return;
    processing = false;
    ttsHold = false;
    setPhase('listening');
    void ensureListening(gen, 'processing-watchdog', true);
  }, 12_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clearWatchdog(): void {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
  clearProcessingWatchdog();
}

function listenCallback(myGen: number) {
  return (partial: string) => {
    if (!active || myGen !== gen) return;
    onPartial(partial);
  };
}

async function ensureListening(myGen: number, reason: string, force = false): Promise<boolean> {
  if (!active || myGen !== gen) return false;
  if (ttsHold && reason !== 'after-tts') return false;
  if (typingHold && reason !== 'after-typing') return false;
  if (processing && !force && reason !== 'watchdog') return false;
  if (!force && isSttRecognitionLive()) return true;
  armMicVadWarmup(450);
  const result = await startListening(listenCallback(myGen), { keepAlive: true, replaceActive: true });
  return result.ok;
}

export function isReisebueroMicHeldForTts(): boolean {
  return ttsHold;
}

export function isReisebueroMicHeldForTyping(): boolean {
  return typingHold;
}

/** Tastatur offen — STT komplett aus, sonst blockiert Audio-Focus das Tippen. */
export async function pauseReisebueroMicForTyping(): Promise<void> {
  typingHold = true;
  if (!active) return;
  clearEndpoint();
  lastPartial = '';
  try {
    await stopListening({ tailMs: 0, finalizeMs: 120 });
  } catch {
    /* soft */
  }
}

export async function resumeReisebueroMicAfterTyping(): Promise<void> {
  typingHold = false;
  if (!active || ttsHold) return;
  processing = false;
  await sleep(180);
  if (!active || ttsHold || typingHold) return;
  setPhase('listening');
  await ensureListening(gen, 'after-typing', true);
}

export async function pauseReisebueroMicForTts(): Promise<void> {
  if (!active) return;
  ttsHold = true;
  processing = true;
  clearEndpoint();
  lastPartial = '';
  try {
    await stopListening({ tailMs: 0, finalizeMs: 200 });
  } catch {
    /* soft */
  }
  setPhase('processing');
}

export async function resumeReisebueroMicAfterTts(): Promise<void> {
  if (!active) return;
  ttsHold = false;
  processing = false;
  clearProcessingWatchdog();
  if (typingHold) return;
  await sleep(420);
  if (!active || typingHold) return;
  setPhase('listening');
  for (let i = 0; i < 4; i += 1) {
    const ok = await ensureListening(gen, 'after-tts', true);
    await sleep(180);
    if (ok && (isSttRecognitionLive() || isCurrentlyListening())) return;
    await sleep(350 * (i + 1));
    if (!active) return;
  }
}

function setPhase(next: ReisebueroMicPhase): void {
  phase = next;
  handlers?.onPhase?.(next);
  listeners.forEach((fn) => fn(active, phase));
}

function clearEndpoint(): void {
  if (endpointTimer) {
    clearTimeout(endpointTimer);
    endpointTimer = null;
  }
}

export function isReisebueroMicActive(): boolean {
  return active;
}

export function getReisebueroMicPhase(): ReisebueroMicPhase {
  return phase;
}

export function subscribeReisebueroMic(
  fn: (on: boolean, phase: ReisebueroMicPhase) => void,
): () => void {
  listeners.add(fn);
  fn(active, phase);
  return () => {
    listeners.delete(fn);
  };
}

export async function startReisebueroMic(h: Handlers): Promise<{ ok: boolean; message?: string }> {
  handlers = h;
  if (active) {
    if (!ttsHold && !typingHold) {
      setPhase('listening');
      await ensureListening(gen, 'rebind', true);
    }
    return { ok: true };
  }
  try {
    const { getCachedUserProfile } = require('../services/userProfileService') as {
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
      const { showAudioConsentMissingAlert } = require('../utils/permissionAlerts') as {
        showAudioConsentMissingAlert: (o?: { force?: boolean }) => void;
      };
      showAudioConsentMissingAlert({ force: true });
      return {
        ok: false,
        message: 'Mikrofon-Einwilligung fehlt — bitte unter Einstellungen Sprache an aktivieren.',
      };
    }
  } catch {
    /* STT prüft OS-Permission */
  }

  try {
    const live = require('../services/handsFree/liveChatSession') as {
      isLiveChatActive: () => boolean;
      stopLiveChatSession: (r?: string) => Promise<void>;
    };
    if (live.isLiveChatActive()) {
      await live.stopLiveChatSession('reisebuero_mic');
    }
  } catch {
    /* soft */
  }

  active = true;
  processing = false;
  ttsHold = false;
  typingHold = false;
  lastPartial = '';
  deferCount = 0;
  gen += 1;
  const myGen = gen;
  setPhase('listening');
  armMicVadWarmup(450);
  const result = await startListening(listenCallback(myGen), { keepAlive: true, replaceActive: true });
  if (!result.ok) {
    active = false;
    setPhase('idle');
    return { ok: false, message: 'Mikrofon startet gerade nicht.' };
  }
  clearWatchdog();
  watchdog = setInterval(() => {
    if (!active || ttsHold || typingHold || processing) return;
    if (isSttRecognitionLive()) return;
    void ensureListening(myGen, 'watchdog', true);
  }, 2_500);
  return { ok: true };
}

export async function stopReisebueroMic(): Promise<void> {
  if (!active && phase === 'idle') return;
  active = false;
  processing = false;
  ttsHold = false;
  typingHold = false;
  gen += 1;
  clearWatchdog();
  clearEndpoint();
  lastPartial = '';
  try {
    await stopListening({ tailMs: 0, finalizeMs: 200 });
  } catch {
    /* soft */
  }
  setPhase('idle');
  handlers = null;
}

function onPartial(partial: string): void {
  const text = partial.replace(/\s+/g, ' ').trim();
  if (!text || processing || ttsHold || typingHold) return;
  if (looksLikeFindusEcho(text)) return;
  handlers?.onPartial?.(text);
  if (text === lastPartial) {
    if (text.length >= MIN_CHARS && !endpointTimer) scheduleEndpoint(text);
    return;
  }
  lastPartial = text;
  deferCount = 0;
  clearEndpoint();
  scheduleEndpoint(text);
}

function askCtx(): { turnIndex: number; lastAskOpen: boolean } {
  try {
    return handlers?.getAskContext?.() ?? { turnIndex: 0, lastAskOpen: true };
  } catch {
    return { turnIndex: 0, lastAskOpen: true };
  }
}

function scheduleEndpoint(snapshot: string): void {
  clearEndpoint();
  const ctx = askCtx();
  const delay = reisebueroEndpointDelayMs(snapshot, ctx);
  endpointTimer = setTimeout(() => {
    endpointTimer = null;
    void onStable(snapshot);
  }, delay);
}

async function onStable(snapshot: string): Promise<void> {
  if (!active || processing || ttsHold || typingHold) return;
  const now = peekListeningTranscript().replace(/\s+/g, ' ').trim();
  if (now !== snapshot && now.length > snapshot.length) {
    deferCount = 0;
    scheduleEndpoint(now);
    return;
  }
  if (hasMicVadSamples() && isMicLikelySpeaking()) {
    deferCount += 1;
    if (deferCount < MAX_DEFERS) {
      scheduleEndpoint(snapshot || now);
      return;
    }
  }
  if (/\b(und|aber|oder|dass|weil|also|mit|vom|von|bis|zum)$/iu.test(now || snapshot)) {
    deferCount += 1;
    if (deferCount < MAX_DEFERS) {
      scheduleEndpoint(now || snapshot);
      return;
    }
  }
  const text = (now || snapshot).trim();
  if (text.length < MIN_CHARS) return;
  await commit(text);
}

async function commit(text: string): Promise<void> {
  if (!active || processing || typingHold) return;
  if (/\b(mic(?:rofon)?\s*aus|mikro\s*aus|mikrofon\s*aus)\b/iu.test(text)) {
    await stopReisebueroMic();
    return;
  }
  processing = true;
  lastPartial = '';
  clearEndpoint();
  setPhase('processing');
  const myGen = gen;
  armProcessingWatchdog(myGen);
  await pauseReisebueroMicForTts();
  try {
    await handlers?.onUtterance(text);
  } catch {
    /* soft */
  }
  if (!active || myGen !== gen) return;
  await resumeReisebueroMicAfterTts();
}
