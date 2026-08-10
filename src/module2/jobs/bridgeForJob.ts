/**
 * Legacy Job-Bridge — DEAKTIVIERT (Manager-Bridge SSOT).
 * Phrase-Pools bleiben nur für Tests/Debug über bridgeLineForJob.
 */

import type { JobClassification, FindusJobId } from './types';

function pick(pool: string[], seed: string): string {
  if (!pool.length) return '';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length]!;
}

const POOLS: Partial<Record<FindusJobId, string[]>> = {
  tonight_live: ['Kurz zu den Kinos.', 'Einen Moment zum Programm.'],
  dining_open: ['Kurz zu den Optionen.', 'Ich check die Nähe.'],
  poi_identify: ['Kurz zu dem Ort.', 'Einen Moment.'],
};

export function bridgeLineForJob(
  classification: JobClassification,
  userText: string,
): string {
  const pool =
    POOLS[classification.jobId] ??
    ['Alles klar.'];
  return pick(pool, `${classification.jobId}|${userText}`);
}

/** No-op — Concierge-Manager owns the only spoken bridge. */
export function speakJobBridgeFireAndForget(
  _classification: JobClassification,
  _userText: string,
): string | null {
  return null;
}
