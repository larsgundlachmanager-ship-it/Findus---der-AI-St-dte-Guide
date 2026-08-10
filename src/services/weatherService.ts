/**
 * Wetter-Cache + Regen-Frühwarnung + Routing-Adjustment.
 * Primär: OpenWeather One Call 3.0; Fallback: Open-Meteo (kein Key).
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from './userProfileService';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from './ttsService';
import {
  buildWeatherRoutingAdjustment,
  type WeatherRoutingAdjustment,
} from './weather/weatherRouting';

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
  /** Minuten bis Regen (minutely) */
  rainStartsInMin?: number | null;
  rainWindows?: Array<{ startMs: number; endMs: number; pop: number }>;
  /** Sonnenuntergang (ms), wenn von OWM bekannt */
  sunsetMs?: number | null;
};

let cache: WeatherSnapshot | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let speakingWarn = false;
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
  const t =
    opts.temp != null ? `So um die ${Math.round(opts.temp)} Grad` : 'Wetter gerade unklar';
  if (opts.isHeavyRain) {
    return `${t}, und draußen regnet es stark (${opts.weatherLabel ?? 'Regen'}).`;
  }
  if (opts.rainProbNext >= RAIN_PROB_THRESHOLD && opts.rainSoonClock) {
    return `${t}, und ab ca. ${opts.rainSoonClock} sieht's nach Regen aus (ca. ${opts.rainProbNext} %).`;
  }
  if (opts.gust != null && opts.gust >= 40) {
    return `${t}, aber mit ordentlich Wind — Böen bis so ${Math.round(opts.gust)} km/h.`;
  }
  // 20–44 %: nicht als „trocken“ verkaufen
  if (opts.rainProbNext >= 20 && opts.rainProbNext < RAIN_PROB_THRESHOLD) {
    return `${t}, Schauer möglich (ca. ${opts.rainProbNext} %) — kein sicheres Trocken${
      opts.weatherLabel ? ` (${opts.weatherLabel})` : ''
    }.`;
  }
  if (opts.rainProbNext < 20) {
    return `${t}, trocken bis zum Abend${opts.weatherLabel ? ` (${opts.weatherLabel})` : ''}.`;
  }
  return `${t}, Regenrisiko so bei ${opts.rainProbNext} %.`;
}

async function speakWeatherLine(speech: string): Promise<void> {
  const voice = await getVoiceSettingsForTour();
  useFinnusStore.getState().addChatMessage({
    role: 'assistant',
    content: speech,
  });
  await speakAssistantText(speech, {
    voiceId: voice.voiceId,
    speechRate: voice.speechRate,
  });
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
  if (!snap.isHeavyRain) return;
  if (speakingWarn) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) return;

  // Höchstens alle 45 Min erneut
  if (
    snap.warnedHeavyRainAtMs != null &&
    Date.now() - snap.warnedHeavyRainAtMs < 45 * 60_000
  ) {
    return;
  }

  const routing = buildWeatherRoutingAdjustment({
    weatherCode: snap.weatherCode,
    precipitationMm: snap.precipitationMm,
  });
  if (!routing.voiceAlert) return;

  speakingWarn = true;
  try {
    await speakWeatherLine(routing.voiceAlert);
    await saveCache({
      ...snap,
      warnedHeavyRainAtMs: Date.now(),
    });
  } catch (err) {
    console.warn('[weather] heavy-rain warn failed:', err);
  } finally {
    speakingWarn = false;
  }
}

async function maybeWarnRain(snap: WeatherSnapshot): Promise<void> {
  if (snap.isHeavyRain) {
    await maybeWarnHeavyRain(snap);
    return;
  }
  if (speakingWarn) return;
  if (snap.nextRainAtMs == null) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) return;

  const mins = (snap.nextRainAtMs - Date.now()) / 60_000;
  if (mins < 0 || mins > 35) return;

  let kind: '30' | '10' | '5' | null = null;
  if (mins <= 5 && snap.warned5ForRainAt !== snap.nextRainAtMs) {
    kind = '5';
  } else if (mins <= 12 && snap.warned10ForRainAt !== snap.nextRainAtMs) {
    kind = '10';
  } else if (
    mins <= 32 &&
    mins > 12 &&
    snap.warned30ForRainAt !== snap.nextRainAtMs
  ) {
    kind = '30';
  }
  if (!kind) return;

  const clock = new Date(snap.nextRainAtMs).toTimeString().slice(0, 5);
  const prob = snap.nextRainProb != null ? ` so ${Math.round(snap.nextRainProb)} Prozent` : '';
  const speech =
    kind === '5'
      ? `Gleich wird's nass — in etwa ${Math.max(1, Math.round(mins))} Minuten Regen ab so ${clock}.`
      : kind === '10'
      ? `Kurzer Wetter-Check: in ungefähr zehn Minuten kann's nass werden — Prognose ab so ${clock}${prob ? `, Wahrscheinlichkeit${prob}` : ''}.`
      : `Hey, Wetter-Update: in etwa einer halben Stunde sieht's nach Regen aus — so ab ${clock}${prob ? ` (${prob.trim()} Chance)` : ''}. Café oder Indoor, oder ist dir Regen egal?`;

  speakingWarn = true;
  try {
    await speakWeatherLine(speech);
    const next: WeatherSnapshot = {
      ...snap,
      warned30ForRainAt:
        kind === '30' ? snap.nextRainAtMs : snap.warned30ForRainAt,
      warned10ForRainAt:
        kind === '10' ? snap.nextRainAtMs : snap.warned10ForRainAt,
      warned5ForRainAt:
        kind === '5' ? snap.nextRainAtMs : snap.warned5ForRainAt ?? null,
    };
    await saveCache(next);
  } catch (err) {
    console.warn('[weather] rain warn failed:', err);
  } finally {
    speakingWarn = false;
  }
}

/**
 * Wetter laden/aktualisieren. reason=open beim App-Start/Resume.
 * Primär OWM One Call 3.0, sonst Open-Meteo.
 */
export async function ensureWeatherFresh(
  reason: 'open' | 'tick' | 'force' = 'tick',
  coords?: { lat: number; lng: number } | null,
): Promise<WeatherSnapshot | null> {
  const prev = await loadCache();
  const c = coords ?? resolveCoords();
  if (!c) return prev;

  let force = reason === 'force';
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
    summaryLine: string;
    promptBlock: string;
    rainWindows: Array<{ startMs: number; endMs: number; pop: number }>;
    sunsetMs?: number | null;
  },
  prev?: WeatherSnapshot | null,
): Promise<WeatherSnapshot> {
  const prior = prev ?? (await loadCache());
  const isHeavy =
    (owm.currentPrecipMm ?? 0) > 2 ||
    (owm.currentWeatherId != null &&
      owm.currentWeatherId >= 200 &&
      owm.currentWeatherId < 600);
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
    rainWindows: owm.rainWindows,
    sunsetMs: owm.sunsetMs ?? prior?.sunsetMs ?? null,
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
