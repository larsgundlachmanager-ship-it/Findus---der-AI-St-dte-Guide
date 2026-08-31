/**
 * Spiegelt laufende Navigation in den Tagesplan:
 * Weg-Zeile (Distanz · Dauer) + Stopp-Karten mit Nummer, Ankunft und grober Pause.
 * Alles ab JETZT — nichts davon in die Vergangenheit.
 */

import { todayDateKey } from '../../utils/dateKeys';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from './futurePlanState';
import {
  buildLiveTourSchedule,
  isLiveNavLegId,
  type LiveTourStopIn,
} from './liveTourSchedule';
import {
  mapsPinUrl,
  mergePlaceActionUrls,
  placeUrlsEqual,
  type PlaceActionUrls,
} from './placeActionUrls';

export {
  LIVE_NAV_DEST_ID,
  LIVE_NAV_LEG_ID,
  TOUR_STOP_PREFIX,
  buildLiveTourSchedule,
  dwellMinForLiveTourStop,
  isLiveNavLegId,
  pathTitleForLeg,
  travelBetweenStops,
  upcomingIndexForLiveId,
  type LiveTourStopIn,
} from './liveTourSchedule';

const THROTTLE_MS = 16_000;
const DIST_DELTA_M = 50;
const ETA_DELTA_MIN = 1;

let lastSyncAtMs = 0;
let lastDistM: number | null = null;
let lastEtaMin: number | null = null;
let lastTarget = '';
let lastTransport: FuturePlanTransport | null = null;
let lastUpcomingLen = -1;
/** User hat die Fahrt aus der Timeline entfernt — nicht wieder spiegeln. */
let liveNavMirrorSuppressed = false;

export function suppressLiveNavMirror(): void {
  liveNavMirrorSuppressed = true;
}

export function allowLiveNavMirror(): void {
  liveNavMirrorSuppressed = false;
}

export function isLiveNavMirrorSuppressed(): boolean {
  return liveNavMirrorSuppressed;
}

export function isLiveJourneyOnTimeline(): boolean {
  try {
    const store = useFuturePlanStore.getState();
    const dayKey = todayDateKey();
    const plan = store.getPlanForDay(dayKey) ?? store.plan;
    return plan.stops.some(
      (s) => s.groupId === 'live_journey' || isLiveNavLegId(s.id),
    );
  } catch {
    return false;
  }
}

function transportFromRuntime(): FuturePlanTransport {
  try {
    const { resolveActiveTravelMode } = require('../../services/navigation/travelModeContext') as {
      resolveActiveTravelMode: () => { mode: string };
    };
    const m = resolveActiveTravelMode().mode;
    if (m === 'bike') return 'bike';
    if (m === 'transit') return 'transit';
    return 'walk';
  } catch {
    return 'walk';
  }
}

function shouldThrottle(opts: {
  force?: boolean;
  distanceM: number | null;
  etaMin: number | null;
  target: string;
  transport: FuturePlanTransport;
  upcomingLen: number;
}): boolean {
  if (opts.force) return false;
  if (opts.upcomingLen !== lastUpcomingLen) return false;
  const now = Date.now();
  if (now - lastSyncAtMs < THROTTLE_MS) {
    const distOk =
      lastDistM == null ||
      opts.distanceM == null ||
      Math.abs(opts.distanceM - lastDistM) < DIST_DELTA_M;
    const etaOk =
      lastEtaMin == null ||
      opts.etaMin == null ||
      Math.abs(opts.etaMin - lastEtaMin) < ETA_DELTA_MIN;
    const sameTarget = opts.target === lastTarget;
    const sameMode = opts.transport === lastTransport;
    if (distOk && etaOk && sameTarget && sameMode) return true;
  }
  return false;
}

function rememberSync(opts: {
  distanceM: number | null;
  etaMin: number | null;
  target: string;
  transport: FuturePlanTransport;
  upcomingLen: number;
}): void {
  lastSyncAtMs = Date.now();
  lastDistM = opts.distanceM;
  lastEtaMin = opts.etaMin;
  lastTarget = opts.target;
  lastTransport = opts.transport;
  lastUpcomingLen = opts.upcomingLen;
}

function originFromGps(): { lat: number; lng: number } | null {
  const g = useGpsStore.getState();
  if (
    g.lat != null &&
    g.lng != null &&
    Number.isFinite(g.lat) &&
    Number.isFinite(g.lng)
  ) {
    return { lat: g.lat, lng: g.lng };
  }
  const f = useFinnusStore.getState();
  if (
    f.lastGpsLat != null &&
    f.lastGpsLng != null &&
    Number.isFinite(f.lastGpsLat) &&
    Number.isFinite(f.lastGpsLng)
  ) {
    return { lat: f.lastGpsLat, lng: f.lastGpsLng };
  }
  return null;
}

function attachAheadPaths(stops: LiveTourStopIn[]): LiveTourStopIn[] {
  if (stops.length < 2) return stops;
  try {
    const { peekTourAheadLeg } = require('../../services/navigation/tourAheadRouteCache') as {
      peekTourAheadLeg: (
        a: { lat: number; lng: number },
        b: { lat: number; lng: number },
      ) => Array<{ lat: number; lng: number }> | null;
    };
    return stops.map((s, i) => {
      if (i === 0) return s;
      const from = stops[i - 1]!;
      if (s.path && s.path.length >= 2) return s;
      const path = peekTourAheadLeg(from, s);
      return path && path.length >= 2 ? { ...s, path } : s;
    });
  } catch {
    return stops;
  }
}

function decorateStopEmojis(rows: FuturePlanStop[]): FuturePlanStop[] {
  try {
    const { emojiForPlace } = require('../../services/navigation/stampBullets') as {
      emojiForPlace: (p: { name: string }) => string;
    };
    return rows.map((row) => {
      if (row.kind !== 'stop') return row;
      const name = row.title.replace(/^\d+\s*·\s*/, '').trim();
      return { ...row, emoji: emojiForPlace({ name }) };
    });
  } catch {
    return rows;
  }
}

function scrubGapFillDupes(dayKey: string, upcomingNames: string[]): void {
  const names = new Set(
    upcomingNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (!names.size) return;
  const store = useFuturePlanStore.getState();
  store.ensureDay(dayKey);
  const plan = store.getPlanForDay(dayKey);
  for (const s of [...plan.stops]) {
    if (s.kind !== 'nav_leg' || isLiveNavLegId(s.id)) continue;
    const dest = s.title
      .replace(/^(Fußweg|Rad|ÖPNV|Fahrt)\s+nach\s+/i, '')
      .trim()
      .toLowerCase();
    if (dest && names.has(dest)) {
      store.removeStop(s.id);
    }
  }
}

function urlsFromStopLike(s: {
  mapsUrl?: string | null;
  menuUrl?: string | null;
  reserveUrl?: string | null;
  websiteUrl?: string | null;
}): PlaceActionUrls {
  return {
    mapsUrl: s.mapsUrl ?? null,
    menuUrl: s.menuUrl ?? null,
    reserveUrl: s.reserveUrl ?? null,
    websiteUrl: s.websiteUrl ?? null,
  };
}

function stripStopNumber(title: string): string {
  return title.replace(/^\d+\s*·\s*/, '').trim().toLowerCase();
}

function nearCoords(
  aLat?: number | null,
  aLng?: number | null,
  bLat?: number | null,
  bLng?: number | null,
): boolean {
  if (
    aLat == null ||
    aLng == null ||
    bLat == null ||
    bLng == null ||
    !Number.isFinite(aLat) ||
    !Number.isFinite(aLng) ||
    !Number.isFinite(bLat) ||
    !Number.isFinite(bLng)
  ) {
    return false;
  }
  return Math.abs(aLat - bLat) < 0.0008 && Math.abs(aLng - bLng) < 0.0012;
}

function lookupSavedPlaceUrls(
  name: string,
  lat: number,
  lng: number,
): PlaceActionUrls {
  const needle = stripStopNumber(name);
  const collected: PlaceActionUrls[] = [];
  try {
    const store = useFuturePlanStore.getState();
    const all = [
      ...store.plan.stops,
      ...Object.values(store.plansByDay).flatMap((p) => p.stops),
    ];
    for (const s of all) {
      if (isLiveNavLegId(s.id) || s.kind === 'nav_leg') continue;
      const title = stripStopNumber(s.title);
      const nameOk =
        Boolean(title) &&
        Boolean(needle) &&
        (title === needle || title.includes(needle) || needle.includes(title));
      const geoOk = nearCoords(s.lat, s.lng, lat, lng);
      if (!nameOk && !geoOk) continue;
      if (!s.mapsUrl && !s.menuUrl && !s.reserveUrl && !s.websiteUrl) continue;
      collected.push(urlsFromStopLike(s));
    }
  } catch {
    /* soft */
  }
  try {
    const { usePlanCalendarUiStore } = require('./planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => {
          pendingChoice: {
            options?: Array<{
              title: string;
              lat: number;
              lng: number;
              mapsUrl?: string | null;
              menuUrl?: string | null;
            }>;
          } | null;
        };
      };
    };
    const opts = usePlanCalendarUiStore.getState().pendingChoice?.options ?? [];
    for (const o of opts) {
      const title = stripStopNumber(o.title);
      if (
        (title && needle && title === needle) ||
        nearCoords(o.lat, o.lng, lat, lng)
      ) {
        collected.push({
          mapsUrl: o.mapsUrl ?? null,
          menuUrl: o.menuUrl ?? null,
        });
      }
    }
  } catch {
    /* soft */
  }
  try {
    const card = useFinnusStore.getState().activeConciergeCard;
    const actions = card?.quickActions ?? [];
    const blob = `${card?.speechText ?? ''} ${needle}`.toLowerCase();
    if (needle && blob.includes(needle)) {
      const urls: PlaceActionUrls = {};
      for (const a of actions) {
        if (a.type !== 'OPEN_URL') continue;
        const url = String(a.payload?.url ?? '').trim();
        if (!/^https?:\/\//i.test(url)) continue;
        const lab = `${a.label ?? ''} ${url}`.toLowerCase();
        if (/maps\.google|google\.[^/]*\/maps|maps\.app\.goo\.gl/i.test(url) || /maps|karte/i.test(lab)) {
          urls.mapsUrl = urls.mapsUrl || url;
        } else if (/speise|menu|karte/i.test(lab)) {
          urls.menuUrl = urls.menuUrl || url;
        } else if (/reserv|tisch|buch/i.test(lab)) {
          urls.reserveUrl = urls.reserveUrl || url;
        } else if (/web|site|homepage|programm/i.test(lab)) {
          urls.websiteUrl = urls.websiteUrl || url;
        }
      }
      collected.push(urls);
    }
  } catch {
    /* soft */
  }
  return mergePlaceActionUrls(...collected);
}

function persistUrlsOnTour(rows: FuturePlanStop[]): void {
  try {
    const nav = useFinnusStore.getState();
    const tour = nav.multiStopTour;
    if (!tour?.stops.length) return;
    let changed = false;
    const stops = tour.stops.map((s) => {
      const row = rows.find(
        (r) => r.kind === 'stop' && nearCoords(r.lat, r.lng, s.lat, s.lng),
      );
      const merged = mergePlaceActionUrls(urlsFromStopLike(s), row);
      if (placeUrlsEqual(urlsFromStopLike(s), merged)) return s;
      changed = true;
      return { ...s, ...merged };
    });
    if (changed) {
      nav.setMultiStopTour({ ...tour, stops });
    }
  } catch {
    /* soft */
  }
}

function replaceLiveNavRows(dayKey: string, next: FuturePlanStop[]): void {
  const store = useFuturePlanStore.getState();
  store.ensureDay(dayKey);
  const liveIds = new Set(next.map((s) => s.id));
  const plan = store.getPlanForDay(dayKey);
  for (const s of [...plan.stops]) {
    if (isLiveNavLegId(s.id) && !liveIds.has(s.id)) {
      store.removeStop(s.id);
    }
  }
  for (const row of next) {
    const prev = plan.stops.find((s) => s.id === row.id);
    const urls = mergePlaceActionUrls(row, prev);
    store.upsertStopOnDay(dayKey, { ...row, ...urls });
  }
}

/**
 * Liest Nav-Runtime und schreibt Weg + Stopps (gedrosselt).
 */
export function upsertLiveNavFromStore(opts?: { force?: boolean }): void {
  try {
    const nav = useFinnusStore.getState();
    const tour = nav.multiStopTour;
    const upcomingRaw = (tour?.stops ?? [])
      .slice(tour?.currentIndex ?? 0)
      .filter((s) => !s.done)
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (liveNavMirrorSuppressed) {
      return;
    }
    if (!nav.navActive) {
      clearLiveNavFromPlan();
      return;
    }
    const target =
      (tour?.title || '').trim() ||
      (nav.navTargetName || '').trim() ||
      'Ziel';
    const distanceM =
      typeof nav.navDistanceM === 'number' && Number.isFinite(nav.navDistanceM)
        ? Math.max(0, Math.round(nav.navDistanceM))
        : null;
    const etaMin =
      typeof nav.navEtaMin === 'number' && Number.isFinite(nav.navEtaMin)
        ? Math.max(1, Math.round(nav.navEtaMin))
        : null;
    const transport = transportFromRuntime();

    if (
      shouldThrottle({
        force: opts?.force,
        distanceM,
        etaMin,
        target,
        transport,
        upcomingLen: upcomingRaw.length,
      })
    ) {
      return;
    }

    let destLat: number | undefined;
    let destLng: number | undefined;
    try {
      const { getActiveNavDestination } = require('../../services/navigation/navigationService') as {
        getActiveNavDestination: () => {
          lat: number;
          lng: number;
          name: string;
        } | null;
      };
      const live = getActiveNavDestination();
      if (live && Number.isFinite(live.lat) && Number.isFinite(live.lng)) {
        destLat = live.lat;
        destLng = live.lng;
      }
    } catch {
      /* cycle-safe */
    }
    const cur = upcomingRaw[0];
    if (destLat == null && cur) {
      destLat = cur.lat;
      destLng = cur.lng;
    }

    let walkMPerMin: number | undefined;
    let bikeMPerMin: number | undefined;
    try {
      const {
        getPlanBikeMPerMin,
        getPlanWalkMPerMin,
      } = require('../../services/mobility/paceProfile') as {
        getPlanWalkMPerMin: () => number;
        getPlanBikeMPerMin: () => number;
      };
      walkMPerMin = getPlanWalkMPerMin();
      bikeMPerMin = getPlanBikeMPerMin();
    } catch {
      /* defaults in scheduler */
    }

    const upcoming = attachAheadPaths(
      upcomingRaw.map((s) => {
        const saved = lookupSavedPlaceUrls(s.name, s.lat, s.lng);
        const urls = mergePlaceActionUrls(urlsFromStopLike(s), saved, {
          mapsUrl: mapsPinUrl(s.lat, s.lng, s.name),
        });
        return {
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          poiId: s.poiId,
          durationSec: s.durationSec,
          distanceM: s.distanceM,
          role: s.role,
          line: s.line,
          headsign: s.headsign ?? null,
          platform: s.platform ?? null,
          delaySec: s.delaySec ?? null,
          stationCount: s.stationCount ?? null,
          startMs: s.startMs ?? null,
          endMs: s.endMs ?? null,
          vehicleStartMs: s.vehicleStartMs ?? null,
          vehicleMode: s.vehicleMode ?? null,
          path: s.path,
          notes: s.notes,
          mapsUrl:
            s.role === 'walk' ||
            s.role === 'alight' ||
            s.role === 'transfer' ||
            s.role === 'board'
              ? null
              : urls.mapsUrl,
          menuUrl: urls.menuUrl,
          reserveUrl: urls.reserveUrl,
          websiteUrl: urls.websiteUrl,
        };
      }),
    );

    let leaveByMs: number | null = tour?.liveMeta?.leaveByMs ?? null;
    try {
      const { peekArmedLeaveByMs } = require('../../services/navigation/journeyLeaveBy') as {
        peekArmedLeaveByMs: () => number | null;
      };
      leaveByMs = peekArmedLeaveByMs() ?? leaveByMs;
    } catch {
      /* soft */
    }

    const dayKey = todayDateKey();
    scrubGapFillDupes(
      dayKey,
      upcoming.map((s) => s.name),
    );
    const rows = decorateStopEmojis(
      buildLiveTourSchedule({
        upcoming,
        nowMs: Date.now(),
        transport,
        origin: originFromGps(),
        liveDistanceM: distanceM,
        liveEtaMin: etaMin,
        destName: target,
        destLat,
        destLng,
        walkMPerMin,
        bikeMPerMin,
        leaveByMs,
        tripTitle: tour?.title ?? null,
      }),
    );
    replaceLiveNavRows(dayKey, rows);
    persistUrlsOnTour(rows);
    rememberSync({
      distanceM,
      etaMin,
      target,
      transport,
      upcomingLen: upcomingRaw.length,
    });
  } catch {
    /* soft — Timeline darf Nav nie killen */
  }
}

/** Live-Leg + Tour-Spiegel entfernen. */
export function clearLiveNavFromPlan(opts?: { abandon?: boolean }): void {
  if (opts?.abandon) {
    liveNavMirrorSuppressed = true;
    try {
      const { stopJourneyLeaveWatch } = require('../../services/navigation/journeyLeaveBy') as {
        stopJourneyLeaveWatch: (reason?: string) => void;
      };
      stopJourneyLeaveWatch('plan_cleared');
    } catch {
      /* soft */
    }
  }
  try {
    const store = useFuturePlanStore.getState();
    const dayKey = todayDateKey();
    store.ensureDay(dayKey);
    const plan = store.getPlanForDay(dayKey);
    for (const s of [...plan.stops]) {
      if (isLiveNavLegId(s.id) || s.groupId === 'live_journey') {
        store.removeStop(s.id);
      }
    }
    lastSyncAtMs = 0;
    lastDistM = null;
    lastEtaMin = null;
    lastTarget = '';
    lastTransport = null;
    lastUpcomingLen = -1;
  } catch {
    /* soft */
  }
}

/**
 * Moduswechsel von der Timeline: Plan + Runtime.
 */
export function applyLiveNavTransport(mode: FuturePlanTransport): void {
  try {
    const { setPreferredTravelMode } = require('../../services/navigation/travelModeContext') as {
      setPreferredTravelMode: (m: 'foot' | 'bike' | 'transit' | null) => void;
    };
    if (mode === 'bike') setPreferredTravelMode('bike');
    else if (mode === 'transit') setPreferredTravelMode('transit');
    else if (mode === 'walk') setPreferredTravelMode('foot');
  } catch {
    /* soft */
  }

  lastTransport = mode;
  lastSyncAtMs = 0;
  upsertLiveNavFromStore({ force: true });
}
