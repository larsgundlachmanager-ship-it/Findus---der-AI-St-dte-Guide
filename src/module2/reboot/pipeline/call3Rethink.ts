/**
 * Call-3 = genau EIN „neu denken“-Nachzieh nach Completeness/Tail.
 *
 * Ablauf (SSOT):
 *   Call 1 Auftrag → Backend → Call 2 Speech
 *   → Completeness / Call-2-Tail: fehlt Must-Fakt oder Deep-Link?
 *   → max 1× Call 3 (Deep-Fill) → UI patchen, Speech nur wenn idle
 *   → STOP (kein zweiter Loop, kein paralleles Auto-Deep-Fill dieselbe Lücke)
 *
 * Call 3 erfindet keine neue Absicht — nur Lücken aus dem bestehenden Job schließen.
 */

import type { Call2TailV1 } from './call2Tail';
import type { CompletenessReport } from '../../jobs/types';

export const FINDUS_CALL3_RETHINK_ONCE = `
=== CALL-3 RETHINK (max 1×) ===
Nach Call 2: wenn Pflicht-Fakt/Button fehlt → einmal Deep-Fill.
Kein zweites Rethinking, kein zweites Auto-Deep-Fill dieselbe Lücke.
Keine neue Lane, keine erfundenen Orte.
UI zuerst; Extra-Speech nur wenn der User gerade nicht zuhört.
`.trim();

const CALL3_REASONS = new Set([
  'menu_prices',
  'speisekarte_url',
  'live_taxi_fare',
  'booking_deeplink',
  'hotel_live_price',
  'event_program_detail',
  'missing_must_fact',
  'missing_must_action',
  'completeness_gap',
]);

export function shouldRunCall3Rethink(tail: Call2TailV1 | null): boolean {
  if (!tail?.followUp?.needed) return false;
  if (tail.followUp.delegateTo === 'call3') return true;
  if (tail.followUp.delegateTo === 'none') return false;
  const reason = String(tail.followUp.reason || '');
  return CALL3_REASONS.has(reason);
}

/**
 * Completeness-Must-Lücken → Tail für genau einen Call-3-Lauf,
 * falls Call 2 noch keinen followUp gesetzt hat.
 */
export function resolveRethinkTail(opts: {
  existing: Call2TailV1 | null;
  completeness: CompletenessReport | null | undefined;
}): Call2TailV1 | null {
  const existing = opts.existing;
  if (shouldRunCall3Rethink(existing)) return existing;

  const report = opts.completeness;
  if (!report?.missing?.length) return existing;

  const must = report.missing.filter((m) => m.severity === 'must');
  const pending = report.pendingActionHints?.length ?? 0;
  if (!must.length && !pending) return existing;

  const reason =
    must[0]?.lane === 'slow'
      ? 'completeness_gap'
      : pending > 0
        ? 'missing_must_action'
        : 'missing_must_fact';

  const seed = [
    ...must.slice(0, 3).map((m) => m.key || m.note),
    ...(report.pendingActionHints ?? []).slice(0, 2),
  ]
    .filter(Boolean)
    .join(', ');

  return {
    bullets: existing?.bullets ?? [],
    memory_extract: existing?.memory_extract,
    shortAnswers: existing?.shortAnswers,
    uiHints: existing?.uiHints,
    background_tasks: existing?.background_tasks,
    followUp: {
      needed: true,
      reason,
      delegateTo: 'call3',
      promptSeed: seed || existing?.followUp?.promptSeed || null,
    },
  };
}

/**
 * Nach Call 3: kein zweites Auto-Deep-Fill für dieselbe Completeness-Lücke.
 * Silent-Slow allein nur wenn Call 3 nicht schon Deep-Fill gefahren hat.
 */
export function shouldQueueAutoDeepFill(opts: {
  call3DeepFillRan: boolean;
  skipAutoDeep: boolean;
  completenessForce: boolean;
  silentSlowPending: boolean;
}): boolean {
  if (opts.skipAutoDeep) return false;
  if (opts.call3DeepFillRan) return false;
  return opts.completenessForce || opts.silentSlowPending;
}
