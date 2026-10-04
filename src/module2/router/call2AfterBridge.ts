/**
 * Call-2 Soft-Deadline nach Bridge — Autonomy Reboot.
 * Hard-Cap: spätestens BRIDGE_TO_CALL2_GAP_MAX_MS nach Bridge-Ende.
 */

import { BRIDGE_TO_CALL2_GAP_MAX_MS } from '../reboot/pipeline/bridgePace';

export { BRIDGE_TO_CALL2_GAP_MAX_MS };

/**
 * Wann Call-2 Speech spätestens starten darf (Epoch ms).
 * bridgeEndedAtMs = Zeitpunkt Bridge-TTS fertig / freigegeben.
 */
export function call2SpeechDeadlineMs(bridgeEndedAtMs: number): number {
  return bridgeEndedAtMs + BRIDGE_TO_CALL2_GAP_MAX_MS;
}

/** true wenn wir die Hard-Cap schon überschritten haben → Call-2 sofort feuern. */
export function shouldForceCall2SpeechNow(
  bridgeEndedAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (bridgeEndedAtMs == null || !Number.isFinite(bridgeEndedAtMs)) return false;
  return nowMs >= call2SpeechDeadlineMs(bridgeEndedAtMs);
}

/**
 * Warte höchstens bis Hard-Cap, dann resolve — für „Call-2 ready oder Timeout“.
 * Wenn readyPromise früher resolved, sofort weiter (Call-3 vermeidbar).
 */
export async function raceCall2ReadyOrGapCap<T>(opts: {
  ready: Promise<T>;
  bridgeEndedAtMs: number;
  nowMs?: number;
}): Promise<{ value: T | null; forcedByGapCap: boolean }> {
  const now = opts.nowMs ?? Date.now();
  const remain = Math.max(0, call2SpeechDeadlineMs(opts.bridgeEndedAtMs) - now);
  let forced = false;
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      forced = true;
      resolve(null);
    }, remain);
  });
  const value = await Promise.race([opts.ready.then((v) => v), timeout]);
  return { value, forcedByGapCap: forced && value == null };
}
