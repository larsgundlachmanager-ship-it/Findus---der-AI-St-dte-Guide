/**
 * Leichter Mic-VAD über expo-speech-recognition `volumechange` (−2…10).
 * Adaptive Noise-Floor + Debounce gegen Wind/Straßenlärm; TTS-Gate gegen Speaker-Leak.
 */

/** Docs: Werte &lt; 0 ≈ inaudible */
const INAUDIBLE = 0;
const DEFAULT_NOISE_FLOOR = -0.4;
/** Abstand über Noise-Floor = „gesprochen“ */
const SPEECH_MARGIN = 1.35;
/** Während TTS/Echo: höherer Abstand */
const TTS_SPEECH_MARGIN = 2.6;
/** Noise-Floor darf Wind nicht endlos hochziehen */
const MAX_NOISE_FLOOR = 2.2;
const MIN_NOISE_FLOOR = -1.6;
/** EMA für Ruhepegel */
const FLOOR_ALPHA_QUIET = 0.08;
const FLOOR_ALPHA_SPEECH = 0.02;
/** Debounce: so viele stille Samples in Folge (bei ~100 ms Intervall) */
const SILENT_SAMPLES_NEEDED = 3;

let noiseFloor = DEFAULT_NOISE_FLOOR;
let lastValue = -2;
let lastVoiceAtMs = 0;
let lastSampleAtMs = 0;
let consecutiveSilent = 0;
let silenceStartedAtMs = 0;
let samplesSeen = 0;
let ttsGate = false;
let warmupUntilMs = 0;
let enabled = false;

export function resetMicVad(): void {
  noiseFloor = DEFAULT_NOISE_FLOOR;
  lastValue = -2;
  lastVoiceAtMs = 0;
  lastSampleAtMs = 0;
  consecutiveSilent = 0;
  silenceStartedAtMs = 0;
  samplesSeen = 0;
  ttsGate = false;
  warmupUntilMs = 0;
}

export function setMicVadEnabled(on: boolean): void {
  enabled = on;
  if (!on) resetMicVad();
}

export function isMicVadEnabled(): boolean {
  return enabled;
}

/** Nach Mic-Start/Resume: Volume kurz ignorieren (TTS-Nachhall). */
export function armMicVadWarmup(ms: number, now = Date.now()): void {
  warmupUntilMs = now + Math.max(0, ms);
}

/** TTS spielt → strengere Schwelle / weniger False-Speech. */
export function setMicVadTtsGate(active: boolean): void {
  ttsGate = active;
}

export function hasMicVadSamples(): boolean {
  return samplesSeen >= 3;
}

function speechThreshold(): number {
  const margin = ttsGate ? TTS_SPEECH_MARGIN : SPEECH_MARGIN;
  return Math.max(INAUDIBLE, noiseFloor + margin);
}

function updateNoiseFloor(value: number, speaking: boolean): void {
  const alpha = speaking ? FLOOR_ALPHA_SPEECH : FLOOR_ALPHA_QUIET;
  // Nur „ruhige“ Samples ziehen den Floor; Speech nur sehr langsam
  if (!speaking || value < speechThreshold()) {
    noiseFloor = noiseFloor * (1 - alpha) + value * alpha;
    noiseFloor = Math.min(MAX_NOISE_FLOOR, Math.max(MIN_NOISE_FLOOR, noiseFloor));
  }
}

/**
 * volumechange Callback (−2…10).
 * @returns true wenn gerade als Stimme gewertet
 */
export function noteMicVolume(value: number, now = Date.now()): boolean {
  if (!enabled) return false;
  if (!Number.isFinite(value)) return false;

  samplesSeen += 1;
  lastSampleAtMs = now;
  lastValue = value;

  if (now < warmupUntilMs) {
    // Warmup: Floor sanft lernen, aber nicht als Stimme zählen
    if (value < INAUDIBLE + 0.5) {
      updateNoiseFloor(value, false);
    }
    consecutiveSilent = SILENT_SAMPLES_NEEDED;
    if (!silenceStartedAtMs) silenceStartedAtMs = now;
    return false;
  }

  const thr = speechThreshold();
  const speaking = value >= thr;

  updateNoiseFloor(value, speaking);

  if (speaking) {
    lastVoiceAtMs = now;
    consecutiveSilent = 0;
    silenceStartedAtMs = 0;
    return true;
  }

  consecutiveSilent += 1;
  if (consecutiveSilent >= SILENT_SAMPLES_NEEDED) {
    if (!silenceStartedAtMs) silenceStartedAtMs = now;
  } else {
    silenceStartedAtMs = 0;
  }
  return false;
}

/** Debounced Stille-Dauer; 0 wenn gerade Stimme / Warmup / zu wenig Samples. */
export function getMicSilenceMs(now = Date.now()): number {
  if (!enabled || samplesSeen < 3) return 0;
  if (now < warmupUntilMs) return 0;
  if (consecutiveSilent < SILENT_SAMPLES_NEEDED || !silenceStartedAtMs) return 0;
  return Math.max(0, now - silenceStartedAtMs);
}

export function isMicLikelySpeaking(now = Date.now()): boolean {
  if (!enabled || samplesSeen < 3) return false;
  if (now < warmupUntilMs) return false;
  if (ttsGate) {
    // Während TTS: nur sehr laute Peaks zählen (Leak-Schutz)
    return lastValue >= speechThreshold() && now - lastVoiceAtMs < 180;
  }
  return now - lastVoiceAtMs < 220 && lastValue >= speechThreshold() * 0.85;
}

/** Debug / Kalibrierung */
export function getMicVadDebug(): {
  noiseFloor: number;
  threshold: number;
  lastValue: number;
  silenceMs: number;
  samplesSeen: number;
  ttsGate: boolean;
} {
  return {
    noiseFloor,
    threshold: speechThreshold(),
    lastValue,
    silenceMs: getMicSilenceMs(),
    samplesSeen,
    ttsGate,
  };
}
