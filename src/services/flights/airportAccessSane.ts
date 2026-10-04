/**
 * ÖPNV zum Abflughafen: keine 26h-Schleifen, keine Past-arriveBy-Routen,
 * kein früher Ausstieg + km-Fußweg zum Terminal.
 * Reines Modul — ohne RN.
 */

export type AirportTransitLegLite = {
  mode?: string | null;
  line?: string | null;
  distanceM?: number | null;
  durationSec?: number | null;
};

export type AirportTransitCandidate = {
  durationSec: number;
  startTime?: Date | null;
  endTime?: Date | null;
  legs?: AirportTransitLegLite[] | null;
  transfers?: number | null;
};

/** Letzte Fuß-/Rad-Distanz (m); 0 wenn die Kette auf Transit endet. */
export function finalEgressWalkM(transit: AirportTransitCandidate): number {
  const legs = transit.legs ?? [];
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i]!;
    const mode = String(l.mode || '').toUpperCase();
    if (mode === 'WALK' || mode === 'BIKE' || mode === 'FOOT') {
      const d = l.distanceM;
      if (d != null && Number.isFinite(d) && d > 0) return d;
      const sec = l.durationSec ?? 0;
      // ~80 m/Min Fuß
      return Math.max(0, Math.round((sec / 60) * 80));
    }
    return 0;
  }
  return 0;
}

function transferCount(transit: AirportTransitCandidate): number {
  if (transit.transfers != null && Number.isFinite(transit.transfers)) {
    return Math.max(0, Math.floor(transit.transfers));
  }
  const rides = (transit.legs ?? []).filter((l) => {
    const m = String(l.mode || '').toUpperCase();
    return m && m !== 'WALK' && m !== 'BIKE' && m !== 'FOOT';
  }).length;
  return Math.max(0, rides - 1);
}

function hasAirportExpressBus(transit: AirportTransitCandidate): boolean {
  return (transit.legs ?? []).some((l) => {
    const line = String(l.line || '').replace(/\s+/g, '');
    return /^X\d/i.test(line) || /^S1$/i.test(line);
  });
}

export function isSaneAirportAccessTransit(
  transit: AirportTransitCandidate,
  opts: { arriveByMs: number; taxiMin: number; nowMs?: number },
): boolean {
  const now = opts.nowMs ?? Date.now();
  const durMin = Math.max(1, Math.round((transit.durationSec || 0) / 60));
  if (durMin > 180) return false;
  if (durMin > Math.max(90, opts.taxiMin * 5)) return false;
  const start = transit.startTime?.getTime();
  const end = transit.endTime?.getTime();
  if (start == null || end == null) return false;
  if (end < start) return false;
  // ±10 Min Toleranz am Terminal (Founder: knapp nach Plan ok)
  if (end > opts.arriveByMs + 10 * 60_000) return false;
  if (start < opts.arriveByMs - 8 * 3600_000) return false;
  if (start < now - 2 * 60_000) return false;
  // Früher Ausstieg + langer Fußweg zum Gate = Müll
  if (finalEgressWalkM(transit) > 900) return false;
  return true;
}

/**
 * Höher = besser. Nur auf Kandidaten anwenden, die isSane… bestehen.
 * Bevorzugt: kurze Egress-Fußwege, Airport-Express (X95/S1), wenige Umstiege,
 * Ankunft nah am arriveBy (nicht unnötig 40+ Min zu früh).
 */
export function scoreAirportAccessTransit(
  transit: AirportTransitCandidate,
  opts: { arriveByMs: number; taxiMin: number; nowMs?: number },
): number {
  if (!isSaneAirportAccessTransit(transit, opts)) return Number.NEGATIVE_INFINITY;
  const end = transit.endTime!.getTime();
  const egress = finalEgressWalkM(transit);
  const transfers = transferCount(transit);
  const durMin = Math.max(1, Math.round((transit.durationSec || 0) / 60));
  const earlyMin = Math.max(0, Math.round((opts.arriveByMs - end) / 60_000));
  let score = 1000;
  score -= egress * 0.4; // 900 m ≈ −360
  score -= transfers * 80;
  score -= Math.max(0, earlyMin - 25) * 3; // >25 Min zu früh weicher Malus
  score -= Math.max(0, durMin - opts.taxiMin) * 0.5;
  if (hasAirportExpressBus(transit)) score += 120;
  if (egress <= 250) score += 80;
  if (transfers <= 1) score += 60;
  return score;
}

export function pickBestAirportAccessTransit<T extends AirportTransitCandidate>(
  candidates: T[],
  opts: { arriveByMs: number; taxiMin: number; nowMs?: number },
): T | null {
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const s = scoreAirportAccessTransit(c, opts);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}
