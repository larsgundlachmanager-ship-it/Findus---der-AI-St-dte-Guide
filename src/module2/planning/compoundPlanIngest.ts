/**
 * Compound-Tagesplan → Kalender-Skelett (Runtime: Session + Timeline).
 */

export {
  shouldIngestCompoundPlan,
  buildCompoundPlanFromUtterance,
} from './compoundPlanIngestCore';
import { buildCompoundPlanFromUtterance } from './compoundPlanIngestCore';
import { applyMasterTimeline } from './planSessionOrchestrator';
import {
  isPlanningModuleActive,
  tagPlanSessionCity,
  usePlanSessionStore,
} from './planSessionState';
import { revealPlanCalendarNow } from '../timeline/planCalendarUiStore';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import { foldCityKey } from '../../services/navigation/landmarkAliases';
import { derivePlanTasks } from './derivePlanTasks';
import {
  applyCompoundFactHintsToWishes,
  hintFromFactSource,
  hintsFromMergedDraft,
  type CompoundFactHint,
} from './compoundPlanEnrichCore';
import type { AgentResult } from '../../types';
import type { TurnFrame } from '../router/turnFrame';
import type { IngestedPlan } from './planningTypes';

export type CompoundEnrichTaskResult = {
  draftText?: string;
  bullets?: string[];
  meta?: Record<string, unknown> | null;
  buttons?: Array<{ payload?: unknown }>;
  task?: { id?: string; lane?: string; brief?: string };
  status?: string;
};

/**
 * Schreibt Compound-Skelett in Session + Future-Plan-Timeline (Kalender optional).
 */
export async function ingestCompoundDayPlan(opts: {
  userText: string;
  frame?: TurnFrame | null;
  dayKeyHint?: string | null;
  skipIfRichSession?: boolean;
  /** Default false — Kalender erst per 📅 Tagesplan öffnen, nicht während Speech. */
  openCalendar?: boolean;
}): Promise<IngestedPlan | null> {
  let lat: number | undefined;
  let lng: number | undefined;
  let gpsCity: string | null | undefined = opts.frame?.destCity ?? null;
  try {
    const bag = readRucksackSync();
    const gps = anchorCoords(bag);
    lat = gps.lat;
    lng = gps.lng;
    gpsCity = bag.cityHint ?? gpsCity ?? null;
  } catch {
    lat = 0;
    lng = 0;
  }

  const plan = buildCompoundPlanFromUtterance({
    userText: opts.userText,
    frame: opts.frame,
    dayKeyHint: opts.dayKeyHint,
    gpsCity,
    lat,
    lng,
  });
  if (!plan || plan.openWishesQueue.length === 0) return null;

  if (opts.skipIfRichSession !== false && isPlanningModuleActive()) {
    const sess = usePlanSessionStore.getState();
    const existing = sess.plan?.openWishesQueue?.length ?? 0;
    if (existing >= plan.openWishesQueue.length) {
      return sess.plan;
    }
  }

  // ÖPNV-Spike: GPS → Zielstadt, Puffer, auf volle Stunde → Frühstück verschieben
  let seeded = plan;
  try {
    const dest = (plan.destinationCity || '').trim();
    if (
      dest &&
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      const { spikeTransitMinutesToCity, arrivalHmAfterTravel } = await import(
        './planTravelEtaSpike'
      );
      const { isTravelToDestWish, isBreakfastWish } = await import(
        './planDestinationCity'
      );
      const spike = await spikeTransitMinutesToCity({
        destCity: dest,
        lat,
        lng,
      });
      const wishes = plan.openWishesQueue.map((w) => {
        if (isTravelToDestWish(w)) {
          return {
            ...w,
            context: `${w.context} | ÖPNV ≈${spike.rawMin} Min (Puffer ${spike.bufferedMin} Min, ${spike.source})`.slice(
              0,
              400,
            ),
          };
        }
        if (isBreakfastWish(w) && w.estimatedTime) {
          const travel = plan.openWishesQueue.find((x) => isTravelToDestWish(x));
          const dep = travel?.estimatedTime;
          if (dep) {
            return {
              ...w,
              estimatedTime: arrivalHmAfterTravel(dep, spike.bufferedMin),
              context: `${w.context} | Ankunft nach ~${spike.bufferedMin} Min ÖPNV`.slice(
                0,
                400,
              ),
            };
          }
        }
        return w;
      });
      seeded = {
        ...plan,
        openWishesQueue: wishes,
        tasks: derivePlanTasks({ ...plan, openWishesQueue: wishes }),
      };
    }
  } catch {
    seeded = plan;
  }

  const store = usePlanSessionStore.getState();
  store.setActive(true);
  store.setPhase('list_build');
  store.setPlan(seeded);
  store.setTaskQueue(seeded.tasks);
  tagPlanSessionCity({
    cityKey: seeded.destinationCity ? foldCityKey(seeded.destinationCity) : null,
    cityHint: seeded.destinationCity,
  });

  applyMasterTimeline(seeded);
  if (opts.openCalendar) {
    await revealPlanCalendarNow(seeded.targetDate);
  }

  return seeded;
}

/** Patched Plan-Wünsche aus Fanout-Fakten (Koords/Name/Preis/Höhe). */
export function enrichCompoundPlanFromFacts(opts: {
  fact?: AgentResult | null;
  /** Alle Fanout-Task-Results (bevorzugt — Multi-Hint). */
  taskResults?: CompoundEnrichTaskResult[] | null;
  userText: string;
}): boolean {
  if (!isPlanningModuleActive()) return false;

  const store = usePlanSessionStore.getState();
  const plan = store.plan;
  if (!plan?.openWishesQueue?.length) return false;

  const hints: CompoundFactHint[] = [];
  const seen = new Set<string>();
  const pushHint = (h: CompoundFactHint | null) => {
    if (!h) return;
    const key = `${h.placeName}|${h.lat}|${h.lng}|${h.note}|${h.lane}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(h);
  };

  for (const r of opts.taskResults ?? []) {
    if (r.status && r.status !== 'ok') continue;
    pushHint(
      hintFromFactSource({
        draftText: r.draftText,
        bullets: r.bullets,
        meta: r.meta ?? null,
        buttons: r.buttons,
        lane: r.task?.lane ?? null,
        jobHint: r.task?.id ?? null,
        taskId: r.task?.id ?? null,
      }),
    );
  }

  if (opts.fact) {
    for (const h of hintsFromMergedDraft(
      String(opts.fact.draftText || ''),
      opts.fact.meta ?? null,
    )) {
      pushHint(h);
    }
    pushHint(
      hintFromFactSource({
        draftText: opts.fact.draftText,
        bullets: opts.fact.bullets,
        meta: opts.fact.meta ?? null,
        buttons: opts.fact.buttons,
      }),
    );
  }

  if (!hints.length) return false;

  const { wishes, changed } = applyCompoundFactHintsToWishes(
    plan.openWishesQueue,
    hints,
    opts.userText,
  );
  if (!changed) return false;

  const nextPlan: IngestedPlan = {
    ...plan,
    openWishesQueue: wishes,
    tasks: derivePlanTasks({ ...plan, openWishesQueue: wishes }),
  };
  store.setPlan(nextPlan);
  store.setTaskQueue(nextPlan.tasks);
  applyMasterTimeline(nextPlan);
  return true;
}
