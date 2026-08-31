/**
 * Async Vapi / Bland Booking — Fire & Forget.
 * User darf App schließen; Follow-up wenn Webhook/Ergebnis kommt.
 */

import type { Poi } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import type {
  ReservationExecuteResult,
  ReservationRequestDetails,
} from '../../types/reservation';
import {
  buildPoiReservationInfo,
  executeReservation,
} from './reservationService';

export type AsyncAiCallJob = {
  id: string;
  poiName: string;
  startedAt: number;
  status: 'running' | 'done' | 'failed';
  result?: ReservationExecuteResult;
};

const jobs = new Map<string, AsyncAiCallJob>();

export function getAsyncAiCallJobs(): AsyncAiCallJob[] {
  return [...jobs.values()];
}

/**
 * Startet KI-Anruf im Hintergrund. Gibt sofort Speech zurück.
 */
export function startAsyncAiCallReservation(opts: {
  poi: Poi;
  details: ReservationRequestDetails;
  profile: UserProfile;
  factTexts?: string[];
  onFollowUp?: (speech: string) => void | Promise<void>;
}): { jobId: string; immediateSpeech: string } {
  const info = buildPoiReservationInfo(opts.poi, opts.factTexts ?? []);
  const id = `vapi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const job: AsyncAiCallJob = {
    id,
    poiName: info.name,
    startedAt: Date.now(),
    status: 'running',
  };
  jobs.set(id, job);

  const immediateSpeech = `Alles klar, ich rufe jetzt bei ${info.name} an. Du kannst die App zumachen oder mich etwas anderes fragen — ich melde mich, sobald der Tisch bestätigt wurde.`;

  void (async () => {
    try {
      const result = await executeReservation('AI_CALL', info, opts.details, opts.profile);
      job.result = result;
      job.status = result.ok ? 'done' : 'failed';
      const follow =
        result.message ||
        (result.ok
          ? `Update zu ${info.name}: Anruf erledigt.`
          : `Update zu ${info.name}: Anruf hat nicht geklappt.`);
      if (opts.onFollowUp) await opts.onFollowUp(follow);
    } catch (err) {
      job.status = 'failed';
      if (__DEV__) console.warn('[asyncVapi]', err);
      if (opts.onFollowUp) {
        await opts.onFollowUp(
          `Update: Der Anruf bei ${info.name} ist fehlgeschlagen. Nummer zum Anrufen ist dabei.`,
        );
      }
    } finally {
      // Keep job briefly for debug, then drop
      setTimeout(() => jobs.delete(id), 60_000);
    }
  })();

  return { jobId: id, immediateSpeech };
}
