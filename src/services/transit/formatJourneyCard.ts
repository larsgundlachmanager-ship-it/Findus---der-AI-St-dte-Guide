/**
 * Door-to-door ÖPNV: Speech + Stichpunkte + Start-Button.
 */

import type { JourneyItinerary, JourneyLeg } from './journeyPlanner';
import { formatDurationMinutesDe } from '../navigation/travelEta';

function clock(d: Date | string | number | null | undefined): string {
  const date =
    d instanceof Date
      ? d
      : typeof d === 'string' || typeof d === 'number'
        ? new Date(d)
        : null;
  const safe =
    date && Number.isFinite(date.getTime()) ? date : new Date();
  return `${safe.getHours().toString().padStart(2, '0')}:${safe
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

function stationsBit(leg: JourneyLeg): string {
  const n = leg.stationCount;
  if (n == null || n < 1) return '';
  if (n === 1) return ' · 1 Station';
  return ` · ${n} Stationen`;
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
  return `${modeLabel(leg.mode)}${line} ${mins} Min${head}${stationsBit(leg)}`;
}

function transitSpeechLeg(leg: JourneyLeg): string {
  const line = leg.line ? ` ${leg.line}` : '';
  const n = leg.stationCount;
  const stations =
    n != null && n >= 1
      ? n === 1
        ? ' Eine Station, dann aussteigen'
        : ` ${n} Stationen, aussteigen an ${leg.toName}`
      : ` Aussteigen an ${leg.toName}`;
  return `${modeLabel(leg.mode)}${line} bis ${leg.toName}.${stations}.`;
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
  const legs = Array.isArray(it.legs) ? it.legs : [];
  const firstTransit = legs.find(
    (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
  );
  const walkLeg = legs.find((l) => l.mode === 'WALK');
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
    const depMs =
      dep instanceof Date && Number.isFinite(dep.getTime())
        ? dep.getTime()
        : NaN;
    if (Number.isFinite(depMs)) {
      const untilDep = Math.round((depMs - Date.now()) / 60_000);
      leaveInMin = Math.max(0, untilDep - walkMin - 2);
    }
  }

  const bullets = legs.slice(0, 5).map(legBullet);
  if (it.transfers > 0) {
    bullets.push(
      it.transfers === 1 ? '1× umsteigen' : `${it.transfers}× umsteigen`,
    );
  }
  bullets.push(`Ankunft ${arrive} Uhr`);

  const depBit =
    dep && station
      ? `Zuerst zu Fuß zur Haltestelle ${station}` +
        (walkMin != null ? ` (ca. ${walkMin} Min)` : '') +
        `, dann ${line ? `${line} ` : ''}um ${clock(dep)} Uhr` +
        (firstTransit?.realTime || it.firstTransitDelaySec != null
          ? ' — Live-Abfahrt'
          : '') +
        '. '
      : '';

  const rideBits = it.legs
    .filter((l) => l.mode !== 'WALK' && l.mode !== 'BIKE')
    .map(transitSpeechLeg)
    .join(' ');

  const transferBit =
    it.transfers > 0
      ? it.transfers === 1
        ? ' Einmal umsteigen. '
        : ` ${it.transfers} Mal umsteigen. `
      : '';

  const leaveBit =
    leaveInMin != null && dep
      ? leaveInMin <= 0
        ? 'Am besten sofort los. '
        : leaveInMin <= 3
          ? `Wird sportlich — in den nächsten ${leaveInMin} Minuten los. `
          : `In etwa ${leaveInMin} Minuten aufbrechen. `
      : '';

  const speech =
    `Zu ${destName}: ${depBit}` +
    rideBits +
    (rideBits ? ' ' : '') +
    transferBit +
    `Zum Schluss zu Fuß zum Ziel. Ankunft gegen ${arrive} Uhr, insgesamt ${formatDurationMinutesDe(totalMin, 'speech').replace(/^etwa /, 'ca. ')}. ` +
    leaveBit +
    `Ich führ dich durch — Fußweg, Fahrt, Ausstieg, Umstieg.`;

  return {
    speech,
    bullets: bullets.slice(0, 4),
    firstTransitStation: station,
    firstTransitWhen: dep,
    walkToStopMin: walkMin,
    leaveInMin,
  };
}
