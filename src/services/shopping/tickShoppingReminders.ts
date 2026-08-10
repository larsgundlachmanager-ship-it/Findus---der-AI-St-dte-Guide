/**
 * Soft GPS tick: open tasks → hotel / DM/Rossmann / time → Concierge.
 */

import { searchOpenPlacesAhead } from '../navigation/googleMapsNav';
import type { DiscoveredPlace } from '../navigation/googleMapsNav';
import { getDeviceHeadingDeg, getMovementBearingDeg } from '../navigation';
import { isAheadOfMovement } from '../navigation/spatialOrientation';
import { presentConciergeResponse } from '../concierge/presentConcierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { haversineMeters } from '../../db/database';
import {
  useShoppingTaskStore,
  type ShoppingTask,
  type ShoppingPlaceCategory,
} from '../../store/useShoppingTaskStore';
import type { QuickAction } from '../../types/concierge';

const PROMPT_RADIUS_M = 150;
const HOTEL_RADIUS_M = 95;
const SEARCH_RADIUS_M = 220;
const MIN_SEARCH_INTERVAL_MS = 18_000;
const GLOBAL_PROMPT_GAP_MS = 40_000;
const SAME_PLACE_COOLDOWN_MS = 2 * 3600_000;
const TASK_SAME_PLACE_GAP_MS = 25 * 60_000;
const TASK_FOLLOWUP_GAP_MS = 3 * 60_000;
const HOTEL_PROMPT_GAP_MS = 90 * 60_000;

let lastSearchAtMs = 0;
let lastPromptAtMs = 0;
let searching = false;

function shortStoreName(name: string): string {
  const n = name.trim();
  if (/^dm\b/i.test(n) || /\bdm[- ]?drogerie/i.test(n)) return 'DM';
  if (/rossmann/i.test(n)) return 'Rossmann';
  if (/müller|mueller/i.test(n)) return 'Müller';
  if (/budni/i.test(n)) return 'Budni';
  if (/douglas/i.test(n)) return 'Douglas';
  if (/rewe/i.test(n)) return 'REWE';
  if (/aldi/i.test(n)) return 'Aldi';
  if (/lidl/i.test(n)) return 'Lidl';
  if (/edeka/i.test(n)) return 'Edeka';
  if (/^hotel\b/i.test(n)) return n.length > 22 ? `${n.slice(0, 20)}…` : n;
  const parts = n.split(/\s+/).slice(0, 2).join(' ');
  return parts.length > 22 ? `${parts.slice(0, 20)}…` : parts;
}

function placeAlreadyPrompted(
  task: ShoppingTask,
  placeId: string,
  now: number,
): boolean {
  const hit = task.promptedPlaces.find((p) => p.placeId === placeId);
  if (!hit) return false;
  return now - hit.atMs < SAME_PLACE_COOLDOWN_MS;
}

function dependencyMet(task: ShoppingTask): boolean {
  const depId = task.dependsOnTaskId;
  if (!depId) return true;
  const dep = useShoppingTaskStore.getState().tasks.find((t) => t.id === depId);
  return dep?.status === 'done';
}

function pickBestPlace(
  places: DiscoveredPlace[],
  task: ShoppingTask,
  now: number,
  headingDeg: number | null,
  movementBearingDeg: number | null,
): DiscoveredPlace | null {
  const usable = places
    .filter((p) => p.distanceM <= PROMPT_RADIUS_M)
    .filter((p) => !placeAlreadyPrompted(task, p.placeId, now))
    .sort((a, b) => a.distanceM - b.distanceM);

  if (usable.length === 0) return null;

  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null) return usable[0] ?? null;

  const scored = usable.map((p) => {
    const targetBearing = compassBearing(lat, lng, p.lat, p.lng);
    const aheadOk = isAheadOfMovement(
      movementBearingDeg,
      headingDeg,
      targetBearing,
      130,
    );
    return { p, aheadOk, d: p.distanceM };
  });
  scored.sort((a, b) => {
    if (a.aheadOk !== b.aheadOk) return a.aheadOk ? -1 : 1;
    return a.d - b.d;
  });
  return scored[0]?.p ?? null;
}

function compassBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function walkMinFromMeters(m: number): number {
  // ~80 m/Min Fuß — strukturierter ETA-Hint, kein Skript
  return Math.max(1, Math.round(m / 80));
}

function buildSpeech(
  task: ShoppingTask,
  place: DiscoveredPlace,
): { speech: string; confirmStoreLabel: string } {
  const here = shortStoreName(place.name);
  const walkMin = walkMinFromMeters(place.distanceM);
  const prev = task.promptedPlaces
    .filter((p) => p.placeId !== place.placeId)
    .sort((a, b) => b.atMs - a.atMs)[0];

  if (prev) {
    const prevName = shortStoreName(prev.name);
    return {
      speech:
        `Hattest du die ${task.itemLabel} bei ${prevName} gekauft, ` +
        `oder willst du hier bei ${here} rein (~${walkMin} Min Fuß)?`,
      confirmStoreLabel: prevName,
    };
  }

  return {
    speech:
      `Hey, hier kannst du in ${walkMin} Minuten Fußweg direkt deine ${task.itemLabel} mitnehmen — ${here}.`,
    confirmStoreLabel: here,
  };
}

function buildActions(
  task: ShoppingTask,
  place: DiscoveredPlace,
  confirmStoreLabel: string,
): QuickAction[] {
  return [
    {
      type: 'START_NAVIGATION',
      label: 'Gehe jetzt hier rein',
      payload: {
        destName: place.name,
        destLat: place.lat,
        destLng: place.lng,
        taskId: task.id,
        placeId: place.placeId,
      },
    },
    {
      type: 'COMPLETE_SHOPPING_TASK',
      label: `Habe bei ${confirmStoreLabel} gekauft`,
      payload: {
        taskId: task.id,
        placeId: place.placeId,
        destName: confirmStoreLabel,
      },
    },
    {
      type: 'SNOOZE_SHOPPING_TASK',
      label: 'Wann anders kaufen',
      payload: {
        taskId: task.id,
      },
    },
  ];
}

async function searchForTypes(
  types: ShoppingPlaceCategory[],
  lat: number,
  lng: number,
): Promise<DiscoveredPlace[]> {
  const byId = new Map<string, DiscoveredPlace>();
  for (const placeType of types) {
    const hits = await searchOpenPlacesAhead({
      lat,
      lng,
      placeType,
      radiusM: SEARCH_RADIUS_M,
      openNow: true,
    });
    for (const h of hits) {
      const prev = byId.get(h.placeId);
      if (!prev || h.distanceM < prev.distanceM) byId.set(h.placeId, h);
    }
  }
  return [...byId.values()].sort((a, b) => a.distanceM - b.distanceM);
}

function resolveHotelWithCoords(): {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
} | null {
  const mem = useUserMemoryStore.getState();
  const hotel =
    mem.getConfirmedHotel() ??
    mem.getHotelCandidate() ??
    mem.entities.find((e) => e.type === 'hotel');
  if (!hotel) return null;
  if (
    typeof hotel.lat !== 'number' ||
    typeof hotel.lng !== 'number' ||
    !Number.isFinite(hotel.lat) ||
    !Number.isFinite(hotel.lng)
  ) {
    return null;
  }
  return {
    placeId: `hotel:${hotel.id}`,
    name: hotel.name || 'Hotel',
    lat: hotel.lat,
    lng: hotel.lng,
  };
}

async function maybePromptHotelTask(
  task: ShoppingTask,
  lat: number,
  lng: number,
  now: number,
): Promise<boolean> {
  if ((task.anchor ?? 'store') !== 'hotel') return false;
  if (!dependencyMet(task)) return false;

  const hotel = resolveHotelWithCoords();
  if (!hotel) return false;

  const dist = haversineMeters(lat, lng, hotel.lat, hotel.lng);
  if (dist > HOTEL_RADIUS_M) return false;
  if (placeAlreadyPrompted(task, hotel.placeId, now)) return false;

  const sincePrompt = now - (task.lastPromptAtMs || 0);
  if (task.lastPromptAtMs > 0 && sincePrompt < HOTEL_PROMPT_GAP_MS) {
    return false;
  }

  const hotelShort = shortStoreName(hotel.name);
  const speech =
    `Du bist wieder ${hotelShort.toLowerCase().startsWith('hotel') ? `im ${hotelShort}` : `im Hotel (${hotelShort})`} — ` +
    `wolltest du nicht noch ${task.itemLabel}?`;

  useShoppingTaskStore.getState().notePrompted(task.id, {
    placeId: hotel.placeId,
    name: hotel.name,
  });
  lastPromptAtMs = Date.now();

  await presentConciergeResponse({
    speechText: speech,
    cardTitle: `Hotel · ${task.itemLabel}`,
    visualBullets: [
      `${task.itemLabel} — noch offen`,
      `${hotelShort} · ca. ${Math.round(dist / 10) * 10} m`,
    ],
    quickActions: [
      {
        type: 'COMPLETE_SHOPPING_TASK',
        label: 'Erledigt',
        payload: { taskId: task.id, placeId: hotel.placeId },
      },
      {
        type: 'SNOOZE_SHOPPING_TASK',
        label: 'Später erinnern',
        payload: { taskId: task.id },
      },
    ],
  });

  if (__DEV__) {
    console.log(
      `[shopping] hotel prompt „${task.itemLabel}“ @ ${hotel.name} (${Math.round(dist)}m)`,
    );
  }
  return true;
}

/**
 * Call from handleLocationUpdate when narration is free and no city-pack geofence fired.
 */
export async function tickShoppingReminders(
  lat: number,
  lng: number,
): Promise<boolean> {
  const now = Date.now();
  if (searching) return false;
  if (now - lastSearchAtMs < MIN_SEARCH_INTERVAL_MS) return false;
  if (now - lastPromptAtMs < GLOBAL_PROMPT_GAP_MS) return false;

  const open = useShoppingTaskStore
    .getState()
    .getOpenTasks()
    .filter(dependencyMet);
  if (open.length === 0) return false;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating || store.activeConciergeCard) {
    return false;
  }

  searching = true;
  lastSearchAtMs = now;
  try {
    const headingDeg = getDeviceHeadingDeg();
    const movementBearingDeg = getMovementBearingDeg();
    const ordered = [...open].sort((a, b) => a.createdAtMs - b.createdAtMs);

    // Hotel-anchor first (cheap haversine, no Overpass)
    for (const task of ordered) {
      if (await maybePromptHotelTask(task, lat, lng, now)) return true;
    }

    for (const task of ordered) {
      if ((task.anchor ?? 'store') === 'hotel') continue;
      if (!task.placeTypes.length) continue;

      const sincePrompt = now - (task.lastPromptAtMs || 0);
      const places = await searchForTypes(task.placeTypes, lat, lng);
      const place = pickBestPlace(
        places,
        task,
        now,
        headingDeg,
        movementBearingDeg,
      );
      if (!place) continue;

      const isFollowUp = task.promptedPlaces.some(
        (p) => p.placeId !== place.placeId,
      );
      const minGap = isFollowUp ? TASK_FOLLOWUP_GAP_MS : TASK_SAME_PLACE_GAP_MS;
      if (task.lastPromptAtMs > 0 && sincePrompt < minGap) continue;

      const { speech, confirmStoreLabel } = buildSpeech(task, place);
      const actions = buildActions(task, place, confirmStoreLabel);

      useShoppingTaskStore.getState().notePrompted(task.id, {
        placeId: place.placeId,
        name: place.name,
      });
      useFinnusStore.getState().setPendingNavOffer({
        poiId: -1,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
      });

      lastPromptAtMs = Date.now();
      await presentConciergeResponse({
        speechText: speech,
        cardTitle: `Einkaufen · ${task.itemLabel}`,
        visualBullets: [
          `${task.itemLabel} — noch offen`,
          `${shortStoreName(place.name)} · ca. ${Math.round(place.distanceM / 10) * 10} m`,
        ],
        quickActions: actions,
      });
      if (__DEV__) {
        console.log(
          `[shopping] prompt „${task.itemLabel}“ @ ${place.name} (${Math.round(place.distanceM)}m)`,
        );
      }
      return true;
    }

    // Time-managed soft nudge
    for (const task of ordered) {
      if (task.dueAtMs == null || task.dueAtMs > now) continue;
      if (task.lastPromptAtMs > 0 && now - task.lastPromptAtMs < 6 * 3600_000) {
        continue;
      }
      useShoppingTaskStore.getState().touchLastPrompt(task.id);
      lastPromptAtMs = Date.now();
      const placeHint =
        (task.anchor ?? 'store') === 'hotel'
          ? 'oder ich melde mich, sobald du wieder im Hotel bist.'
          : 'oder ich melde mich beim nächsten passenden Laden.';
      await presentConciergeResponse({
        speechText:
          `Kurzer Reminder: ${task.itemLabel} steht noch auf der Liste. ` +
          `Sag Bescheid, wenn du’s erledigt hast — ${placeHint}`,
        cardTitle: `Erinnerung · ${task.itemLabel}`,
        visualBullets: [`${task.itemLabel} — noch offen`],
        quickActions: [
          {
            type: 'COMPLETE_SHOPPING_TASK',
            label:
              (task.anchor ?? 'store') === 'hotel'
                ? 'Erledigt'
                : 'Habe gekauft',
            payload: { taskId: task.id },
          },
          {
            type: 'SNOOZE_SHOPPING_TASK',
            label: 'Später erinnern',
            payload: { taskId: task.id },
          },
        ],
      });
      return true;
    }
    return false;
  } catch (err) {
    if (__DEV__) console.warn('[shopping] tick failed:', err);
    return false;
  } finally {
    searching = false;
  }
}
