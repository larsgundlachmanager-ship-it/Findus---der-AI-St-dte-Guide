/**
 * ÖPNV-Stations-Countdown: Audio + Haptik.
 * 3 Stationen vorher erinnern; bei 1 Station „nächste raus“;
 * kurz vor Ankunft nochmal „jetzt aussteigen“ (nicht sofort doppelt).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { speakAssistantText } from '../ttsService';
import { triggerHapticPulse } from './haptics';
import type { TransportMode } from './navigationTypes';
import { isTransitMode } from './transportMode';

const announced = new Set<number>();
let lastCueAtMs = 0;
let alightNowSpoken = false;
let lastRemaining: number | null = null;
const CUE_COOLDOWN_MS = 12_000;
/** Nach „nächste Station raus“ mindestens so lange warten vor „jetzt aussteigen“. */
const ALIGHT_NOW_GAP_MS = 90_000;
let nextStationCueAtMs = 0;

export function resetStationCountdownAnnouncements(): void {
  announced.clear();
  lastCueAtMs = 0;
  alightNowSpoken = false;
  lastRemaining = null;
  nextStationCueAtMs = 0;
}

function cueForStations(
  n: number,
  targetName: string,
): { text: string; haptic?: 'double' } | null {
  if (n === 5) {
    return {
      text: 'Noch fünf Stationen — entspannt bleiben.',
    };
  }
  if (n === 3) {
    return {
      text: 'Noch drei Stationen — langsam bereit machen zum Aussteigen.',
    };
  }
  if (n === 1) {
    return {
      text: targetName.trim()
        ? `Nächste Station müssen wir raus — bereit für ${targetName}.`
        : 'Nächste Station müssen wir raus.',
      haptic: 'double',
    };
  }
  return null;
}

/**
 * Wird aufgerufen, wenn remainingStations sich ändert (Transit).
 */
export async function onRemainingStationsChanged(
  remaining: number,
  opts: { transportMode: TransportMode; targetName: string },
): Promise<void> {
  if (!isTransitMode(opts.transportMode)) return;

  // Neu gestartet / weiter entfernt → Reset „jetzt aussteigen“
  if (lastRemaining != null && remaining > lastRemaining) {
    alightNowSpoken = false;
    nextStationCueAtMs = 0;
  }
  lastRemaining = remaining;

  if (![5, 3, 1].includes(remaining)) return;
  if (announced.has(remaining)) return;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) return;
  if (Date.now() - lastCueAtMs < CUE_COOLDOWN_MS) return;

  const cue = cueForStations(remaining, opts.targetName);
  if (!cue) return;

  announced.add(remaining);
  lastCueAtMs = Date.now();
  if (remaining === 1) nextStationCueAtMs = Date.now();
  if (cue.haptic) triggerHapticPulse(cue.haptic);

  try {
    await speakAssistantText(cue.text);
  } catch (err) {
    console.warn('[stationCountdown] speak failed:', err);
  }
}

/**
 * GPS-Tick: wenn schon „nächste Station raus“ gesagt wurde und wir nahe am Ziel sind,
 * nach Puffer „jetzt aussteigen“ (nicht sofort nach dem ersten Cue).
 */
export async function maybeSpeakAlightNow(opts: {
  transportMode: TransportMode;
  remainingStations: number | null;
  distanceToDestinationM: number | null;
  speedMs: number | null;
}): Promise<void> {
  if (!isTransitMode(opts.transportMode)) return;
  if (opts.remainingStations == null || opts.remainingStations > 1) return;
  if (alightNowSpoken) return;
  if (!nextStationCueAtMs) return;
  if (Date.now() - nextStationCueAtMs < ALIGHT_NOW_GAP_MS) return;

  const dist = opts.distanceToDestinationM ?? 9999;
  const speed = opts.speedMs ?? 0;
  // ~30–90 s vor Halt: nah am Ziel oder stark verlangsamt
  const nearStop = dist <= 350 || (dist <= 800 && speed < 4);
  if (!nearStop) return;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) return;

  alightNowSpoken = true;
  lastCueAtMs = Date.now();
  triggerHapticPulse('double');
  try {
    await speakAssistantText('Jetzt müssen wir aussteigen.');
  } catch {
    /* soft */
  }
}
