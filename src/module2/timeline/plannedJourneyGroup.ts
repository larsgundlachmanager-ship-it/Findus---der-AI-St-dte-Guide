/**
 * Geplante ÖPNV-Verbindung = dieselben Beine wie Live-Nav,
 * als aufklappbare Timeline-Gruppe (zu Fuß → Halt → Bahn → Halt → …).
 */

import type { JourneyItinerary, JourneyLeg } from '../../services/transit/journeyPlanner';
import { pathTitleForLeg } from './liveTourSchedule';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from './futurePlanState';

function asDate(v: Date | string | number | null | undefined): Date | null {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function journeyModeEmoji(mode: JourneyLeg['mode']): string {
  switch (mode) {
    case 'WALK':
      return '🚶';
    case 'BIKE':
      return '🚲';
    case 'BUS':
      return '🚌';
    case 'TRAM':
      return '🚊';
    case 'SUBWAY':
      return '🚇';
    case 'RAIL':
    case 'TRANSIT':
      return '🚆';
    case 'FERRY':
      return '⛴️';
    default:
      return '🚌';
  }
}

function transportForMode(mode: JourneyLeg['mode']): FuturePlanTransport {
  if (mode === 'BIKE') return 'bike';
  if (mode === 'WALK') return 'walk';
  return 'transit';
}

function destTitleFromPlaceholder(title: string): string {
  return cleanPlanDestTitle(title);
}

/** Hinweis-Satz aus dem HUD, kein Ort und kein Wunsch. */
export function isPlanPromptLeak(raw: string | null | undefined): boolean {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /hilft das\?|was ich beachten soll|leave-by|meine bahn\/bus-abfahrt|um fixtermine|folgt in sekunden|hinterher in\s+\w+|cruise hinterher/i.test(
    t,
  );
}

/** Hohl-Titel („Schönes Hamburg“, TASK-Leaks) dürfen keine ÖPNV-Zeile werden. */
export function cleanPlanDestTitle(title: string): string {
  let t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\[TASK[^\]]*\]/gi, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(ÖPNV|Fußweg|Rad|Fahrt|Los)\s+(zu|nach)\s+/i, '').trim();
  t = t.replace(/^(schönes?|tolles?|liebes?|mega|geiles?)\s+/iu, '').trim();
  if (!t || t.length < 2) return '';
  if (isPlanPromptLeak(t)) return '';
  if (/\b(dining_menus|speisekarten-urls?|fuer\s+\d+\s+\[task)\b/i.test(t)) {
    return '';
  }
  try {
    const { extractCruiseCenterNavDest } = require('../../services/stt/cruiseVoiceRepair') as {
      extractCruiseCenterNavDest: (s: string) => string | null;
    };
    const cruise = extractCruiseCenterNavDest(t);
    if (cruise) return cruise;
  } catch {
    /* soft */
  }
  return t;
}

/** @deprecated Prefer pathTitleForLeg — kept for smoke/compat. */
export function titleForJourneyLeg(leg: JourneyLeg): string {
  const transport = transportForMode(leg.mode);
  const mins = Math.max(
    1,
    Math.round(
      Number.isFinite(leg.durationSec) ? leg.durationSec / 60 : 1,
    ),
  );
  return pathTitleForLeg(
    transport,
    leg.mode === 'WALK' || leg.mode === 'BIKE' ? leg.distanceM : null,
    mins,
    {
      line: leg.line,
      headsign: leg.headsign || leg.toName,
      stationCount: leg.stationCount,
    },
  );
}

function gleisBadge(platform?: string | null, mode?: string | null): string | null {
  const p = (platform ?? '').trim();
  if (!p) return null;
  const bus = /^(BUS|FERRY)$/i.test(String(mode || '').trim());
  if (/\b(gleis|steig|kante|abschnitt|abfahr(?:ts)?bereich|gate|bay)\b/i.test(p)) {
    if (bus && /^gleis\b/i.test(p)) {
      return p.replace(/^gleis\b/i, 'Abfahrtsbereich').trim();
    }
    return p;
  }
  if (bus) {
    // Busbahnhof-Buchstaben (A/B/C) = Abfahrtsbereich; nackte Ziffern weglassen.
    if (/^[A-Za-z]$/.test(p)) return `Abfahrtsbereich ${p.toUpperCase()}`;
    return null;
  }
  return `Gleis ${p}`;
}

function haltLabel(name: string | null | undefined, fallback: string): string {
  const t = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || fallback;
}

function waitNotes(
  legEnd: Date,
  nextLeg: JourneyLeg | undefined,
): string {
  if (!nextLeg) return 'Ankunft';
  const nextStart = asDate(nextLeg.startTime);
  if (!nextStart) {
    return nextLeg.mode === 'WALK' || nextLeg.mode === 'BIKE'
      ? 'Aussteigen · weiter zu Fuß'
      : 'Umstieg';
  }
  const waitMin = Math.max(
    0,
    Math.round((nextStart.getTime() - legEnd.getTime()) / 60_000),
  );
  if (waitMin > 0) {
    if (nextLeg.mode === 'WALK' || nextLeg.mode === 'BIKE') {
      return `${waitMin} Min · weiter zu Fuß`;
    }
    return `${waitMin} Min warten · Umstieg`;
  }
  if (nextLeg.mode === 'WALK' || nextLeg.mode === 'BIKE') {
    return 'Aussteigen · weiter zu Fuß';
  }
  return 'Aussteigen · Umstieg';
}

/**
 * Pro Journey: Ort → Weg → Ort → Weg …
 * Start-Halt, dann je Bein die Fahrt und der Ankunftsort.
 */
export function buildPlannedJourneyStops(opts: {
  navId: string;
  destTitle: string;
  itinerary: JourneyItinerary;
}): FuturePlanStop[] {
  const legs = Array.isArray(opts.itinerary.legs) ? opts.itinerary.legs : [];
  const destTitle = cleanPlanDestTitle(opts.destTitle) || 'Ziel';
  const groupLabel = (opts.navId === 'live_journey' ? `Fahrt nach ${destTitle}` : `ÖPNV nach ${destTitle}`).slice(0, 48);
  const out: FuturePlanStop[] = [];
  let haltNum = 0;

  if (legs.length > 0) {
    const first = legs[0]!;
    const start =
      asDate(first.startTime) ?? asDate(opts.itinerary.startTime) ?? new Date();
    const originName = haltLabel(first.fromName, 'Start');
    haltNum += 1;
    out.push({
      id: `${opts.navId}_h_origin`,
      title: `${haltNum} · ${originName}`.slice(0, 80),
      lat: first.fromLat ?? undefined,
      lng: first.fromLng ?? undefined,
      plannedStartMs: start.getTime(),
      plannedEndMs: start.getTime(),
      bufferMin: 0,
      transport: transportForMode(first.mode) === 'transit' ? 'walk' : transportForMode(first.mode),
      kind: 'stop',
      status: 'planned',
      notes: waitNotes(start, first),
      emoji: '🚶',
      hardAnchor: false,
      badge: gleisBadge(first.fromPlatform, first.mode),
      groupId: opts.navId,
      groupLabel,
    });
  }

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const next = legs[i + 1];
    const start =
      asDate(leg.startTime) ?? asDate(opts.itinerary.startTime) ?? new Date();
    const end =
      asDate(leg.endTime) ??
      new Date(start.getTime() + Math.max(60, leg.durationSec || 60) * 1000);
    const mins = Math.max(
      1,
      Math.round(
        Number.isFinite(leg.durationSec)
          ? leg.durationSec / 60
          : (end.getTime() - start.getTime()) / 60_000,
      ),
    );
    const transport = transportForMode(leg.mode);
    const isWalkish = leg.mode === 'WALK' || leg.mode === 'BIKE';

    const gleis = gleisBadge(leg.fromPlatform, leg.mode);
    out.push({
      id: `${opts.navId}_l${i}`,
      title: pathTitleForLeg(
        transport,
        isWalkish ? leg.distanceM : null,
        mins,
        {
          line: leg.line,
          headsign: (leg.headsign || leg.toName || '').trim() || null,
          stationCount: leg.stationCount,
        },
      ),
      lat: leg.toLat ?? leg.fromLat ?? undefined,
      lng: leg.toLng ?? leg.fromLng ?? undefined,
      plannedStartMs: start.getTime(),
      plannedEndMs: end.getTime(),
      bufferMin: 0,
      transport,
      kind: 'nav_leg',
      status: 'planned',
      notes: transport === 'transit' ? `${clock(start)}–${clock(end)} · ~${mins} Min` : undefined,
      emoji: journeyModeEmoji(leg.mode),
      routeEstimate: 'routed',
      badge: transport === 'transit' ? gleis : null,
      groupId: opts.navId,
      groupLabel,
    });

    haltNum += 1;
    const haltName = haltLabel(
      leg.toName,
      i === legs.length - 1 ? destTitle : `Halt ${haltNum}`,
    );
    const isLast = i === legs.length - 1;
    out.push({
      id: `${opts.navId}_h${i}`,
      title: `${haltNum} · ${haltName}`.slice(0, 80),
      lat: leg.toLat ?? undefined,
      lng: leg.toLng ?? undefined,
      plannedStartMs: end.getTime(),
      plannedEndMs: end.getTime() + (isLast ? 45 * 60_000 : 0),
      bufferMin: isLast ? 5 : 0,
      transport: isWalkish ? 'walk' : 'transit',
      kind: 'stop',
      status: 'planned',
      notes: isLast ? 'Ankunft' : waitNotes(end, next),
      emoji: isLast ? '📍' : isWalkish ? '🚶' : '🚆',
      hardAnchor: false,
      badge: isWalkish ? null : gleisBadge(leg.toPlatform ?? leg.fromPlatform, leg.mode),
      groupId: opts.navId,
      groupLabel,
    });
  }

  return out;
}

/** Platzhalter-Zeile durch echte Beine ersetzen. */
export function replaceNavLegWithJourneyGroup(opts: {
  navId: string;
  destTitle?: string | null;
  itinerary: JourneyItinerary;
}): boolean {
  const store = useFuturePlanStore.getState();
  const placeholder = store.plan.stops.find((s) => s.id === opts.navId);
  const destTitle =
    (opts.destTitle || '').trim() ||
    destTitleFromPlaceholder(placeholder?.title || 'Ziel');
  const steps = buildPlannedJourneyStops({
    navId: opts.navId,
    destTitle,
    itinerary: opts.itinerary,
  });
  if (steps.length < 1) return false;
  const next = store.plan.stops.filter(
    (s) => s.id !== opts.navId && s.groupId !== opts.navId,
  );
  store.setPlan({
    ...store.plan,
    stops: [...next, ...steps],
    updatedAtMs: Date.now(),
  });
  return true;
}

/**
 * Gesprochene ÖPNV-Verbindung → Timeline (Fuß/Bahn/Umstieg + Ziel-Stop).
 * Soft: darf Speech/Button nicht blockieren.
 */
export function upsertSpokenJourneyToTimeline(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
}): boolean {
  const destTitle = cleanPlanDestTitle(opts.destName) || 'Ziel';
  const start =
    opts.itinerary.startTime instanceof Date
      ? opts.itinerary.startTime.getTime()
      : Date.parse(String(opts.itinerary.startTime ?? ''));
  const end =
    opts.itinerary.endTime instanceof Date
      ? opts.itinerary.endTime.getTime()
      : Date.parse(String(opts.itinerary.endTime ?? ''));
  const dayKey = (() => {
    try {
      const { dateKeyFromMs } = require('../../utils/dateKeys') as {
        dateKeyFromMs: (ms: number) => string;
      };
      if (Number.isFinite(start)) return dateKeyFromMs(start);
    } catch {
      /* soft */
    }
    return useFuturePlanStore.getState().plan.dayKey;
  })();

  const slug = destTitle
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/giu, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  let navId = `voice_oepnv_${slug || 'ziel'}`;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean; multiStopTour?: { stops?: unknown[] } | null } };
    };
    const st = useFinnusStore.getState();
    if (st.navActive || (st.multiStopTour?.stops?.length ?? 0) > 0) {
      navId = 'live_journey';
    }
  } catch {
    /* soft */
  }

  useFuturePlanStore.getState().ensureDay(dayKey);
  const steps = buildPlannedJourneyStops({
    navId,
    destTitle,
    itinerary: opts.itinerary,
  });
  if (!steps.length) return false;

  // Ziel-Koordinaten auf letzten Halt legen (im Akkordeon, wie Live)
  const lastHalt = [...steps].reverse().find((s) => s.kind === 'stop');
  if (lastHalt) {
    if (Number.isFinite(opts.destLat)) lastHalt.lat = opts.destLat;
    if (Number.isFinite(opts.destLng)) lastHalt.lng = opts.destLng;
    const num =
      lastHalt.title.match(/^(\d+)\s*·/)?.[1] ??
      String(steps.filter((s) => s.kind === 'stop').length);
    lastHalt.title = `${num} · ${destTitle}`.slice(0, 80);
    if (Number.isFinite(end)) {
      lastHalt.plannedStartMs = end;
      lastHalt.plannedEndMs = end + 45 * 60_000;
    }
  }

  const store = useFuturePlanStore.getState();
  const next = store.plan.stops.filter(
    (s) => s.id !== navId && !String(s.id).startsWith(`${navId}_`) && s.groupId !== navId,
  );
  store.setPlan({
    ...store.plan,
    dayKey,
    stops: [...next, ...steps],
    updatedAtMs: Date.now(),
  });

  return true;
}

export function plannedJourneyGroupExists(navId: string): boolean {
  try {
    return useFuturePlanStore
      .getState()
      .plan.stops.some((s) => s.groupId === navId && s.kind === 'nav_leg');
  } catch {
    return false;
  }
}
