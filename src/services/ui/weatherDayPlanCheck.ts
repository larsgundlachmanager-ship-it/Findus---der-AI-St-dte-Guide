/**
 * Live-HUD Wetter-Tap → kompletter Tagesbericht (TTS + Chat).
 * Ab 16 Uhr inkl. morgen. Bis 11 Uhr Outfit.
 * Timeline nur bei Konflikt. Keine neuen Pläne / Wishes.
 */

import { ensureWeatherFresh, getCachedWeatherSnapshot } from '../weatherService';
import { speakAssistantText, getVoiceSettingsForTour } from '../ttsService';
import { getCurrentCoords } from '../locationService';
import { isNachtruhe } from './nachtruhePolicy';
import { formatWeatherBriefing } from './weatherDayPlanSpeech';
import {
  evaluatePlanAgainstWeather,
  formatWeatherTimelineHints,
  isOutdoorPlanStop,
  type WeatherPlanFit,
} from './weatherPlanTimelineHints';

export type { WeatherPlanFit };
export {
  evaluatePlanAgainstWeather,
  formatWeatherTimelineHints,
  isOutdoorPlanStop,
};

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

function formatHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function speak(text: string): Promise<void> {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          addChatMessage: (m: { role: string; content: string }) => void;
        };
      };
    };
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: trimmed,
    });
  } catch {
    /* Chat optional */
  }
  const voice = await getVoiceSettingsForTour();
  await speakAssistantText(trimmed, voice);
}

/**
 * Einstieg von der Live-HUD Wetterkarte.
 * Kein Planning-Modul, keine Timeline-Writes.
 */
let weatherCheckRunning = false;

export async function runWeatherLiveDayCheck(): Promise<void> {
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
    const snap = getCachedWeatherSnapshot();
    const { heavy, soon } = rainThreat(nowMs);
    const brief = formatWeatherBriefing({ snap, heavy, soon, nowMs });
    const weatherLine = brief.speech;

    if (isNachtruhe(nowMs)) {
      await speak(weatherLine);
      return;
    }

    const fit = evaluatePlanAgainstWeather(nowMs);
    const timelineHints = formatWeatherTimelineHints({ nowMs, snap });
    if (fit.ok && !timelineHints.length) {
      await speak(weatherLine);
      return;
    }

    let tail = timelineHints.join(' ');
    if (!tail && fit.riskyStops.length) {
      tail = `Passt nicht so gut: ${fit.riskyStops
        .slice(0, 3)
        .map((s) => {
          const t =
            s.plannedStartMs != null ? ` so gegen ${formatHm(s.plannedStartMs)}` : '';
          return `${s.title}${t}`;
        })
        .join(', ')} bei dem Wetter. Wenn du willst, schieben wir das später oder nach drinnen.`;
    } else if (!tail && fit.reasons[0]) {
      tail = fit.reasons[0];
    }
    await speak(tail ? `${weatherLine} ${tail}` : weatherLine);
  } finally {
    weatherCheckRunning = false;
  }
}
