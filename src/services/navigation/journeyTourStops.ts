/**
 * ÖPNV-Tour-Stops zusammenziehen — keine RN-Imports (Tests + startJourneyNavigation).
 */

import { tidyHaltName } from '../transit/haltName';

export type JourneyTourStop = {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  done: boolean;
  role?: 'walk' | 'board' | 'alight' | 'transfer' | 'dest';
  line?: string | null;
  headsign?: string | null;
  notes?: string | null;
  startMs?: number | null;
  speakOnStart?: string | null;
  distanceM?: number | null;
  [key: string]: unknown;
};

function haversineStop(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** „Bahnhof Pinneberg“ / „Bf. Pinneberg“ / „Pinneberg“ → gleicher Kern. */
function haltCoreKey(name: string): string {
  return tidyHaltName(name)
    .toLowerCase()
    .replace(
      /\b(bahnhof|busbahnhof|bhf|bf\.?|hbf|haltepunkt|haltestelle|zob)\b/giu,
      ' ',
    )
    .replace(/[^a-z0-9äöüß]+/giu, '')
    .trim();
}

export function foldTinyTransfers<T extends JourneyTourStop>(stops: T[]): T[] {
  const out: T[] = [];
  for (const s of stops) {
    const prev = out[out.length - 1];
    const sameHalt =
      Boolean(prev) &&
      tidyHaltName(prev!.name).toLowerCase() ===
        tidyHaltName(s.name).toLowerCase();
    const sameCore =
      Boolean(prev) &&
      haltCoreKey(prev!.name) !== '' &&
      haltCoreKey(prev!.name) === haltCoreKey(s.name);
    const tinyWalk =
      (s.role === 'walk' || s.role === 'transfer') &&
      prev &&
      (prev.role === 'alight' || prev.role === 'walk') &&
      (sameHalt ||
        // Bahnhof/Bf. Varianten nur bei kurzem Gleiswechsel falten
        (sameCore && (s.distanceM == null || s.distanceM < 180)) ||
        (haversineStop(prev, s) < 140 &&
          (s.distanceM == null || s.distanceM < 220)));
    // Echter Umstieg zu Fuß (anderer Halt, ≥220 m) bleibt sichtbar.
    const realTransferWalk =
      s.role === 'transfer' &&
      !sameHalt &&
      typeof s.distanceM === 'number' &&
      s.distanceM >= 220;
    if (tinyWalk && prev && !realTransferWalk) {
      prev.notes = [prev.notes, s.notes].filter(Boolean).join(' · ');
      if (s.line) prev.line = prev.line || s.line;
      if (s.headsign) prev.headsign = prev.headsign || s.headsign;
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * Nach der letzten Bahn: nur noch Ziel zu Fuß.
 * Kein zweites „Pinneberg Umsteigen“ plus „Pinneberg Aussteigen“.
 */
export function collapseJourneyTourStops<T extends JourneyTourStop>(
  stops: T[],
  dest: { lat: number; lng: number; name: string },
): T[] {
  if (stops.length < 2) return stops;
  let lastAlight = -1;
  for (let i = 0; i < stops.length; i += 1) {
    if (stops[i]!.role === 'alight') lastAlight = i;
  }
  if (lastAlight < 0) return stops;
  const head = stops.slice(0, lastAlight + 1);
  const tail = stops.slice(lastAlight + 1);
  const walkToDest =
    [...tail].filter((s) => s.role === 'walk' || s.role === 'transfer').pop() ??
    [...tail].reverse().find((s) => s.role === 'dest');
  const destStop = {
    poiId: -1,
    name: dest.name,
    lat: dest.lat,
    lng: dest.lng,
    done: false,
    role: 'dest' as const,
    startMs: walkToDest?.startMs ?? stops[stops.length - 1]?.startMs ?? null,
    endMs: walkToDest?.endMs ?? null,
    durationSec: walkToDest?.durationSec,
    distanceM: walkToDest?.distanceM,
    path: walkToDest?.path,
    notes: walkToDest?.notes || 'Ankunft',
    speakOnStart: `Letzter Fußweg zu ${dest.name}.`,
  } as T;
  const last = head[head.length - 1];
  // Nur kollabieren wenn wirklich derselbe Punkt UND kein eigener Fußweg.
  // Sonst verschluckt der Alight den letzten Walk → Fuß nach ÖPNV stirbt.
  const walkPathLen = walkToDest?.path?.length ?? 0;
  const nearSame =
    last &&
    Math.abs(last.lat - dest.lat) < 1e-4 &&
    Math.abs(last.lng - dest.lng) < 1e-4;
  if (nearSame && walkPathLen < 3) {
    last.role = 'dest';
    last.name = dest.name;
    return foldTinyTransfers(head);
  }
  return foldTinyTransfers([...head, destStop]);
}
