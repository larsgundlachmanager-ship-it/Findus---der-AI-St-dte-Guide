/**
 * Modul 4 — Wetter-Tracker.
 * Start: einmal Tageslage.
 * Stabil trocken → erst nach 6h wieder.
 * Regen geplant → 2h vorher checken, dann alle 30 Min.
 * Warnungen: 30 Min + 5 Min — Audio (App offen) + geplante Local Notifications
 * (gesperrt / Hintergrund / App geschlossen).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  fetchOpenWeatherOneCall,
  hasOpenWeatherKey,
  type OwmOneCallResult,
} from '../weather/openWeatherOneCall';
import { canModule4Speak } from '../navigation/modulePriorityPolicy';
import { getVoiceSettingsForTour, speakAssistantText } from '../ttsService';
import { noteWeatherSaid, wasWeatherThemeSaidRecently } from './weatherSaidMemory';

const STABLE_RECHECK_MS = 6 * 60 * 60_000;
const RAIN_WATCH_FROM_MS = 2 * 60 * 60_000;
const RAIN_WATCH_INTERVAL_MS = 30 * 60_000;
const SLEEP_RECHECK_MS = 4 * 60 * 60_000;
/** ~80 m in degrees (rough) — nur wenn Accuracy gut und Velocity > Drift */
const MOVE_EPS_DEG = 0.0007;
/** Accuracy schlechter als das → Indoor / Drift-verdächtig */
const POOR_ACCURACY_M = 45;
/** Unter dieser Geschwindigkeit zählen Sprünge als Drift */
const DRIFT_MAX_SPEED_KMH = 0.8;

/** Context: Nav aktiv oder unterwegs → alert; 3h still → sleep. */
function shouldWeatherStayAlert(opts: {
  navActive: boolean;
  stationaryMs: number;
}): { alertMode: boolean; sleepMs: number } {
  if (opts.navActive) {
    return { alertMode: true, sleepMs: 0 };
  }
  if (opts.stationaryMs >= 3 * 60 * 60_000) {
    return { alertMode: false, sleepMs: 4 * 60 * 60_000 };
  }
  return { alertMode: true, sleepMs: 0 };
}

export type WeatherTrackerState = {
  lastCheckAtMs: number;
  nextCheckAtMs: number;
  dayStableDry: boolean;
  nextRainAtMs: number | null;
  rainStartsInMin: number | null;
  summaryLine: string;
  promptBlock: string;
  rainWindows: OwmOneCallResult['rainWindows'];
  warned30ForRainAt: number | null;
  warned5ForRainAt: number | null;
  offeredShelterForRainAt: number | null;
  alertMode?: boolean;
};

let state: WeatherTrackerState | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let speaking = false;
let lastMovedAtMs = Date.now();
let lastFixLat: number | null = null;
let lastFixLng: number | null = null;

function noteGpsMovement(lat: number, lng: number): void {
  const store = useFinnusStore.getState();
  const accuracyM = store.gpsAccuracyM;
  const now = Date.now();

  if (
    lastFixLat != null &&
    lastFixLng != null &&
    Math.abs(lastFixLat - lat) < MOVE_EPS_DEG &&
    Math.abs(lastFixLng - lng) < MOVE_EPS_DEG
  ) {
    return;
  }

  // Indoor-Drift: schlechte Accuracy + ~0 km/h → Sprung ignorieren
  if (
    lastFixLat != null &&
    lastFixLng != null &&
    lastMovedAtMs > 0 &&
    accuracyM != null &&
    accuracyM >= POOR_ACCURACY_M
  ) {
    const dtH = Math.max(1 / 3600, (now - (store.lastGpsAtMs ?? lastMovedAtMs)) / 3_600_000);
    const distM = haversineMeters(lastFixLat, lastFixLng, lat, lng);
    const speedKmh = distM / 1000 / dtH;
    if (speedKmh < DRIFT_MAX_SPEED_KMH) {
      // Position merken ohne „Bewegung“ (Sleep bleibt)
      lastFixLat = lat;
      lastFixLng = lng;
      return;
    }
  }

  lastFixLat = lat;
  lastFixLng = lng;
  lastMovedAtMs = now;
}

function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function contextScheduleMs(now: number, baseNext: number): number {
  const store = useFinnusStore.getState();
  const ctx = shouldWeatherStayAlert({
    navActive: !!store.navActive,
    stationaryMs: now - lastMovedAtMs,
  });
  if (!ctx.alertMode) {
    return now + (ctx.sleepMs || SLEEP_RECHECK_MS);
  }
  return baseNext;
}

export function getWeatherTrackerState(): WeatherTrackerState | null {
  return state;
}

/** Für HUD oben links — ab ~90 Min vor Regen (Speech erst ab ~30 Min). */
export function getWeatherHudLine(): string | null {
  if (!state?.nextRainAtMs) return null;
  const mins = Math.round((state.nextRainAtMs - Date.now()) / 60_000);
  if (mins < 0 || mins > 90) return null;
  if (state.rainStartsInMin != null && state.rainStartsInMin <= 90) {
    return `🌧 Regen in ${state.rainStartsInMin} Min`;
  }
  return `🌧 Regen in ${mins} Min`;
}

export function getRainWindowsForPlanning(): OwmOneCallResult['rainWindows'] {
  return state?.rainWindows ?? [];
}

function scheduleNextCheck(owm: OwmOneCallResult, now: number): number {
  if (owm.dayStableDry || owm.nextRainAtMs == null) {
    return now + STABLE_RECHECK_MS;
  }
  const untilRain = owm.nextRainAtMs - now;
  if (untilRain > RAIN_WATCH_FROM_MS) {
    // Bis 2h vor Regen warten, dann watch
    return owm.nextRainAtMs - RAIN_WATCH_FROM_MS;
  }
  return now + RAIN_WATCH_INTERVAL_MS;
}

async function speakLine(speech: string): Promise<void> {
  const gate = canModule4Speak();
  if (!gate.ok) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening) return;
  const voice = await getVoiceSettingsForTour();
  store.addChatMessage({ role: 'assistant', content: speech });
  await speakAssistantText(speech, {
    voiceId: voice.voiceId,
    speechRate: voice.speechRate,
  });
}

async function maybeWarn(owm: OwmOneCallResult): Promise<void> {
  if (!state || !owm.nextRainAtMs || speaking) return;
  // Sleep-Modus: keine 30/5-Min-Audio-Warnungen
  const store = useFinnusStore.getState();
  const ctx = shouldWeatherStayAlert({
    navActive: !!store.navActive,
    stationaryMs: Date.now() - lastMovedAtMs,
  });
  if (!ctx.alertMode) return;

  const mins =
    owm.rainStartsInMin ??
    Math.round((owm.nextRainAtMs - Date.now()) / 60_000);
  if (mins < 0 || mins > 35) return;

  const rainKey = owm.nextRainAtMs;

  // 5 Min vorher
  if (mins <= 5 && state.warned5ForRainAt !== rainKey) {
    if (wasWeatherThemeSaidRecently('regen-5min', 10 * 60_000)) {
      state = { ...state, warned5ForRainAt: rainKey };
      return;
    }
    speaking = true;
    try {
      const speech = `Gleich wird's nass — in etwa ${mins} Minuten Regen. Wenn du noch draußen bist, such dir kurz was Trockenes.`;
      await speakLine(speech);
      noteWeatherSaid(speech, 'regen-5min');
      state = { ...state, warned5ForRainAt: rainKey };
    } finally {
      speaking = false;
    }
    return;
  }

  // 30 Min: Warnung + Shelter-Vorschlag
  if (
    mins <= 30 &&
    mins > 5 &&
    state.warned30ForRainAt !== rainKey
  ) {
    speaking = true;
    try {
      const clock = new Date(owm.nextRainAtMs).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const speech = `In etwa einer halben Stunde — so ab ${clock} — sieht's nach Regen aus. Ist dir das egal, oder sollen wir kurz ein Café / Indoor ansteuern?`;
      await speakLine(speech);
      noteWeatherSaid(speech, 'regen-30min');
      state = {
        ...state,
        warned30ForRainAt: rainKey,
        offeredShelterForRainAt: rainKey,
      };
      // Concierge-Card soft: Shelter-Buttons
      try {
        const { wrapPlainAsConcierge } = await import(
          '../concierge/parseConciergeResponse'
        );
        const { toConciergeCardState } = await import(
          '../concierge/presentConcierge'
        );
        useFinnusStore.getState().setActiveConciergeCard(
          toConciergeCardState(
            wrapPlainAsConcierge(speech, {
              cardTitle: 'Wetter',
              visualBullets: [`Regen ab ~${clock}`, `Noch ca. ${mins} Min`],
              quickActions: [
                {
                  type: 'SHOW_MORE',
                  label: 'Café in der Nähe',
                  payload: { textPrompt: 'Finde ein Café in der Nähe wegen Regen' },
                },
                {
                  type: 'SHOW_MORE',
                  label: 'Ist mir egal',
                  payload: { textPrompt: 'Regen ist mir egal, weiter wie geplant' },
                },
              ],
            }),
          ),
        );
      } catch {
        /* soft */
      }
    } finally {
      speaking = false;
    }
  }
}

export async function runWeatherTrackerCheck(opts?: {
  force?: boolean;
  lat?: number | null;
  lng?: number | null;
}): Promise<WeatherTrackerState | null> {
  const now = Date.now();
  if (
    !opts?.force &&
    state &&
    state.nextCheckAtMs > now
  ) {
    return state;
  }

  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  const lat = opts?.lat ?? store.lastGpsLat;
  const lng = opts?.lng ?? store.lastGpsLng;
  if (lat == null || lng == null) return state;
  noteGpsMovement(lat, lng);

  // Context-aware: Sleep ohne Force → kein OWM-Call
  if (!opts?.force) {
    const ctx = shouldWeatherStayAlert({
      navActive: !!store.navActive,
      stationaryMs: now - lastMovedAtMs,
    });
    if (!ctx.alertMode && state && state.nextCheckAtMs > now) {
      return state;
    }
  }

  let owm: OwmOneCallResult | null = null;
  if (hasOpenWeatherKey()) {
    owm = await fetchOpenWeatherOneCall({ lat, lng });
  }
  if (!owm) {
    // Ohne OWM-Key / bei Fail: Open-Meteo — Push-Planung trotzdem
    try {
      const { fetchOpenMeteoFallback } = await import(
        '../weather/openMeteoFallback'
      );
      const meteo = await fetchOpenMeteoFallback({ lat, lng });
      if (meteo) {
        owm = {
          fetchedAtMs: meteo.fetchedAtMs,
          lat: meteo.lat,
          lng: meteo.lng,
          currentTemp: meteo.currentTemp,
          currentWeatherId: meteo.weatherCode,
          currentPrecipMm: meteo.precipitationMm,
          nextRainAtMs: meteo.nextRainAtMs,
          nextRainProb: meteo.nextRainProb,
          rainStartsInMin: null,
          summaryLine: meteo.summaryLine,
          promptBlock: meteo.promptBlock,
          dayStableDry: meteo.nextRainAtMs == null,
          rainWindows: meteo.rainWindows.map((w) => ({
            startMs: w.startMs,
            endMs: w.endMs,
            pop: w.pop > 1 ? Math.round(w.pop) : Math.round(w.pop * 100),
          })),
          rawHourly: [],
          sunsetMs: null,
        };
      }
    } catch {
      /* soft */
    }
  }
  if (!owm) return state;

  const baseNext = scheduleNextCheck(owm, now);
  const nextCheckAtMs = contextScheduleMs(now, baseNext);
  const alertCtx = shouldWeatherStayAlert({
    navActive: !!store.navActive,
    stationaryMs: now - lastMovedAtMs,
  });

  state = {
    lastCheckAtMs: now,
    nextCheckAtMs,
    dayStableDry: owm.dayStableDry,
    nextRainAtMs: owm.nextRainAtMs,
    rainStartsInMin: owm.rainStartsInMin,
    summaryLine: owm.summaryLine,
    promptBlock: owm.promptBlock,
    rainWindows: owm.rainWindows,
    warned30ForRainAt: state?.warned30ForRainAt ?? null,
    warned5ForRainAt: state?.warned5ForRainAt ?? null,
    offeredShelterForRainAt: state?.offeredShelterForRainAt ?? null,
    alertMode: alertCtx.alertMode,
  };

  // Sync into legacy weather cache fields for HUD producers
  try {
    const { ensureWeatherFreshFromOwm } = await import('../weatherService');
    await ensureWeatherFreshFromOwm(owm, null);
  } catch {
    /* optional bridge */
  }

  // OS-geplante Push: auch bei gesperrtem/geschlossenem Handy
  try {
    const { syncRainAlertNotifications } = await import(
      '../notifications/rainAlertNotifications'
    );
    await syncRainAlertNotifications({
      nextRainAtMs: owm.nextRainAtMs,
      rainStartsInMin: owm.rainStartsInMin,
      summaryLine: owm.summaryLine,
    });
  } catch {
    /* soft */
  }

  void maybeWarn(owm);
  void profile;
  return state;
}

export function startWeatherTracker(): () => void {
  void runWeatherTrackerCheck({ force: true });
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    void runWeatherTrackerCheck();
  }, 60_000);
  return () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  };
}
