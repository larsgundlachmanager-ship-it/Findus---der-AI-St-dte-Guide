/**
 * Ein Turn = eine TTS-Session: Bridge ist Satz 1, Hauptantwort hängt an denselben Pump.
 * TTS_SENTENCE_PIPELINE_LOCK
 */

import {
  createLiveSentencePump,
  remainingSpeechAfterLead,
  type LiveSentencePump,
} from '../../services/audio/liveSentencePump';

let pump: LiveSentencePump | null = null;
let activeTurnId = '';
let lastBridge = '';
let starting = false;
let enqueueChain: Promise<void> = Promise.resolve();

/** Haupt-Speech darf Wait-Bridge nicht wiederholen. */
export function stripLeadingBridgeEcho(speech: string, bridge: string | null): string {
  let s = (speech || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const b = (bridge || '').replace(/\s+/g, ' ').trim();
  if (b.length >= 12) {
    const head = b.slice(0, Math.min(40, b.length)).toLowerCase();
    if (s.toLowerCase().startsWith(head)) {
      const cut = s.search(/[.!?]/);
      if (cut > 0 && cut < 180) s = s.slice(cut + 1).trim();
    } else {
      const firstEnd = s.search(/[.!?]/);
      const first = (firstEnd > 0 ? s.slice(0, firstEnd) : s.slice(0, 90)).toLowerCase();
      const bridgeWords = new Set(b.toLowerCase().match(/[a-zäöüß]{4,}/gu) ?? []);
      const firstWords = first.match(/[a-zäöüß]{4,}/gu) ?? [];
      const overlap = firstWords.filter((w) => bridgeWords.has(w));
      if (overlap.length >= 2 && firstEnd > 0 && firstEnd < 180) {
        s = s.slice(firstEnd + 1).trim();
      }
    }
  }
  s = s
    .replace(
      /^(ich\s+(such|recherch|prüfe|pruefe|schau|check|hol)\b[^.!?]*[.!?]+\s*)+/iu,
      '',
    )
    .trim();
  return s || (speech || '').trim();
}

export function beginFusedTurnSpeech(turnId: string): void {
  const id = (turnId || '').trim();
  if (id && id === activeTurnId && pump && !pump.isEnded()) return;
  pump?.end();
  pump = createLiveSentencePump();
  activeTurnId = id;
  lastBridge = '';
  starting = false;
  try {
    const { noteModule2TurnBusy } = require('../../services/boot/interactiveBootGate') as {
      noteModule2TurnBusy: (b: boolean) => void;
    };
    noteModule2TurnBusy(true);
  } catch {
    /* soft */
  }
}

export function isFusedTurnLive(): boolean {
  return Boolean(pump && !pump.isEnded());
}

export function getFusedTurnId(): string {
  return activeTurnId;
}

/** Bridge dieses Turns schon committed — nie wegen Pump-Ende erneut sprechen. */
export function fusedBridgeCommitted(): boolean {
  return Boolean(lastBridge.trim()) || starting || Boolean(pump?.hasStarted());
}

export function getFusedTurnPump(): LiveSentencePump {
  // Mid-Turn: Pump nach Bridge-Satz oft „ended“ — neuen Pump für Call-2,
  // aber lastBridge/starting nicht löschen (sonst zweite Bridge).
  if (!pump || pump.isEnded()) {
    pump = createLiveSentencePump();
    starting = false;
  }
  return pump;
}

export function noteFusedBridge(text: string): void {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t) lastBridge = t;
}

function remainderAfterBridge(speech: string): string {
  const full = (speech || '').replace(/\s+/g, ' ').trim();
  if (!full) return '';
  if (!lastBridge) return full;
  const afterLead = remainingSpeechAfterLead(full, lastBridge);
  if (afterLead) return afterLead;
  const stripped = stripLeadingBridgeEcho(full, lastBridge);
  if (stripped && stripped !== lastBridge) return stripped;
  if (full === lastBridge) return '';
  return full;
}

async function ensureSession(
  firstSentence: string,
  turnId: string,
): Promise<void> {
  const p = getFusedTurnPump();
  if (p.hasStarted() || starting) return;
  if (!p.markStarted()) return;
  starting = true;
  try {
    const { speakRuntimeSentences } = await import('../../runtime/speechModule');
    const { getVoiceSettingsForTour } = await import('../../services/ttsService');
    const { warmStreamingPhrases } = await import(
      '../../services/audio/streamingAudioQueueService'
    );
    const voice = await getVoiceSettingsForTour();
    // Warm first hooks NOW — Cartesia während Satz 1, Rest hängt an dieselbe Session.
    warmStreamingPhrases(firstSentence, voice.voiceId);
    void speakRuntimeSentences(
      p.sentences,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { priority: 'question', deliveryKind: 'assistant' },
    );
  } catch {
    starting = false;
    return;
  }
  try {
    const { enqueueSpeech } = require('./speechQueue') as {
      enqueueSpeech: (j: {
        kind: 'main';
        text: string;
        turnId: string;
        alreadySpoken?: boolean;
      }) => void;
    };
    enqueueSpeech({
      kind: 'main',
      text: firstSentence,
      turnId,
      alreadySpoken: true,
    });
  } catch {
    /* occupancy optional */
  }
}

/** Bridge oder Haupttext in dieselbe Session. */
export function fusedEnqueue(opts: {
  kind: 'bridging' | 'main';
  text: string;
  turnId: string;
}): Promise<boolean> {
  const run = enqueueChain.then(() => fusedEnqueueImpl(opts));
  enqueueChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function ttsConsumerAlive(): boolean {
  try {
    const { getActiveTtsSessionCount } = require('../../services/AudioVoiceService') as {
      getActiveTtsSessionCount: () => number;
    };
    return getActiveTtsSessionCount() > 0;
  } catch {
    return false;
  }
}

async function fusedEnqueueImpl(opts: {
  kind: 'bridging' | 'main';
  text: string;
  turnId: string;
}): Promise<boolean> {
  const t = (opts.text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (opts.turnId && !activeTurnId) beginFusedTurnSpeech(opts.turnId);
  let p = getFusedTurnPump();

  if (opts.kind === 'bridging') {
    if (p.hasStarted() || starting) return true;
    noteFusedBridge(t);
    p.push(t);
    await ensureSession(t, opts.turnId || activeTurnId);
    return p.hasStarted() || starting;
  }

  const payload = p.hasStarted() || starting ? remainderAfterBridge(t) : t;
  if (!payload) return true;

  // Bridge-Session schon tot (Mic/OEM/Error) → Call-2 sonst stumm im toten Pump.
  // Nicht während ensureSession (starting) — sonst Race mit Session-Start.
  if (p.hasStarted() && !starting && !ttsConsumerAlive() && !p.isEnded()) {
    p.end();
    p = getFusedTurnPump();
    starting = false;
  }

  p.push(payload);
  if (!p.hasStarted() && !starting) {
    await ensureSession(payload, opts.turnId || activeTurnId);
  }
  return p.hasStarted() || starting;
}

export async function drainFusedEnqueue(): Promise<void> {
  await enqueueChain;
}

export function endFusedTurnSpeech(): void {
  pump?.end();
  // Busy erst wenn TTS/Queue idle — sonst Grün-Lücke zwischen Call-1 und Call-2.
  scheduleClearModule2TurnBusyWhenSpeechIdle();
}

export function resetFusedTurnSpeech(): void {
  pump?.end();
  pump = null;
  activeTurnId = '';
  lastBridge = '';
  starting = false;
  enqueueChain = Promise.resolve();
  try {
    const { noteModule2TurnBusy } = require('../../services/boot/interactiveBootGate') as {
      noteModule2TurnBusy: (b: boolean) => void;
    };
    noteModule2TurnBusy(false);
  } catch {
    /* soft */
  }
}

function scheduleClearModule2TurnBusyWhenSpeechIdle(): void {
  let tries = 0;
  const tick = () => {
    tries += 1;
    // Gate-Flag selbst nicht prüfen — sonst Endlosschleife.
    if (isTurnSpeechPendingIgnoringGateBusy() && tries < 40) {
      setTimeout(tick, 120);
      return;
    }
    try {
      const { noteModule2TurnBusy } = require('../../services/boot/interactiveBootGate') as {
        noteModule2TurnBusy: (b: boolean) => void;
      };
      noteModule2TurnBusy(false);
    } catch {
      /* soft */
    }
  };
  setTimeout(tick, 0);
}

/** Speech/TTS noch aktiv — ohne Gate-Flag (sonst Cleared-Busy nie). */
function isTurnSpeechPendingIgnoringGateBusy(): boolean {
  try {
    const { isStreamingAudioQueueBusy } = require('../../services/audio/streamingAudioQueueService') as {
      isStreamingAudioQueueBusy: () => boolean;
    };
    if (isStreamingAudioQueueBusy()) return true;
  } catch {
    /* soft */
  }
  try {
    const { isSpeechActive } = require('./speechQueue') as {
      isSpeechActive: () => boolean;
    };
    if (isSpeechActive()) return true;
  } catch {
    /* soft */
  }
  try {
    const { getActiveTtsSessionCount } = require('../../services/AudioVoiceService') as {
      getActiveTtsSessionCount: () => number;
    };
    if (getActiveTtsSessionCount() > 0) return true;
  } catch {
    /* soft */
  }
  return false;
}
