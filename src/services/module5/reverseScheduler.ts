/**
 * Modul 5 — Rückwärtsrechnung von harten Deadlines (Zug/Flug/Reservation).
 */

import { haversineMeters } from '../../db/database';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { getCachedUserProfile } from '../userProfileService';
import type { DayPlanItem } from '../../types/dayPlan';
import { clockLabel, todayDateKey, uid } from '../../types/dayPlan';
import {
  arriveByFromDeadline,
  bufferMinutesForKind,
  carMinutesPlan,
  defaultStayMinutes,
  describeCurrentPace,
  leaveByFromArrive,
  walkMinutesPlan,
} from './bufferMath';
import { stampTransitHardMeta } from './transitHardMeta';
import { ASK_TRANSIT_WALK_MIN } from './planTalkPolicy';
export type ReverseScheduleInput = {
  dateKey?: string;
  /** z.B. ICE 13:17 */
  deadlineMs: number;
  deadlineTitle: string;
  destLat?: number | null;
  destLng?: number | null;
  destName?: string | null;
  /** train_hbf | train_small | flight… */
  importance?: 'train_hbf' | 'train_small' | 'flight' | 'generic';
  preferMode?: 'walk' | 'bike' | 'transit' | 'taxi' | 'auto';
};

export type ReverseScheduleResult = {
  items: DayPlanItem[];
  speechSummary: string;
  leaveByMs: number;
  arriveByMs: number;
  wakeMs: number | null;
  modeUsed: string;
  notes: string[];
};

function hotelOrigin(): {
  name: string;
  lat: number | null;
  lng: number | null;
} {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  return {
    name: hotel?.name ?? 'Hotel',
    lat: hotel?.lat ?? null,
    lng: hotel?.lng ?? null,
  };
}

function pickMode(
  walkMin: number,
  prefer?: ReverseScheduleInput['preferMode'],
): { mode: string; travelMin: number; note: string } {
  const profile = getCachedUserProfile();
  const mobility = profile?.mobilityMode;

  if (prefer === 'taxi' || mobility === 'car') {
    return {
      mode: 'taxi',
      travelMin: Math.max(10, Math.round(walkMin / 4)),
      note: 'Taxi/Uber bevorzugt (Profil oder Wunsch).',
    };
  }
  if (prefer === 'bike' || mobility === 'bike') {
    return {
      mode: 'bike',
      travelMin: Math.max(8, Math.round(walkMin / 2.5)),
      note: 'Fahrrad laut Profil.',
    };
  }
  if (prefer === 'transit' || mobility === 'public_transit') {
    // Sync-Fallback; Async-Pfad ersetzt per planJourney (Transitous/HAFAS).
    const transit = Math.max(15, Math.round(walkMin * 0.65) + 10);
    return {
      mode: 'transit',
      travelMin: transit,
      note:
        'ÖPNV geschätzt — Live-Fahrplan folgt im Async-Pfad (planJourney).',
    };
  }
  if (prefer === 'walk' || walkMin < ASK_TRANSIT_WALK_MIN) {
    return {
      mode: 'walk',
      travelMin: walkMin,
      note: 'Fußweg ok.',
    };
  }
  // auto: ab ~20 Min Fußweg → Transit/Taxi vorschlagen
  return {
    mode: 'transit',
    travelMin: Math.max(20, Math.round(walkMin * 0.65) + 10),
    note: `Fußweg ~${walkMin} Min → ÖPNV/Taxi vorschlagen.`,
  };
}

/**
 * Baut eine Rückwärts-Kette: Deadline → Ankunft → Anreise → Checkout → Packen → Frühstück → Wecker.
 */
export function buildReverseScheduleFromDeadline(
  input: ReverseScheduleInput,
): ReverseScheduleResult {
  const dateKey = input.dateKey ?? todayDateKey();
  const notes: string[] = [];
  const hotel = hotelOrigin();

  const importance =
    input.importance ??
    (/hbf|hauptbahnhof/i.test(input.destName ?? '')
      ? 'train_hbf'
      : 'train_small');

  const bufferMin =
    importance === 'train_hbf'
      ? bufferMinutesForKind('train_hbf')
      : importance === 'flight'
        ? bufferMinutesForKind('flight_commercial')
        : bufferMinutesForKind('train_small');

  const arriveByMs = arriveByFromDeadline(input.deadlineMs, bufferMin);

  let walkMin = 25;
  let travelDistM: number | null = null;
  if (
    hotel.lat != null &&
    hotel.lng != null &&
    input.destLat != null &&
    input.destLng != null
  ) {
    const dist = haversineMeters(
      hotel.lat,
      hotel.lng,
      input.destLat,
      input.destLng,
    );
    travelDistM = dist;
    walkMin = walkMinutesPlan(dist);
    notes.push(
      `Distanz Hotel→Ziel ~${Math.round(dist)} m → Fuß ~${walkMin} Min (${describeCurrentPace()}).`,
    );
  } else {
    notes.push('Keine Hotel-/Ziel-Koordinaten — Fußweg 25 Min Default.');
  }

  const picked = pickMode(walkMin, input.preferMode);
  notes.push(picked.note);
  const travelMin =
    picked.mode === 'taxi'
      ? carMinutesPlan(
          hotel.lat != null &&
            hotel.lng != null &&
            input.destLat != null &&
            input.destLng != null
            ? haversineMeters(
                hotel.lat,
                hotel.lng,
                input.destLat,
                input.destLng,
              )
            : 5000,
        )
      : picked.travelMin;

  const leaveHotelMs = leaveByFromArrive(arriveByMs, travelMin);
  const checkoutBuffer = bufferMinutesForKind('checkout');
  const checkoutStartMs = leaveByFromArrive(leaveHotelMs, checkoutBuffer);
  const packMin = 20;
  const packStartMs = leaveByFromArrive(checkoutStartMs, packMin);
  const breakfastMin = 40;
  const breakfastStartMs = leaveByFromArrive(packStartMs, breakfastMin);
  const wakeBuffer = 20;
  const wakeMs = leaveByFromArrive(breakfastStartMs, wakeBuffer);

  const items: DayPlanItem[] = [];
  let order = 10;

  items.push({
    id: uid('wake'),
    kind: 'wake',
    title: `Wecker ${clockLabel(wakeMs)}`,
    startMs: wakeMs,
    endMs: wakeMs + 5 * 60_000,
    timed: true,
    status: 'planned',
    source: 'module5',
    sortOrder: order++,
    notes: 'Aufstehen · duschen · wach werden',
  });

  items.push({
    id: uid('bfast'),
    kind: 'breakfast',
    title: `Frühstück ${clockLabel(breakfastStartMs)}–${clockLabel(packStartMs)}`,
    startMs: breakfastStartMs,
    endMs: packStartMs,
    timed: true,
    status: 'planned',
    placeName: hotel.name,
    lat: hotel.lat,
    lng: hotel.lng,
    durationMin: breakfastMin,
    source: 'module5',
    sortOrder: order++,
  });

  items.push({
    id: uid('pack'),
    kind: 'pack',
    title: 'Packen / Zimmer räumen',
    startMs: packStartMs,
    endMs: checkoutStartMs,
    timed: true,
    status: 'planned',
    placeName: hotel.name,
    durationMin: packMin,
    source: 'module5',
    sortOrder: order++,
  });

  items.push({
    id: uid('out'),
    kind: 'checkout',
    title: `Auschecken (${checkoutBuffer} Min)`,
    startMs: checkoutStartMs,
    endMs: leaveHotelMs,
    timed: true,
    status: 'planned',
    placeName: hotel.name,
    lat: hotel.lat,
    lng: hotel.lng,
    bufferMin: checkoutBuffer,
    source: 'module5',
    sortOrder: order++,
  });

  items.push({
    id: uid('leg'),
    kind:
      picked.mode === 'taxi'
        ? 'taxi'
        : picked.mode === 'transit'
          ? 'transit'
          : 'nav',
    title:
      picked.mode === 'taxi'
        ? `Taxi/Uber → ${input.destName ?? 'Bahnhof'}`
        : picked.mode === 'transit'
          ? `ÖPNV → ${input.destName ?? 'Bahnhof'}`
          : `Fußweg → ${input.destName ?? 'Bahnhof'}`,
    startMs: leaveHotelMs,
    endMs: arriveByMs,
    timed: true,
    status: 'planned',
    lat: input.destLat,
    lng: input.destLng,
    placeName: input.destName,
    durationMin: travelMin,
    source: 'module5',
    sortOrder: order++,
    notes: picked.note,
    meta: { mode: picked.mode, distanceM: travelDistM },
  });

  if (picked.mode === 'transit') {
    const leg = items[items.length - 1]!;
    items[items.length - 1] = stampTransitHardMeta(leg, {
      stationName: input.destName ?? 'Bahnhof',
      trainHint: input.deadlineTitle,
      leaveByMs: leaveHotelMs,
      plannedDepartMs: leaveHotelMs,
      mode: 'transit',
      source: 'estimate',
    });
  }

  items.push({
    id: uid('arr'),
    kind: 'buffer',
    title: `Ankunft ${input.destName ?? 'Ziel'} (Puffer ${bufferMin} Min)`,
    startMs: arriveByMs,
    endMs: input.deadlineMs,
    timed: true,
    status: 'planned',
    lat: input.destLat,
    lng: input.destLng,
    placeName: input.destName,
    bufferMin,
    source: 'module5',
    sortOrder: order++,
  });

  items.push(
    stampTransitHardMeta(
      {
        id: uid('dl'),
        kind: 'transit',
        title: input.deadlineTitle,
        startMs: input.deadlineMs,
        endMs: input.deadlineMs + 5 * 60_000,
        timed: true,
        status: 'planned',
        lat: input.destLat,
        lng: input.destLng,
        placeName: input.destName,
        hardDeadline: true,
        source: 'module2',
        sortOrder: order++,
        meta: { dateKey },
      },
      {
        stationName: input.destName ?? 'Bahnhof',
        trainHint: input.deadlineTitle,
        leaveByMs: leaveHotelMs,
        plannedDepartMs: input.deadlineMs,
        mode: 'transit',
        source: 'deadline',
      },
    ),
  );
  const speechSummary =
    `Für ${input.deadlineTitle} um ${clockLabel(input.deadlineMs)}: ` +
    `am Ziel ${clockLabel(arriveByMs)} (Puffer ${bufferMin} Min), ` +
    `Los ${clockLabel(leaveHotelMs)} per ${picked.mode}, ` +
    `Auschecken ${clockLabel(checkoutStartMs)}, ` +
    `Wecker ${clockLabel(wakeMs)}.`;

  if (walkMin >= ASK_TRANSIT_WALK_MIN && picked.mode === 'walk') {
    try {
      const { scheduleModule5FollowUp } = require('./module5Priority') as {
        scheduleModule5FollowUp: (o: {
          speech: string;
          actions?: Array<{
            type: 'SHOW_MORE';
            label: string;
            payload: { textPrompt: string };
          }>;
        }) => void;
      };
      scheduleModule5FollowUp({
        speech: `Zu Fuß wären das so um die ${walkMin} Minuten — soll ich Taxi oder ÖPNV prüfen?`,
        actions: [
          {
            type: 'SHOW_MORE',
            label: 'ÖPNV prüfen',
            payload: { textPrompt: 'Zeig mir die ÖPNV-Verbindung dorthin' },
          },
          {
            type: 'SHOW_MORE',
            label: 'Taxi',
            payload: { textPrompt: 'Organisiere ein Taxi dorthin' },
          },
        ],
      });
    } catch {
      /* soft */
    }
  }

  return {
    items,
    speechSummary,
    leaveByMs: leaveHotelMs,
    arriveByMs,
    wakeMs,
    modeUsed: picked.mode,
    notes,
  };
}

/**
 * Wie sync, aber ÖPNV-Legs mit DB/HAFAS Live-Fahrplan (arrive-by).
 */
export async function buildReverseScheduleFromDeadlineAsync(
  input: ReverseScheduleInput,
): Promise<ReverseScheduleResult> {
  const base = buildReverseScheduleFromDeadline(input);
  const hotel = hotelOrigin();
  if (
    hotel.lat == null ||
    hotel.lng == null ||
    input.destLat == null ||
    input.destLng == null
  ) {
    return base;
  }
  if (base.modeUsed === 'taxi' || base.modeUsed === 'bike') {
    return base;
  }

  try {
    const { pickLiveTransitBeforeDeadline, checkDeadlineTrainDelay } =
      await import('./liveTransitPlan');
    const live = await pickLiveTransitBeforeDeadline({
      fromLat: hotel.lat,
      fromLng: hotel.lng,
      toLat: input.destLat,
      toLng: input.destLng,
      arriveByMs: base.arriveByMs,
      minBufferMin: 10,
    });
    if (!live) {
      base.notes.push('Keine Live-ÖPNV-Verbindung — geschätzte Zeit bleibt.');
      return base;
    }

    // Rebuild leave chain from live leaveHomeMs
    const leaveHotelMs = live.leaveHomeMs;
    const checkoutBuffer = bufferMinutesForKind('checkout');
    const checkoutStartMs = leaveByFromArrive(leaveHotelMs, checkoutBuffer);
    const packMin = 20;
    const packStartMs = leaveByFromArrive(checkoutStartMs, packMin);
    const breakfastMin = 40;
    const breakfastStartMs = leaveByFromArrive(packStartMs, breakfastMin);
    const wakeMs = leaveByFromArrive(breakfastStartMs, 20);

    const items = base.items.map((it) => {
      if (it.kind === 'wake') {
        return {
          ...it,
          title: `Wecker ${clockLabel(wakeMs)}`,
          startMs: wakeMs,
          endMs: wakeMs + 5 * 60_000,
        };
      }
      if (it.kind === 'breakfast') {
        return {
          ...it,
          title: `Frühstück ${clockLabel(breakfastStartMs)}–${clockLabel(packStartMs)}`,
          startMs: breakfastStartMs,
          endMs: packStartMs,
        };
      }
      if (it.kind === 'pack') {
        return {
          ...it,
          startMs: packStartMs,
          endMs: checkoutStartMs,
        };
      }
      if (it.kind === 'checkout') {
        return {
          ...it,
          startMs: checkoutStartMs,
          endMs: leaveHotelMs,
        };
      }
      if (it.kind === 'nav' || it.kind === 'transit' || it.kind === 'taxi') {
        if (it.hardDeadline) {
          return stampTransitHardMeta(it, {
            stationName: input.destName ?? 'Bahnhof',
            trainHint: input.deadlineTitle,
            leaveByMs: leaveHotelMs,
            plannedDepartMs: input.deadlineMs,
            mode: 'transit',
            source: live.source,
            delaySec: live.delaySec,
          });
        }
        return stampTransitHardMeta(
          {
            ...it,
            kind: 'transit',
            title: `${live.lineLabel} → ${input.destName ?? 'Bahnhof'}`,
            startMs: live.departMs,
            endMs: live.arriveMs,
            durationMin: Math.round((live.arriveMs - live.departMs) / 60_000),
            notes: live.notes.join(' · '),
            placeName: input.destName ?? it.placeName,
          },
          {
            stationName: input.destName ?? 'Bahnhof',
            trainHint: input.deadlineTitle,
            leaveByMs: leaveHotelMs,
            plannedDepartMs: live.departMs,
            mode: 'transit',
            source: live.source,
            delaySec: live.delaySec,
            walkToStopMin: live.walkToStopMin,
          },
        );
      }
      if (it.kind === 'buffer') {
        return {
          ...it,
          startMs: live.arriveMs,
          endMs: input.deadlineMs,
          notes: `Live-Ankunft ${clockLabel(live.arriveMs)}`,
        };
      }
      return it;
    });

    // Zusätzliches Walk-to-stop Item
    items.splice(
      items.findIndex((i) => i.kind === 'transit' && !i.hardDeadline),
      0,
      {
        id: uid('wstop'),
        kind: 'nav',
        title: `Fuß zur Haltestelle (~${live.walkToStopMin} Min)`,
        startMs: leaveHotelMs,
        endMs: live.departMs - 5 * 60_000,
        timed: true,
        status: 'planned',
        source: 'module5',
        durationMin: live.walkToStopMin,
        meta: { mode: 'walk' },
        sortOrder: 45,
      },
    );

    const delayNote = await checkDeadlineTrainDelay({
      stationName: input.destName ?? 'Bahnhof',
      trainHint: input.deadlineTitle,
      plannedMs: input.deadlineMs,
      biasLat: input.destLat,
      biasLng: input.destLng,
    });
    if (delayNote) base.notes.push(delayNote);
    base.notes.push(...live.notes);

    const speechSummary =
      `Für ${input.deadlineTitle} um ${clockLabel(input.deadlineMs)}: ` +
      `Live ${live.lineLabel} ${clockLabel(live.departMs)}→${clockLabel(live.arriveMs)}, ` +
      `Los ${clockLabel(leaveHotelMs)}, Wecker ${clockLabel(wakeMs)}.` +
      (delayNote ? ` ${delayNote}` : '');

    return {
      items,
      speechSummary,
      leaveByMs: leaveHotelMs,
      arriveByMs: live.arriveMs,
      wakeMs,
      modeUsed: 'transit' as const,
      notes: base.notes,
    };
  } catch (err) {
    base.notes.push(`Live-ÖPNV fehlgeschlagen: ${String(err)}`);
    return base;
  }
}

export function buildStayBlock(opts: {
  title: string;
  startMs: number;
  kind?: DayPlanItem['kind'];
  lat?: number | null;
  lng?: number | null;
  placeName?: string | null;
  durationMin?: number | null;
  source?: DayPlanItem['source'];
}): DayPlanItem {
  const duration =
    opts.durationMin ??
    defaultStayMinutes(opts.kind ?? 'activity', opts.title);
  return {
    id: uid('stay'),
    kind: opts.kind ?? 'activity',
    title: opts.title,
    startMs: opts.startMs,
    endMs: opts.startMs + duration * 60_000,
    timed: true,
    status: 'planned',
    lat: opts.lat,
    lng: opts.lng,
    placeName: opts.placeName ?? opts.title,
    durationMin: duration,
    source: opts.source ?? 'module5',
  };
}
