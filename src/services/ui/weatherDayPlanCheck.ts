/**
 * Live-HUD Wetter → Tagescheck gegen Timeline.
 * Sprecht Wetter, prüft Plan still, öffnet Timeline nur bei Konflikt.
 * Legt KEINE offenen Pläne / Wishes an.
 */

import { ensureWeatherFresh, getCachedWeatherSnapshot } from '../weatherService';
import { speakAssistantText, getVoiceSettingsForTour } from '../ttsService';
import { useFuturePlanStore, type FuturePlanStop } from '../../module2/timeline/futurePlanState';
import { requestOpenPlanCalendar } from '../../module2/timeline/planCalendarUiStore';
import { todayDateKey } from '../../utils/dateKeys';
import { getCurrentCoords } from '../locationService';

const OUTDOOR_RE =
  /\b(park|garten|strand|beach|wander|hike|aussicht|markt|platz|outdoor|terrasse|boot|rad|fahrrad|zoo|see|ufer|promenade|skyline|sonnenuntergang|picknick)\b/i;
const INDOOR_RE =
  /\b(museum|galerie|kirche|dom|restaurant|café|cafe|bistro|hotel|kino|theater|shopping|mall|ausstellung|indoor|bibliothek|therme|spa)\b/i;

export type WeatherPlanFit = {
  ok: boolean;
  reasons: string[];
  riskyStops: FuturePlanStop[];
};

function isOutdoorish(stop: FuturePlanStop): boolean {
  const blob = `${stop.title} ${stop.notes ?? ''} ${stop.emoji ?? ''}`;
  if (INDOOR_RE.test(blob)) return false;
  if (OUTDOOR_RE.test(blob)) return true;
  // Zu Fuß / Rad ohne Indoor-Hinweis → eher outdoor-sensitiv
  if (stop.transport === 'walk' || stop.transport === 'bike') return true;
  return false;
}

function rainThreat(nowMs: number): {
  heavy: boolean;
  soon: boolean;
  rainAtMs: number | null;
  summary: string;
} {
  const snap = getCachedWeatherSnapshot();
  const summary = snap?.summaryLine?.trim() || 'Aktuell hab ich keinen frischen Wettercheck.';
  const heavy = !!snap?.isHeavyRain;
  const rainAtMs = snap?.nextRainAtMs ?? null;
  const soon =
    heavy ||
    (snap?.rainStartsInMin != null && snap.rainStartsInMin <= 90) ||
    (rainAtMs != null && rainAtMs - nowMs <= 3 * 60 * 60_000) ||
    (snap?.precipitationMm != null && snap.precipitationMm > 0.3);
  return { heavy, soon, rainAtMs, summary };
}

/** Timed Stops (keine Nav-Legs, keine Wishes) für heute ab jetzt. */
function todaysTimedStops(nowMs: number): FuturePlanStop[] {
  const dayKey = todayDateKey();
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  return plan.stops.filter((s) => {
    if (s.status === 'done') return false;
    if (s.kind === 'nav_leg' || s.kind === 'wish') return false;
    const start = s.plannedStartMs;
    if (start == null) return false;
    const end = s.plannedEndMs ?? start + 60 * 60_000;
    return end >= nowMs - 15 * 60_000;
  });
}

export function evaluatePlanAgainstWeather(
  nowMs = Date.now(),
): WeatherPlanFit {
  const { heavy, soon, rainAtMs } = rainThreat(nowMs);
  const stops = todaysTimedStops(nowMs);
  if (!soon && !heavy) {
    return { ok: true, reasons: [], riskyStops: [] };
  }

  const risky = stops.filter((s) => {
    if (!isOutdoorish(s)) return false;
    const start = s.plannedStartMs ?? nowMs;
    const end = s.plannedEndMs ?? start + 60 * 60_000;
    // Überlappt mit Regenfenster (jetzt oder nextRain)
    if (heavy) return end >= nowMs;
    if (rainAtMs != null) {
      return start <= rainAtMs + 2 * 60 * 60_000 && end >= rainAtMs - 30 * 60_000;
    }
    return true;
  });

  const reasons: string[] = [];
  if (risky.length) {
    reasons.push(
      heavy
        ? `Bei dem Wetter wirken ${risky
            .slice(0, 2)
            .map((s) => s.title)
            .join(' und ')} eher ungemütlich draußen.`
        : `Regen könnte sich mit ${risky
            .slice(0, 2)
            .map((s) => s.title)
            .join(' und ')} beißen.`,
    );
  }

  return {
    ok: risky.length === 0,
    reasons,
    riskyStops: risky,
  };
}

/** Freie Fenster ≥ 75 Min zwischen timed Stops (heute). */
function freeGapsMs(nowMs: number): Array<{ startMs: number; endMs: number }> {
  const stops = todaysTimedStops(nowMs)
    .map((s) => ({
      start: s.plannedStartMs!,
      end: s.plannedEndMs ?? s.plannedStartMs! + 60 * 60_000,
    }))
    .sort((a, b) => a.start - b.start);

  const dayEnd = new Date(nowMs);
  dayEnd.setHours(22, 0, 0, 0);
  const endCap = dayEnd.getTime();

  const gaps: Array<{ startMs: number; endMs: number }> = [];
  let cursor = nowMs + 20 * 60_000;
  for (const s of stops) {
    if (s.start - cursor >= 75 * 60_000) {
      gaps.push({ startMs: cursor, endMs: s.start });
    }
    cursor = Math.max(cursor, s.end + 10 * 60_000);
  }
  if (endCap - cursor >= 75 * 60_000) {
    gaps.push({ startMs: cursor, endMs: endCap });
  }
  return gaps;
}

function twoFillSuggestions(rainy: boolean): [string, string] {
  if (rainy) {
    return [
      'ein gemütliches Café mit guter Speisekarte',
      'ein kleines Museum oder eine Indoor-Ausstellung',
    ];
  }
  return [
    'ein kurzer Spaziergang zu einem Aussichtspunkt',
    'ein lokaler Markt oder ein ruhiger Park',
  ];
}

function formatHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function speak(text: string): Promise<void> {
  const voice = await getVoiceSettingsForTour();
  await speakAssistantText(text, voice);
}

/**
 * Einstieg von der Live-HUD Wetterkarte.
 * Kein Planning-Modul, keine Timeline-Writes.
 */
let weatherCheckRunning = false;

export async function runWeatherLiveDayCheck(): Promise<void> {
  // Kein Re-Trigger während Findus noch spricht / ein Check läuft
  try {
    const { isSpeechActive } = await import('../../module2/speech/speechQueue');
    if (isSpeechActive() || weatherCheckRunning) return;
  } catch {
    if (weatherCheckRunning) return;
  }
  weatherCheckRunning = true;
  try {
    const coords = await getCurrentCoords({ timeoutMs: 4000 });
    await ensureWeatherFresh(
      'force',
      coords ? { lat: coords.lat, lng: coords.lng } : null,
    );
  } catch {
    /* soft — Cache reicht */
  }

  try {
  const nowMs = Date.now();
  const { heavy, soon, summary } = rainThreat(nowMs);
  const fit = evaluatePlanAgainstWeather(nowMs);

  // 1) Erst Wetter sagen
  await speak(`So siehts heute aus: ${summary}`);

  // 2) Still prüfen — Timeline nur bei Konflikt öffnen
  if (fit.ok) {
    let line =
      'Deinem heutigen Tag steht nichts im Wege — der Plan passt zum Wetter.';
    const gaps = freeGapsMs(nowMs);
    if (gaps.length > 0) {
      const [a, b] = twoFillSuggestions(heavy || soon);
      line += ` Unverbindlich, weil noch Luft ist: Du könntest noch ${a} einplanen — oder ${b}. Nur Ideen, nichts festgehalten.`;
    }
    await speak(line);
    return;
  }

  // Konflikt → Timeline öffnen + Anpassungsideen (ohne Wishes anzulegen)
  requestOpenPlanCalendar();
  const names = fit.riskyStops
    .slice(0, 3)
    .map((s) => {
      const t =
        s.plannedStartMs != null ? ` gegen ${formatHm(s.plannedStartMs)}` : '';
      return `${s.title}${t}`;
    })
    .join(', ');

  const adjust = fit.riskyStops.length
    ? `Schau mal in die Timeline: ${names} könnte bei dem Wetter haken. Idee: nach drinnen schieben, etwas später legen, oder gegen etwas Geschütztes tauschen.`
    : fit.reasons[0] ??
      'Schau mal in die Timeline — ich würde den Plan etwas wetterfester machen.';

  await speak(adjust);

  const gaps = freeGapsMs(nowMs);
  if (gaps.length > 0) {
    const [a, b] = twoFillSuggestions(true);
    await speak(
      `Und wenn du magst, unverbindlich zwei Füller: ${a}, oder ${b}. Ich trag nichts ein, solange du nicht willst.`,
    );
  }
  } finally {
    weatherCheckRunning = false;
  }
}
