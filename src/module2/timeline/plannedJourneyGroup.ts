/**
 * Geplante ÖPNV-Verbindung = dieselben Beine wie Live-Nav,
 * als aufklappbare Timeline-Gruppe (zu Fuß → Bahn → Umstieg → Fuß).
 */

import type { JourneyItinerary, JourneyLeg } from '../../services/transit/journeyPlanner';
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

/** Hohl-Titel („Schönes Hamburg“, TASK-Leaks) dürfen keine ÖPNV-Zeile werden. */
export function cleanPlanDestTitle(title: string): string {
  let t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\[TASK[^\]]*\]/gi, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(ÖPNV|Fußweg|Rad|Fahrt|Los)\s+(zu|nach)\s+/i, '').trim();
  t = t.replace(/^(schönes?|tolles?|liebes?|mega|geiles?)\s+/iu, '').trim();
  if (!t || t.length < 2) return '';
  if (/\b(dining_menus|speisekarten-urls?|fuer\s+\d+\s+\[task)\b/i.test(t)) {
    return '';
  }
  return t;
}

export function titleForJourneyLeg(leg: JourneyLeg): string {
  const toName = String(leg.toName || 'Halt').trim() || 'Halt';
  const line = leg.line ? ` ${leg.line}` : '';
  const stations =
    leg.stationCount != null && leg.stationCount > 0
      ? ` · ${leg.stationCount} St.`
      : '';
  if (leg.mode === 'WALK' || leg.mode === 'BIKE') {
    return `${journeyModeEmoji(leg.mode)} → ${toName}`;
  }
  return `${journeyModeEmoji(leg.mode)}${line} → ${toName}${stations}`;
}

/**
 * Ein Bein pro Journey-Leg — gleiche Struktur wie Live-ÖPNV, ohne Ziel-POI.
 */
export function buildPlannedJourneyStops(opts: {
  navId: string;
  destTitle: string;
  itinerary: JourneyItinerary;
}): FuturePlanStop[] {
  const legs = Array.isArray(opts.itinerary.legs) ? opts.itinerary.legs : [];
  const destTitle = cleanPlanDestTitle(opts.destTitle) || 'Ziel';
  const groupLabel = `ÖPNV nach ${destTitle}`.slice(0, 48);
  const out: FuturePlanStop[] = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
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
    out.push({
      id: `${opts.navId}_l${i}`,
      title: titleForJourneyLeg(leg),
      lat: leg.toLat ?? leg.fromLat ?? undefined,
      lng: leg.toLng ?? leg.fromLng ?? undefined,
      plannedStartMs: start.getTime(),
      plannedEndMs: end.getTime(),
      bufferMin: 0,
      transport,
      kind: 'nav_leg',
      status: 'planned',
      notes: `${clock(start)}–${clock(end)} · ~${mins} Min`,
      emoji: journeyModeEmoji(leg.mode),
      routeEstimate: 'routed',
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
  if (steps.length < 2) return false;
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

export function plannedJourneyGroupExists(navId: string): boolean {
  try {
    return useFuturePlanStore
      .getState()
      .plan.stops.some((s) => s.groupId === navId && s.kind === 'nav_leg');
  } catch {
    return false;
  }
}
