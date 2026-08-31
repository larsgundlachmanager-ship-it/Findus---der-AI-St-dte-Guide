/**
 * Wetter-Cache + Regen-Frühwarnung + Routing-Adjustment.
 * Primär: OpenWeather One Call 3.0; Fallback: Open-Meteo (kein Key).
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from './userProfileService';
import {
  buildWeatherRoutingAdjustment,
  type WeatherRoutingAdjustment,
} from './weather/weatherRouting';
import { markRainWarnSessionStart } from './weather/rainWarnSessionGate';

const STATE_PATH = `${FileSystem.documentDirectory}findus-weather-cache.json`;
const FETCH_MS = 8_000;

/** Normal-Refresh im Gebrauch (lokal) — Server-Cache hält ohnehin 3h/Ort */
const REFRESH_WHILE_ACTIVE_MS = 3 * 60 * 60_000;
/** Beim Öffnen: älter als das → nachladen */
const STALE_ON_OPEN_MS = 2 * 60 * 60_000;
/** Regen nah → stündlich checken (Masterbook V5) */
const REFRESH_RAIN_WATCH_MS = 60 * 60_000;

const RAIN_PROB_THRESHOLD = 40;

export type WeatherSnapshot = {
  fetchedAtMs: number;
  lat: number;
  lng: number;
  cityHint: string | null;
  summaryLine: string;
  promptBlock: string;
  /** Nächster Regen-Start (ms), null wenn keiner in ~6h */
  nextRainAtMs: number | null;
  nextRainProb: number | null;
  /** WMO weather_code (aktuell) */
  weatherCode: number | null;
  /** Aktueller Niederschlag in mm (current_weather / hourly) */
  precipitationMm: number | null;
  /** Starkregen/Sturm nach weathercode oder precip > 2 mm */
  isHeavyRain: boolean;
  /** Schon gewarnt für diesen Regen-Start */
  warned30ForRainAt: number | null;
  warned10ForRainAt: number | null;
  /** 5-Min-Warnung (OpenWeather Tracker) */
  warned5ForRainAt?: number | null;
  /** Schon Voice-Alert für aktuellen Starkregen-Zustand */
  warnedHeavyRainAtMs: number | null;
  /** Minuten bis Regen (minutely) — Snapshot; HUD live aus nextRainAtMs */
  rainStartsInMin?: number | null;
  /** Ende des aktuellen Regenfensters (ms), wenn belegt */
  rainEndsAtMs?: number | null;
  rainWindows?: Array<{ startMs: number; endMs: number; pop: number }>;
  /** Sonnenuntergang (ms), wenn von OWM bekannt */
  sunsetMs?: number | null;
  /** Aktuelle Temperatur °C (SSOT, nicht aus Summary parsen) */
  currentTempC?: number | null;
  /** Tageshoch bis Abend °C */
  dayHighC?: number | null;
  /** Morgen kurz, nur belegt */
  tomorrowSummary?: string | null;
  /** Tiefstwert heute Nacht °C (jetzt bis morgen früh) */
  nightLowC?: number | null;
};

let cache: WeatherSnapshot | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let started = false;

function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function loadCache(): Promise<WeatherSnapshot | null> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(STATE_PATH);
    if (!info.exists) return null;
    const raw = JSON.parse(
      await FileSystem.readAsStringAsync(STATE_PATH),
    ) as WeatherSnapshot;
    if (raw?.fetchedAtMs && typeof raw.promptBlock === 'string') {
      cache = {
        ...raw,
        weatherCode: raw.weatherCode ?? null,
        precipitationMm: raw.precipitationMm ?? null,
        isHeavyRain: !!raw.isHeavyRain,
        warnedHeavyRainAtMs: raw.warnedHeavyRainAtMs ?? null,
      };
      return cache;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function saveCache(next: WeatherSnapshot): Promise<void> {
  cache = next;
  try {
    await FileSystem.writeAsStringAsync(STATE_PATH, JSON.stringify(next));
  } catch (err) {
    console.warn('[weather] persist failed:', err);
  }
}

function buildColloquialSummary(opts: {
  temp: number | null;
  rainProbNext: number;
  gust: number | null;
  rainSoonClock: string | null;
  weatherLabel: string | null;
  isHeavyRain: boolean;
}): string {
  try {
    const { weatherSpokenLine } = require('./tts/offlinePhraseBank') as {
      weatherSpokenLine: (o: {
        tempC: number | null;
        rainProbNext: number;
        gustKmh: number | null;
        rainSoonClock: string | null;
        isHeavyRain: boolean;
      }) => string;
    };
    return weatherSpokenLine({
      tempC: opts.temp,
      rainProbNext: opts.rainProbNext,
      gustKmh: opts.gust,
      rainSoonClock: opts.rainSoonClock,
      isHeavyRain: opts.isHeavyRain,
    });
  } catch {
    const t =
      opts.temp != null
        ? `So um die ${Math.round(opts.temp)} Grad`
        : 'Wetter gerade unklar';
    if (opts.isHeavyRain) return `${t}, und draußen regnet es stark.`;
    if (opts.rainProbNext >= RAIN_PROB_THRESHOLD && opts.rainSoonClock) {
      return `${t}, und ab ca. ${opts.rainSoonClock} sieht's nach Regen aus.`;
    }
    if (opts.gust != null && opts.gust >= 40) {
      return `${t}, aber mit ordentlich Wind.`;
    }
    if (opts.rainProbNext >= 20) {
      return `${t}, Schauer möglich — kein sicheres Trocken.`;
    }
    return `${t}, trocken bis zum Abend.`;
  }
}

function resolveCoords(): { lat: number; lng: number } | null {
  const s = useFinnusStore.getState();
  if (s.lastGpsLat != null && s.lastGpsLng != null) {
    return { lat: s.lastGpsLat, lng: s.lastGpsLng };
  }
  // Fallback: Profil-Stadt / Prisdorf — sonst nie Wetter ohne GPS
  return { lat: 53.685, lng: 9.763 };
}

async function maybeWarnHeavyRain(snap: WeatherSnapshot): Promise<void> {
  // Aktueller Starkregen wird nicht angesagt — User merkt nasse Straße selbst.
  void snap;
}

async function maybeWarnRain(snap: WeatherSnapshot): Promise<void> {
  // Stimme: nur weatherTracker (30 und 5 Min). Hier kein zweites „es regnet“.
  void snap;
}

/**
 * Wetter laden/aktualisieren. reason=open beim App-Start/Resume.
 * Primär OWM One Call 3.0, sonst Open-Meteo.
 */
export async function ensureWeatherFresh(
  reason: 'open' | 'tick' | 'force' = 'tick',
  coords?: { lat: number; lng: number } | null,
  opts?: { userAsked?: boolean },
): Promise<WeatherSnapshot | null> {
  const prev = await loadCache();
  const c = coords ?? resolveCoords();
  if (!c) return prev;

  // Proaktiv: Shared/Live nur nach 30 Min + GPS in Stadt.
  // User-Frage oder Cache schon nass → Session-Gate überspringen.
  const userAsked = opts?.userAsked === true;
  if (!userAsked) {
    try {
      const { canFetchLiveWeather } = await import('./weather/weatherFetchGate');
      const { isRainAlreadyFalling } = await import('./weather/rainIncomingPolicy');
      const wetCache =
        !!prev &&
        isRainAlreadyFalling({
          nowMs: Date.now(),
          nextRainAtMs: prev.nextRainAtMs,
          rainStartsInMin: prev.rainStartsInMin,
          currentPrecipMm: prev.precipitationMm,
          weatherCode: prev.weatherCode,
        });
      const gate = canFetchLiveWeather({
        lat: c.lat,
        lng: c.lng,
        cityId: getCachedUserProfile()?.cityId ?? null,
        bypassSession: wetCache || reason === 'force',
      });
      if (!gate.ok) {
        if (prev) void maybeWarnRain(prev);
        return prev;
      }
    } catch {
      /* soft */
    }
  }

  let force = reason === 'force';
  // Kaputte Legacy-Summary („Temperatur unklar“) → Soft-Refresh
  if (
    prev &&
    /Temperatur unklar|Wetter gerade unklar/i.test(prev.summaryLine ?? '')
  ) {
    force = true;
  }
  if (prev && haversineKm(prev.lat, prev.lng, c.lat, c.lng) > 15) {
    force = true;
  }

  try {
    const { hasOpenWeatherKey, fetchOpenWeatherOneCall } = await import(
      './weather/openWeatherOneCall'
    );
    if (!hasOpenWeatherKey()) {
      if (__DEV__) {
        console.warn('[weather] OWM key missing — Open-Meteo Fallback');
      }
      const { fetchOpenMeteoFallback } = await import(
        './weather/openMeteoFallback'
      );
      const meteo = await fetchOpenMeteoFallback({ lat: c.lat, lng: c.lng });
      if (meteo) {
        return ensureWeatherFreshFromOwm(
          {
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
            rainWindows: meteo.rainWindows,
            dayHighC: meteo.dayHighC ?? null,
            tomorrowSummary: meteo.tomorrowSummary ?? null,
            nightLowC: meteo.nightLowC ?? null,
          },
          prev,
        );
      }
      if (prev) void maybeWarnRain(prev);
      return prev;
    }
    const owmDue =
      force ||
      !prev ||
      Date.now() - prev.fetchedAtMs >
        (prev.nextRainAtMs != null &&
        prev.nextRainAtMs - Date.now() < 2 * 60 * 60_000
          ? 30 * 60_000
          : prev.nextRainAtMs == null
            ? 6 * 60 * 60_000
            : 60 * 60_000);
    if (owmDue) {
      const owm = await fetchOpenWeatherOneCall({ lat: c.lat, lng: c.lng });
      if (owm) {
        return ensureWeatherFreshFromOwm(owm, prev);
      }
      // OWM fail → Open-Meteo einmalig
      const { fetchOpenMeteoFallback } = await import(
        './weather/openMeteoFallback'
      );
      const meteo = await fetchOpenMeteoFallback({ lat: c.lat, lng: c.lng });
      if (meteo) {
        return ensureWeatherFreshFromOwm(
          {
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
            rainWindows: meteo.rainWindows,
            dayHighC: meteo.dayHighC ?? null,
            tomorrowSummary: meteo.tomorrowSummary ?? null,
            nightLowC: meteo.nightLowC ?? null,
          },
          prev,
        );
      }
    } else if (prev) {
      void maybeWarnRain(prev);
      return prev;
    }
  } catch (err) {
    if (__DEV__) console.warn('[weather] OWM SSOT failed', err);
  }

  if (prev) void maybeWarnRain(prev);
  return prev;
}

/** Bridge aus Modul-4 Wetter-Tracker (OWM). */
export async function ensureWeatherFreshFromOwm(
  owm: {
    fetchedAtMs: number;
    lat: number;
    lng: number;
    currentTemp: number | null;
    currentWeatherId: number | null;
    currentPrecipMm: number | null;
    nextRainAtMs: number | null;
    nextRainProb: number | null;
    rainStartsInMin: number | null;
    rainEndsAtMs?: number | null;
    summaryLine: string;
    promptBlock: string;
    rainWindows: Array<{ startMs: number; endMs: number; pop: number }>;
    sunsetMs?: number | null;
    dayHighC?: number | null;
    tomorrowSummary?: string | null;
    nightLowC?: number | null;
  },
  prev?: WeatherSnapshot | null,
): Promise<WeatherSnapshot> {
  const prior = prev ?? (await loadCache());
  const isHeavy =
    (owm.currentPrecipMm ?? 0) > 2 ||
    (owm.currentWeatherId != null &&
      // OWM: 2xx Gewitter, 502+ starker Regen — nicht jeder Schauer
      ((owm.currentWeatherId >= 200 && owm.currentWeatherId < 300) ||
        owm.currentWeatherId === 502 ||
        owm.currentWeatherId === 503 ||
        owm.currentWeatherId === 504 ||
        owm.currentWeatherId === 522 ||
        owm.currentWeatherId === 531));
  const dayHigh =
    owm.dayHighC ??
    (() => {
      const m = owm.promptBlock.match(
        /Tageshoch[^\d-]{0,24}(-?\d+(?:[.,]\d+)?)\s*°/i,
      );
      return m ? Number(m[1]!.replace(',', '.')) : null;
    })();
  const snap: WeatherSnapshot = {
    fetchedAtMs: owm.fetchedAtMs,
    lat: owm.lat,
    lng: owm.lng,
    cityHint: getCachedUserProfile()?.cityName ?? null,
    summaryLine: owm.summaryLine,
    promptBlock: owm.promptBlock,
    nextRainAtMs: owm.nextRainAtMs,
    nextRainProb: owm.nextRainProb,
    weatherCode: owm.currentWeatherId,
    precipitationMm: owm.currentPrecipMm,
    isHeavyRain: isHeavy,
    warned30ForRainAt:
      prior && prior.nextRainAtMs === owm.nextRainAtMs
        ? prior.warned30ForRainAt
        : null,
    warned10ForRainAt:
      prior && prior.nextRainAtMs === owm.nextRainAtMs
        ? prior.warned10ForRainAt
        : null,
    warned5ForRainAt:
      prior && prior.nextRainAtMs === owm.nextRainAtMs
        ? prior.warned5ForRainAt ?? null
        : null,
    warnedHeavyRainAtMs:
      prior && prior.isHeavyRain && isHeavy ? prior.warnedHeavyRainAtMs : null,
    rainStartsInMin: owm.rainStartsInMin,
    rainEndsAtMs: owm.rainEndsAtMs ?? null,
    rainWindows: owm.rainWindows,
    sunsetMs: owm.sunsetMs ?? prior?.sunsetMs ?? null,
    currentTempC: owm.currentTemp,
    dayHighC:
      dayHigh != null && Number.isFinite(dayHigh) ? dayHigh : prior?.dayHighC ?? null,
    tomorrowSummary: owm.tomorrowSummary ?? prior?.tomorrowSummary ?? null,
    nightLowC:
      owm.nightLowC != null && Number.isFinite(owm.nightLowC)
        ? owm.nightLowC
        : prior?.nightLowC ?? null,
  };
  await saveCache(snap);

  // Geplante Regen-Push — auch wenn App später zu ist
  try {
    const { syncRainAlertNotifications } = await import(
      './notifications/rainAlertNotifications'
    );
    await syncRainAlertNotifications({
      nextRainAtMs: snap.nextRainAtMs,
      rainStartsInMin: snap.rainStartsInMin ?? null,
      summaryLine: snap.summaryLine,
    });
  } catch {
    /* soft */
  }

  return snap;
}

/** Prompt-Block für Concierge / Planung (Cache oder frisch). */
export async function getWeatherPromptBlock(
  lat?: number,
  lng?: number,
): Promise<string | null> {
  const snap = await ensureWeatherFresh(
    'tick',
    lat != null && lng != null ? { lat, lng } : null,
  );
  return snap?.promptBlock ?? null;
}

export function getCachedWeatherSummary(): string | null {
  return cache?.summaryLine ?? null;
}

export function getCachedWeatherSnapshot(): WeatherSnapshot | null {
  return cache;
}

/** Routing-Anpassung aus Cache (oder Defaults bei fehlendem Wetter). */
export function getWeatherRoutingAdjustment(
  stationName?: string | null,
): WeatherRoutingAdjustment {
  const snap = cache;
  return buildWeatherRoutingAdjustment({
    weatherCode: snap?.weatherCode ?? null,
    precipitationMm: snap?.precipitationMm ?? null,
    stationName,
  });
}

/**
 * Frisches Routing inkl. optionaler Voice-Zeile für Transit/Nav.
 * Ruft ensureWeatherFresh, wenn Koordinaten bekannt sind.
 */
export async function resolveWeatherRouting(opts?: {
  lat?: number;
  lng?: number;
  stationName?: string | null;
}): Promise<WeatherRoutingAdjustment> {
  if (opts?.lat != null && opts?.lng != null) {
    await ensureWeatherFresh('tick', { lat: opts.lat, lng: opts.lng });
  } else {
    await ensureWeatherFresh('tick');
  }
  return getWeatherRoutingAdjustment(opts?.stationName);
}

/** Startet periodische Checks + AppState-Resume. */
export function startWeatherMonitor(): () => void {
  if (started) {
    return () => undefined;
  }
  started = true;
  markRainWarnSessionStart();

  void ensureWeatherFresh('open');
  // Modul-4 Tracker ist SSOT für OWM-Taktung (Sleep / Rain-Watch / Hysterese)
  void import('./logistics/weatherTracker')
    .then((m) => m.startWeatherTracker())
    .catch(() => {});
  // Regen-Push braucht Notification-Permission früh
  void import('./notifications/notificationService')
    .then((m) => m.ensureNotificationPermissionForProfile())
    .catch(() => {});

  tickTimer = setInterval(() => {
    if (AppState.currentState !== 'active') return;
    // OWM-SSOT: Tracker pollt; Legacy-Tick entfällt
  }, 60_000);

  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') {
      void ensureWeatherFresh('open');
    }
    // Beim Sperren/Hintergrund: noch einmal Sync → OS behält geplante Regen-Push
    if (next === 'background' || next === 'inactive') {
      void (async () => {
        try {
          await ensureWeatherFresh('tick');
          const { runWeatherTrackerCheck } = await import(
            './logistics/weatherTracker'
          );
          await runWeatherTrackerCheck({ force: true });
        } catch {
          /* soft */
        }
      })();
    }
  };
  appStateSub = AppState.addEventListener('change', onAppState);

  return () => {
    started = false;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    appStateSub?.remove();
    appStateSub = null;
  };
}
