/**
 * Wetter-Cache + Regen-Frühwarnung.
 * - Beim App-Start / Resume: wenn älter als ~2h → Update
 * - Im Gebrauch: alle ~3h Refresh
 * - Bei Regenprognose: häufiger checken, Warnung ~30 Min und ~10 Min vorher
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from './userProfileService';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from './ttsService';

const STATE_PATH = `${FileSystem.documentDirectory}findus-weather-cache.json`;
const FETCH_MS = 8_000;

/** Normal-Refresh im Gebrauch */
const REFRESH_WHILE_ACTIVE_MS = 3 * 60 * 60_000;
/** Beim Öffnen: älter als das → nachladen */
const STALE_ON_OPEN_MS = 2 * 60 * 60_000;
/** Regen nah → häufiger */
const REFRESH_RAIN_WATCH_MS = 5 * 60_000;

const RAIN_PROB_THRESHOLD = 45;

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
  /** Schon gewarnt für diesen Regen-Start */
  warned30ForRainAt: number | null;
  warned10ForRainAt: number | null;
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
      cache = raw;
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
}): string {
  const t =
    opts.temp != null ? `So um die ${Math.round(opts.temp)} Grad` : 'Wetter gerade unklar';
  if (opts.rainProbNext >= RAIN_PROB_THRESHOLD && opts.rainSoonClock) {
    return `${t}, und ab ca. ${opts.rainSoonClock} sieht's nach Regen aus (~${opts.rainProbNext}%).`;
  }
  if (opts.gust != null && opts.gust >= 40) {
    return `${t}, aber mit ordentlich Wind — Böen bis so ${Math.round(opts.gust)} km/h.`;
  }
  if (opts.rainProbNext < 25) {
    return `${t}, und erstmal eher trocken.`;
  }
  return `${t}, Regenrisiko so bei ${opts.rainProbNext}%.`;
}

async function fetchOpenMeteo(
  lat: number,
  lng: number,
): Promise<Omit<
  WeatherSnapshot,
  'warned30ForRainAt' | 'warned10ForRainAt'
> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&minutely_15=precipitation_probability` +
      `&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m` +
      `&forecast_days=1&timezone=auto`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: number[];
        wind_gusts_10m?: number[];
      };
      minutely_15?: {
        time?: string[];
        precipitation_probability?: number[];
      };
    };

    const times = data.hourly?.time ?? [];
    const probs = data.hourly?.precipitation_probability ?? [];
    const temps = data.hourly?.temperature_2m ?? [];
    const gusts = data.hourly?.wind_gusts_10m ?? [];
    if (!times.length) return null;

    const now = Date.now();
    const nextHours = probs
      .map((p, i) => ({
        p: p ?? 0,
        t: times[i]!,
        temp: temps[i],
        gust: gusts[i],
        at: new Date(times[i]!).getTime(),
      }))
      .filter((x) => x.at >= now - 20 * 60_000)
      .slice(0, 10);

    let nextRainAtMs: number | null = null;
    let nextRainProb: number | null = null;

    const miniTimes = data.minutely_15?.time ?? [];
    const miniProbs = data.minutely_15?.precipitation_probability ?? [];
    for (let i = 0; i < miniTimes.length; i++) {
      const at = new Date(miniTimes[i]!).getTime();
      if (at < now) continue;
      if (at > now + 6 * 3600_000) break;
      const p = miniProbs[i] ?? 0;
      if (p >= RAIN_PROB_THRESHOLD) {
        nextRainAtMs = at;
        nextRainProb = p;
        break;
      }
    }
    if (nextRainAtMs == null) {
      for (const h of nextHours) {
        if (h.at >= now && h.p >= RAIN_PROB_THRESHOLD) {
          nextRainAtMs = h.at;
          nextRainProb = h.p;
          break;
        }
      }
    }

    const rainLines: string[] = [];
    for (const h of nextHours) {
      if (h.p >= 40 && h.at >= now) {
        rainLines.push(
          `- Ab ca. ${h.t.slice(11, 16)} Uhr: Regenwahrscheinlichkeit ~${h.p}%`,
        );
      }
    }

    const cur = nextHours[0];
    const rainClock =
      nextRainAtMs != null
        ? new Date(nextRainAtMs).toTimeString().slice(0, 5)
        : null;
    const summaryLine = buildColloquialSummary({
      temp: cur?.temp ?? null,
      rainProbNext: nextRainProb ?? cur?.p ?? 0,
      gust: cur?.gust ?? null,
      rainSoonClock: rainClock,
    });

    const night = nextHours.find((x) => {
      const h = Number(x.t.slice(11, 13));
      return h >= 22 || h <= 5;
    });

    const profile = getCachedUserProfile();
    const cityHint = profile?.cityName?.trim() || null;

    const promptBlock = [
      'Wetter (Open-Meteo, gecacht — für Planung nutzen):',
      summaryLine,
      nextHours.length
        ? `Nächste Stunden: ${nextHours
            .slice(0, 6)
            .map((x) => {
              const temp =
                x.temp != null ? `${Math.round(x.temp)}°` : '?';
              const gust =
                x.gust != null ? ` Böen~${Math.round(x.gust)}km/h` : '';
              return `${x.t.slice(11, 16)}→${temp} Regen${x.p}%${gust}`;
            })
            .join(', ')}`
        : '',
      ...(rainLines.length ? ['Regen-Fenster:', ...rainLines.slice(0, 4)] : []),
      nextRainAtMs != null
        ? `Nächster Regen-Peak ca. ${rainClock} (~${nextRainProb}%).`
        : 'Kein klarer Regen-Peak in den nächsten Stunden.',
      'OUTFIT-REGELN (wenn User nach Kleidung fragt): Temp/Wind/Regen nennen + begründen.',
      night?.temp != null
        ? `- Nachts/ab 22 Uhr ca. ${Math.round(night.temp)}° — warme Jacke.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      fetchedAtMs: Date.now(),
      lat,
      lng,
      cityHint,
      summaryLine,
      promptBlock,
      nextRainAtMs,
      nextRainProb,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resolveCoords(): { lat: number; lng: number } | null {
  const s = useFinnusStore.getState();
  if (
    typeof s.lastGpsLat === 'number' &&
    typeof s.lastGpsLng === 'number' &&
    Number.isFinite(s.lastGpsLat) &&
    Number.isFinite(s.lastGpsLng)
  ) {
    return { lat: s.lastGpsLat, lng: s.lastGpsLng };
  }
  return null;
}

function needsRefresh(
  snap: WeatherSnapshot | null,
  reason: 'open' | 'tick' | 'force',
): boolean {
  if (reason === 'force' || !snap) return true;
  const age = Date.now() - snap.fetchedAtMs;
  if (reason === 'open') return age >= STALE_ON_OPEN_MS;
  const rainSoon =
    snap.nextRainAtMs != null &&
    snap.nextRainAtMs - Date.now() < 90 * 60_000 &&
    snap.nextRainAtMs > Date.now() - 5 * 60_000;
  if (rainSoon) return age >= REFRESH_RAIN_WATCH_MS;
  return age >= REFRESH_WHILE_ACTIVE_MS;
}

async function maybeWarnRain(snap: WeatherSnapshot): Promise<void> {
  if (speakingWarn) return;
  if (snap.nextRainAtMs == null) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) return;

  const mins = (snap.nextRainAtMs - Date.now()) / 60_000;
  if (mins < 0 || mins > 35) return;

  let kind: '30' | '10' | null = null;
  if (mins <= 12 && snap.warned10ForRainAt !== snap.nextRainAtMs) {
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
    kind === '10'
      ? `Kurzer Wetter-Check: in ungefähr zehn Minuten kann's nass werden — Prognose ab so ${clock}${prob ? `, Wahrscheinlichkeit${prob}` : ''}. Wenn du draußen bist, Jacke oder Unterstand im Hinterkopf behalten.`
      : `Hey, Wetter-Update: in etwa einer halben Stunde sieht's nach Regen aus — so ab ${clock}${prob ? ` (${prob.trim()} Chance)` : ''}. Kein Drama, aber gut zu wissen, falls du noch länger draußen chillen willst.`;

  speakingWarn = true;
  try {
    const voice = await getVoiceSettingsForTour();
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: speech,
    });
    await speakAssistantText(speech, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
    const next: WeatherSnapshot = {
      ...snap,
      warned30ForRainAt:
        kind === '30' ? snap.nextRainAtMs : snap.warned30ForRainAt,
      warned10ForRainAt:
        kind === '10' ? snap.nextRainAtMs : snap.warned10ForRainAt,
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
 */
export async function ensureWeatherFresh(
  reason: 'open' | 'tick' | 'force' = 'tick',
  coords?: { lat: number; lng: number } | null,
): Promise<WeatherSnapshot | null> {
  const prev = await loadCache();
  const c = coords ?? resolveCoords();
  if (!c) return prev;

  // Ort gewechselt (>15 km) → force
  let force = reason === 'force';
  if (prev && haversineKm(prev.lat, prev.lng, c.lat, c.lng) > 15) {
    force = true;
  }

  if (!needsRefresh(prev, force ? 'force' : reason)) {
    if (prev) void maybeWarnRain(prev);
    return prev;
  }

  const fresh = await fetchOpenMeteo(c.lat, c.lng);
  if (!fresh) return prev;

  const merged: WeatherSnapshot = {
    ...fresh,
    warned30ForRainAt:
      prev && prev.nextRainAtMs === fresh.nextRainAtMs
        ? prev.warned30ForRainAt
        : null,
    warned10ForRainAt:
      prev && prev.nextRainAtMs === fresh.nextRainAtMs
        ? prev.warned10ForRainAt
        : null,
  };
  await saveCache(merged);
  void maybeWarnRain(merged);
  return merged;
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

/** Startet periodische Checks + AppState-Resume. */
export function startWeatherMonitor(): () => void {
  if (started) {
    return () => undefined;
  }
  started = true;

  void ensureWeatherFresh('open');

  tickTimer = setInterval(() => {
    if (AppState.currentState !== 'active') return;
    void ensureWeatherFresh('tick');
  }, 60_000);

  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') {
      void ensureWeatherFresh('open');
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
