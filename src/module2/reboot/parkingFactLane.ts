/**
 * Fact-Lane Care: Parkticket / Parkplatz speichern + Leave-by.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import {
  isParkingSpotSaveIntent,
  parseParkingMaxDurationMin,
  saveParkingSpot,
} from '../../services/timeline/parkingSpotStore';
import {
  evaluateParkingCare,
  armParkingCare,
} from '../../services/timeline/parkingCareEngine';
import type { AgentResult } from '../types';
import { isParkingCareIntent } from '../../services/concierge/timeCareIntent';

export function isParkingCareUtterance(text: string): boolean {
  return isParkingCareIntent(text) || isParkingSpotSaveIntent(text);
}

export async function researchParkingCare(opts: {
  userText: string;
}): Promise<AgentResult> {
  const gps = useFinnusStore.getState();
  const maxDurationMin = parseParkingMaxDurationMin(opts.userText);
  const spot = saveParkingSpot({
    label: 'Parkplatz',
    lat: gps.lastGpsLat,
    lng: gps.lastGpsLng,
    maxDurationMin,
  });
  const care = (await armParkingCare()) ?? (await evaluateParkingCare());

  const untilClock = opts.userText.match(
    /\b(?:bis|gilt\s+bis|läuft\s+bis|laeuft\s+bis|ticket\s+bis)\s*(\d{1,2})[:.](\d{2})\b/iu,
  );

  let draft: string;
  if (untilClock?.[1] != null && untilClock[2] != null) {
    const hh = untilClock[1].padStart(2, '0');
    const mm = untilClock[2];
    draft = `Parkplatz ist gespeichert — Ticket bis ${hh}:${mm}. Ich behalte die Position im Blick und erinner dich rechtzeitig, bevor die Zeit abläuft.`;
  } else if (maxDurationMin != null) {
    const h = maxDurationMin / 60;
    const dur =
      Number.isInteger(h) && h >= 1
        ? `${h} Stunden`
        : `${maxDurationMin} Minuten`;
    draft = `Parkplatz gespeichert — max. ${dur}. Restzeit siehst du oben; ich melde mich ~30 und ~5 Minuten bevor du los zum Auto musst.`;
  } else {
    draft =
      'Parkplatz ist gespeichert. Ich merke mir den Spot — sag mir die maximale Parkdauer, dann plane ich den Leave-by.';
  }

  if (care?.walkMinEstimate != null) {
    const walk = care.walkMinEstimate;
    draft += ` Zurück zum Auto aktuell ca. ${walk} Min.`;
    if (spot.maxDurationMin != null && spot.maxDurationMin > 0) {
      const elapsed = Math.max(
        0,
        Math.round((Date.now() - spot.parkedAtMs) / 60_000),
      );
      const remAt = spot.maxDurationMin - (elapsed + walk);
      if (remAt > 0) {
        draft += ` Bei Ankunft hättest du noch ca. ${remAt} Min Ticketzeit.`;
      } else if (remAt === 0) {
        draft += ` Bei Ankunft wäre das Ticket gerade abgelaufen.`;
      } else {
        draft += ` Bei Ankunft wärst du ca. ${Math.abs(remAt)} Min über der Zeit.`;
      }
    }
    if (care.leaveByMs != null) {
      const leave = new Date(care.leaveByMs);
      const leaveStr = `${String(leave.getHours()).padStart(2, '0')}:${String(leave.getMinutes()).padStart(2, '0')}`;
      draft += ` Leave-by grob ${leaveStr}.`;
    }
  }

  return {
    agent: 'memory',
    ok: true,
    draftText: draft,
    bullets: [
      spot.label,
      untilClock
        ? `Ticket bis ${untilClock[1]!.padStart(2, '0')}:${untilClock[2]}`
        : maxDurationMin != null
          ? `Max ${maxDurationMin} Min`
          : 'Spot gespeichert',
      care?.walkMinEstimate != null
        ? `Fuß ~${care.walkMinEstimate} Min`
        : 'Leave-by folgt mit GPS',
    ].slice(0, 3),
    buttons: [],
    meta: {
      parkingCare: true,
      concrete_place: true,
      spotId: spot.id,
      maxDurationMin,
      leaveByMs: care?.leaveByMs ?? null,
    },
  };
}
