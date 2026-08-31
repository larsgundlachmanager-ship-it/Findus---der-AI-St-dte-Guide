/**
 * Gemini billing / credit guard.
 * Detects empty prepaid credits and surfaces a one-shot user warning.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-gemini-billing.json`;
/** Don't spam the user more often than this. */
const WARN_COOLDOWN_MS = 20 * 60_000;
/** Nach Aufladen: Gemini nach so lange nochmal versuchen. */
const RETRY_AFTER_MS = 60_000;

export const GEMINI_CREDITS_EMPTY_SPEECH =
  'Mein Gemini-Guthaben ist leer und muss wieder aufgeladen werden. Bis das wieder da ist, nehme ich den Reserve-Kanal.';

type BillingState = {
  exhausted: boolean;
  lastErrorAtMs: number;
  lastWarnedAtMs: number;
  lastMessage: string;
};

let memory: BillingState = {
  exhausted: false,
  lastErrorAtMs: 0,
  lastWarnedAtMs: 0,
  lastMessage: '',
};

let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as Partial<BillingState>;
    memory = {
      exhausted: parsed.exhausted === true,
      lastErrorAtMs: Number(parsed.lastErrorAtMs) || 0,
      lastWarnedAtMs: Number(parsed.lastWarnedAtMs) || 0,
      lastMessage: String(parsed.lastMessage ?? ''),
    };
  } catch {
    /* ignore */
  }
}

async function persist(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(memory));
  } catch {
    /* ignore */
  }
}

/** True when error looks like empty prepaid credits / billing block (not soft rate limit). */
export function isGeminiCreditsExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/prepayment credits are depleted/i.test(msg)) return true;
  if (/credits? (?:are )?depleted/i.test(msg)) return true;
  if (/manage your project and billing/i.test(msg)) return true;
  if (/billing/i.test(msg) && /RESOURCE_EXHAUSTED|429/i.test(msg)) return true;
  if (/CONSUMER_SUSPENDED|billing enabled|payment/i.test(msg)) return true;
  return false;
}

/** Soft 429 / quota — may still recover; not a hard „Guthaben leer“. */
export function isGeminiSoftRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (isGeminiCreditsExhaustedError(err)) return false;
  return /429|Too Many Requests|RESOURCE_EXHAUSTED|quota/i.test(msg);
}

export async function noteGeminiCreditsExhausted(
  err?: unknown,
): Promise<void> {
  await hydrate();
  memory.exhausted = true;
  memory.lastErrorAtMs = Date.now();
  memory.lastMessage =
    err instanceof Error ? err.message : String(err ?? 'credits depleted');
  await persist();
  if (__DEV__) {
    console.warn('[gemini-billing] credits exhausted flagged');
  }
}

export async function clearGeminiCreditsExhausted(): Promise<void> {
  await hydrate();
  memory.exhausted = false;
  memory.lastMessage = '';
  await persist();
}

export async function isGeminiCreditsExhausted(): Promise<boolean> {
  await hydrate();
  return memory.exhausted;
}

/**
 * Factual user-facing notice (system status, not a chat template).
 * Fires when a new exhaustion error arrived since last warn, or after cooldown.
 */
export async function consumeGeminiCreditsWarning(): Promise<string | null> {
  await hydrate();
  if (!memory.exhausted) return null;
  const now = Date.now();
  const newFailSinceWarn = memory.lastErrorAtMs > memory.lastWarnedAtMs;
  const cooledDown = now - memory.lastWarnedAtMs >= WARN_COOLDOWN_MS;
  if (!newFailSinceWarn && !cooledDown) return null;
  memory.lastWarnedAtMs = now;
  await persist();
  return GEMINI_CREDITS_EMPTY_SPEECH;
}

/** Nach einer Minute nochmal Gemini — z. B. wenn du gerade aufgeladen hast. */
export function shouldRetryGeminiAfterExhaustion(now = Date.now()): boolean {
  if (!memory.exhausted) return false;
  return now - (memory.lastErrorAtMs || 0) >= RETRY_AFTER_MS;
}

/** Peek without consuming cooldown (for UI badges). */
export async function peekGeminiCreditsExhausted(): Promise<boolean> {
  await hydrate();
  return memory.exhausted;
}

/** Sync: nach dem ersten 429, ohne await — Skip-Gemini / OpenAI-Pfad. */
export function isGeminiCreditsExhaustedSync(): boolean {
  return memory.exhausted === true;
}
