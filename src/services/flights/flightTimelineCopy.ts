/**
 * Timeline-Texte für Flugschritte — Struktur-Hints, kein Script-Wortlaut.
 */

import { pathTitleForLeg } from '../../module2/timeline/liveTourSchedule';
import type { FuturePlanTransport } from '../../module2/timeline/futurePlanState';

export function terminalLabel(raw: string | null | undefined): string | null {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^terminal\b/i.test(t)) return t;
  return `Terminal ${t}`;
}

export function tidyTransitPlace(raw: string | null | undefined): string | null {
  const s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^(weiter|zwischenstopp|ziel|continue)$/i.test(s)) return null;
  if (s.length < 2) return null;
  return s;
}

export function securityWaitNote(
  waitMin: number,
  securityMs: number,
  nowMs = Date.now(),
): string {
  const mins = Math.max(1, Math.round(waitMin));
  const live =
    nowMs >= securityMs - 2 * 60 * 60_000 && nowMs <= securityMs + 30 * 60_000;
  return live
    ? `Aktuell etwa ${mins} Min Wartezeit.`
    : `Voraussichtlich etwa ${mins} Min Wartezeit (Puffer).`;
}

export function formatDistM(distanceM: number | null | undefined): string | null {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM <= 0) {
    return null;
  }
  if (distanceM >= 1000) return `${(distanceM / 1000).toFixed(1)} km`;
  return `${Math.round(distanceM)} m`;
}

export function formatWalkMinutes(
  durationSec: number,
  distanceM?: number | null,
): number {
  if (Number.isFinite(durationSec) && durationSec > 0) {
    const fromSec = Math.max(1, Math.round(durationSec / 60));
    if (distanceM != null && distanceM > 0) {
      const fromDist = Math.max(2, Math.round(distanceM / 80));
      // Lange reported walks bei kleiner Distanz = arriveBy-Padding
      if (fromSec > fromDist * 2.5 && fromDist <= 20) return fromDist;
    }
    return fromSec;
  }
  if (distanceM != null && distanceM > 0) {
    return Math.max(2, Math.round(distanceM / 80));
  }
  return 3;
}

export function walkNaturalEndMs(opts: {
  startMs: number;
  reportedEndMs: number;
  durationSec: number;
  distanceM?: number | null;
}): { endMs: number; walkMin: number; padded: boolean } {
  const walkMin = formatWalkMinutes(opts.durationSec, opts.distanceM);
  const natural = opts.startMs + walkMin * 60_000;
  const reported = opts.reportedEndMs;
  const padded = reported - natural > 4 * 60_000;
  return {
    endMs: padded ? natural : reported,
    walkMin,
    padded,
  };
}

export function waitMinutes(fromMs: number, toMs: number): number {
  return Math.max(0, Math.round((toMs - fromMs) / 60_000));
}

/** Enduhr ausblenden, wenn der nächste Schritt nahtlos anschließt. */
export function shouldShowEndClock(
  endMs: number | null | undefined,
  nextAtMs: number | null | undefined,
  startMs?: number | null,
): boolean {
  if (endMs == null || !Number.isFinite(endMs)) return false;
  if (startMs != null && Math.abs(endMs - startMs) < 90_000) return false;
  if (nextAtMs == null || !Number.isFinite(nextAtMs)) return true;
  return nextAtMs - endMs >= 2.5 * 60_000;
}

export type AccessLegHint = {
  mode: string;
  line?: string | null;
  headsign?: string | null;
  fromName: string;
  toName: string;
  durationSec?: number;
  distanceM?: number | null;
  stationCount?: number | null;
  delaySec?: number | null;
  startMs: number;
  endMs: number;
};

function railish(mode?: string | null, line?: string | null): boolean {
  if (mode === 'RAIL' || mode === 'SUBWAY') return true;
  return /^(RB|RE|IC|ICE|S)\b/i.test(line || '');
}

function busish(mode?: string | null, line?: string | null): boolean {
  if (mode === 'BUS' || mode === 'TRAM') return true;
  return /^(X\d|\d{1,3}[A-Z]?$)/i.test((line || '').replace(/\s+/g, ''));
}

export function accessLegEmoji(mode: string, line?: string | null): string {
  if (mode === 'WALK') return '🚶';
  if (mode === 'BIKE') return '🚲';
  if (mode === 'FERRY') return '⛴️';
  if (railish(mode, line) && !busish(mode, line)) return '🚆';
  if (busish(mode, line)) return '🚌';
  if (mode === 'RAIL' || mode === 'SUBWAY') return '🚆';
  return '🚆';
}

export function toPlacePrep(place: string): string {
  const p = place.replace(/^(der|die|das)\s+/i, '').trim();
  if (!p) return 'zum Ziel';
  if (
    /^(bushaltestelle|haltestelle|station|sicherheitskontrolle|gepäckabgabe|gepaeckabgabe)\b/i.test(
      p,
    )
  ) {
    return `zur ${p}`;
  }
  return `zum ${p}`;
}

export function accessLegTitle(opts: {
  leg: AccessLegHint;
  index: number;
  isLast: boolean;
  nextMode?: string | null;
  nextLine?: string | null;
  nextIsLastWalk?: boolean;
  airportLabel?: string | null;
  originLabel?: string | null;
}): string {
  const walk = opts.leg.mode === 'WALK' || opts.leg.mode === 'BIKE';
  if (walk) {
    const transport: FuturePlanTransport =
      opts.leg.mode === 'BIKE' ? 'bike' : 'walk';
    const walkMin = formatWalkMinutes(
      opts.leg.durationSec ?? 0,
      opts.leg.distanceM,
    );
    return pathTitleForLeg(transport, opts.leg.distanceM ?? null, walkMin);
  }
  const etaMin = Math.max(
    1,
    Math.round((opts.leg.durationSec ?? 60) / 60),
  );
  return pathTitleForLeg('transit', null, etaMin, {
    line: opts.leg.line,
    headsign: opts.leg.headsign,
    stationCount: opts.leg.stationCount,
    skipDistance: true,
    delaySec: opts.leg.delaySec,
  });
}

export function accessLegNotes(opts: {
  leg: AccessLegHint;
  waitMin?: number;
  isLastWalk?: boolean;
  paddedWalk?: boolean;
  nextLine?: string | null;
  nextHeadsign?: string | null;
}): string | undefined {
  const walk = opts.leg.mode === 'WALK' || opts.leg.mode === 'BIKE';
  const bits: string[] = [];
  const nextRide = (opts.nextLine || '').trim();
  const nextHead = (opts.nextHeadsign || '').trim();
  const ride = nextRide
    ? nextHead
      ? `${nextRide} nach ${nextHead}`
      : nextRide
    : '';
  if (walk && ride && !opts.isLastWalk) {
    bits.push(
      opts.waitMin != null && opts.waitMin >= 3
        ? `${opts.waitMin} Min warten auf ${ride}`
        : `Einstieg in ${ride}`,
    );
  } else if (opts.waitMin != null && opts.waitMin >= 3) {
    bits.push(
      opts.isLastWalk || opts.paddedWalk
        ? `${opts.waitMin} Min Puffer bis Terminal`
        : `${opts.waitMin} Min Umstieg`,
    );
  }
  return bits.length ? bits.join(' · ') : undefined;
}

export function planAccessLeg(opts: {
  legs: AccessLegHint[];
  index: number;
  airportLabel: string;
  airportMs: number;
  originLabel?: string | null;
}): {
  title: string;
  notes?: string;
  startMs: number;
  endMs: number;
  emoji: string;
  walk: boolean;
  padded: boolean;
  waitMin: number;
} {
  const leg = opts.legs[opts.index]!;
  const next = opts.legs[opts.index + 1];
  const isLast = opts.index === opts.legs.length - 1;
  const walk = leg.mode === 'WALK' || leg.mode === 'BIKE';
  let endMs = leg.endMs;
  let padded = false;
  if (walk) {
    const natural = walkNaturalEndMs({
      startMs: leg.startMs,
      reportedEndMs: leg.endMs,
      durationSec: leg.durationSec ?? 0,
      distanceM: leg.distanceM,
    });
    endMs = natural.endMs;
    padded = natural.padded;
  }
  const nextStart = next ? next.startMs : isLast ? opts.airportMs : endMs;
  const waitMin = waitMinutes(endMs, nextStart);
  return {
    title: accessLegTitle({
      leg,
      index: opts.index,
      isLast,
      nextMode: next?.mode,
      nextLine: next?.line,
      nextIsLastWalk: Boolean(
        next &&
          (next.mode === 'WALK' || next.mode === 'BIKE') &&
          opts.index === opts.legs.length - 2,
      ),
      airportLabel: opts.airportLabel,
      originLabel: opts.originLabel,
    }),
    notes: accessLegNotes({
      leg,
      waitMin,
      isLastWalk: walk && isLast,
      paddedWalk: padded,
      nextLine: next?.line,
      nextHeadsign: next?.headsign,
    }),
    startMs: leg.startMs,
    endMs,
    emoji: accessLegEmoji(leg.mode, leg.line),
    walk,
    padded,
    waitMin,
  };
}

export function checkinDeskLabel(raw: string | null | undefined): string | null {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^check-?in\b/i.test(t)) {
    return t.replace(/^checkin\b/i, 'Check-in');
  }
  return `Check-in-Schalter ${t}`;
}

export function gateLabel(raw: string | null | undefined): string | null {
  const g = String(raw || '')
    .replace(/^gate\s+/i, '')
    .trim();
  if (!g) return null;
  return `Gate ${g}`;
}

export function flightGroupLabel(destLabel: string): string {
  const d = destLabel.replace(/\s+/g, ' ').trim() || 'Ziel';
  return `Flug nach ${d}`;
}
