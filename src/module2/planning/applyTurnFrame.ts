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

/** Nur Blick/Sunset — Kriterien am Abendessen, keine eigenen Wishes. */
function isViewSunsetOnlyMustHave(label: string): boolean {
  const t = label.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /\b(pann(?:en)?fisch|abendessen|mittagessen|restaurant|frühstück|fruehstueck|essen|michel|hotel|anreise)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return /\b(elbblick|elb\s*blick|sonnenuntergang|sunset|blick\s+auf\s+(die\s+)?elbe)\b/i.test(
    t,
  );
}

function findMealWishIndex(wishes: IngestOpenWish[]): number {
  return wishes.findIndex((w) =>
    /\b(restaurant|essen|dinner|mittag|abendessen|italiener|sushi|pizza|pann(?:en)?fisch|fisch)\b/i.test(
      `${w.title} ${w.context}`,
    ),
  );
}

function appendMustHaveNote(context: string, note: string): string {
  const n = note.replace(/\s+/g, ' ').trim();
  if (!n) return context;
  if (context.toLowerCase().includes(n.toLowerCase())) return context;
  return `${context} · ${n}`.replace(/\s+/g, ' ').trim().slice(0, 240);
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
  let wishes = [...next.openWishesQueue];
  const extra: IngestOpenWish[] = [];
  for (const mh of frame.mustHaves) {
    if (blobCovers({ ...next, openWishesQueue: wishes }, mh)) continue;
    if (isViewSunsetOnlyMustHave(mh)) {
      const mealIdx = findMealWishIndex(wishes);
      if (mealIdx >= 0) {
        wishes[mealIdx] = {
          ...wishes[mealIdx]!,
          context: appendMustHaveNote(wishes[mealIdx]!.context, mh),
        };
        continue;
      }
    }
    extra.push(wishFromMustHave(mh, dest));
  }
  next = {
    ...next,
    openWishesQueue: [...wishes, ...extra],
  };
  return next;
}
