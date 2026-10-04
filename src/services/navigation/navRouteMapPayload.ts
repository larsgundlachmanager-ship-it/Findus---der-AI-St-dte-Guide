/**
 * Karten-Payload für aktive Navigation: aktuelles Bein, weitere Tour-Beine, Pins, Pfeile.
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';
import { bearingDegrees } from './bearing';
import { getMapMatchAlongM, getRemainingRouteCoords } from './mapMatchEngine';
import { isTurnManeuver } from './navPredictiveCue';
import { getActiveNavDestination } from './navigationService';
import {
  isGenericMapPointLabel,
  stripEntranceDisplaySuffix,
  stripNavDestLeak,
} from './streetAddressQuery';
import {
  ensureTourAheadRoutes,
  peekTourAheadLeg,
  type AheadCoord,
} from './tourAheadRouteCache';

export type NavRouteMapCoord = { lat: number; lng: number };

export type NavRouteMapPin = {
  lat: number;
  lng: number;
  n: number;
  name: string;
  current?: boolean;
  icon?: string;
  chip?: { title: string; sub?: string } | null;
};

export type NavRouteMapArrow = {
  lat: number;
  lng: number;
  bearing: number;
  kind: 'flow' | 'turn';
  /** Zoom-LOD: hi = Nahzoom, lo = Übersicht (weniger Pfeile). */
  lod?: 'hi' | 'lo';
};

export type NavRouteMapPayload = {
  current: NavRouteMapCoord[];
  /** Echte Straßen-Beine (eines pro Folgestopp) — nie Luftlinie. */
  ahead: NavRouteMapCoord[][];
  aheadMeta?: Array<'walk' | 'transit'>;
  /** Fallback für den Renderer, falls `ahead` leer ankommt. */
  lines?: Array<{ kind: 'walk' | 'transit'; coords: NavRouteMapCoord[] }>;
  pins: NavRouteMapPin[];
  arrows: NavRouteMapArrow[];
  /**
   * Goldene Abbiege-Shafts (Garmin): schlängeln auf der blauen Route um die Ecke.
   */
  turnBands?: NavRouteMapCoord[][];
  /** Dreieck-Köpfe zu den Shafts (gefüllt, gold). */
  turnHeads?: NavRouteMapCoord[][];
  /** true: ganze ÖPNV-Reise, Follow aus, weit rauszoomen. */
  fitWide?: boolean;
  fitKey?: string;
  previewPin?: NavRouteMapCoord | null;
  /** Wegweiser-Vorschau — gestrichelte Linie, kein Turn-by-Turn. */
  preview?: boolean;
};

/**
 * Billige Delta-Signatur — kein volles JSON.stringify der Dense-Spline.
 */
export function navRoutePayloadSig(
  payload: NavRouteMapPayload | null | undefined,
): string {
  if (payload == null) return 'null';
  const c = payload.current ?? [];
  const a = payload.ahead ?? [];
  const pins = payload.pins ?? [];
  const first = c[0];
  const last = c.length > 0 ? c[c.length - 1] : null;
  const a0 = a[0];
  const a0last = a0 && a0.length > 0 ? a0[a0.length - 1] : null;
  return [
    c.length,
    first ? `${first.lat.toFixed(5)},${first.lng.toFixed(5)}` : '',
    last ? `${last.lat.toFixed(5)},${last.lng.toFixed(5)}` : '',
    a.length,
    a0?.length ?? 0,
    a0last ? `${a0last.lat.toFixed(5)},${a0last.lng.toFixed(5)}` : '',
    pins.length,
    pins[0]?.n ?? '',
    pins[1]
      ? `${pins[1].lat.toFixed(4)},${pins[1].lng.toFixed(4)}`
      : '',
    payload.fitKey ?? '',
    payload.preview ? '1' : '0',
    payload.fitWide ? '1' : '0',
    // Trim-Index: Payload ändert sich wenn Remaining am GPS wandert
    Math.round(getMapMatchAlongM()),
  ].join('|');
}

function isAirLine(pts: NavRouteMapCoord[]): boolean {
  if (pts.length !== 2) return false;
  return (
    haversineMeters(pts[0]!.lat, pts[0]!.lng, pts[1]!.lat, pts[1]!.lng) > 80
  );
}

/** Max. Abstand eines Punkts zur Sehne Start→Ende (Meter). */
function maxDeviationFromChordM(pts: NavRouteMapCoord[]): number {
  if (pts.length < 3) return 0;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const chord = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  if (chord < 1) return 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i]!;
    const d1 = haversineMeters(a.lat, a.lng, p.lat, p.lng);
    const d2 = haversineMeters(p.lat, p.lng, b.lat, b.lng);
    // Heron: Fläche → Höhe zur Sehne
    const s = (chord + d1 + d2) / 2;
    const area2 = Math.max(0, s * (s - chord) * (s - d1) * (s - d2));
    const h = (2 * Math.sqrt(area2)) / chord;
    if (h > max) max = h;
  }
  return max;
}

/**
 * 2 Punkte über Distanz ODER Quasi-Sehne (Journey-Pfad ohne Straßenknicke)
 * = Luftlinie — nicht als lila Folgeben zeichnen.
 * Schwelle 40 m: lange Beine (Pinneberg→Quickborn) wirken sonst wie Straße.
 */
function isFakeRouteLine(pts: NavRouteMapCoord[]): boolean {
  if (!pts || pts.length < 2) return true;
  if (isAirLine(pts)) return true;
  if (pts.length >= 3) {
    const chord = haversineMeters(
      pts[0]!.lat,
      pts[0]!.lng,
      pts[pts.length - 1]!.lat,
      pts[pts.length - 1]!.lng,
    );
    if (chord > 80 && maxDeviationFromChordM(pts) < 40) return true;
  }
  return false;
}

function geomFromStop(ts: {
  role?: string | null;
  path?: Array<{ lat: number; lng: number }> | null;
  stations?: Array<{ lat: number; lng: number }> | null;
}): NavRouteMapCoord[] {
  const transit = ts.role === 'alight' || ts.role === 'board';
  // ÖPNV: Stationskette / Journey-Leg — nie Fuß-OSRM; gerade Schiene ist OK.
  if (transit) {
    if (Array.isArray(ts.stations) && ts.stations.length >= 2) {
      const pts = ts.stations
        .map((p) => asCoord(p.lat, p.lng))
        .filter((c): c is NavRouteMapCoord => c != null);
      if (pts.length >= 2) return pts;
    }
    if (Array.isArray(ts.path) && ts.path.length >= 2) {
      const pts = ts.path
        .map((p) => asCoord(p.lat, p.lng))
        .filter((c): c is NavRouteMapCoord => c != null);
      if (pts.length >= 2) return pts;
    }
    return [];
  }
  if (Array.isArray(ts.path) && ts.path.length >= 2) {
    const pts = ts.path
      .map((p) => asCoord(p.lat, p.lng))
      .filter((c): c is NavRouteMapCoord => c != null);
    if (pts.length >= 3 && !isFakeRouteLine(pts)) return pts;
  }
  return [];
}

function asCoord(lat: number, lng: number): NavRouteMapCoord | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function stripPinName(name: string): string {
  return stripEntranceDisplaySuffix(
    stripNavDestLeak(
      name
        .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, '')
        .replace(/^\S+\s+→\s+/, '')
        .trim(),
    ),
  );
}

function chipClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function delayBit(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec) || Math.abs(sec) < 60) return '';
  const m = Math.round(sec / 60);
  return m > 0 ? `+${m} Min` : `${m} Min`;
}

function isBusVehicle(mode?: string | null): boolean {
  return /^(BUS|FERRY)$/i.test(String(mode || '').trim());
}

/** Nur belegte Labels — Bus ohne Steig/Abfahrtsbereich → leer (kein erfundenes Gleis). */
function gleisBit(plat?: string | null, mode?: string | null): string {
  const p = (plat ?? '').trim();
  if (!p) return '';
  if (/\b(gleis|steig|kante|abschnitt|abfahr(?:ts)?bereich|gate|bay)\b/i.test(p)) {
    if (isBusVehicle(mode) && /^gleis\b/i.test(p)) {
      return p.replace(/^gleis\b/i, 'Abfahrtsbereich').trim();
    }
    return p;
  }
  if (isBusVehicle(mode)) {
    if (/^[A-Za-z]$/.test(p)) return `Abfahrtsbereich ${p.toUpperCase()}`;
    return '';
  }
  return `Gleis ${p}`;
}

export function chipForTourStop(
  s: {
    role?: string | null;
    name: string;
    line?: string | null;
    headsign?: string | null;
    platform?: string | null;
    delaySec?: number | null;
    vehicleStartMs?: number | null;
    startMs?: number | null;
    vehicleMode?: string | null;
  },
  next?: {
    role?: string | null;
    name?: string;
    line?: string | null;
    headsign?: string | null;
    startMs?: number | null;
    vehicleMode?: string | null;
    platform?: string | null;
  } | null,
): { title: string; sub?: string } | null {
  const mode = s.vehicleMode || next?.vehicleMode || null;
  const plat = gleisBit(s.platform ?? next?.platform, mode);
  const line = (s.line || next?.line || '').trim();
  const head = (s.headsign || next?.headsign || '').trim();
  const when = chipClock(s.vehicleStartMs ?? next?.startMs ?? null);
  const delay = delayBit(s.delaySec ?? null);
  const ride = line ? (head ? `${line} nach ${head}` : line) : '';
  if (s.role === 'dest') {
    return { title: stripPinName(s.name) || 'Ziel' };
  }
  if (s.role === 'walk' || s.role === 'board') {
    // Linie + Verspätung oben; Uhr nur als „Abfahrt HH:MM“ — nicht „11:19 +1“ (verwirrt).
    const title = ride
      ? delay
        ? `${ride} · ${delay}`
        : ride
      : stripPinName(s.name);
    const bits: string[] = [];
    if (plat) bits.push(plat);
    if (when) bits.push(`Abfahrt ${when}`);
    if (!bits.length) return { title: title || stripPinName(s.name) };
    return { title, sub: bits.join(' · ') };
  }
  if (s.role === 'transfer' || s.role === 'alight') {
    const nxtLine = (next?.line || '').trim();
    const ownLine = (s.line || '').trim();
    const nxtHead = (next?.headsign || '').trim();
    const realTransfer =
      next &&
      (next.role === 'alight' || next.role === 'board') &&
      nxtLine &&
      nxtLine !== ownLine;
    if (realTransfer) {
      const nxtPlat = gleisBit(next?.platform ?? s.platform, next?.vehicleMode || mode);
      const nxtWhen = chipClock(next?.startMs ?? null);
      return {
        title: `Umsteigen ${nxtLine}${nxtHead ? ` nach ${nxtHead}` : ''}`,
        sub:
          [nxtPlat, nxtWhen ? `Abfahrt ${nxtWhen}` : ''].filter(Boolean).join(' · ') ||
          undefined,
      };
    }
    if (!next || next.role === 'dest' || next.role === 'walk') {
      const onward =
        next?.role === 'dest' || next?.role === 'walk'
          ? `weiter zu ${stripPinName(next?.name || '') || 'Fuß'}`
          : '';
      return {
        title: `Aussteigen · ${stripPinName(s.name)}`,
        sub: onward || undefined,
      };
    }
  }
  return { title: stripPinName(s.name) };
}

function pinIcon(current: boolean, n: number, numbered: boolean): string {
  if (current) {
    return numbered && n > 0 ? `route-pin-now-${Math.min(9, n)}` : 'route-pin-now';
  }
  return `route-pin-next-${Math.min(9, Math.max(1, n))}`;
}

/**
 * Offene Stopps von vorn: 1 = aktuelles Ziel. Erreichter Stopp ist weg —
 * der nächste wird wieder 1.
 */
export function remainingNavPins(
  dest: { lat: number; lng: number; name: string },
  upcoming: Array<{ lat: number; lng: number; name: string }>,
): NavRouteMapPin[] {
  const rows: Array<{ lat: number; lng: number; name: string }> = [];
  const push = (lat: number, lng: number, name: string) => {
    const c = asCoord(lat, lng);
    if (!c) return;
    const nearPrev = rows.find(
      (r) => haversineMeters(c.lat, c.lng, r.lat, r.lng) < 90,
    );
    if (nearPrev) return;
    const label = (name ?? '').trim() || 'Stop';
    rows.push({ lat: c.lat, lng: c.lng, name: label });
  };
  if (upcoming.length > 0) {
    for (const s of upcoming) push(s.lat, s.lng, s.name);
    const destC = asCoord(dest.lat, dest.lng);
    if (
      destC &&
      !rows.some(
        (r) => haversineMeters(r.lat, r.lng, destC.lat, destC.lng) < 90,
      )
    ) {
      push(dest.lat, dest.lng, dest.name.trim() || 'Ziel');
    }
  } else {
    push(dest.lat, dest.lng, dest.name.trim() || 'Ziel');
  }
  const numbered = rows.length > 1;
  return rows.map((r, i) => {
    const n = numbered ? i + 1 : 0;
    const current = i === 0;
    return {
      lat: r.lat,
      lng: r.lng,
      name: r.name,
      n,
      current,
      icon: pinIcon(current, n, numbered),
    };
  });
}

export function sampleRouteChevrons(
  line: NavRouteMapCoord[],
  everyM = 90,
  max = 22,
): NavRouteMapArrow[] {
  if (line.length < 2) return [];
  const out: NavRouteMapArrow[] = [];
  let acc = 0;
  let nextAt = Math.min(everyM * 0.55, 50);
  for (let i = 0; i < line.length - 1 && out.length < max; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const seg = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (seg < 1) continue;
    const br = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
    while (acc + seg >= nextAt && out.length < max) {
      const t = (nextAt - acc) / seg;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        bearing: br,
        kind: 'flow',
      });
      nextAt += everyM;
    }
    acc += seg;
  }
  return out;
}

/**
 * Echte Abzweigungen für die goldene Karten-Geometrie.
 * keep (Spur halten) raus; slight left/right = Abzweigung → Pfeil.
 */
export function isMapCornerManeuver(
  maneuver: string | null | undefined,
): boolean {
  const m = (maneuver ?? '').toLowerCase().trim();
  if (!m) return false;
  if (/straight|arrive|continue/.test(m)) return false;
  if (/\bkeep\b/.test(m)) return false;
  return /left|right|uturn|u-turn|roundabout|fork|ramp|sharp|end of road|slight/.test(
    m,
  );
}

export function turnArrowsFromWaypoints(
  wps: Array<{
    lat: number;
    lng: number;
    maneuver?: string | null;
    turnHeadingDeg?: number;
    arrowLat?: number;
    arrowLng?: number;
  }>,
): NavRouteMapArrow[] {
  const out: NavRouteMapArrow[] = [];
  /** Index der letzten echten Abbiegung vor Arrive — Pfeil darf nicht fehlen. */
  let lastTurnBeforeArrive = -1;
  for (let i = 0; i < wps.length; i += 1) {
    const m = (wps[i]!.maneuver ?? '').toLowerCase();
    if (m.includes('arrive') || m === 'destination') break;
    if (isTurnManeuver(wps[i]!.maneuver) && isMapCornerManeuver(wps[i]!.maneuver)) {
      lastTurnBeforeArrive = i;
    }
  }
  for (let i = 0; i < wps.length - 1; i += 1) {
    const wp = wps[i]!;
    // Karten-Pfeil: Junction-Lat/Lng — nie sidewalk-arrowLat (sonst 20 m + Versatz = zu lang).
    const forceFinal = i === lastTurnBeforeArrive;
    if (!forceFinal && !isMapCornerManeuver(wp.maneuver)) continue;
    if (!isTurnManeuver(wp.maneuver) && !forceFinal) continue;
    const nxt = wps[i + 1]!;
    const lat = wp.lat;
    const lng = wp.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const bearing =
      typeof wp.turnHeadingDeg === 'number' && Number.isFinite(wp.turnHeadingDeg)
        ? wp.turnHeadingDeg
        : bearingDegrees(lat, lng, nxt.lat, nxt.lng);
    out.push({ lat, lng, bearing, kind: 'turn' });
  }
  return out;
}

/**
 * Fallback wenn ÖPNV-Journey-Fußpfad keine OSRM-Maneuvers hat:
 * echte Straßenecken aus der Polyline (z. B. Heisterhoop → Bahnhofstr.).
 * Distanz-Lookback/-ahead — dichte Journey-Punkte sonst unter minLeg.
 */
export function turnArrowsFromPolylineCorners(
  line: NavRouteMapCoord[],
  opts?: { minTurnDeg?: number; minLegM?: number; max?: number },
): NavRouteMapArrow[] {
  if (line.length < 3) return [];
  const minTurn = opts?.minTurnDeg ?? 48;
  const minLeg = opts?.minLegM ?? 12;
  const max = opts?.max ?? 4;
  const out: NavRouteMapArrow[] = [];

  const pointBehind = (
    fromI: number,
    targetM: number,
  ): NavRouteMapCoord | null => {
    let acc = 0;
    for (let j = fromI; j > 0; j -= 1) {
      const a = line[j]!;
      const b = line[j - 1]!;
      acc += haversineMeters(a.lat, a.lng, b.lat, b.lng);
      if (acc >= targetM) return b;
    }
    return null;
  };
  const pointAhead = (
    fromI: number,
    targetM: number,
  ): NavRouteMapCoord | null => {
    let acc = 0;
    for (let j = fromI; j < line.length - 1; j += 1) {
      const a = line[j]!;
      const b = line[j + 1]!;
      acc += haversineMeters(a.lat, a.lng, b.lat, b.lng);
      if (acc >= targetM) return b;
    }
    return null;
  };

  for (let i = 1; i < line.length - 1 && out.length < max; i += 1) {
    const cur = line[i]!;
    const prev = pointBehind(i, minLeg);
    const next = pointAhead(i, minLeg);
    if (!prev || !next) continue;
    const inBr = bearingDegrees(prev.lat, prev.lng, cur.lat, cur.lng);
    const outBr = bearingDegrees(cur.lat, cur.lng, next.lat, next.lng);
    let delta = ((outBr - inBr + 540) % 360) - 180;
    const abs = Math.abs(delta);
    if (abs < minTurn || abs > 170) continue;
    // Zu nah am Start/Ziel → kein Pfeil (nur echte Zwischen-Abbiegungen).
    const fromStart = haversineMeters(
      line[0]!.lat,
      line[0]!.lng,
      cur.lat,
      cur.lng,
    );
    const toEnd = haversineMeters(
      cur.lat,
      cur.lng,
      line[line.length - 1]!.lat,
      line[line.length - 1]!.lng,
    );
    if (fromStart < 25 || toEnd < 30) continue;
    // Nicht denselben Knick doppelt (dichte Vertices um die Ecke).
    if (
      out.some(
        (t) => haversineMeters(t.lat, t.lng, cur.lat, cur.lng) < 28,
      )
    ) {
      continue;
    }
    out.push({ lat: cur.lat, lng: cur.lng, bearing: outBr, kind: 'turn' });
  }
  return out;
}

/**
 * Garmin-Stil: goldener Abbiege-Pfeil = Geometrie auf der Route.
 * Shaft schlängelt vor+um+nach der Ecke; Head = V-Linie (kein Polygon — MapLibre-Crash).
 */
export type NavRouteTurnArrowGeom = {
  shaft: NavRouteMapCoord[];
  /** Geschlossenes Dreieck Spitze→links→rechts→Spitze (ausgefüllter Kopf). */
  head: NavRouteMapCoord[];
};

function offsetLatLng(
  lat: number,
  lng: number,
  bearingDeg: number,
  distM: number,
): NavRouteMapCoord {
  const br = (bearingDeg * Math.PI) / 180;
  const latM = 1 / 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngM = 1 / (111_320 * Math.max(0.25, Math.abs(cosLat)));
  const out = {
    lat: lat + Math.cos(br) * distM * latM,
    lng: lng + Math.sin(br) * distM * lngM,
  };
  if (!Number.isFinite(out.lat) || !Number.isFinite(out.lng)) {
    return { lat, lng };
  }
  return out;
}

/**
 * Exakte Metern entlang der Polyline vom Index `fromI` in Richtung `dir`.
 * Liefert Punkte inkl. interpoliertem Endpunkt (kein Segment-Überstand).
 */
function walkExactMeters(
  line: NavRouteMapCoord[],
  fromI: number,
  dir: -1 | 1,
  targetM: number,
): NavRouteMapCoord[] {
  if (line.length < 2 || targetM <= 0) return [{ ...line[fromI]! }];
  const out: NavRouteMapCoord[] = [{ ...line[fromI]! }];
  let acc = 0;
  let i = fromI;
  while (acc < targetM) {
    const nextI = i + dir;
    if (nextI < 0 || nextI >= line.length) break;
    const a = line[i]!;
    const b = line[nextI]!;
    const seg = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (seg < 0.05) {
      i = nextI;
      continue;
    }
    if (acc + seg >= targetM) {
      const t = (targetM - acc) / seg;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
      return out;
    }
    out.push({ ...b });
    acc += seg;
    i = nextI;
  }
  return out;
}

/** Nächster Punkt AUF der Polyline (Segment), nicht nur Vertex — sonst zu lange Shafts. */
function snapTurnOntoLine(
  line: NavRouteMapCoord[],
  lat: number,
  lng: number,
): { work: NavRouteMapCoord[]; junctionI: number; distM: number } | null {
  if (line.length < 2) return null;
  let bestD = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  let bestPt: NavRouteMapCoord = line[0]!;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const abLat = b.lat - a.lat;
    const abLng = b.lng - a.lng;
    const ab2 = abLat * abLat + abLng * abLng;
    const t =
      ab2 < 1e-18
        ? 0
        : Math.max(
            0,
            Math.min(1, ((lat - a.lat) * abLat + (lng - a.lng) * abLng) / ab2),
          );
    const pt = { lat: a.lat + abLat * t, lng: a.lng + abLng * t };
    const d = haversineMeters(lat, lng, pt.lat, pt.lng);
    if (d < bestD) {
      bestD = d;
      bestSeg = i;
      bestT = t;
      bestPt = pt;
    }
  }
  const work = line.map((p) => ({ ...p }));
  let junctionI = bestSeg;
  if (bestT <= 0.02) {
    junctionI = bestSeg;
  } else if (bestT >= 0.98) {
    junctionI = bestSeg + 1;
  } else {
    work.splice(bestSeg + 1, 0, bestPt);
    junctionI = bestSeg + 1;
  }
  return { work, junctionI, distM: bestD };
}

function polylineLengthM(pts: NavRouteMapCoord[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i += 1) {
    sum += haversineMeters(
      pts[i - 1]!.lat,
      pts[i - 1]!.lng,
      pts[i]!.lat,
      pts[i]!.lng,
    );
  }
  return sum;
}

/**
 * Ausgefüllter Pfeilkopf: geschlossenes Dreieck (Spitze → links → rechts → Spitze).
 * Immer ≥4 Ring-Punkte + Mindestfläche — sonst MapLibre-JNI-Blackscreen.
 */
export function arrowHeadPolygon(
  tip: NavRouteMapCoord,
  bearingDeg: number,
  lengthM = 6,
  halfWidthM = 4.5,
): NavRouteMapCoord[] {
  if (
    !Number.isFinite(tip.lat) ||
    !Number.isFinite(tip.lng) ||
    !Number.isFinite(bearingDeg) ||
    lengthM < 2 ||
    halfWidthM < 2
  ) {
    return [];
  }
  const base = offsetLatLng(tip.lat, tip.lng, bearingDeg + 180, lengthM);
  const left = offsetLatLng(base.lat, base.lng, bearingDeg + 90, halfWidthM);
  const right = offsetLatLng(base.lat, base.lng, bearingDeg - 90, halfWidthM);
  if (
    !Number.isFinite(left.lat) ||
    !Number.isFinite(left.lng) ||
    !Number.isFinite(right.lat) ||
    !Number.isFinite(right.lng)
  ) {
    return [];
  }
  if (
    haversineMeters(left.lat, left.lng, right.lat, right.lng) < 2 ||
    haversineMeters(tip.lat, tip.lng, base.lat, base.lng) < 2 ||
    haversineMeters(tip.lat, tip.lng, left.lat, left.lng) < 2 ||
    haversineMeters(tip.lat, tip.lng, right.lat, right.lng) < 2
  ) {
    return [];
  }
  // Geschlossen: 4 Positionen für MapLibre (≥3 Ecken + Schluss).
  return [{ ...tip }, left, right, { ...tip }];
}

/**
 * Exakt: 20 m gelb vor der Ecke → um die Ecke → 10 m gelb danach → kleiner Pfeilkopf.
 * Meter werden interpoliert (kein Überziehen ganzer Segmente).
 * Optional `clipFrom`: Shaft nicht hinter dem User (sonst langer gelber Streifen).
 */
export function turnArrowGeomsAlongRoute(
  line: NavRouteMapCoord[],
  turns: NavRouteMapArrow[],
  approachLenM = 20,
  exitLenM = 10,
  maxDistFromLineM = 55,
  clipFrom: NavRouteMapCoord | null = null,
): NavRouteTurnArrowGeom[] {
  if (line.length < 2 || turns.length < 1) return [];
  const out: NavRouteTurnArrowGeom[] = [];
  const maxShaftM = approachLenM + exitLenM + 1.5;
  let clipI: number | null = null;
  if (clipFrom) {
    const snapUser = snapTurnOntoLine(line, clipFrom.lat, clipFrom.lng);
    if (snapUser && snapUser.distM <= 80) clipI = snapUser.junctionI;
  }
  for (const t of turns) {
    const snap = snapTurnOntoLine(line, t.lat, t.lng);
    if (!snap || snap.distM > maxDistFromLineM) continue;
    const { work, junctionI } = snap;
    // User-Clip auf derselben work-Linie (Junction-Index ggf. +1 durch Insert).
    let userI = clipI;
    if (clipFrom) {
      const su = snapTurnOntoLine(work, clipFrom.lat, clipFrom.lng);
      if (su && su.distM <= 80) userI = su.junctionI;
    }
    let useApproach = approachLenM;
    if (userI != null && userI < junctionI) {
      // Nur bis User zurück — kein gelber Streifen hinter dem Puck.
      let behind = 0;
      for (let i = junctionI; i > userI; i -= 1) {
        behind += haversineMeters(
          work[i]!.lat,
          work[i]!.lng,
          work[i - 1]!.lat,
          work[i - 1]!.lng,
        );
      }
      useApproach = Math.min(approachLenM, Math.max(4, behind));
    }
    const back = walkExactMeters(work, junctionI, -1, useApproach);
    const fwd = walkExactMeters(work, junctionI, 1, exitLenM);
    const shaft = [...back].reverse().concat(fwd.slice(1));
    if (shaft.length < 2) continue;
    const shaftM = polylineLengthM(shaft);
    if (shaftM > maxShaftM) continue;
    // Harte Kappe: nie länger als 20+10 (+Kopf-Spiel).
    if (shaftM > approachLenM + exitLenM + 0.75) {
      // sollte nicht greifen — Safety
      continue;
    }
    const tipBase = shaft[shaft.length - 1]!;
    const prev = shaft[shaft.length - 2]!;
    if (
      !Number.isFinite(tipBase.lat) ||
      !Number.isFinite(tipBase.lng) ||
      !Number.isFinite(prev.lat) ||
      !Number.isFinite(prev.lng)
    ) {
      continue;
    }
    if (haversineMeters(prev.lat, prev.lng, tipBase.lat, tipBase.lng) < 0.5) {
      continue;
    }
    const bearing = bearingDegrees(prev.lat, prev.lng, tipBase.lat, tipBase.lng);
    if (!Number.isFinite(bearing)) continue;
    const headLenM = 6;
    // Spitze etwas vor Shaft-Ende — sonst ragt die gelbe Line-Cap vor dem Dreieck.
    const tip = offsetLatLng(tipBase.lat, tipBase.lng, bearing, 2.2);
    const head = arrowHeadPolygon(tip, bearing, headLenM, 4.5);
    out.push({ shaft, head: head.length >= 4 ? head : [] });
  }
  return out;
}

/** @deprecated — nutze turnArrowGeomsAlongRoute (Garmin-Shaft). */
export function turnBandsAlongRoute(
  line: NavRouteMapCoord[],
  turns: NavRouteMapArrow[],
  approachLenM = 20,
  exitLenM = 10,
  maxDistFromLineM = 55,
): NavRouteMapCoord[][] {
  return turnArrowGeomsAlongRoute(
    line,
    turns,
    approachLenM,
    exitLenM,
    maxDistFromLineM,
  ).map((g) => g.shaft);
}

/** @deprecated — Spitze steckt im Head-Polygon. */
export function turnTipsFromBands(
  bands: NavRouteMapCoord[][],
): NavRouteMapArrow[] {
  const out: NavRouteMapArrow[] = [];
  for (const band of bands) {
    if (band.length < 2) continue;
    const tip = band[band.length - 1]!;
    const prev = band[band.length - 2]!;
    out.push({
      lat: tip.lat,
      lng: tip.lng,
      bearing: bearingDegrees(prev.lat, prev.lng, tip.lat, tip.lng),
      kind: 'turn',
    });
  }
  return out;
}

/** WebView: lange Fuß-Splines nicht 1:1 injizieren (5 h ≈ 1000+ Punkte → Renderer-Freeze). */
const MAX_MAP_ROUTE_POINTS = 480;
const MAX_MAP_ARROWS = 80;

function downsampleCoords(
  pts: NavRouteMapCoord[],
  max = MAX_MAP_ROUTE_POINTS,
): NavRouteMapCoord[] {
  if (pts.length <= max) return pts;
  const out: NavRouteMapCoord[] = [pts[0]!];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i += 1) {
    out.push(pts[Math.round(i * step)]!);
  }
  const last = pts[pts.length - 1]!;
  if (
    out[out.length - 1]!.lat !== last.lat ||
    out[out.length - 1]!.lng !== last.lng
  ) {
    out.push(last);
  }
  return out;
}

export function buildNavRouteMapPayload(): NavRouteMapPayload | null {
  const liveDest = getActiveNavDestination();
  const tour = useFinnusStore.getState().multiStopTour;
  const upcoming = (tour?.stops ?? [])
    .slice(tour?.currentIndex ?? 0)
    .filter((s) => !s.done);
  if (!liveDest && upcoming.length < 1) return null;
  const tourHead = upcoming[0] ?? null;
  // Nach Timeline-Skip: Tour ist SSOT — alte Active-Nav nicht weiter zeichnen.
  const liveMatchesTour =
    !tourHead ||
    !liveDest ||
    haversineMeters(liveDest.lat, liveDest.lng, tourHead.lat, tourHead.lng) <
      120;
  const dest =
    liveMatchesTour && liveDest
      ? liveDest
      : tourHead
        ? {
            lat: tourHead.lat,
            lng: tourHead.lng,
            name: tourHead.name,
            waypoints: [] as Array<{ lat: number; lng: number }>,
          }
        : liveDest!;
  const transitTour = upcoming.some(
    (s) => s.role === 'alight' || s.role === 'board' || s.role === 'transfer',
  );
  // Aktuelles Bein: zu Fuß zur Haltestelle = normale Fußnavi (gelbe Pfeile).
  const curRoleEarly = upcoming[0]?.role ?? null;
  const currentIsTransit =
    curRoleEarly === 'alight' || curRoleEarly === 'board';
  const walkLegActive = !currentIsTransit;

  const gps = useGpsStore.getState();
  const origin = asCoord(
    gps.lat ?? useFinnusStore.getState().lastGpsLat ?? dest.waypoints?.[0]?.lat ?? Number.NaN,
    gps.lng ?? useFinnusStore.getState().lastGpsLng ?? dest.waypoints?.[0]?.lng ?? Number.NaN,
  );

  // Remaining from map-match — never unshift GPS onto full start→dest (fork toward start).
  // Auch bei ÖPNV-Tour: solange das aktuelle Bein Fuß ist.
  let current: NavRouteMapCoord[] = [];
  if (walkLegActive && liveMatchesTour) {
    const remaining = getRemainingRouteCoords({
      userLat: origin?.lat ?? null,
      userLng: origin?.lng ?? null,
      snapMaxM: 8,
    });
    if (remaining.length >= 2) {
      current = remaining
        .map((pt) => asCoord(pt.lat, pt.lng))
        .filter((c): c is NavRouteMapCoord => c != null);
    } else {
      current = (dest.waypoints ?? [])
        .map((w) => asCoord(w.lat, w.lng))
        .filter((c): c is NavRouteMapCoord => c != null);
    }
  }

  const last = current[current.length - 1];
  if (
    walkLegActive &&
    (!last ||
      Math.abs(last.lat - dest.lat) > 1e-5 ||
      Math.abs(last.lng - dest.lng) > 1e-5)
  ) {
    const end = asCoord(dest.lat, dest.lng);
    if (end) current.push(end);
  }

  const pins = remainingNavPins(
    { lat: dest.lat, lng: dest.lng, name: dest.name ?? 'Ziel' },
    upcoming.map((s) => ({ lat: s.lat, lng: s.lng, name: s.name })),
  );
  const usedStops = new Set<number>();
  for (const pin of pins) {
    let best = -1;
    let bestD = 80;
    for (let i = 0; i < upcoming.length; i += 1) {
      if (usedStops.has(i)) continue;
      const s = upcoming[i]!;
      const d = haversineMeters(pin.lat, pin.lng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      usedStops.add(best);
      pin.chip = chipForTourStop(upcoming[best]!, upcoming[best + 1] ?? null);
    }
  }
  // Chip nur bei echter Info — kein „Punkt auf der Karte“ / leeres Ziel.
  for (const pin of pins) {
    const title = pin.chip?.title?.trim() || stripPinName(pin.name);
    const sub = pin.chip?.sub?.trim();
    if (!title || (isGenericMapPointLabel(title) && !sub)) {
      pin.chip = null;
      continue;
    }
    if (isGenericMapPointLabel(title) && sub) {
      pin.chip = { title: sub, sub: undefined };
      continue;
    }
    pin.chip = sub ? { title, sub } : { title };
  }

  const stopCoords: AheadCoord[] = pins.map((p) => ({ lat: p.lat, lng: p.lng }));
  for (const ts of upcoming) {
    if (!Array.isArray(ts.path) || ts.path.length < 2) continue;
    let best: AheadCoord | null = null;
    let bestD = 120;
    for (const c of stopCoords) {
      const d = haversineMeters(c.lat, c.lng, ts.lat, ts.lng);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      best.role = ts.role ?? best.role ?? null;
      best.vehicleMode = (ts as { vehicleMode?: string | null }).vehicleMode ?? best.vehicleMode ?? null;
      best.path = ts.path.map((p) => ({ lat: p.lat, lng: p.lng }));
    }
  }
  for (let i = 0; i < Math.min(stopCoords.length, upcoming.length); i += 1) {
    const c = stopCoords[i];
    const ts = upcoming[i];
    if (c && ts) {
      c.role = c.role ?? ts.role ?? null;
      c.vehicleMode =
        c.vehicleMode ??
        (ts as { vehicleMode?: string | null }).vehicleMode ??
        null;
      const st = (ts as { stations?: Array<{ lat: number; lng: number }> | null })
        .stations;
      if (Array.isArray(st) && st.length >= 2) {
        (c as AheadCoord & { stations?: AheadCoord[] }).stations = st.map((p) => ({
          lat: p.lat,
          lng: p.lng,
        }));
      }
    }
  }
  ensureTourAheadRoutes(
    transitTour
      ? stopCoords
      : origin
        ? [{ lat: origin.lat, lng: origin.lng, role: 'walk' }, ...stopCoords]
        : stopCoords,
  );

  const ahead: NavRouteMapCoord[][] = [];
  const aheadMeta: Array<'walk' | 'transit'> = [];
  const pushAhead = (
    pts: NavRouteMapCoord[],
    kind: 'walk' | 'transit',
  ): void => {
    if (!pts || pts.length < 2) return;
    ahead.push(pts);
    aheadMeta.push(kind);
  };
  for (const ts of upcoming) {
    const geom = geomFromStop(ts);
    const kind =
      ts.role === 'alight' || ts.role === 'board' ? 'transit' : 'walk';
    if (geom.length < 2) continue;
    if (kind !== 'transit' && isFakeRouteLine(geom)) continue;
    if (
      transitTour &&
      kind === 'walk' &&
      geom.length >= 2 &&
      haversineMeters(
        geom[0]!.lat,
        geom[0]!.lng,
        geom[geom.length - 1]!.lat,
        geom[geom.length - 1]!.lng,
      ) > 2500 &&
      haversineMeters(
        geom[geom.length - 1]!.lat,
        geom[geom.length - 1]!.lng,
        dest.lat,
        dest.lng,
      ) < 120
    ) {
      continue;
    }
    pushAhead(geom, kind);
  }
  if (stopCoords.length >= 2) {
    for (let i = 0; i < stopCoords.length - 1; i += 1) {
      const a = stopCoords[i]!;
      const b = stopCoords[i + 1]!;
      const fromStop = upcoming[i + 1] ? geomFromStop(upcoming[i + 1]!) : [];
      const transitLeg =
        b.role === 'alight' ||
        b.role === 'board' ||
        ((b.vehicleMode || '').toUpperCase() === 'RAIL' ||
          (b.vehicleMode || '').toUpperCase() === 'SUBWAY' ||
          (b.vehicleMode || '').toUpperCase() === 'TRAM' ||
          (b.vehicleMode || '').toUpperCase() === 'TRANSIT');
      // Transit: Stationskette/Journey vor Fuß-OSRM-Cache.
      const routed = peekTourAheadLeg(a, b);
      const line = transitLeg
        ? fromStop.length >= 2
          ? fromStop
          : routed && routed.length >= 2
            ? routed
            : []
        : routed && routed.length >= 3 && !isFakeRouteLine(routed)
          ? routed
          : fromStop.length >= 3 && !isFakeRouteLine(fromStop)
            ? fromStop
            : [];
      if (line.length < 2) continue;
      if (!transitLeg && isFakeRouteLine(line)) continue;
      const already =
        ahead.some(
          (leg) =>
            leg.length >= 2 &&
            haversineMeters(leg[0]!.lat, leg[0]!.lng, line[0]!.lat, line[0]!.lng) < 40 &&
            haversineMeters(
              leg[leg.length - 1]!.lat,
              leg[leg.length - 1]!.lng,
              line[line.length - 1]!.lat,
              line[line.length - 1]!.lng,
            ) < 40,
        );
      if (already) continue;
      pushAhead(line, transitLeg ? 'transit' : 'walk');
    }
  }

  const firstWalkPath = (() => {
    const hit = upcoming.find(
      (s) =>
        (s.role === 'walk' || s.role === 'board' || s.role == null) &&
        Array.isArray(s.path) &&
        s.path.length >= 3,
    );
    let pts: NavRouteMapCoord[] | null = null;
    if (hit?.path && hit.path.length >= 3) {
      pts = hit.path.map((p) => ({ lat: p.lat, lng: p.lng }));
    } else if (origin && pins[0]) {
      const routed = peekTourAheadLeg(origin, {
        lat: pins[0].lat,
        lng: pins[0].lng,
      });
      if (routed && routed.length >= 3) pts = routed;
    }
    if (
      pts &&
      transitTour &&
      pts.length >= 2 &&
      haversineMeters(
        pts[0]!.lat,
        pts[0]!.lng,
        pts[pts.length - 1]!.lat,
        pts[pts.length - 1]!.lng,
      ) > 2500 &&
      haversineMeters(
        pts[pts.length - 1]!.lat,
        pts[pts.length - 1]!.lng,
        dest.lat,
        dest.lng,
      ) < 120
    ) {
      return null;
    }
    return pts;
  })();
  const currentLooksAir =
    current.length === 2 &&
    haversineMeters(
      current[0]!.lat,
      current[0]!.lng,
      current[1]!.lat,
      current[1]!.lng,
    ) > 80;

  let mapped: NavRouteMapCoord[];
  if (currentIsTransit) {
    const rail = geomFromStop(upcoming[0] ?? {});
    // Aktuelles Bein + alle folgenden Transit-Beine = eine Linie bis zum Ziel.
    const chain: NavRouteMapCoord[] = rail.length >= 2 ? [...rail] : [];
    for (let i = 0; i < ahead.length; i += 1) {
      if (aheadMeta[i] !== 'transit') continue;
      const leg = ahead[i]!;
      if (leg.length < 2) continue;
      if (chain.length === 0) {
        chain.push(...leg);
        continue;
      }
      const last = chain[chain.length - 1]!;
      const first = leg[0]!;
      if (haversineMeters(last.lat, last.lng, first.lat, first.lng) > 40) {
        chain.push(first);
      }
      for (let j = 1; j < leg.length; j += 1) chain.push(leg[j]!);
    }
    mapped = chain.length >= 2 ? downsampleCoords(chain) : [];
  } else if (
    // Live-Fußroute (FOSSGIS/Map-Match) schlägt Journey-Polyline — sonst keine Abbiege-Pfeile.
    walkLegActive &&
    current.length >= 3 &&
    !isFakeRouteLine(current) &&
    !currentLooksAir
  ) {
    mapped = downsampleCoords(current);
  } else if (
    transitTour &&
    firstWalkPath &&
    firstWalkPath.length >= 3 &&
    !isFakeRouteLine(firstWalkPath)
  ) {
    mapped = downsampleCoords(firstWalkPath);
  } else if (
    (currentLooksAir || current.length < 3) &&
    firstWalkPath &&
    firstWalkPath.length >= 3 &&
    !isFakeRouteLine(firstWalkPath)
  ) {
    mapped = downsampleCoords(firstWalkPath);
  } else if (isFakeRouteLine(current) || currentLooksAir) {
    // Nie GPS→Ziel-Luftlinie zeichnen — nur Pin, bis FOSSGIS/OSRM da ist.
    mapped = [];
  } else {
    mapped = downsampleCoords(current);
  }

  // Linie immer User → Ziel, sonst zeigen Line-Chevrons rückwärts.
  if (mapped.length >= 2) {
    const first = mapped[0]!;
    const last = mapped[mapped.length - 1]!;
    const firstToDest = haversineMeters(first.lat, first.lng, dest.lat, dest.lng);
    const lastToDest = haversineMeters(last.lat, last.lng, dest.lat, dest.lng);
    if (firstToDest + 25 < lastToDest) {
      mapped = [...mapped].reverse();
    }
  }

  // Loading ohne Linie: Pin sichtbar, keine Chevrons auf Fake-Geometrie.
  const routeAwaitingStreet =
    mapped.length < 3 && pins.length > 0 && !currentIsTransit;

  const sameEnds = (a: NavRouteMapCoord[], b: NavRouteMapCoord[]): boolean =>
    a.length >= 2 &&
    b.length >= 2 &&
    haversineMeters(a[0]!.lat, a[0]!.lng, b[0]!.lat, b[0]!.lng) < 40 &&
    haversineMeters(
      a[a.length - 1]!.lat,
      a[a.length - 1]!.lng,
      b[b.length - 1]!.lat,
      b[b.length - 1]!.lng,
    ) < 40;
  const sameDest = (a: NavRouteMapCoord[], b: NavRouteMapCoord[]): boolean =>
    a.length >= 2 &&
    b.length >= 2 &&
    haversineMeters(
      a[a.length - 1]!.lat,
      a[a.length - 1]!.lng,
      b[b.length - 1]!.lat,
      b[b.length - 1]!.lng,
    ) < 80;
  const keptAhead: NavRouteMapCoord[][] = [];
  const keptMeta: Array<'walk' | 'transit'> = [];
  for (let i = 0; i < ahead.length; i += 1) {
    const leg = ahead[i]!;
    const kind = aheadMeta[i] ?? 'walk';
    if (sameEnds(leg, mapped)) continue;
    // Aktives Fußbein schon blau (FOSSGIS) → keine zweite lila Luftlinie zum selben Ziel.
    if (
      kind === 'walk' &&
      walkLegActive &&
      mapped.length >= 3 &&
      !currentLooksAir &&
      sameDest(leg, mapped)
    ) {
      continue;
    }
    // Transit-Stationsketten oft geradlinig — nicht als Fake verwerfen.
    if (kind !== 'transit' && isFakeRouteLine(leg)) continue;
    keptAhead.push(leg);
    keptMeta.push(kind);
  }
  const aheadSlim = keptAhead.map((leg) => downsampleCoords(leg, 160));
  const aheadMetaSlim = keptMeta;
  const alongNow = getMapMatchAlongM();
  const turnsFromWp = currentIsTransit
    ? []
    : turnArrowsFromWaypoints(
        (dest.waypoints ?? []).filter((w) => {
          const a = (w as { splineAlongM?: number }).splineAlongM;
          return typeof a !== 'number' || a >= alongNow - 15;
        }),
      );
  // ÖPNV-Fußbein: Journey-Pfad oft ohne Maneuvers → Ecken aus der Polyline.
  const turns =
    turnsFromWp.length > 0 || currentIsTransit
      ? turnsFromWp
      : turnArrowsFromPolylineCorners(mapped, { max: 48 });
  const mappedSpanM =
    mapped.length >= 2
      ? haversineMeters(
          mapped[0]!.lat,
          mapped[0]!.lng,
          mapped[mapped.length - 1]!.lat,
          mapped[mapped.length - 1]!.lng,
        )
      : 0;
  const walkChevronsOk =
    mapped.length >= 3 && (!transitTour || walkLegActive || mappedSpanM < 2500);
  const farFromTurns = (c: NavRouteMapArrow) =>
    turns.every((t) => haversineMeters(c.lat, c.lng, t.lat, t.lng) > 28);
  // Nah: dichter; Übersicht: sehr großzügig — unter Zoom ~13.8 zeichnet die Karte sowieso keine.
  const puck = mapped[0] ?? origin;
  const farFromPuck = (c: NavRouteMapArrow) =>
    !puck || haversineMeters(c.lat, c.lng, puck.lat, puck.lng) > 30;
  const flowHi = walkChevronsOk
    ? sampleRouteChevrons(mapped, 65, 22)
        .filter(farFromTurns)
        .filter(farFromPuck)
        .map((c) => ({ ...c, lod: 'hi' as const }))
    : [];
  const flowLo = walkChevronsOk
    ? sampleRouteChevrons(mapped, 200, 8)
        .filter(farFromTurns)
        .filter(farFromPuck)
        .map((c) => ({ ...c, lod: 'lo' as const }))
    : [];
  // Turn-Pfeile: alle Abzweigungen auf der Route (nicht nur die nächsten 1–2).
  const turnsOnRoute = turns.filter((t) => {
    let best = Infinity;
    for (const p of mapped) {
      const d = haversineMeters(t.lat, t.lng, p.lat, p.lng);
      if (d < best) best = d;
      if (best <= 55) return true;
    }
    return false;
  });
  // Kurzes Eck-Band; nicht hinter dem User (sonst langer gelber Streifen).
  const turnGeoms = turnArrowGeomsAlongRoute(
    mapped,
    turnsOnRoute,
    20,
    10,
    55,
    puck,
  );
  const turnBands = turnGeoms.map((g) => g.shaft);
  const turnHeads = turnGeoms
    .map((g) => g.head)
    .filter((h) => h.length >= 4);
  // Nur Flow-Chevrons auf der blauen Linie — Turn = Geometrie, kein Icon.
  const arrows = [...flowLo, ...flowHi].slice(0, MAX_MAP_ARROWS);
  const fitKey = pins.map((p) => `${p.n}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  let fitWide = false;
  if (pins.length >= 2) {
    const a = pins[0]!;
    const b = pins[pins.length - 1]!;
    fitWide = haversineMeters(a.lat, a.lng, b.lat, b.lng) > 2500;
  }

  const lines = aheadSlim.map((coords, i) => ({
    kind: (aheadMetaSlim[i] === 'transit' ? 'transit' : 'walk') as 'walk' | 'transit',
    coords,
  }));

  const previewPin = pins[0]
    ? { lat: pins[0].lat, lng: pins[0].lng }
    : null;

  return {
    current: mapped,
    ahead: aheadSlim,
    aheadMeta: aheadMetaSlim,
    lines,
    pins,
    arrows,
    turnBands,
    turnHeads,
    fitWide,
    fitKey: fitWide ? `w|${fitKey}` : fitKey,
    previewPin,
    preview: routeAwaitingStreet,
  };
}
