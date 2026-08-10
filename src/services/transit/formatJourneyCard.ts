/**
 * Door-to-door ÖPNV: Speech + Stichpunkte + Start-Button.
 */

import type { JourneyItinerary, JourneyLeg } from './journeyPlanner';

function clock(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function modeLabel(mode: JourneyLeg['mode']): string {
  switch (mode) {
    case 'WALK':
      return 'Gehen';
    case 'BIKE':
      return 'Rad';
    case 'BUS':
      return 'Bus';
    case 'TRAM':
      return 'Tram';
    case 'SUBWAY':
      return 'U-Bahn';
    case 'RAIL':
      return 'Bahn';
    case 'FERRY':
      return 'Fähre';
    default:
      return 'Fahrt';
  }
}

function legBullet(leg: JourneyLeg): string {
  const mins = Math.max(1, Math.round(leg.durationSec / 60));
  if (leg.mode === 'WALK' || leg.mode === 'BIKE') {
    const dist =
      leg.distanceM != null && leg.distanceM > 0
        ? leg.distanceM >= 1000
          ? `${(leg.distanceM / 1000).toFixed(1)} km`
          : `${Math.round(leg.distanceM)} m`
        : `${mins} Min`;
    return `${modeLabel(leg.mode)} ${dist} → ${leg.toName}`;
  }
  const line = leg.line ? ` ${leg.line}` : '';
  const head = leg.headsign ? ` → ${leg.headsign}` : ` → ${leg.toName}`;
  return `${modeLabel(leg.mode)}${line} ${mins} Min${head}`;
}

export function formatJourneyForConcierge(
  it: JourneyItinerary,
  destName: string,
): {
  speech: string;
  bullets: string[];
  firstTransitStation: string | null;
  firstTransitWhen: Date | null;
  walkToStopMin: number | null;
  leaveInMin: number | null;
} {
  const totalMin = Math.max(1, Math.round(it.durationSec / 60));
  const arrive = clock(it.endTime);
  const firstTransit = it.legs.find(
    (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
  );
  const walkLeg = it.legs.find((l) => l.mode === 'WALK');
  const walkMin =
    it.walkToStopSec != null
      ? Math.max(1, Math.round(it.walkToStopSec / 60))
      : walkLeg
        ? Math.max(1, Math.round(walkLeg.durationSec / 60))
        : null;

  const dep = it.firstTransitDeparture ?? firstTransit?.startTime ?? null;
  const line = it.firstTransitLine ?? firstTransit?.line ?? null;
  const station =
    firstTransit?.fromName?.trim() ||
    walkLeg?.toName?.trim() ||
    null;

  let leaveInMin: number | null = null;
  if (dep && walkMin != null) {
    const untilDep = Math.round((dep.getTime() - Date.now()) / 60_000);
    leaveInMin = Math.max(0, untilDep - walkMin - 2);
  }

  const bullets = it.legs.slice(0, 5).map(legBullet);
  bullets.push(`Ankunft ${arrive} Uhr`);

  const depBit =
    dep && station
      ? `Nächste sinnvolle Verbindung: ${line ? `${line} ` : ''}ab ${station} um ${clock(dep)} Uhr. `
      : '';
  const leaveBit =
    leaveInMin != null && dep
      ? leaveInMin <= 0
        ? `Fußweg ca. ${walkMin} Min — am besten sofort los. `
        : leaveInMin <= 3
          ? `Fußweg ca. ${walkMin} Min — wird sportlich, in den nächsten ${leaveInMin} Minuten los. `
          : `Fußweg ca. ${walkMin} Min — in etwa ${leaveInMin} Minuten aufbrechen, kein Stress. `
      : '';

  const speech =
    `Zu ${destName}: ${depBit}` +
    `Ankunft gegen ${arrive} Uhr, Gesamtfahrt ca. ${totalMin} Minuten. ` +
    leaveBit +
    `Passt die Verbindung, oder soll ich eine spätere raussuchen?`;

  return {
    speech,
    bullets: bullets.slice(0, 3),
    firstTransitStation: station,
    firstTransitWhen: dep,
    walkToStopMin: walkMin,
    leaveInMin,
  };
}
