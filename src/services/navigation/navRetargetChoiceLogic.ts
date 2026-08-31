/**
 * Reine Logik für Zweit-Ziel während Navigation — ohne Store/TTS.
 */

import type { QuickAction, QuickActionPayload } from '../../types/concierge';

function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function numericPoiId(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

export function isSameNavTarget(
  current: {
    name?: string | null;
    lat?: number | null;
    lng?: number | null;
    poiId?: number | null;
  },
  next: {
    name?: string | null;
    lat?: number | null;
    lng?: number | null;
    poiId?: string | number | null;
  },
): boolean {
  const cPoi =
    typeof current.poiId === 'number' && current.poiId >= 0
      ? current.poiId
      : null;
  const nPoi = numericPoiId(next.poiId);
  if (cPoi != null && nPoi != null && cPoi === nPoi) return true;

  const cLat = current.lat;
  const cLng = current.lng;
  const nLat = next.lat;
  const nLng = next.lng;
  if (
    typeof cLat === 'number' &&
    typeof cLng === 'number' &&
    typeof nLat === 'number' &&
    typeof nLng === 'number' &&
    Number.isFinite(cLat) &&
    Number.isFinite(cLng) &&
    Number.isFinite(nLat) &&
    Number.isFinite(nLng) &&
    haversineM(cLat, cLng, nLat, nLng) < 55
  ) {
    return true;
  }

  const a = (current.name ?? '').trim().toLowerCase();
  const b = (next.name ?? '').trim().toLowerCase();
  if (a.length >= 3 && b.length >= 3 && (a === b || a.includes(b) || b.includes(a))) {
    return true;
  }
  return false;
}

export function buildNavRetargetChoice(payload: QuickActionPayload): {
  speech: string;
  bullets: string[];
  actions: QuickAction[];
} {
  const name = (payload.destName ?? '').trim() || 'der neue Ort';
  const shared: QuickActionPayload = {
    destName: payload.destName,
    destLat: payload.destLat,
    destLng: payload.destLng,
    targetPoiId: payload.targetPoiId,
    preferWalk: payload.preferWalk,
    preferBike: payload.preferBike,
    skipClosingGate: payload.skipClosingGate ?? true,
    skipDestVerify: payload.skipDestVerify ?? true,
    offlineOnly: payload.offlineOnly,
  };
  return {
    speech: `Du bist schon unterwegs. Route neu — oder ${name} als Stopp, dann sortiere ich den Weg.`,
    bullets: ['Route neu ersetzt das aktuelle Ziel', 'Stopp wird effizient einsortiert'],
    actions: [
      {
        type: 'START_NAVIGATION',
        label: 'Route neu',
        payload: { ...shared, replaceRoute: true },
      },
      {
        type: 'START_NAVIGATION',
        label: 'Stopp hinzufügen',
        payload: { ...shared, addStop: true },
      },
    ],
  };
}
