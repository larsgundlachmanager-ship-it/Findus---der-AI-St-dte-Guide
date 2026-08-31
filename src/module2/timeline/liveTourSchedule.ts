/**
 * Reine Tour-Zeitachse: Wegzeile + nummerierte Stopps, Zeiten ab now.
 * Kein RN — SSOT für Tests und `syncLiveNavToPlan`.
 */

import type { FuturePlanStop, FuturePlanTransport } from './futurePlanState';
import { concreteHaltLabel, tidyHaltName } from '../../services/transit/haltName';
import {
  STATION_ARRIVE_BEFORE_MIN,
  stationArriveByMs,
} from '../../services/transit/stationArriveBuffer';

export const LIVE_NAV_LEG_ID = 'nav_live_active';
export const LIVE_NAV_DEST_ID = 'nav_live_dest';
export const TOUR_STOP_PREFIX = 'nav_live_tour_';

const DEFAULT_DWELL_MIN = 8;
const WALK_M_PER_MIN = 70;
const BIKE_M_PER_MIN = 220;

export type LiveTourStopIn = {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
  durationSec?: number | null;
  distanceM?: number | null;
  role?: string | null;
  line?: string | null;
  headsign?: string | null;
  platform?: string | null;
  delaySec?: number | null;
  stationCount?: number | null;
  startMs?: number | null;
  endMs?: number | null;
  vehicleStartMs?: number | null;
  path?: Array<{ lat: number; lng: number }> | null;
  notes?: string | null;
  mapsUrl?: string | null;
  menuUrl?: string | null;
  reserveUrl?: string | null;
  websiteUrl?: string | null;
  vehicleMode?: string | null;
};

export function isLiveNavLegId(id: string | null | undefined): boolean {
  const s = String(id ?? '');
  return (
    s === LIVE_NAV_LEG_ID ||
    s === LIVE_NAV_DEST_ID ||
    s.startsWith(TOUR_STOP_PREFIX)
  );
}

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function formatDist(m: number): string {
  const n = Math.max(0, Math.round(m));
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} km`;
  return `${n} m`;
}

function formatMin(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} Std ${rest} Min` : `${h} Std`;
}

export function emojiForTransport(transport: FuturePlanTransport): string {
  if (transport === 'transit') return '🚆';
  if (transport === 'bike') return '🚲';
  if (transport === 'taxi') return '🚕';
  if (transport === 'car') return '🚗';
  return '🚶';
}

function modeWord(transport: FuturePlanTransport): string {
  if (transport === 'transit') return 'ÖPNV';
  if (transport === 'bike') return 'Rad';
  if (transport === 'taxi' || transport === 'car') return 'Fahrt';
  return 'zu Fuß';
}

export function pathTitleForLeg(
  transport: FuturePlanTransport,
  distanceM: number | null,
  etaMin: number | null,
  extra?: {
    line?: string | null;
    headsign?: string | null;
    stationCount?: number | null;
    skipDistance?: boolean;
    delaySec?: number | null;
  },
): string {
  if (transport === 'transit') {
    const line = (extra?.line ?? '').trim();
    const head = (extra?.headsign ?? '').trim();
    const ride = line
      ? head
        ? `${line} Richtung ${head}`
        : line
      : 'ÖPNV';
    const bits = [ride];
    const n = extra?.stationCount;
    if (n != null && n >= 1) {
      bits.push(n === 1 ? '1 Station' : `${n} Stationen`);
    }
    if (etaMin != null && Number.isFinite(etaMin) && etaMin > 0) {
      bits.push(formatMin(etaMin));
    }
    const delay = extra?.delaySec;
    if (typeof delay === 'number' && delay >= 60) {
      bits.push(`+${Math.round(delay / 60)} Min`);
    }
    return bits.join(' · ');
  }
  const bits = [modeWord(transport)];
  const skipDist = extra?.skipDistance === true;
  if (
    !skipDist &&
    distanceM != null &&
    Number.isFinite(distanceM) &&
    distanceM > 0
  ) {
    bits.push(formatDist(distanceM));
  }
  if (etaMin != null && Number.isFinite(etaMin) && etaMin > 0) {
    bits.push(formatMin(etaMin));
  }
  return bits.join(' · ');
}

function clockHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dwellMinForLiveTourStop(s: LiveTourStopIn): number {
  if (typeof s.durationSec === 'number' && Number.isFinite(s.durationSec) && s.durationSec >= 90) {
    return Math.max(3, Math.min(45, Math.round(s.durationSec / 60)));
  }
  const blob = `${s.name ?? ''} ${s.notes ?? ''}`.toLowerCase();
  if (
    /\b(briefkasten|packstation|postfiliale|post_box|mailbox|dhl|paketautomat)\b/.test(
      blob,
    )
  ) {
    return 3;
  }
  return DEFAULT_DWELL_MIN;
}

function paceMPerMin(transport: FuturePlanTransport, walkM?: number, bikeM?: number): number {
  if (transport === 'bike') return Math.max(80, bikeM ?? BIKE_M_PER_MIN);
  if (transport === 'transit') return 220;
  if (transport === 'taxi' || transport === 'car') return 500;
  return Math.max(40, walkM ?? WALK_M_PER_MIN);
}

function boardingBadge(
  platform?: string | null,
  _vehicleMode?: string | null,
): string | null {
  const p = (platform ?? '').trim();
  if (!p) return null;
  // „Steig“ klingt komisch — immer Gleis, auch wenn die Quelle Bussteig sagt.
  const asGleis = p.replace(/^(?:bus)?steig\b/i, 'Gleis').trim();
  if (/\b(gleis|kante|abschnitt|abfahrbereich)\b/i.test(asGleis)) return asGleis;
  return `Gleis ${asGleis}`;
}

function pathLengthM(
  path: Array<{ lat: number; lng: number }> | null | undefined,
): number {
  if (!path || path.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    acc += haversineM(a.lat, a.lng, b.lat, b.lng);
  }
  return acc;
}

export function travelBetweenStops(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  transport: FuturePlanTransport,
  path?: Array<{ lat: number; lng: number }> | null,
  pace?: { walkMPerMin?: number; bikeMPerMin?: number },
): { distanceM: number; etaMin: number } {
  const along = pathLengthM(path);
  const air = haversineM(from.lat, from.lng, to.lat, to.lng);
  // Bahn-Polyline nie als Fußmeter — sonst „47 km · 9 Std zu Fuß“.
  let distanceM = Math.round(air);
  if (transport === 'transit' && along > 0) {
    distanceM = Math.round(along);
  } else if (transport !== 'transit' && along > 0 && along <= Math.max(air * 3, 1_200)) {
    distanceM = Math.round(Math.max(along, air));
  }
  const etaMin = Math.max(
    2,
    Math.round(distanceM / paceMPerMin(transport, pace?.walkMPerMin, pace?.bikeMPerMin)),
  );
  return { distanceM, etaMin };
}

function isTransitStop(s: LiveTourStopIn): boolean {
  if (s.role === 'alight' || s.role === 'board') return true;
  if (s.role === 'walk' || s.role === 'dest' || s.role === 'transfer') return false;
  if (s.line) return true;
  const n = (s.name || '').toLowerCase();
  if (/\b(hbf|hauptbahnhof|bahnhof|zob)\b/i.test(n) && s.role !== 'dest') {
    return true;
  }
  return false;
}

function incomingTransport(
  s: LiveTourStopIn,
  fallback: FuturePlanTransport,
): FuturePlanTransport {
  if (s.role === 'alight' || s.role === 'board') return 'transit';
  if (s.role === 'walk' || s.role === 'transfer' || s.role === 'dest') {
    return fallback === 'bike' ? 'bike' : 'walk';
  }
  if (isTransitStop(s)) return 'transit';
  return fallback;
}

function stripEmojiName(name: string): string {
  return name
    .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, '')
    .replace(/^\S+\s+→\s+/, '')
    .trim();
}

function hideMapsOnStop(s: LiveTourStopIn): boolean {
  return (
    s.role === 'walk' ||
    s.role === 'alight' ||
    s.role === 'transfer' ||
    s.role === 'board'
  );
}

function waitMinUntil(fromMs: number, untilMs: number | null | undefined): number {
  if (untilMs == null || !Number.isFinite(untilMs) || untilMs <= fromMs) return 0;
  return Math.max(0, Math.round((untilMs - fromMs) / 60_000));
}

function nextUpcomingBoardMs(
  stops: LiveTourStopIn[],
  i: number,
): number | null {
  const self = stops[i]?.vehicleStartMs ?? null;
  for (let j = i + 1; j < stops.length; j += 1) {
    const n = stops[j]!;
    if (n.role === 'dest') return null;
    const ms = n.vehicleStartMs ?? null;
    if (ms == null || !Number.isFinite(ms) || ms === self) continue;
    if (n.role === 'board' || n.role === 'walk' || n.role === 'transfer') {
      return ms;
    }
    if (n.role === 'alight') return ms;
  }
  return null;
}

/** Fußweg zum Halt so legen, dass man mind. 3 Min vor Abfahrt da ist. */
function clampWalkArriveBeforeBoard(opts: {
  leaveMs: number;
  arriveMs: number;
  etaMin: number;
  boardMs: number | null;
  nowMs: number;
}): { leaveMs: number; arriveMs: number } {
  const { etaMin, boardMs, nowMs } = opts;
  let leaveMs = opts.leaveMs;
  let arriveMs = opts.arriveMs;
  if (boardMs == null || !Number.isFinite(boardMs)) {
    return { leaveMs, arriveMs };
  }
  const arriveBy = stationArriveByMs(boardMs, STATION_ARRIVE_BEFORE_MIN);
  if (arriveMs > arriveBy) {
    arriveMs = arriveBy;
    leaveMs = arriveMs - etaMin * 60_000;
  }
  if (leaveMs < nowMs) {
    leaveMs = nowMs + 1_000;
    const natural = leaveMs + etaMin * 60_000;
    arriveMs = Math.min(natural, Math.max(leaveMs + 20_000, arriveBy));
    if (arriveMs > boardMs - 30_000) {
      arriveMs = Math.max(leaveMs + 20_000, boardMs - 30_000);
    }
  }
  if (leaveMs > arriveMs) {
    return { leaveMs: opts.leaveMs, arriveMs: opts.arriveMs };
  }
  return { leaveMs, arriveMs };
}

function stopNotes(opts: {
  s: LiveTourStopIn;
  next: LiveTourStopIn | undefined;
  isLast: boolean;
  waitMin: number;
  dwell: number;
  stopEnd: number;
}): string {
  const { s, next, isLast, waitMin, dwell, stopEnd } = opts;
  if (isLast || s.role === 'dest') {
    return waitMin > 0
      ? `Ankunft · Tour fertig ~${clockHm(stopEnd)}`
      : `Ankunft · Tour fertig ~${clockHm(stopEnd)}`;
  }
  const nextLine = (next?.line || s.line || '').trim();
  const nextHead = (next?.headsign || '').trim();
  const ride = nextLine
    ? nextHead
      ? `${nextLine} nach ${nextHead}`
      : nextLine
    : '';
  if (s.role === 'walk' || s.role === 'board') {
    const plat = (s.platform || '').trim();
    const gleis = plat
      ? (() => {
          const asGleis = plat.replace(/^(?:bus)?steig\b/i, 'Gleis').trim();
          return /gleis|kante|abschnitt|abfahrbereich/i.test(asGleis)
            ? asGleis
            : `Gleis ${asGleis}`;
        })()
      : '';
    const delay =
      typeof s.delaySec === 'number' && s.delaySec >= 60
        ? `+${Math.round(s.delaySec / 60)} Min`
        : '';
    if (waitMin > 0) {
      return [ride ? `${waitMin} Min warten auf ${ride}` : `${waitMin} Min warten`, gleis, delay]
        .filter(Boolean)
        .join(' · ');
    }
    return [ride ? `Einstieg in ${ride}` : 'Einstieg', gleis, delay]
      .filter(Boolean)
      .join(' · ');
  }
  if (s.role === 'alight' || s.role === 'transfer') {
    const waitBit = waitMin > 0 ? `${waitMin} Min warten` : '';
    const nextRide =
      next &&
      (next.role === 'alight' || next.role === 'board') &&
      (next.line || '').trim() &&
      (next.line || '').trim() !== (s.line || '').trim();
    if (nextRide && ride) {
      return [waitBit, `dann ${ride}`].filter(Boolean).join(' · ');
    }
    if (next?.role === 'dest' || next?.role === 'walk' || !next) {
      return [waitBit, 'Aussteigen · weiter zu Fuß'].filter(Boolean).join(' · ');
    }
    if (s.role === 'transfer') {
      return [waitBit, 'Umsteigen · zu Fuß'].filter(Boolean).join(' · ');
    }
    return [waitBit, 'Aussteigen'].filter(Boolean).join(' · ') || 'Aussteigen';
  }
  return `ca. ${dwell} Min vor Ort`;
}

function slugName(name: string, fallback: number): string {
  const s = name
    .trim()
    .slice(0, 28)
    .replace(/\s+/g, '_')
    .replace(/[^\wÄÖÜäöüß-]/g, '');
  return s || `stop_${fallback}`;
}

function tourStopId(s: LiveTourStopIn, index: number): string {
  const key =
    typeof s.poiId === 'number' && s.poiId > 0
      ? String(s.poiId)
      : slugName(s.name, index);
  return `${TOUR_STOP_PREFIX}${index}_${key}`;
}

function stripStopNumber(title: string): string {
  return title.replace(/^\d+\s*·\s*/, '').trim().toLowerCase();
}

/**
 * Timeline-ID → Index in den noch offenen Tour-Stopps.
 * Wegzeile zum ersten Ziel und erstes Ziel selbst = 0.
 */
export function upcomingIndexForLiveId(
  id: string,
  upcoming: Array<{
    name: string;
    poiId?: number;
    lat?: number;
    lng?: number;
  }>,
  hint?: { lat?: number | null; lng?: number | null; title?: string | null },
): number | null {
  if (!upcoming.length) return null;
  if (id === LIVE_NAV_LEG_ID || id === LIVE_NAV_DEST_ID) return 0;
  const leg = new RegExp(`^${TOUR_STOP_PREFIX}leg_(\\d+)$`).exec(id);
  if (leg) {
    const i = Number(leg[1]);
    if (Number.isFinite(i) && i >= 0 && i < upcoming.length) return i;
  }
  for (let i = 0; i < upcoming.length; i += 1) {
    if (tourStopId(upcoming[i]!, i) === id) return i;
  }
  const hintName = stripStopNumber(hint?.title ?? '');
  if (hintName) {
    const byName = upcoming.findIndex(
      (s) => s.name.trim().toLowerCase() === hintName,
    );
    if (byName >= 0) return byName;
  }
  if (
    hint?.lat != null &&
    hint?.lng != null &&
    Number.isFinite(hint.lat) &&
    Number.isFinite(hint.lng)
  ) {
    let best = -1;
    let bestD = 80;
    for (let i = 0; i < upcoming.length; i += 1) {
      const s = upcoming[i]!;
      if (s.lat == null || s.lng == null) continue;
      const d = haversineM(hint.lat, hint.lng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) return best;
  }
  return null;
}

function tourLegId(index: number): string {
  return `${TOUR_STOP_PREFIX}leg_${index}`;
}

function stopEmoji(name: string, transit: boolean): string {
  if (transit) return '🚆';
  const blob = name.toLowerCase();
  if (/briefkasten|packstation|post/.test(blob)) return '📬';
  if (/brücke|bruecke|\bbahnhof\b|eisenbahn/.test(blob)) return '🚂';
  if (/platz|dorf/.test(blob)) return '🏛️';
  return '📍';
}

export function buildLiveTourSchedule(opts: {
  upcoming: LiveTourStopIn[];
  nowMs: number;
  transport: FuturePlanTransport;
  origin: { lat: number; lng: number } | null;
  liveDistanceM: number | null;
  liveEtaMin: number | null;
  destName: string;
  destLat?: number;
  destLng?: number;
  walkMPerMin?: number;
  bikeMPerMin?: number;
  leaveByMs?: number | null;
  tripTitle?: string | null;
}): FuturePlanStop[] {
  const {
    upcoming,
    nowMs,
    transport,
    origin,
    liveDistanceM,
    liveEtaMin,
    destName,
    destLat,
    destLng,
    walkMPerMin,
    bikeMPerMin,
    leaveByMs,
    tripTitle,
  } = opts;
  const out: FuturePlanStop[] = [];
  const pace = { walkMPerMin, bikeMPerMin };

  const stops =
    upcoming.length > 0
      ? upcoming
      : destLat != null && destLng != null
        ? [{ name: destName, lat: destLat, lng: destLng } satisfies LiveTourStopIn]
        : [];

  if (!stops.length) {
    const eta = liveEtaMin ?? 5;
    const leave = nowMs + 1_000;
    const arrive = leave + eta * 60_000;
    const title = pathTitleForLeg(transport, liveDistanceM, eta);
    out.push({
      id: LIVE_NAV_LEG_ID,
      title,
      plannedStartMs: leave,
      plannedEndMs: arrive,
      bufferMin: 0,
      transport,
      kind: 'nav_leg',
      status: 'pending_change',
      emoji: emojiForTransport(transport),
      routeEstimate: liveDistanceM != null ? 'routed' : 'fallback',
      hardAnchor: false,
    });
    return out;
  }

  const hasTransit = stops.some((s) => isTransitStop(s));
  const groupId = hasTransit ? 'live_journey' : undefined;
  const groupLabel = hasTransit
    ? (tripTitle?.trim() || `Fahrt nach ${stripEmojiName(destName)}`)
    : undefined;

  const deferWalk =
    leaveByMs != null &&
    Number.isFinite(leaveByMs) &&
    leaveByMs > nowMs + 8 * 60_000;

  let t = deferWalk ? (leaveByMs as number) : nowMs + 1_000;
  let from = origin;

  const firstTrainMs = (() => {
    for (const s of stops) {
      if (!isTransitStop(s) && s.role !== 'alight' && s.role !== 'board') continue;
      const ms = s.vehicleStartMs ?? s.startMs;
      if (ms != null && Number.isFinite(ms)) return ms;
    }
    return null;
  })();

  for (let i = 0; i < stops.length; i += 1) {
    const s = stops[i]!;
    const next = stops[i + 1];
    const legTransport = incomingTransport(s, transport);
    let distanceM: number | null = null;
    let etaMin = 4;
    if (typeof s.durationSec === 'number' && Number.isFinite(s.durationSec) && s.durationSec > 0) {
      etaMin = Math.max(1, Math.round(s.durationSec / 60));
    }
    if (typeof s.distanceM === 'number' && Number.isFinite(s.distanceM) && s.distanceM > 0) {
      distanceM = Math.round(s.distanceM);
    }
    if (
      i === 0 &&
      !hasTransit &&
      liveEtaMin != null &&
      liveEtaMin > 0 &&
      legTransport !== 'transit'
    ) {
      etaMin = Math.max(etaMin, liveEtaMin);
      distanceM = liveDistanceM ?? distanceM;
    } else if (
      distanceM == null &&
      from &&
      Number.isFinite(from.lat) &&
      Number.isFinite(from.lng)
    ) {
      const walkPath = legTransport === 'transit' ? null : i === 0 ? null : s.path;
      const tr = travelBetweenStops(from, s, legTransport, walkPath, pace);
      distanceM = tr.distanceM;
      if (!(typeof s.durationSec === 'number' && s.durationSec > 0)) {
        etaMin = tr.etaMin;
      }
    } else if (
      distanceM != null &&
      !(typeof s.durationSec === 'number' && s.durationSec > 0)
    ) {
      etaMin = Math.max(
        2,
        Math.round(
          distanceM / paceMPerMin(legTransport, walkMPerMin, bikeMPerMin),
        ),
      );
    }

    if (legTransport === 'transit') {
      distanceM = null;
    }

    let leaveMs = t;
    let arriveMs = t + etaMin * 60_000;
    if (
      s.startMs != null &&
      Number.isFinite(s.startMs) &&
      s.endMs != null &&
      Number.isFinite(s.endMs) &&
      s.endMs > s.startMs
    ) {
      leaveMs = s.startMs;
      arriveMs = s.endMs;
      if (!(typeof s.durationSec === 'number' && s.durationSec > 0)) {
        etaMin = Math.max(1, Math.round((arriveMs - leaveMs) / 60_000));
      }
    }
    const boardMs =
      legTransport === 'transit'
        ? null
        : (s.vehicleStartMs ??
          (next && isTransitStop(next)
            ? (next.vehicleStartMs ?? next.startMs ?? null)
            : null) ??
          (i === 0 ? firstTrainMs : null));
    if (boardMs != null) {
      const clamped = clampWalkArriveBeforeBoard({
        leaveMs,
        arriveMs,
        etaMin,
        boardMs,
        nowMs,
      });
      leaveMs = clamped.leaveMs;
      arriveMs = clamped.arriveMs;
      if (arriveMs > leaveMs) {
        etaMin = Math.max(1, Math.round((arriveMs - leaveMs) / 60_000));
      }
    }

    const title = pathTitleForLeg(legTransport, distanceM, etaMin, {
      line: s.line,
      headsign: s.headsign,
      stationCount: s.stationCount,
      delaySec: s.delaySec,
    });
    out.push({
      id: i === 0 ? LIVE_NAV_LEG_ID : tourLegId(i),
      title,
      lat: s.lat,
      lng: s.lng,
      plannedStartMs: leaveMs,
      plannedEndMs: arriveMs,
      bufferMin: 0,
      transport: legTransport,
      kind: 'nav_leg',
      status: i === 0 ? 'pending_change' : 'planned',
      emoji: legTransport === 'transit' ? '🚆' : emojiForTransport(legTransport),
      routeEstimate:
        (typeof s.durationSec === 'number' && s.durationSec > 0) ||
        (typeof s.distanceM === 'number' && s.distanceM > 0) ||
        (Array.isArray(s.path) && s.path.length >= 2) ||
        (i === 0 && liveDistanceM != null)
          ? 'routed'
          : 'fallback',
      hardAnchor: false,
      badge: boardingBadge(s.platform, s.vehicleMode),
      groupId,
      groupLabel,
    });

    const nextDep =
      nextUpcomingBoardMs(stops, i) ??
      (next
        ? isTransitStop(next)
          ? (next.vehicleStartMs ?? next.startMs ?? null)
          : (s.vehicleStartMs ?? next.startMs ?? null)
        : (s.vehicleStartMs ?? null));
    const waitMin = waitMinUntil(arriveMs, nextDep ?? null);
    const exploreDwell =
      !hasTransit && !isTransitStop(s) && s.role !== 'dest'
        ? dwellMinForLiveTourStop(s)
        : 0;
    const dwell = waitMin > 0 ? waitMin : exploreDwell;
    const stopEnd = arriveMs + dwell * 60_000;
    const isLast = i === stops.length - 1;
    const isTransit = isTransitStop(s);
    out.push({
      id: upcoming.length === 0 ? LIVE_NAV_DEST_ID : tourStopId(s, i),
      title: `${i + 1} · ${concreteHaltLabel({
        name: tidyHaltName(stripEmojiName(s.name) || s.name) || s.name,
        mode: s.vehicleMode,
        line: s.line,
        headsign: s.headsign,
        role: s.role,
      })}`,
      lat: s.lat,
      lng: s.lng,
      plannedStartMs: arriveMs,
      plannedEndMs: stopEnd,
      bufferMin: 0,
      transport: isTransit ? 'transit' : 'walk',
      kind: 'stop',
      status: 'planned',
      emoji: stopEmoji(s.name, isTransit),
      notes: stopNotes({ s, next, isLast, waitMin, dwell, stopEnd }),
      mapsUrl: hideMapsOnStop(s) ? null : s.mapsUrl ?? null,
      menuUrl: s.menuUrl ?? null,
      reserveUrl: s.reserveUrl ?? null,
      websiteUrl: s.websiteUrl ?? null,
      badge: boardingBadge(s.platform, s.vehicleMode),
      hardAnchor: false,
      groupId,
      groupLabel,
    });

    t = Math.max(stopEnd, arriveMs);
    from = { lat: s.lat, lng: s.lng };
  }

  return out;
}
