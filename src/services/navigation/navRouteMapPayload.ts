/**
 * Karten-Payload für aktive Navigation: aktuelles Bein, weitere Tour-Beine, Pins, Pfeile.
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';
import { bearingDegrees } from './bearing';
import { isTurnManeuver } from './navPredictiveCue';
import { getActiveNavDestination } from './navigationService';
import { stripEntranceDisplaySuffix, stripNavDestLeak } from './streetAddressQuery';
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
    payload.fitKey ?? '',
    payload.preview ? '1' : '0',
    payload.fitWide ? '1' : '0',
  ].join('|');
}

function isAirLine(pts: NavRouteMapCoord[]): boolean {
  if (pts.length !== 2) return false;
  return (
    haversineMeters(pts[0]!.lat, pts[0]!.lng, pts[1]!.lat, pts[1]!.lng) > 80
  );
}

/** 2 Punkte über Distanz = Luftlinie, nicht zeichnen. */
function isFakeRouteLine(pts: NavRouteMapCoord[]): boolean {
  if (!pts || pts.length < 2) return true;
  if (isAirLine(pts)) return true;
  return false;
}

function geomFromStop(ts: {
  role?: string | null;
  path?: Array<{ lat: number; lng: number }> | null;
  stations?: Array<{ lat: number; lng: number }> | null;
}): NavRouteMapCoord[] {
  if (Array.isArray(ts.path) && ts.path.length >= 2) {
    const pts = ts.path
      .map((p) => asCoord(p.lat, p.lng))
      .filter((c): c is NavRouteMapCoord => c != null);
    if (pts.length >= 3 && !isFakeRouteLine(pts)) return pts;
  }
  const transit = ts.role === 'alight' || ts.role === 'board';
  if (transit && Array.isArray(ts.stations) && ts.stations.length >= 2) {
    const pts = ts.stations
      .map((p) => asCoord(p.lat, p.lng))
      .filter((c): c is NavRouteMapCoord => c != null);
    if (pts.length >= 3) return pts;
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

function gleisBit(plat?: string | null): string {
  const p = (plat ?? '').trim();
  if (!p) return '';
  const asGleis = p.replace(/^(?:bus)?steig\b/i, 'Gleis').trim();
  return /gleis|kante|abschnitt|abfahrbereich/i.test(asGleis)
    ? asGleis
    : `Gleis ${asGleis}`;
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
  },
  next?: {
    role?: string | null;
    name?: string;
    line?: string | null;
    headsign?: string | null;
    startMs?: number | null;
  } | null,
): { title: string; sub?: string } | null {
  const plat = gleisBit(s.platform);
  const line = (s.line || next?.line || '').trim();
  const head = (s.headsign || next?.headsign || '').trim();
  const when = chipClock(s.vehicleStartMs ?? next?.startMs ?? null);
  const delay = delayBit(s.delaySec ?? null);
  const ride = line ? (head ? `${line} nach ${head}` : line) : '';
  if (s.role === 'dest') {
    return { title: stripPinName(s.name) || 'Ziel' };
  }
  if (s.role === 'walk' || s.role === 'board') {
    const title = ride || stripPinName(s.name);
    const bits: string[] = [];
    if (plat) bits.push(plat);
    if (when) bits.push(when);
    if (delay) bits.push(delay);
    const alightAt =
      next?.role === 'alight' ? stripPinName(next.name || '') : '';
    if (alightAt) bits.push(`Ausstieg ${alightAt}`);
    if (!bits.length) return { title: stripPinName(s.name) };
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
      return {
        title: `Umsteigen ${nxtLine}${nxtHead ? ` nach ${nxtHead}` : ''}`,
        sub: [plat, when].filter(Boolean).join(' · ') || undefined,
      };
    }
    if (!next || next.role === 'dest' || next.role === 'walk') {
      const bits = [plat, ride].filter(Boolean);
      return {
        title: `Aussteigen · ${stripPinName(s.name)}`,
        sub: bits.length ? bits.join(' · ') : undefined,
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
  for (let i = 0; i < wps.length - 1; i += 1) {
    const wp = wps[i]!;
    if (!isTurnManeuver(wp.maneuver)) continue;
    const nxt = wps[i + 1]!;
    const lat = Number.isFinite(wp.arrowLat) ? (wp.arrowLat as number) : wp.lat;
    const lng = Number.isFinite(wp.arrowLng) ? (wp.arrowLng as number) : wp.lng;
    const bearing =
      typeof wp.turnHeadingDeg === 'number' && Number.isFinite(wp.turnHeadingDeg)
        ? wp.turnHeadingDeg
        : bearingDegrees(lat, lng, nxt.lat, nxt.lng);
    out.push({ lat, lng, bearing, kind: 'turn' });
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
  const dest = liveDest ?? {
    lat: upcoming[0]!.lat,
    lng: upcoming[0]!.lng,
    name: upcoming[0]!.name,
    waypoints: [] as Array<{ lat: number; lng: number }>,
  };
  const transitTour = upcoming.some(
    (s) => s.role === 'alight' || s.role === 'board' || s.role === 'transfer',
  );

  // ÖPNV: alte Fuß-Polyline zum Ziel nicht zeichnen — nur die gewählte Reise.
  const current: NavRouteMapCoord[] = transitTour
    ? []
    : (dest.waypoints ?? [])
        .map((w) => asCoord(w.lat, w.lng))
        .filter((c): c is NavRouteMapCoord => c != null);

  const gps = useGpsStore.getState();
  const origin = asCoord(
    gps.lat ?? useFinnusStore.getState().lastGpsLat ?? dest.waypoints?.[0]?.lat ?? Number.NaN,
    gps.lng ?? useFinnusStore.getState().lastGpsLng ?? dest.waypoints?.[0]?.lng ?? Number.NaN,
  );
  if (
    origin &&
    !transitTour &&
    current.length >= 3 &&
    (Math.abs(current[0]!.lat - origin.lat) > 1e-5 ||
      Math.abs(current[0]!.lng - origin.lng) > 1e-5)
  ) {
    current.unshift(origin);
  }

  const last = current[current.length - 1];
  if (
    !transitTour &&
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
  // Einzelziel / fehlender Tour-Chip: trotzdem kleiner Button-Titel
  for (const pin of pins) {
    if (pin.chip?.title) continue;
    pin.chip = {
      title: stripPinName(pin.name) || (pin.current ? 'Ziel' : 'Stopp'),
    };
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
    if (geom.length < 2 || isFakeRouteLine(geom)) continue;
    const kind =
      ts.role === 'alight' || ts.role === 'board' ? 'transit' : 'walk';
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
      const routed = peekTourAheadLeg(a, b);
      const fromStop = upcoming[i + 1] ? geomFromStop(upcoming[i + 1]!) : [];
      const line =
        routed && routed.length >= 3 && !isFakeRouteLine(routed)
          ? routed
          : fromStop.length >= 3 && !isFakeRouteLine(fromStop)
            ? fromStop
            : [];
      if (line.length < 2 || isFakeRouteLine(line)) continue;
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
      const transit =
        b.role === 'alight' ||
        b.role === 'board' ||
        ((b.vehicleMode || '').toUpperCase() === 'RAIL' ||
          (b.vehicleMode || '').toUpperCase() === 'SUBWAY' ||
          (b.vehicleMode || '').toUpperCase() === 'TRAM' ||
          (b.vehicleMode || '').toUpperCase() === 'TRANSIT');
      pushAhead(line, transit ? 'transit' : 'walk');
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

  const curRole = upcoming[0]?.role;
  const currentIsTransit = curRole === 'alight' || curRole === 'board';
  let mapped: NavRouteMapCoord[];
  if (currentIsTransit) {
    const rail =
      Array.isArray(upcoming[0]?.path) && (upcoming[0]!.path?.length ?? 0) >= 3
        ? upcoming[0]!.path!.map((p) => ({ lat: p.lat, lng: p.lng }))
        : current;
    mapped = isFakeRouteLine(rail) ? [] : downsampleCoords(rail);
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
    // Keine GPS→Ziel-Luftlinie — nur Pin bis FOSSGIS/Offline-Polyline da ist.
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
  const keptAhead: NavRouteMapCoord[][] = [];
  const keptMeta: Array<'walk' | 'transit'> = [];
  for (let i = 0; i < ahead.length; i += 1) {
    if (sameEnds(ahead[i]!, mapped)) continue;
    keptAhead.push(ahead[i]!);
    keptMeta.push(aheadMeta[i] ?? 'walk');
  }
  const aheadSlim = keptAhead.map((leg) => downsampleCoords(leg, 160));
  const aheadMetaSlim = keptMeta;
  const turns = currentIsTransit
    ? []
    : turnArrowsFromWaypoints(dest.waypoints ?? []);
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
    mapped.length >= 3 && (!transitTour || mappedSpanM < 2500);
  const flow = walkChevronsOk
    ? sampleRouteChevrons(mapped, 55, 28).filter((c) =>
        turns.every((t) => haversineMeters(c.lat, c.lng, t.lat, t.lng) > 28),
      )
    : [];
  // Turn-Pfeile aus Waypoints: in Richtung des orientierten mapped-Ziels.
  const destEnd = mapped.length >= 2 ? mapped[mapped.length - 1]! : null;
  const turnsAligned =
    destEnd == null
      ? turns
      : turns.map((t) => {
          const towardDest = bearingDegrees(t.lat, t.lng, destEnd.lat, destEnd.lng);
          const delta = Math.abs(
            ((towardDest - t.bearing + 540) % 360) - 180,
          );
          // Zeigt der Turn-Pfeil stark vom Ziel weg → 180° drehen
          if (delta > 100) {
            return { ...t, bearing: (t.bearing + 180) % 360 };
          }
          return t;
        });
  const arrows = [...flow, ...turnsAligned].slice(0, MAX_MAP_ARROWS);
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
    fitWide,
    fitKey: fitWide ? `w|${fitKey}` : fitKey,
    previewPin,
    preview: routeAwaitingStreet,
  };
}
