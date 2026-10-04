/**
 * Kombi-Score: Flug + Stay + Transfer → beste Gesamtsumme.
 */

import type { ComboWindow } from '../types';
import { isDealAnomaly } from './dealAnomaly';

export type ComboCandidate = {
  id: string;
  checkin: string;
  checkout: string;
  label: string;
  flightEur: number | null;
  stayEur: number | null;
  transferEur: number | null;
};

export function comboTotal(c: ComboCandidate): number | null {
  const parts = [c.flightEur, c.stayEur, c.transferEur].filter(
    (x): x is number => x != null && x > 0,
  );
  if (!parts.length) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0));
}

export function rankCombos(
  cands: ComboCandidate[],
  opts?: { dealRatio?: number },
): ComboWindow[] {
  const stayPeers = cands.map((c) => c.stayEur).filter((x): x is number => x != null && x > 0);
  const flightPeers = cands.map((c) => c.flightEur).filter((x): x is number => x != null && x > 0);
  const ratio = opts?.dealRatio ?? 0.72;

  const mapped: ComboWindow[] = cands.map((c) => {
    const totalEur = comboTotal(c);
    const dealHit =
      isDealAnomaly(c.stayEur, stayPeers, ratio) ||
      isDealAnomaly(c.flightEur, flightPeers, ratio);
    return {
      id: c.id,
      checkin: c.checkin,
      checkout: c.checkout,
      flightEur: c.flightEur,
      stayEur: c.stayEur,
      transferEur: c.transferEur,
      totalEur,
      label: c.label,
      dealHit,
    };
  });

  return mapped.sort((a, b) => {
    if (a.dealHit !== b.dealHit) return a.dealHit ? -1 : 1;
    const ta = a.totalEur ?? 9e9;
    const tb = b.totalEur ?? 9e9;
    if (ta !== tb) return ta - tb;
    return (a.flightEur ?? 9e9) - (b.flightEur ?? 9e9);
  });
}

/** Grobe Taxi-Schätzung EUR aus Distanz km (DE Stadt). */
export function estimateTaxiEur(km: number): number {
  if (!(km > 0)) return 12;
  return Math.round(3.9 + km * 2.3);
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
