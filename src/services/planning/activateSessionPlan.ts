/**
 * Activate a Gemini-parsed compound session plan:
 * shopping tasks + relevance boosts + leave-by clock.
 */

import { haversineMeters } from '../../db/database';
import type {
  CompoundPlanParseResult,
  SessionPlan,
  SessionPlanStop,
} from '../../runtime/sessionPlanTypes';
import { setRuntimeModule } from '../../runtime/orchestrator';
import type { ShoppingPlaceCategory } from '../../store/useShoppingTaskStore';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFinnusStore } from '../../store/useFinnusStore';

const WALK_SPEED_MS = 1.25;
const MIN_LEG_MS = 3 * 60_000;
const MAX_LEG_MS = 45 * 60_000;

/** Map free-form Gemini place types → shopping search categories (no product names). */
export function normalizePlaceTypes(
  raw: string[],
): ShoppingPlaceCategory[] {
  const out = new Set<ShoppingPlaceCategory>();
  for (const t of raw) {
    const n = t.toLowerCase().replace(/[\s-]+/g, '_');
    if (!n) continue;
    if (
      n.includes('pharm') ||
      n.includes('apothek') ||
      n === 'chemist'
    ) {
      out.add('pharmacy');
      continue;
    }
    if (
      n.includes('drug') ||
      n.includes('droger') ||
      n.includes('beauty') ||
      n.includes('personal_care')
    ) {
      out.add('drugstore');
      continue;
    }
    if (
      n.includes('convenience') ||
      n.includes('kiosk') ||
      n.includes('corner_shop') ||
      n.includes('spät') ||
      n.includes('spaet') ||
      n === 'shop'
    ) {
      out.add('convenience_store');
      continue;
    }
    if (
      n.includes('super') ||
      n.includes('grocery') ||
      n.includes('market') ||
      n.includes('retail') ||
      n.includes('store')
    ) {
      out.add('supermarket');
      continue;
    }
  }
  if (out.size === 0) {
    out.add('supermarket');
    out.add('convenience_store');
  }
  return [...out];
}

function parseLocalHmToMs(hm: string, now: Date): number | null {
  const m = hm.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  // If time already passed today by > 2h, assume tomorrow
  if (d.getTime() < now.getTime() - 2 * 60 * 60_000) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function estimateLegMs(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
): number {
  if (!from || !to) return 12 * 60_000;
  const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  const ms = (dist / WALK_SPEED_MS) * 1000;
  return Math.max(MIN_LEG_MS, Math.min(MAX_LEG_MS, ms));
}

function hotelCoords(): { lat: number; lng: number } | null {
  const mem = useUserMemoryStore.getState();
  const hotel =
    mem.getConfirmedHotel() ??
    mem.getHotelCandidate() ??
    mem.entities.find((e) => e.type === 'hotel');
  if (
    hotel &&
    typeof hotel.lat === 'number' &&
    typeof hotel.lng === 'number' &&
    Number.isFinite(hotel.lat) &&
    Number.isFinite(hotel.lng)
  ) {
    return { lat: hotel.lat, lng: hotel.lng };
  }
  return null;
}

/**
 * Compute leave-by: arriveBy − buffer − sum of remaining walk legs
 * (here → dynamic → hotel → fixed).
 */
export function computeLeaveByMs(
  plan: Pick<SessionPlan, 'stops' | 'bufferMinutes'>,
  _nowMs: number,
  origin: { lat: number; lng: number } | null,
  externalTravelMs = 0,
): number | null {
  const fixed = plan.stops.find(
    (s) => s.kind === 'fixed' && s.arriveByMs != null && !s.done,
  );
  if (!fixed?.arriveByMs) return null;

  const dynamic = plan.stops.find((s) => s.kind === 'dynamic' && !s.done);
  const hotel = plan.stops.find((s) => s.kind === 'hotel' && !s.done);

  let cursor = origin;
  let travelMs = externalTravelMs; // Include multimodal travel times (e.g., flight + train)

  if (dynamic) {
    travelMs += 10 * 60_000;
  }
  if (hotel) {
    const hc = hotelCoords();
    travelMs += estimateLegMs(cursor, hc);
    cursor = hc ?? cursor;
  }
  if (fixed.lat != null && fixed.lng != null && cursor) {
    travelMs += estimateLegMs(cursor, {
      lat: fixed.lat,
      lng: fixed.lng,
    });
  } else {
    travelMs += 15 * 60_000;
  }

  const bufferMs = plan.bufferMinutes * 60_000;
  return fixed.arriveByMs - bufferMs - travelMs;
}

function generateTimeResolverActions(leaveByMs: number, nowMs: number): any[] {
  const diff = leaveByMs - nowMs;
  if (diff < 0) {
    return [
      {
        type: 'SHOW_MORE',
        label: 'Fähre als Alternative prüfen',
        payload: { textPrompt: 'Fähre als Alternative prüfen' }
      },
      {
        type: 'OPEN_URL',
        label: 'Zusätzliche Hotelnacht buchen (ab 89 €)',
        payload: { url: 'https://www.stay22.com/' }
      }
    ];
  }
  return [];
}

export function activateCompoundSessionPlan(
  parsed: CompoundPlanParseResult,
  opts?: { now?: Date; userText?: string },
): { plan: SessionPlan; reply: string; actions: any[] } | null {
  // Legacy SessionPlan für Tages-Multi-Stops ist retired — Modul 5 ist SSOT.
  try {
    const { shouldBlockLegacyCompoundPlan } = require('../../module2/planning/planHandoffGuard') as {
      shouldBlockLegacyCompoundPlan: (t: string) => boolean;
    };
    if (opts?.userText && shouldBlockLegacyCompoundPlan(opts.userText)) {
      console.warn(
        '[planning] legacy compound blocked — Modul 5 owns day plans',
      );
      return null;
    }
  } catch {
    /* soft */
  }
  const timedFixed = parsed.stops.filter(
    (s) =>
      (s.kind === 'fixed' || s.kind === 'hotel') &&
      Boolean(s.arriveByLocal),
  );
  if (timedFixed.length >= 2 || (parsed.stops.length >= 3 && !parsed.freeRoam)) {
    console.warn(
      '[planning] legacy compound blocked (multi timed stops) — use Modul 5',
    );
    return null;
  }

  if (!parsed.isCompound || parsed.stops.length < 2) return null;

  const now = opts?.now ?? new Date();
  const nowMs = now.getTime();
  const store = useFinnusStore.getState();
  const origin =
    store.lastGpsLat != null && store.lastGpsLng != null
      ? { lat: store.lastGpsLat, lng: store.lastGpsLng }
      : null;

  const stops: SessionPlanStop[] = parsed.stops.map((s) => {
    const arriveByMs = s.arriveByLocal
      ? parseLocalHmToMs(s.arriveByLocal, now)
      : null;
    const placeTypes = normalizePlaceTypes(s.placeTypes);
    let label = s.label;
    if (s.kind === 'hotel') {
      const h = hotelCoords();
      const mem = useUserMemoryStore.getState();
      const ent =
        mem.getConfirmedHotel() ??
        mem.getHotelCandidate() ??
        mem.entities.find((e) => e.type === 'hotel');
      if (ent?.name) label = ent.name;
      return {
        id: uid('stop'),
        kind: s.kind,
        label,
        arriveByMs,
        lat: h?.lat ?? null,
        lng: h?.lng ?? null,
        placeTypes: [],
        items: s.items,
        done: false,
      };
    }
    return {
      id: uid('stop'),
      kind: s.kind,
      label,
      arriveByMs,
      lat: null,
      lng: null,
      placeTypes: s.kind === 'dynamic' ? placeTypes : [],
      items: s.items,
      done: false,
    };
  });

  const boostPlaceTypes = [
    ...new Set(
      stops
        .filter((s) => s.kind === 'dynamic')
        .flatMap((s) => s.placeTypes),
    ),
  ];

  const draft: SessionPlan = {
    id: uid('plan'),
    createdAtMs: nowMs,
    freeRoam: parsed.freeRoam,
    leaveByMs: null,
    bufferMinutes: parsed.bufferMinutes,
    boostPlaceTypes,
    stops,
    confirmSpeech: parsed.confirmSpeech,
    active: true,
    deadlineFired: false,
  };
  draft.leaveByMs = computeLeaveByMs(draft, nowMs, origin);

  // Persist shopping items as open tasks (feeds tickShoppingReminders)
  const dueAt =
    draft.stops.find((s) => s.arriveByMs != null)?.arriveByMs ?? null;
  for (const stop of draft.stops) {
    if (stop.kind !== 'dynamic') continue;
    const items = stop.items.length ? stop.items : [stop.label];
    for (const item of items) {
      const types: ShoppingPlaceCategory[] = stop.placeTypes.length
        ? (stop.placeTypes as ShoppingPlaceCategory[])
        : normalizePlaceTypes(['supermarket', 'convenience_store']);
      useShoppingTaskStore.getState().addTask({
        itemLabel: item,
        placeTypes: types,
        anchor: 'store',
        dueAtMs: dueAt,
      });
    }
  }

  useSessionPlanStore.getState().setPlan(draft);
  if (draft.freeRoam) {
    setRuntimeModule('explore');
  }

  let finalReply = draft.confirmSpeech;
  let actions: any[] = [];
  
  if (draft.leaveByMs) {
     const leaveDate = new Date(draft.leaveByMs);
     const timeStr = `${leaveDate.getHours().toString().padStart(2, '0')}:${leaveDate.getMinutes().toString().padStart(2, '0')}`;
     
     if (draft.leaveByMs < nowMs) {
        finalReply = `Achtung: Um pünktlich anzukommen, hättest du schon um ${timeStr} Uhr losmüssen! Der Zeitplan ist zu eng.`;
        actions = generateTimeResolverActions(draft.leaveByMs, nowMs);
     } else {
        finalReply = `${draft.confirmSpeech} Um alles zu schaffen, solltest du spätestens um ${timeStr} Uhr aufbrechen.`;
     }
  }

  return { plan: draft, reply: finalReply, actions };
}
