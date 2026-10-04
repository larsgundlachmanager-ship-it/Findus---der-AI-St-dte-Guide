/**
 * Reisebüro Live-Chat — KEIN eigenes Mic.
 * Nutzt exakt die Home-Live-Chat-Session (Endpoint, Soft-Commit, STT).
 * Capture-Mode: jedes gesprochene Wort → Briefing, ohne Wake-Wort-Filter.
 */

import {
  clearLiveChatIdleOverride,
  forceLiveChatResumeListening,
  isLiveChatActive,
  setLiveChatCapture,
  setLiveChatIdleOverrideMs,
  setLiveChatListenPaused,
  getLiveChatPhase,
  startLiveChatSession,
  stopLiveChatSession,
  subscribeLiveChat,
  type LiveChatPhase,
  waitLiveChatSpeechIdle,
} from '../services/handsFree/liveChatSession';
import { setMicVadTtsGate } from '../services/handsFree/micVad';
import { noteFindusSpokenForEcho } from '../services/handsFree/echoGuard';

const REISE_IDLE_MS = 15 * 60_000;

export type ReisebueroLivePhase = 'idle' | 'listening' | 'processing';
export type ReisebueroMicPhase = ReisebueroLivePhase;

type Handlers = {
  onUtterance: (text: string) => Promise<void>;
  onPartial?: (text: string) => void;
  onPhase?: (phase: ReisebueroLivePhase) => void;
};

function mapPhase(p: LiveChatPhase): ReisebueroLivePhase {
  if (p === 'listening') return 'listening';
  if (p === 'processing' || p === 'answering') return 'processing';
  return 'idle';
}

let owned = false;
let handlers: Handlers | null = null;

function wireCapture(): void {
  setLiveChatCapture({
    onUtterance: async (text) => {
      const t = (text || '').trim();
      if (!t) return;
      if (/\b(mikro\s*aus|mikrofon\s*aus|nicht\s+mehr\s+zuhören)\b/iu.test(t)) {
        await stopReisebueroLive();
        return;
      }
      await handlers?.onUtterance(t);
    },
    onPartial: (text) => handlers?.onPartial?.(text),
    skipAck: true,
    acceptAll: true,
  });
}

export function isReisebueroLiveActive(): boolean {
  return owned && isLiveChatActive();
}

export function subscribeReisebueroLive(
  fn: (active: boolean, phase: ReisebueroLivePhase) => void,
): () => void {
  return subscribeLiveChat((on, phase) => {
    fn(owned && on, mapPhase(phase));
  });
}

export async function startReisebueroLive(h: Handlers): Promise<{ ok: boolean; message?: string }> {
  handlers = h;
  // Vorherigen Modul-2-Turn / Home-Live hart trennen
  try {
    const { abortActiveModule2Turn } = require('../module2/pipeline/turnAbort') as {
      abortActiveModule2Turn: (r?: string) => void;
    };
    abortActiveModule2Turn('reisebuero_open');
  } catch {
    /* soft */
  }
  try {
    const { stopVoiceOnUserTap } = require('../module2/speech/speechQueue') as {
      stopVoiceOnUserTap: () => Promise<void>;
    };
    await stopVoiceOnUserTap();
  } catch {
    /* soft */
  }
  setLiveChatIdleOverrideMs(REISE_IDLE_MS);
  wireCapture();
  owned = true;
  try {
    if (isLiveChatActive()) await stopLiveChatSession('reisebuero_takeover');
  } catch {
    /* soft */
  }
  const res = await startLiveChatSession('reisebuero');
  if (!res.ok) {
    owned = false;
    setLiveChatCapture(null);
    clearLiveChatIdleOverride();
  }
  return res;
}

export async function stopReisebueroLive(): Promise<void> {
  owned = false;
  handlers = null;
  setLiveChatCapture(null);
  clearLiveChatIdleOverride();
  try {
    await stopLiveChatSession('reisebuero_end');
  } catch {
    /* soft */
  }
}

export async function pauseReisebueroLiveForTyping(): Promise<void> {
  await setLiveChatListenPaused(true);
}

export async function resumeReisebueroLiveAfterTyping(): Promise<void> {
  await setLiveChatListenPaused(false);
  // Extra-Kick falls Session idle blieb
  if (owned && handlers) {
    await ensureReisebueroMicListening();
  }
}

export async function waitReisebueroSpeechIdle(opts?: { postIdleMs?: number }): Promise<void> {
  await waitLiveChatSpeechIdle(opts);
}

export async function runReisebueroSpeech(
  speak: () => Promise<void>,
  textForEcho?: string,
): Promise<void> {
  setMicVadTtsGate(true);
  try {
    if (textForEcho) noteFindusSpokenForEcho(textForEcho);
    await speak();
  } finally {
    setMicVadTtsGate(false);
  }
}

/** Kompat: TTS-Hold = processing/answering Phase der Live-Session. */
export function isReisebueroMicHeldForTts(): boolean {
  const p = getLiveChatPhase();
  return p === 'processing' || p === 'answering';
}

export function isReisebueroMicActive(): boolean {
  return isReisebueroLiveActive();
}

/**
 * Mic heilen: Session tot → neu; Processing klebt → Force-Resume;
 * „listening“ aber STT taub → Force-Resume startet STT neu.
 */
export async function ensureReisebueroMicListening(): Promise<void> {
  if (!owned || !handlers) return;
  try {
    if (!isLiveChatActive()) {
      wireCapture();
      setLiveChatIdleOverrideMs(REISE_IDLE_MS);
      const res = await startLiveChatSession('reisebuero_heal');
      if (!res.ok) {
        console.warn('[Reisebuero] heal start failed', res.message);
        return;
      }
    }
    await forceLiveChatResumeListening();
  } catch (e) {
    console.warn('[Reisebuero] ensure mic failed', e);
  }
}
