/**
 * Countdown-Timer — „Timer 10 Minuten“ / Eieruhr.
 * Android: Clock SET_TIMER + AlarmManager (Hintergrund/Display-aus).
 * Fallback: Notification + In-App-Timeout (TTS wenn App offen).
 */

import type { QuickAction } from '../../types/concierge';
import { scheduleCountdownTimer } from '../notifications/notificationService';
import {
  cancelNativeKitchenTimer,
  setNativeKitchenTimer,
} from './nativeTimerBridge';

const TIMER_INTENT =
  /\b(timer|eieruhr|countdown|stopp\s*uhr|stoppuhr|stell(?:e)?\s+(?:mir\s+)?(?:einen\s+)?timer|erinnere\s+mich\s+in|in\s+\d{1,3}\s*(?:min|sek|stunden?|std|h|m|s)\b|powernap|power\s*nap|nickerchen|kurzschlaf)\b/iu;

const TIMER_CANCEL =
  /\b(timer\s+(?:aus|stopp|stop|abbrechen|löschen|loeschen)|stopp?\s+(?:den\s+)?timer|kein\s+timer)\b/iu;

const TIMER_STORAGE_KEY = '@yorro/active_kitchen_timer_v1';

/** Nach „Dauer fehlt“: nächste kurze Dauer-Antwort („2 Minuten“) gilt als Timer. */
let pendingTimerDurationAskUntilMs = 0;

export type TimerFollowUp = {
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  endsAtMs: number;
  durationMs: number;
  label: string;
};

type ActiveTimer = {
  id: string;
  endsAtMs: number;
  label: string;
  timeout: ReturnType<typeof setTimeout> | null;
  nativeOk?: boolean;
};

let activeTimer: ActiveTimer | null = null;
const listeners = new Set<() => void>();

function notifyTimerListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* soft */
    }
  }
}

/** HUD: bei Start/Tick/Cancel sofort neu zeichnen. */
export function subscribeActiveTimer(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function markPendingTimerDurationAsk(ttlMs = 120_000): void {
  pendingTimerDurationAskUntilMs = Date.now() + Math.max(15_000, ttlMs);
}

export function clearPendingTimerDurationAsk(): void {
  pendingTimerDurationAskUntilMs = 0;
}

/** Kurze Antwort nur mit Dauer, nachdem Yorro nach der Timer-Zeit gefragt hat. */
export function isBareTimerDurationReply(text: string): boolean {
  if (Date.now() > pendingTimerDurationAskUntilMs) return false;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 48) return false;
  if (
    /\b(navi|navigation|route|fahr|geh(?:en)?|bring|restaurant|essen|wecker|flug|bahn)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return parseTimerDurationMs(t) != null;
}

export function isTimerIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (TIMER_CANCEL.test(t)) return true;
  if (TIMER_INTENT.test(t)) return true;
  return isBareTimerDurationReply(t);
}

/** Speech schon aus Native/Just-Do-It — nicht nochmal Background-Tasks. */
export function looksLikeNativeTimerSpeech(speech: string): boolean {
  const s = (speech || '').trim();
  if (!s) return false;
  if (/^Timer läuft/iu.test(s)) return true;
  if (/^Alles klar — Timer ist aus/iu.test(s)) return true;
  if (/^Gerade läuft kein Timer/iu.test(s)) return true;
  if (/sag mir die Dauer/iu.test(s) && /Timer|Eieruhr/iu.test(s)) return true;
  if (/Mitteilungs-Erlaubnis|Alarm-\/Mitteilungs/iu.test(s)) return true;
  return false;
}

export function isTimerCancelIntent(text: string): boolean {
  return TIMER_CANCEL.test(text.replace(/\s+/g, ' ').trim());
}

export function getActiveTimer(): ActiveTimer | null {
  if (activeTimer && activeTimer.endsAtMs <= Date.now()) {
    clearActiveTimerLocal();
    return null;
  }
  return activeTimer;
}

function wordNumber(raw: string): number | null {
  const map: Record<string, number> = {
    eine: 1,
    ein: 1,
    einen: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    fuenf: 5,
    sechs: 6,
    sieben: 7,
    acht: 8,
    neun: 9,
    zehn: 10,
    elf: 11,
    zwölf: 12,
    zwoelf: 12,
    fünfzehn: 15,
    fuenfzehn: 15,
    zwanzig: 20,
    dreißig: 30,
    dreissig: 30,
    fünfundvierzig: 45,
    fuenfundvierzig: 45,
  };
  return map[raw.toLowerCase()] ?? null;
}

/** Parse relative Dauer → ms (max 12h, min 5s). */
export function parseTimerDurationMs(text: string): number | null {
  const t = String(text || '')
    .normalize('NFKC')
    .replace(/[\u00A0\u202F\u2007\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (/\b(?:eine?\s+)?halbe\s+stunde\b/.test(t)) return 30 * 60_000;
  if (/\b(?:eine?\s+)?viertel\s*stunde\b/.test(t)) return 15 * 60_000;
  if (/\b(?:eine?\s+)?dreiviertel\s*stunde\b/.test(t)) return 45 * 60_000;

  const combo = t.match(
    /(\d{1,2})\s*(?:stunden?|std|h)\s*(?:und\s*)?(\d{1,2})\s*(?:min(?:uten)?|min)?\b/,
  );
  if (combo) {
    const h = Number(combo[1]);
    const m = Number(combo[2]);
    if (h >= 0 && h <= 12 && m >= 0 && m < 60) {
      return (h * 60 + m) * 60_000;
    }
  }

  const hours = t.match(
    /(\d{1,2}|eine?|zwei|drei|vier|fünf|fuenf|sechs)\s*(?:stunden?|std\.?|h)\b/,
  );
  if (hours) {
    const n = /^\d+$/.test(hours[1]!) ? Number(hours[1]) : wordNumber(hours[1]!);
    if (n != null && n >= 1 && n <= 12) return n * 60 * 60_000;
  }

  // Ziffern zuerst — ohne fragiles \b vor der Zahl (Hermes/Unicode).
  const digMin = t.match(/(\d{1,3})\s*(?:minuten?|mins?|min\.?)\b/);
  if (digMin) {
    const n = Number(digMin[1]);
    if (n >= 1 && n <= 12 * 60) return n * 60_000;
  }

  const wordMin = t.match(
    /\b(eine?|zwei|drei|vier|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|dreißig|dreissig)\s*(?:minuten?|mins?|min\.?)\b/,
  );
  if (wordMin) {
    const n = wordNumber(wordMin[1]!);
    if (n != null && n >= 1 && n <= 12 * 60) return n * 60_000;
  }

  const secs = t.match(/(\d{1,3})\s*(?:sekunden?|sek\.?|s)\b/);
  if (secs) {
    const n = Number(secs[1]);
    if (n >= 5 && n <= 3600) return n * 1000;
  }

  // „Timer … 2 …“ / „in 10“ → Minuten
  if (TIMER_INTENT.test(t) || /\btimer\b/.test(t)) {
    const bare = t.match(/\b(?:in|auf|für|fuer)\s+(\d{1,3})\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n >= 1 && n <= 180) return n * 60_000;
    }
    const anyNum = t.match(/(\d{1,3})/);
    if (anyNum) {
      const n = Number(anyNum[1]);
      if (n >= 1 && n <= 180) return n * 60_000;
    }
  }

  return null;
}

function formatDurationDe(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} Sekunden`;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} Minute${totalMin === 1 ? '' : 'n'}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h} Stunde${h === 1 ? '' : 'n'}`;
  return `${h} Std ${m} Min`;
}

function extractTimerLabel(text: string): string {
  if (/powernap|power\s*nap|nickerchen|kurzschlaf/i.test(text)) {
    return 'Powernap';
  }
  const m = text.match(
    /\b(?:für|fuer|wegen)\s+([a-zäöüß0-9][\wäöüß\s-]{1,40}?)(?:\.|$)/iu,
  );
  if (m) {
    const lab = m[1].trim().slice(0, 40);
    // „für 2 Minuten“ / „für zehn Minuten“ = Dauer, kein Label
    if (
      /^\d{1,3}\s*(?:minuten?|min\.?|sekunden?|sek\.?|stunden?|std\.?|h|m|s)?$/iu.test(
        lab,
      ) ||
      /^(?:eine?|zwei|drei|vier|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|dreißig|dreissig)\s*(?:minuten?|min\.?|sekunden?|sek\.?|stunden?|std\.?|h|m|s)?$/iu.test(
        lab,
      )
    ) {
      return 'Timer';
    }
    return lab;
  }
  return 'Timer';
}

function clearActiveTimerLocal(): void {
  if (activeTimer?.timeout) {
    clearTimeout(activeTimer.timeout);
  }
  activeTimer = null;
  void persistActiveTimer(null);
  notifyTimerListeners();
}

async function persistActiveTimer(
  t: { endsAtMs: number; label: string; id: string } | null,
): Promise<void> {
  try {
    const AsyncStorage = (
      await import('@react-native-async-storage/async-storage')
    ).default;
    if (!t) {
      await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(
      TIMER_STORAGE_KEY,
      JSON.stringify({
        id: t.id,
        endsAtMs: t.endsAtMs,
        label: t.label,
      }),
    );
  } catch {
    /* soft */
  }
}

/** Nach App-Start: laufenden Timer für HUD wiederherstellen. */
export async function hydrateActiveTimerFromStorage(): Promise<void> {
  if (activeTimer) return;
  try {
    const AsyncStorage = (
      await import('@react-native-async-storage/async-storage')
    ).default;
    const raw = await AsyncStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      id?: string;
      endsAtMs?: number;
      label?: string;
    };
    if (
      typeof parsed.endsAtMs !== 'number' ||
      !Number.isFinite(parsed.endsAtMs) ||
      parsed.endsAtMs <= Date.now() + 500
    ) {
      await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
      return;
    }
    const label = (parsed.label || 'Timer').trim() || 'Timer';
    const endsAtMs = parsed.endsAtMs;
    const remaining = Math.max(0, endsAtMs - Date.now());
    activeTimer = {
      id: parsed.id || `timer:${endsAtMs}`,
      endsAtMs,
      label,
      timeout: setTimeout(() => {
        activeTimer = null;
        void persistActiveTimer(null);
        notifyTimerListeners();
        void fireTimerSpeech(label);
      }, remaining),
      nativeOk: true,
    };
    notifyTimerListeners();
  } catch {
    /* soft */
  }
}

async function fireTimerSpeech(label: string): Promise<void> {
  try {
    const { speakAssistantText, getVoiceSettingsForTour } = await import(
      '../ttsService'
    );
    const voice = await getVoiceSettingsForTour();
    const line =
      label && label !== 'Timer'
        ? `Dein Timer ist durch — ${label}.`
        : 'Dein Timer ist durch.';
    await speakAssistantText(line, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  } catch {
    /* soft */
  }
}

/**
 * Startet Timer: Native Android (Clock + AlarmManager) → Notification-Fallback.
 */
export async function startFindusTimer(opts: {
  durationMs: number;
  label?: string;
}): Promise<{ ok: boolean; speech: string; endsAtMs?: number; reason?: string }> {
  const durationMs = Math.max(5_000, Math.min(opts.durationMs, 12 * 60 * 60_000));
  const label = (opts.label ?? 'Timer').trim() || 'Timer';

  if (activeTimer) {
    await cancelNativeKitchenTimer(activeTimer.endsAtMs);
    try {
      const { cancelReminderById } = await import(
        '../notifications/notificationService'
      );
      await cancelReminderById(activeTimer.id);
    } catch {
      /* soft */
    }
    clearActiveTimerLocal();
  }

  const native = await setNativeKitchenTimer({ durationMs, label });
  const endsAtMs =
    native.ok && native.endsAtMs != null
      ? native.endsAtMs
      : Date.now() + durationMs;
  const id = `timer:${endsAtMs}`;

  let notifOk = false;
  try {
    const scheduled = await scheduleCountdownTimer({
      endsAtMs,
      label,
      timerKey: id,
      force: true,
    });
    notifOk = scheduled.ok === true;
  } catch {
    notifOk = false;
  }

  if (!native.ok && !notifOk) {
    return {
      ok: false,
      speech:
        native.reason === 'ios_unsupported'
          ? 'Auf dem iPhone brauche ich Mitteilungen für den Timer.'
          : 'Ich brauche Alarm-/Mitteilungs-Erlaubnis, sonst kann der Timer im Hintergrund nicht klingeln.',
      reason: native.reason || 'permission',
    };
  }

  const remaining = Math.max(0, endsAtMs - Date.now());
  activeTimer = {
    id,
    endsAtMs,
    label,
    nativeOk: native.ok,
    timeout: setTimeout(() => {
      activeTimer = null;
      void persistActiveTimer(null);
      notifyTimerListeners();
      void fireTimerSpeech(label);
    }, remaining),
  };
  void persistActiveTimer({ id, endsAtMs, label });
  notifyTimerListeners();

  // Timeline: Aktivität + Ende als zeitlicher Trigger
  try {
    const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          ensureDay: (k: string) => void;
          upsertStopOnDay: (k: string, s: Record<string, unknown>) => void;
        };
      };
    };
    const { todayDateKey } = require('../../utils/dateKeys') as {
      todayDateKey: () => string;
    };
    const dayKey = todayDateKey();
    const startMs = endsAtMs - durationMs;
    useFuturePlanStore.getState().ensureDay(dayKey);
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id: `activity_${startMs}`,
      title: label,
      plannedStartMs: startMs,
      plannedEndMs: endsAtMs,
      bufferMin: 0,
      transport: 'unknown',
      kind: 'stop',
      status: 'trigger_active',
      hardAnchor: true,
      emoji: label.toLowerCase().includes('power') ? '😴' : '⏱️',
      notes: 'Timer',
    });
  } catch {
    /* soft */
  }

  const dur = formatDurationDe(durationMs);
  return {
    ok: true,
    endsAtMs,
    speech:
      label !== 'Timer'
        ? `Timer läuft — ${dur} für ${label}. Ich melde mich, auch wenn die App zu ist.`
        : `Timer läuft — ${dur}. Ich melde mich, auch wenn die App zu ist.`,
  };
}

export async function cancelFindusTimer(): Promise<{
  ok: boolean;
  speech: string;
}> {
  if (!activeTimer) {
    return { ok: false, speech: 'Gerade läuft kein Timer.' };
  }
  const ends = activeTimer.endsAtMs;
  const { cancelReminderById } = await import(
    '../notifications/notificationService'
  );
  await cancelReminderById(activeTimer.id);
  await cancelNativeKitchenTimer(ends);
  clearActiveTimerLocal();
  return { ok: true, speech: 'Alles klar — Timer ist aus.' };
}

/**
 * Voice / Concierge: Timer stellen oder abbrechen (Just-Do-It).
 */
export async function prepareTimerFollowUp(
  text: string,
): Promise<TimerFollowUp | null> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || !isTimerIntent(t)) return null;

  if (isTimerCancelIntent(t)) {
    const cancelled = await cancelFindusTimer();
    return {
      speech: cancelled.speech,
      bullets: cancelled.ok ? ['Timer gestoppt'] : [],
      quickActions: [],
      endsAtMs: 0,
      durationMs: 0,
      label: 'Timer',
    };
  }

  const durationMs = parseTimerDurationMs(t);
  if (durationMs == null) {
    console.warn('[timer] duration missing for:', t.slice(0, 120));
    markPendingTimerDurationAsk();
    return {
      speech:
        'Klar — sag mir die Dauer, z. B. „Timer 10 Minuten“ oder „Eieruhr 3 Minuten“.',
      bullets: ['Dauer fehlt'],
      quickActions: [],
      endsAtMs: 0,
      durationMs: 0,
      label: 'Timer',
    };
  }

  clearPendingTimerDurationAsk();
  const label = extractTimerLabel(t);
  console.warn('[timer] start', durationMs, label, t.slice(0, 80));
  const started = await startFindusTimer({ durationMs, label });
  if (!started.ok || !started.endsAtMs) {
    return {
      speech: started.speech,
      bullets: [],
      quickActions: [],
      endsAtMs: 0,
      durationMs,
      label,
    };
  }

  const durLabel = formatDurationDe(durationMs);
  return {
    speech: started.speech,
    bullets: [`Timer ${durLabel}`, label !== 'Timer' ? label : ''].filter(
      Boolean,
    ),
    quickActions: [
      {
        type: 'SET_TIMER',
        label: 'Timer stoppen',
        payload: {
          textPrompt: 'Timer aus',
          timeLabel: durLabel,
          dateIso: new Date(started.endsAtMs).toISOString(),
          destName: label,
        },
      },
    ],
    endsAtMs: started.endsAtMs,
    durationMs,
    label,
  };
}
