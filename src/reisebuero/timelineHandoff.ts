/**
 * Gewählte Reise-Option → FuturePlan / Timeline (Multi-Day 1:1).
 */

import type { ReiseOption } from './types';
import { useFuturePlanStore } from '../module2/timeline/futurePlanState';
import { useReisebueroStore } from './store';
import {
  buildTimelineDayBuckets,
  buildTimelineStopsFromOption,
} from './timelineStopsFromOption';

export { buildTimelineStopsFromOption, buildTimelineDayBuckets } from './timelineStopsFromOption';

export function pushOptionToTimeline(opt: ReiseOption): {
  dayKey: string;
  count: number;
  days: number;
} {
  const { trip, markTimelinePushed } = useReisebueroStore.getState();
  const buckets = buildTimelineDayBuckets(opt, trip.ledger);
  const store = useFuturePlanStore.getState();

  const stay =
    opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0] || null;
  const hotelBase =
    stay || opt.lat != null
      ? {
          label: stay?.name || opt.stayName || opt.placeName || 'Unterkunft',
          kind: 'hotel' as const,
          lat: stay?.lat ?? opt.lat,
          lng: stay?.lng ?? opt.lng,
        }
      : null;

  let count = 0;
  let firstDay: string | null = null;
  for (const bucket of buckets) {
    if (!firstDay) firstDay = bucket.dayKey;
    store.ensureDay(bucket.dayKey);
    if (hotelBase && (stay || opt.lat != null)) {
      try {
        store.setDayBase(bucket.dayKey, hotelBase);
      } catch {
        /* soft */
      }
    }
    for (const stop of bucket.stops) {
      store.upsertStopOnDay(bucket.dayKey, stop);
      count += 1;
    }
  }

  // Fokus auf ersten Reisetag
  if (firstDay) {
    const focused = store.getPlanForDay(firstDay);
    store.setPlan(focused);
  }

  markTimelinePushed(opt.id);
  return {
    dayKey: firstDay || trip.ledger.dateStart?.value || new Date().toISOString().slice(0, 10),
    count,
    days: buckets.length,
  };
}
