/**
 * Hotel-Check-in auf der Timeline — keine Endzeit, smart nach vorherigem Termin.
 */

import type { IngestOpenWish } from './planningTypes';
import type { FuturePlanStop } from '../timeline/futurePlanState';

function parseTimeToMs(dayKey: string, time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dayKey.split('-').map(Number);
  const dt = new Date(y!, mo! - 1, d!, Number(m[1]), Number(m[2]), 0, 0);
  return dt.getTime();
}

const HOTEL_RE =
  /\b(hotel|übernacht|uebernacht|pension|unterkunft|hostel|zimmer|airbnb|ferienwohnung)\b/i;

export function isHotelPlanBlob(blob: string): boolean {
  return HOTEL_RE.test(blob);
}

/** Check-in HH:mm — Flug-Ankunft+Transfer, sonst Fixtermine (+30 Min), sonst 15:00. */
export function inferHotelCheckInHm(
  wish: IngestOpenWish,
  dayKey: string,
  stops: FuturePlanStop[],
): string {
  // Flug-Nachtankunft: Check-in nach Ankunft + Transfer (aus Wish-Kontext oder Watch).
  try {
    const blob = `${wish.title} ${wish.context ?? ''}`;
    const m = blob.match(
      /mind\.\s*bis\s*~?(\d{1,2}):(\d{2})\s*Check-in|Ankunft\s+Flughafen\s*~?(\d{1,2}):(\d{2})/i,
    );
    if (m) {
      if (m[1] != null && m[2] != null) {
        return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
      }
      if (m[3] != null && m[4] != null) {
        const mins = Number(m[3]) * 60 + Number(m[4]) + 65;
        const h = Math.floor(mins / 60) % 24;
        const mm = mins % 60;
        return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    const { lateCheckInFloorHm, flightArrivalMsForOpenPlan } = require('../../services/flights/flightOpenPlanContext') as {
      lateCheckInFloorHm: (ms: number, transferMin?: number) => string;
      flightArrivalMsForOpenPlan: () => number | null;
    };
    const arr = flightArrivalMsForOpenPlan();
    if (arr != null) return lateCheckInFloorHm(arr);
  } catch {
    /* soft */
  }

  // Nach hartem Fixtermin (+30 Min) hat Vorrang vor LLM-Default 18:00
  let latestEndMin: number | null = null;
  for (const s of stops) {
    if (s.id.startsWith('choice_') || s.kind === 'nav_leg' || s.kind === 'wish') {
      continue;
    }
    if (HOTEL_RE.test(`${s.title} ${s.notes ?? ''}`)) continue;
    const startMs = s.plannedStartMs;
    const endMs = s.plannedEndMs;
    if (startMs == null) continue;
    const end = endMs ?? startMs + 60 * 60_000;
    const d = new Date(end);
    const mins = d.getHours() * 60 + d.getMinutes() + 30;
    if (latestEndMin == null || mins > latestEndMin) latestEndMin = mins;
  }

  if (wish.estimatedTime) {
    const m = wish.estimatedTime.match(/^(\d{1,2}):(\d{2})/);
    if (m) {
      const userMin = Number(m[1]) * 60 + Number(m[2]);
      // LLM-„18:00“ hinter festem Termin → auf +30 nach Fix schieben
      if (latestEndMin != null && userMin + 15 < latestEndMin) {
        const h = Math.floor(latestEndMin / 60) % 24;
        const mm = latestEndMin % 60;
        return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
      return `${m[1]!.padStart(2, '0')}:${m[2]}`;
    }
  }

  if (latestEndMin != null) {
    const h = Math.floor(latestEndMin / 60) % 24;
    const m = latestEndMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return '15:00';
}

export function hotelCheckInMs(
  wish: IngestOpenWish,
  dayKey: string,
  stops: FuturePlanStop[],
): number | null {
  const hm = inferHotelCheckInHm(wish, dayKey, stops);
  return parseTimeToMs(dayKey, hm);
}
