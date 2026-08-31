/**
 * Yorro-Präsenz & Diagnose: online/grün vs. offline/orange,
 * plus erklärbare Issues für „Was funktioniert nicht?“.
 */

import { env } from '../config/env';
import { useFinnusStore } from '../store/useFinnusStore';
import { isDeviceOffline } from './navigation/networkState';
import { hasGeminiApiKey } from './geminiService';
import { hasCartesiaTtsKey } from './cartesiaTtsService';

function hasOpenAiChatKey(): boolean {
  const key = env.openAiApiKey();
  return !!(key && !key.includes('your-key-here'));
}

export type FindusPresence = 'ok' | 'degraded' | 'offline';

export type FindusIssue = {
  id: string;
  title: string;
  fix: string;
};

export type FindusHealth = {
  presence: FindusPresence;
  networkOk: boolean;
  issues: FindusIssue[];
};

let networkOk = true;
let lastApiFailureAtMs: number | null = null;
let lastApiFailureMsg: string | null = null;
let monitorTimer: ReturnType<typeof setInterval> | null = null;

const API_FAILURE_WINDOW_MS = 5 * 60_000;

export function reportApiFailure(message?: string): void {
  lastApiFailureAtMs = Date.now();
  lastApiFailureMsg = (message ?? 'API-Fehler').slice(0, 160);
  pushPresenceFromHealth();
}

export function reportApiSuccess(): void {
  lastApiFailureAtMs = null;
  lastApiFailureMsg = null;
  pushPresenceFromHealth();
}

export async function refreshNetworkStatus(): Promise<boolean> {
  try {
    networkOk = !(await isDeviceOffline());
  } catch {
    networkOk = true;
  }
  pushPresenceFromHealth();
  return networkOk;
}

export function evaluateFindusHealth(): FindusHealth {
  const store = useFinnusStore.getState();
  const issues: FindusIssue[] = [];

  if (!networkOk) {
    issues.push({
      id: 'network',
      title: 'Kein Netz',
      fix: 'WLAN oder Mobilfunk prüfen — Offline läuft nur lokale Stimme und GPS-Nav.',
    });
  }

  if (store.gpsStatus === 'denied') {
    issues.push({
      id: 'gps_denied',
      title: 'GPS-Berechtigung fehlt',
      fix: 'In den System-Einstellungen Standortzugriff für Yorro erlauben.',
    });
  } else if (store.gpsServicesEnabled === false) {
    issues.push({
      id: 'gps_off',
      title: 'Standort-Dienste aus',
      fix: 'GPS/Standort im Gerät einschalten.',
    });
  } else if (
    !store.isSimulationMode &&
    store.navActive &&
    (store.gpsStatus === 'idle' ||
      (store.lastGpsAtMs != null && Date.now() - store.lastGpsAtMs > 20_000))
  ) {
    issues.push({
      id: 'gps_stale',
      title: 'GPS liefert keine frischen Fixes',
      fix: 'Kurz ins Freie gehen oder App neu starten — Navigation braucht Live-Position.',
    });
  }

  const ttsLocalOk = store.ttsReady;
  const ttsCloud = store.ttsProvider !== 'system' && hasCartesiaTtsKey();
  if (!ttsLocalOk && !ttsCloud && store.ttsStatusMessage) {
    issues.push({
      id: 'tts',
      title: 'Stimme nicht bereit',
      fix: 'Cartesia-Key prüfen oder Offline-Systemstimme in den Einstellungen.',
    });
  } else if (store.ttsStatusMessage && /fehlt|fehl|unavailable|nicht/i.test(store.ttsStatusMessage)) {
    issues.push({
      id: 'tts_msg',
      title: 'Stimme meldet ein Problem',
      fix: store.ttsStatusMessage,
    });
  }

  if (
    lastApiFailureAtMs != null &&
    Date.now() - lastApiFailureAtMs < API_FAILURE_WINDOW_MS
  ) {
    const hasKey = hasGeminiApiKey() || hasOpenAiChatKey();
    issues.push({
      id: 'api',
      title: 'KI-Antwort zuletzt fehlgeschlagen',
      fix: hasKey
        ? `KI-Dienst hat nicht geantwortet — nochmal fragen${lastApiFailureMsg ? ` (${lastApiFailureMsg})` : ''}.`
        : 'API-Key in .env setzen (Gemini/OpenAI), sonst nur Offline-Antworten.',
    });
  }

  let presence: FindusPresence = 'ok';
  if (!networkOk) {
    presence = 'offline';
  } else if (issues.length > 0) {
    presence = 'degraded';
  }

  return { presence, networkOk, issues };
}

export function pushPresenceFromHealth(): FindusHealth {
  const health = evaluateFindusHealth();
  useFinnusStore.getState().setFindusPresence(health.presence);
  return health;
}

export function isHealthStatusQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(was\s+funktioniert\s+nicht|was\s+ist\s+kaputt|was\s+ist\s+broken|fehler\s*status|diagnos[e]?|was\s+stimmt\s+nicht|offline\s*\?|bin\s+ich\s+offline|netz\s+weg|was\s+muss\s+ich\s+(ändern|fixen|machen))\b/i.test(
      t,
    ) ||
    /^(status|diagnose|hilfe\s+technik)\b/i.test(t)
  );
}

export function buildHealthStatusReply(health?: FindusHealth): string {
  const h = health ?? evaluateFindusHealth();
  if (h.issues.length === 0) {
    return 'Alles grün — Netz, Stimme und GPS sehen okay aus. Frag mich einfach, wenn irgendwas hakt.';
  }
  const lines = h.issues.map(
    (issue, i) => `${i + 1}) ${issue.title}: ${issue.fix}`,
  );
  const tone =
    h.presence === 'offline'
      ? 'Ich bin gerade offline (orange).'
      : 'Ich bin online, aber etwas hakt (orange).';
  return `${tone} Das ist aktuell kaputt bzw. zu prüfen:\n${lines.join('\n')}`;
}

/** Periodischer Netz-/Präsenz-Check. Rückgabe = Stop-Funktion. */
export function startFindusHealthMonitor(intervalMs = 12_000): () => void {
  void refreshNetworkStatus();
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    void refreshNetworkStatus();
  }, intervalMs);
  return () => {
    if (monitorTimer) {
      clearInterval(monitorTimer);
      monitorTimer = null;
    }
  };
}
