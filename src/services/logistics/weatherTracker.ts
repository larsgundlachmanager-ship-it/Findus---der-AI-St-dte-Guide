/**
 * Modul 4 — Wetter-Tracker.
 * Kosten-Leiter: trocken ~60 Min; Regen-Watch 30→10→5→1 Min; während Regen ~5 Min.
 * Warnungen: 30 und 5 Min — nur wenn es jetzt trocken ist.
 * HUD: live Minuten aus nextRainAtMs; bei Regen „jetzt bis …“.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { fetchSharedOrDirectOwm } from '../weather/fetchSharedOwm';
import type { OwmOneCallResult } from '../weather/openWeatherOneCall';
import { canSpeakUnsolicited } from '../navigation/modulePriorityPolicy';
import { getVoiceSettingsForTour, speakAssistantText } from '../ttsService';
import { noteWeatherSaid, wasWeatherThemeSaidRecently } from './weatherSaidMemory';
import {
  canIssueProactiveRainWarning,
  weatherSessionStartedAtMs,
} from '../weather/rainWarnSessionGate';
import {
  formatRainHudLine,
  isPrecipWeatherCode,
  isRainAlreadyFalling,
  minutesUntilIncomingRain,
  rainDurationMin,
} from '../weather/rainIncomingPolicy';
import { nextWeatherPollDelayMs } from '../weather/weatherPollSchedule';
import {
  canFetchLiveWeather,
  WEATHER_LIVE_AFTER_USE_MS,
} from '../weather/weatherFetchGate';

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
  rainEndsAtMs: number | null;
  currentPrecipMm: number | null;
  weatherCode: number | null;
  /** Max. Regen-% nahe Zukunft (0–100), für GPS-Probe-Gate */
  nextRainProb: number | null;
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
/** Letzter GPS-/DWD-Nowcast — Trocken-Probe auch zwischen vollen OWM-Polls. */
let lastGpsNowcastAtMs = 0;

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

/** Zwischen API-Fetches: Minuten aus absolutem Start weiterzählen. */
function refreshLiveRainMinutes(now: number): void {
  if (!state?.nextRainAtMs) return;
  const live = minutesUntilIncomingRain({
    nowMs: now,
    nextRainAtMs: state.nextRainAtMs,
    currentPrecipMm: state.currentPrecipMm,
    weatherCode: state.weatherCode,
  });
  if (live != null && live !== state.rainStartsInMin) {
    state = { ...state, rainStartsInMin: live };
  } else if (
    live == null &&
    isRainAlreadyFalling({
      nowMs: now,
      nextRainAtMs: state.nextRainAtMs,
      currentPrecipMm: state.currentPrecipMm,
      rainStartsInMin: state.rainStartsInMin,
      weatherCode: state.weatherCode,
    }) &&
    state.rainStartsInMin !== 0
  ) {
    state = { ...state, rainStartsInMin: 0 };
  }
}

export function getWeatherTrackerState(): WeatherTrackerState | null {
  return state;
}

/** Für HUD / Regenradar — Minuten ≤60, sonst Uhrzeit; später „Regen ab …“. */
export function getWeatherHudLine(): string | null {
  if (!state) return null;
  refreshLiveRainMinutes(Date.now());
  return formatRainHudLine({
    currentPrecipMm: state.currentPrecipMm,
    rainStartsInMin: state.rainStartsInMin,
    nextRainAtMs: state.nextRainAtMs,
    rainEndsAtMs: state.rainEndsAtMs,
    rainWindows: state.rainWindows,
    weatherCode: state.weatherCode,
  });
}

export function getRainWindowsForPlanning(): OwmOneCallResult['rainWindows'] {
  return state?.rainWindows ?? [];
}

function scheduleNextCheck(owm: OwmOneCallResult, now: number): number {
  const rainingNow =
    (owm.currentPrecipMm ?? 0) >= 0.1 ||
    isPrecipWeatherCode(owm.currentWeatherId) ||
    (owm.rainStartsInMin != null && owm.rainStartsInMin <= 2) ||
    (owm.nextRainAtMs != null && owm.nextRainAtMs <= now + 2 * 60_000);

  const untilRainMs =
    rainingNow || owm.nextRainAtMs == null
      ? null
      : owm.nextRainAtMs - now;

  return (
    now +
    nextWeatherPollDelayMs({
      rainingNow,
      dayStableDry: owm.dayStableDry,
      untilRainMs,
    })
  );
}

async function speakLine(speech: string): Promise<void> {
  const gate = canSpeakUnsolicited();
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
  if (!canIssueProactiveRainWarning()) return;
  if (!state || !owm.nextRainAtMs || speaking) return;
  if (
    isRainAlreadyFalling({
      currentPrecipMm: owm.currentPrecipMm,
      rainStartsInMin: owm.rainStartsInMin,
      nextRainAtMs: owm.nextRainAtMs,
    })
  ) {
    return;
  }

  const store = useFinnusStore.getState();
  const ctx = shouldWeatherStayAlert({
    navActive: !!store.navActive,
    stationaryMs: Date.now() - lastMovedAtMs,
  });
  if (!ctx.alertMode) return;

  const mins = minutesUntilIncomingRain({
    rainStartsInMin: owm.rainStartsInMin,
    nextRainAtMs: owm.nextRainAtMs,
    currentPrecipMm: owm.currentPrecipMm,
  });
  if (mins == null || mins > 35) return;

  const rainKey = owm.nextRainAtMs;
  const clock = new Date(owm.nextRainAtMs).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const durationMin = rainDurationMin(owm.rainWindows, owm.nextRainAtMs);
  const durationBit =
    durationMin != null
      ? durationMin <= 25
        ? ` Kurze Wolke, so um die ${durationMin} Minuten.`
        : ` Das zieht sich dann etwa ${Math.round(durationMin / 60) >= 2 ? `${Math.round(durationMin / 60)} Stunden` : `${durationMin} Minuten`}.`
      : '';
  const outdoorBit = outdoorRainMismatchHint(store);

  let kind: '30' | '5' | null = null;
  if (mins <= 5 && state.warned5ForRainAt !== rainKey) kind = '5';
  else if (mins <= 32 && mins > 5 && state.warned30ForRainAt !== rainKey)
    kind = '30';
  if (!kind) return;

  if (kind === '5' && wasWeatherThemeSaidRecently('regen-5min', 10 * 60_000)) {
    state = { ...state, warned5ForRainAt: rainKey };
    return;
  }

  const speech =
    kind === '5'
      ? `Gleich wird's nass — in etwa ${mins} Minuten, so ab ${clock}.${durationBit}${outdoorBit} Indoor, oder ist dir das egal?`
      : `In etwa ${mins} Minuten — so ab ${clock} — sieht's nach Regen aus.${durationBit}${outdoorBit} Ist dir das egal, oder sollen wir kurz Indoor ansteuern?`;

  speaking = true;
  try {
    if (kind === '5') {
      try {
        const { nudgeUserTtsVolume } = await import('../speech/ttsVolumePref');
        nudgeUserTtsVolume('up');
        nudgeUserTtsVolume('up');
      } catch {
        /* soft */
      }
    }
    await speakLine(speech);
    noteWeatherSaid(speech, kind === '5' ? 'regen-5min' : 'regen-30min');
    state = {
      ...state,
      warned30ForRainAt: kind === '30' ? rainKey : state.warned30ForRainAt,
      warned5ForRainAt: kind === '5' ? rainKey : state.warned5ForRainAt,
      offeredShelterForRainAt: rainKey,
    };
    try {
      const { wrapPlainAsConcierge } = await import(
        '../concierge/parseConciergeResponse'
      );
      const { toConciergeCardState } = await import(
        '../concierge/presentConcierge'
      );
      const bullets = [`Regen ab ~${clock}`, `Noch ca. ${mins} Min`];
      if (durationMin != null) bullets.push(`Dauer ~${durationMin} Min`);
      useFinnusStore.getState().setActiveConciergeCard(
        toConciergeCardState(
          wrapPlainAsConcierge(speech, {
            cardTitle: 'Wetter',
            visualBullets: bullets,
            quickActions: [
              {
                type: 'SHOW_MORE',
                label: 'Indoor-Alternative',
                payload: {
                  textPrompt:
                    'Regen kommt — such eine Indoor-Alternative (Museum, Kino, Aktivität, Café), die ich vor dem Regen erreiche. Dauer des Regens einbauen. Nur wenn ich Unterstand will.',
                },
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

function outdoorRainMismatchHint(store: {
  transportMode?: string | null;
  currentLocationName?: string | null;
}): string {
  const mode = (store.transportMode ?? '').toLowerCase();
  const place = (store.currentLocationName ?? '').toLowerCase();
  if (mode === 'bicycle') {
    return ' Mit dem Rad wird das ungemütlich.';
  }
  if (
    /\b(picknick|picnic|park|strand|spielplatz|terrasse|biergarten|minigolf|golf)\b/.test(
      place,
    )
  ) {
    return ' Draußen bleibt das dann eher ungemütlich.';
  }
  return '';
}

/**
 * Zwischen langen Trocken-Polls: Open-Meteo am GPS.
 * Fängt lokale Schauer, die OWM/Shared noch als „leicht bewölkt“ führen.
 */
async function maybeGpsDryProbeBetweenPolls(now: number): Promise<void> {
  if (!state) return;
  try {
    const {
      fetchGpsRainNowcast,
      shouldFetchGpsRainNowcast,
      GPS_RAIN_RISK_PROBE_MS,
      summaryWithGpsRain,
      maxNearTermRainPopPct,
    } = await import('../weather/gpsRainNowcast');
    if (
      !shouldFetchGpsRainNowcast({
        nowMs: now,
        nextRainAtMs: state.nextRainAtMs,
        rainStartsInMin: state.rainStartsInMin,
        rainingNow: isRainAlreadyFalling({
          nowMs: now,
          nextRainAtMs: state.nextRainAtMs,
          rainStartsInMin: state.rainStartsInMin,
          currentPrecipMm: state.currentPrecipMm,
          weatherCode: state.weatherCode,
        }),
        currentPrecipMm: state.currentPrecipMm,
        lastGpsNowcastAtMs: lastGpsNowcastAtMs || null,
        dayStableDry: state.dayStableDry,
        nextRainProb: state.nextRainProb,
        rainWindows: state.rainWindows,
        weatherCode: state.weatherCode,
        maxNearPopPct: maxNearTermRainPopPct({
          nowMs: now,
          nextRainProb: state.nextRainProb,
          rainWindows: state.rainWindows,
        }),
      })
    ) {
      return;
    }
    const store = useFinnusStore.getState();
    const lat = store.lastGpsLat;
    const lng = store.lastGpsLng;
    if (lat == null || lng == null) return;

    const nowcast = await fetchGpsRainNowcast({ lat, lng });
    lastGpsNowcastAtMs = now;
    if (!nowcast) return;

    const wasDry = !isRainAlreadyFalling({
      nowMs: now,
      nextRainAtMs: state.nextRainAtMs,
      rainStartsInMin: state.rainStartsInMin,
      currentPrecipMm: state.currentPrecipMm,
      weatherCode: state.weatherCode,
    });
    const wetNow = nowcast.rainingNow;
    const rainSoon =
      nowcast.nextRainAtMs != null &&
      nowcast.nextRainAtMs <= now + 90 * 60_000;

    if (!wetNow && !rainSoon) return;

    const summaryLine = wetNow
      ? summaryWithGpsRain(
          {
            summaryLine: state.summaryLine,
            currentTempC: (() => {
              const m = state.summaryLine.match(/(-?\d+)\s*°/);
              return m ? Number(m[1]) : null;
            })(),
          },
          nowcast,
        )
      : state.summaryLine;

    state = {
      ...state,
      dayStableDry: false,
      nextRainAtMs: nowcast.nextRainAtMs,
      rainStartsInMin: nowcast.rainStartsInMin,
      rainEndsAtMs: nowcast.rainEndsAtMs ?? state.rainEndsAtMs,
      currentPrecipMm:
        nowcast.currentPrecipMm ?? (wetNow ? 0.2 : state.currentPrecipMm),
      weatherCode: nowcast.weatherCode ?? state.weatherCode,
      nextRainProb: wetNow
        ? Math.max(state.nextRainProb ?? 0, 90)
        : state.nextRainProb,
      summaryLine,
      // Nass/nah: bald voller OWM; sonst nächster Dry-Probe-Slot.
      nextCheckAtMs: Math.min(
        state.nextCheckAtMs,
        now + (wetNow ? 60_000 : GPS_RAIN_RISK_PROBE_MS),
      ),
    };

    try {
      const { ensureWeatherFreshFromOwm } = await import('../weatherService');
      const { getCachedWeatherSnapshot } = await import('../weatherService');
      const prev = getCachedWeatherSnapshot();
      await ensureWeatherFreshFromOwm(
        {
          fetchedAtMs: now,
          lat,
          lng,
          currentTemp: prev?.currentTempC ?? null,
          currentWeatherId: state.weatherCode,
          currentPrecipMm: state.currentPrecipMm,
          nextRainAtMs: state.nextRainAtMs,
          nextRainProb: wetNow ? 90 : state.nextRainProb ?? prev?.nextRainProb ?? null,
          rainStartsInMin: state.rainStartsInMin,
          rainEndsAtMs: state.rainEndsAtMs,
          summaryLine: state.summaryLine,
          promptBlock: state.promptBlock || state.summaryLine,
          rainWindows: state.rainWindows,
          dayHighC: prev?.dayHighC ?? null,
          tomorrowSummary: prev?.tomorrowSummary ?? null,
          nightLowC: prev?.nightLowC ?? null,
          sunsetMs: prev?.sunsetMs ?? null,
        },
        prev,
      );
    } catch {
      /* soft */
    }

    // Übergang trocken → nass: kein Voice (User merkt Regen), HUD reicht.
    void wasDry;
  } catch {
    /* soft */
  }
}

export async function runWeatherTrackerCheck(opts?: {
  force?: boolean;
  lat?: number | null;
  lng?: number | null;
}): Promise<WeatherTrackerState | null> {
  const now = Date.now();
  if (!opts?.force && state && state.nextCheckAtMs > now) {
    refreshLiveRainMinutes(now);
    // Voller OWM-Poll noch nicht fällig — trotzdem GPS-Schauer nicht verpassen.
    await maybeGpsDryProbeBetweenPolls(now);
    return state;
  }

  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  const lat = opts?.lat ?? store.lastGpsLat;
  const lng = opts?.lng ?? store.lastGpsLng;
  if (lat == null || lng == null) return state;
  noteGpsMovement(lat, lng);

  // Shared/Live-Wetter: ≥30 Min + GPS in Stadt — außer Force oder Cache schon nass.
  let wetCacheHint = false;
  try {
    const { getCachedWeatherSnapshot } = await import('../weatherService');
    const snap = getCachedWeatherSnapshot();
    if (
      snap &&
      isRainAlreadyFalling({
        nowMs: now,
        nextRainAtMs: snap.nextRainAtMs,
        rainStartsInMin: snap.rainStartsInMin,
        currentPrecipMm: snap.precipitationMm,
        weatherCode: snap.weatherCode,
      })
    ) {
      wetCacheHint = true;
    }
  } catch {
    /* soft */
  }
  const gate = canFetchLiveWeather({
    lat,
    lng,
    cityId: profile?.cityId ?? null,
    nowMs: now,
    bypassSession: !!opts?.force || wetCacheHint,
  });
  if (!gate.ok) {
    refreshLiveRainMinutes(now);
    if (gate.reason === 'session_too_short') {
      const wakeAt = weatherSessionStartedAtMs() + WEATHER_LIVE_AFTER_USE_MS;
      if (!state) {
        // Kein Fake-Trocken — warte auf Session-Gate, HUD bleibt auf Cache.
        state = {
          lastCheckAtMs: 0,
          nextCheckAtMs: wakeAt,
          dayStableDry: false,
          nextRainAtMs: null,
          rainStartsInMin: null,
          rainEndsAtMs: null,
          currentPrecipMm: null,
          weatherCode: null,
          nextRainProb: null,
          summaryLine: '',
          promptBlock: '',
          rainWindows: [],
          warned30ForRainAt: null,
          warned5ForRainAt: null,
          offeredShelterForRainAt: null,
          alertMode: true,
        };
      } else if (state.nextCheckAtMs > wakeAt) {
        state = { ...state, nextCheckAtMs: wakeAt };
      }
    }
    return state;
  }

  if (!opts?.force) {
    const ctx = shouldWeatherStayAlert({
      navActive: !!store.navActive,
      stationaryMs: now - lastMovedAtMs,
    });
    if (!ctx.alertMode && state && state.nextCheckAtMs > now) {
      refreshLiveRainMinutes(now);
      return state;
    }
  }

  let owm: OwmOneCallResult | null = null;
  try {
    owm = await fetchSharedOrDirectOwm({
      lat,
      lng,
      cityId: gate.cityId,
    });
  } catch {
    owm = null;
  }
  if (!owm) {
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
          rainEndsAtMs:
            meteo.rainWindows.find(
              (w) =>
                w.endMs > (meteo.nextRainAtMs ?? now) &&
                w.startMs <= (meteo.nextRainAtMs ?? now) + 30 * 60_000,
            )?.endMs ?? null,
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
          dayHighC: meteo.dayHighC ?? null,
        };
      }
    } catch {
      /* soft */
    }
  }
  if (!owm) return state;

  // GPS-Nowcast: nur bei Regen nah/jetzt ODER spürbarem Regenrisiko (Pop).
  try {
    const {
      fetchGpsRainNowcast,
      applyGpsNowcastToTiming,
      shouldFetchGpsRainNowcast,
      maxNearTermRainPopPct,
    } = await import('../weather/gpsRainNowcast');
    const hourlyPops = (owm.rawHourly ?? []).slice(0, 8).map((h) => h.pop);
    const riskPop = maxNearTermRainPopPct({
      nowMs: now,
      nextRainProb: owm.nextRainProb,
      rainWindows: owm.rainWindows,
      hourlyPops,
    });
    const districtSaysSoon = shouldFetchGpsRainNowcast({
      nowMs: now,
      nextRainAtMs: owm.nextRainAtMs,
      rainStartsInMin: owm.rainStartsInMin,
      rainingNow: isRainAlreadyFalling({
        nowMs: now,
        nextRainAtMs: owm.nextRainAtMs,
        rainStartsInMin: owm.rainStartsInMin,
        currentPrecipMm: owm.currentPrecipMm,
        weatherCode: owm.currentWeatherId,
      }),
      currentPrecipMm: owm.currentPrecipMm,
      lastGpsNowcastAtMs: lastGpsNowcastAtMs || null,
      dayStableDry: owm.dayStableDry,
      nextRainProb: owm.nextRainProb,
      rainWindows: owm.rainWindows,
      weatherCode: owm.currentWeatherId,
      hourlyPops,
      maxNearPopPct: riskPop,
    });
    if (districtSaysSoon) {
      const nowcast = await fetchGpsRainNowcast({ lat, lng });
      lastGpsNowcastAtMs = now;
      owm = applyGpsNowcastToTiming(owm, nowcast);
    }

    const baseNext = scheduleNextCheck(owm, now);
    const nextCheckAtMs = contextScheduleMs(now, baseNext);
    const alertCtx = shouldWeatherStayAlert({
      navActive: !!store.navActive,
      stationaryMs: now - lastMovedAtMs,
    });

    const liveStarts =
      minutesUntilIncomingRain({
        nowMs: now,
        nextRainAtMs: owm.nextRainAtMs,
        rainStartsInMin: owm.rainStartsInMin,
        currentPrecipMm: owm.currentPrecipMm,
        weatherCode: owm.currentWeatherId,
      }) ??
      (isRainAlreadyFalling({
        nowMs: now,
        nextRainAtMs: owm.nextRainAtMs,
        rainStartsInMin: owm.rainStartsInMin,
        currentPrecipMm: owm.currentPrecipMm,
        weatherCode: owm.currentWeatherId,
      })
        ? 0
        : owm.rainStartsInMin);

    const riskAfter = maxNearTermRainPopPct({
      nowMs: now,
      nextRainProb: owm.nextRainProb,
      rainWindows: owm.rainWindows,
      hourlyPops,
    });

    state = {
      lastCheckAtMs: now,
      nextCheckAtMs,
      dayStableDry: owm.dayStableDry,
      nextRainAtMs: owm.nextRainAtMs,
      rainStartsInMin: liveStarts,
      rainEndsAtMs: owm.rainEndsAtMs ?? null,
      currentPrecipMm: owm.currentPrecipMm,
      weatherCode: owm.currentWeatherId ?? null,
      nextRainProb:
        Math.max(owm.nextRainProb ?? 0, riskAfter) || owm.nextRainProb,
      summaryLine: owm.summaryLine,
      promptBlock: owm.promptBlock,
      rainWindows: owm.rainWindows,
      warned30ForRainAt: state?.warned30ForRainAt ?? null,
      warned5ForRainAt: state?.warned5ForRainAt ?? null,
      offeredShelterForRainAt: state?.offeredShelterForRainAt ?? null,
      alertMode: alertCtx.alertMode,
    };
  } catch {
    /* soft — Base-Wetter ohne GPS-Nowcast */
    const baseNext = scheduleNextCheck(owm, now);
    const nextCheckAtMs = contextScheduleMs(now, baseNext);
    const alertCtx = shouldWeatherStayAlert({
      navActive: !!store.navActive,
      stationaryMs: now - lastMovedAtMs,
    });
    const liveStarts =
      minutesUntilIncomingRain({
        nowMs: now,
        nextRainAtMs: owm.nextRainAtMs,
        rainStartsInMin: owm.rainStartsInMin,
        currentPrecipMm: owm.currentPrecipMm,
        weatherCode: owm.currentWeatherId,
      }) ??
      (isRainAlreadyFalling({
        nowMs: now,
        nextRainAtMs: owm.nextRainAtMs,
        rainStartsInMin: owm.rainStartsInMin,
        currentPrecipMm: owm.currentPrecipMm,
        weatherCode: owm.currentWeatherId,
      })
        ? 0
        : owm.rainStartsInMin);
    state = {
      lastCheckAtMs: now,
      nextCheckAtMs,
      dayStableDry: owm.dayStableDry,
      nextRainAtMs: owm.nextRainAtMs,
      rainStartsInMin: liveStarts,
      rainEndsAtMs: owm.rainEndsAtMs ?? null,
      currentPrecipMm: owm.currentPrecipMm,
      weatherCode: owm.currentWeatherId ?? null,
      nextRainProb: owm.nextRainProb,
      summaryLine: owm.summaryLine,
      promptBlock: owm.promptBlock,
      rainWindows: owm.rainWindows,
      warned30ForRainAt: state?.warned30ForRainAt ?? null,
      warned5ForRainAt: state?.warned5ForRainAt ?? null,
      offeredShelterForRainAt: state?.offeredShelterForRainAt ?? null,
      alertMode: alertCtx.alertMode,
    };
  }

  try {
    const { ensureWeatherFreshFromOwm } = await import('../weatherService');
    await ensureWeatherFreshFromOwm(owm, null);
  } catch {
    /* optional bridge */
  }

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
  // Kein Force-Fetch beim Start — Gate (30 Min + GPS in Stadt) spart Upstream.
  void runWeatherTrackerCheck();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    void runWeatherTrackerCheck();
  }, 30_000);
  return () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  };
}
