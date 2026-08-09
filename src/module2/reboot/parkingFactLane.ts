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
  startParkingCareWatch,
} from '../../services/timeline/parkingCareEngine';
import type { AgentResult } from '../types';

export function isParkingCareUtterance(text: string): boolean {
  return (
    isParkingSpotSaveIntent(text) ||
    (/\bparkticket\b/iu.test(text) &&
      /\b(bis|gilt|uhr|\d{1,2}[:.]\d{2})\b/iu.test(text))
  );
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
  startParkingCareWatch();

  const care = await evaluateParkingCare();
  const untilClock = opts.userText.match(
    /\b(?:bis|gilt\s+bis|läuft\s+bis|laeuft\s+bis|ticket\s+bis)\s*(\d{1,2})[:.](\d{2})\b/iu,
  );

  let draft: string;
  if (untilClock?.[1] != null && untilClock[2] != null) {
    const hh = untilClock[1].padStart(2, '0');
    const mm = untilClock[2];
    draft = `Parkplatz ist gespeichert — Ticket bis ${hh}:${mm}. Ich behalte die Position im Blick und erinner dich rechtzeitig, bevor die Zeit abläuft.`;
  } else if (maxDurationMin != null) {
    draft = `Parkplatz gespeichert — max. ${maxDurationMin} Minuten. Restzeit siehst du oben; ich melde mich bevor’s eng wird.`;
  } else {
    draft =
      'Parkplatz ist gespeichert. Ich merke mir den Spot — sag mir die maximale Parkdauer, dann plane ich den Leave-by.';
  }

  if (care?.walkMinEstimate != null && care.leaveByMs != null) {
    const leave = new Date(care.leaveByMs);
    const leaveStr = `${String(leave.getHours()).padStart(2, '0')}:${String(leave.getMinutes()).padStart(2, '0')}`;
    draft += ` Aktuell ca. ${care.walkMinEstimate} Min zurück zum Auto — Leave-by grob ${leaveStr}.`;
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
