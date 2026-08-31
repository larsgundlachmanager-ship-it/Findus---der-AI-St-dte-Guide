/**
 * Call-1-Frame in den Plan schreiben — Zielstadt/Must-Haves nicht nochmal erfinden.
 */

import type { TurnFrame } from '../router/turnFrame';
import { patchPlanForDestinationCity } from './planDestinationCity';
import { mergeUtteranceSlotsIntoPlan } from './planUtteranceSlots';
import type { IngestedPlan, IngestOpenWish } from './planningTypes';

function stamp(title: string, city: string | null): string {
  if (!city) return title.slice(0, 48);
  if (new RegExp(`\\b${city}\\b`, 'i').test(title)) return title.slice(0, 48);
  return `${title} (${city})`.slice(0, 48);
}

function wishFromMustHave(
  label: string,
  destCity: string | null,
): IngestOpenWish {
  const meal = /\b(pannfisch|essen|restaurant|fisch|frühstück|fruehstueck)\b/i.test(
    label,
  );
  return {
    title: stamp(label, destCity),
    priority: meal ? 5 : 6,
    context: destCity ? `${label} in ${destCity}` : label,
    completeness: 2,
  };
}

function blobCovers(plan: IngestedPlan, needle: string): boolean {
  const blob = [
    ...plan.openWishesQueue.map((w) => `${w.title} ${w.context}`),
    ...plan.fixedNodes.map((n) => `${n.title} ${n.location ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();
  const n = needle.toLowerCase();
  return n.length >= 3 && blob.includes(n);
}

/**
 * Frame ist Gesetz: destinationCity, Must-Haves, Anreise-Hinweis.
 * Ingest darf Zeiten legen, nicht die Zielstadt überschreiben.
 */
export function applyTurnFrameToPlan(
  plan: IngestedPlan,
  frame: TurnFrame | null | undefined,
  utterance: string,
  gpsCity?: string | null,
): IngestedPlan {
  if (!frame) {
    return patchPlanForDestinationCity(plan, utterance, gpsCity);
  }
  const dest = frame.destCity || plan.destinationCity || null;
  let next: IngestedPlan = {
    ...plan,
    destinationCity: dest,
  };
  next = mergeUtteranceSlotsIntoPlan(next, utterance);
  next = patchPlanForDestinationCity(next, utterance, gpsCity);
  if (dest) {
    next = { ...next, destinationCity: dest };
  }
  const extra: IngestOpenWish[] = [];
  for (const mh of frame.mustHaves) {
    if (!blobCovers(next, mh)) extra.push(wishFromMustHave(mh, dest));
  }
  if (extra.length) {
    next = {
      ...next,
      openWishesQueue: [...next.openWishesQueue, ...extra],
    };
  }
  return next;
}
