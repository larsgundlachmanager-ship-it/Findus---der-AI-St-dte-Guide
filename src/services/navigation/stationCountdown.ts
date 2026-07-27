/**
 * ÖPNV-Stations-Countdown: Audio + Haptik bei 5 / 3 / 1 verbleibenden Stationen.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { speakAssistantText } from '../ttsService';
import { triggerHapticPulse } from './haptics';
import type { TransportMode } from './navigationTypes';
import { isTransitMode } from './transportMode';

const announced = new Set<number>();
let lastCueAtMs = 0;
const CUE_COOLDOWN_MS = 12_000;

export function resetStationCountdownAnnouncements(): void {
  announced.clear();
  lastCueAtMs = 0;
}

function cueForStations(
  n: number,
  targetName: string,
): { text: string; haptic?: 'double' } | null {
  if (n === 5) {
    return {
      text: 'Noch fünf Stationen — wir haben noch etwas Zeit.',
    };
  }
  if (n === 3) {
    return {
      text: 'Noch drei Stationen — mach dich langsam bereit.',
    };
  }
  if (n === 1) {
    return {
      text: targetName.trim()
        ? `An der nächsten Station musst du raus! Bereit machen für ${targetName}.`
        : 'An der nächsten Station musst du raus! Bereit machen.',
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
  if (![5, 3, 1].includes(remaining)) return;
  if (announced.has(remaining)) return;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) return;
  if (Date.now() - lastCueAtMs < CUE_COOLDOWN_MS) return;

  const cue = cueForStations(remaining, opts.targetName);
  if (!cue) return;

  announced.add(remaining);
  lastCueAtMs = Date.now();
  if (cue.haptic) triggerHapticPulse(cue.haptic);

  try {
    await speakAssistantText(cue.text);
  } catch (err) {
    console.warn('[stationCountdown] speak failed:', err);
  }
}
