/**
 * Aufräumen doppelter Reality-Einträge (Visit-Log ∩ Historical).
 * Beim Öffnen der Timeline einmal pro Tag laufen lassen.
 */

import { placeNameKey } from '../../services/timeline/placeLabelClean';
import { isSameDwellPlace } from '../../services/timeline/dwellPlaceDedupe';
import {
  getVisitsForDate,
  patchVisitEntries,
  type VisitLogEntry,
} from '../../services/timeline/visitLog';
import {
  useHistoricalTimelineStore,
  type HistoricalEntry,
} from './historicalTimelineState';

const SAME_WINDOW_MS = 3 * 60 * 60_000;

function titlesMatch(a: string, b: string): boolean {
  const ka = placeNameKey(a);
  const kb = placeNameKey(b);
  if (ka.length >= 3 && ka === kb) return true;
  return (
    a.replace(/^📍\s*/, '').trim().toLowerCase() ===
    b.replace(/^📍\s*/, '').trim().toLowerCase()
  );
}

function samePlaceVisitHist(
  v: VisitLogEntry,
  h: HistoricalEntry,
): boolean {
  if (!titlesMatch(v.name, h.title) && !(v.lat != null && h.lat != null)) {
    if (Math.abs(v.arrivedAtMs - h.atMs) > SAME_WINDOW_MS) return false;
  }
  if (titlesMatch(v.name, h.title)) {
    // Gleiche Adresse: auch über 90 Min — außer klar anderer Tag-Slot
    if (Math.abs(v.arrivedAtMs - h.atMs) > 12 * 60 * 60_000) return false;
    return true;
  }
  if (Math.abs(v.arrivedAtMs - h.atMs) > SAME_WINDOW_MS) return false;
  if (
    v.lat != null &&
    v.lng != null &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng)
  ) {
    return isSameDwellPlace(
      { title: v.name, lat: v.lat, lng: v.lng, atMs: v.arrivedAtMs },
      { title: h.title, lat: h.lat, lng: h.lng, atMs: h.atMs },
    );
  }
  return false;
}

function samePlaceHist(
  a: HistoricalEntry,
  b: HistoricalEntry,
): boolean {
  if (titlesMatch(a.title, b.title)) {
    if (Math.abs(a.atMs - b.atMs) > 12 * 60 * 60_000) return false;
    return true;
  }
  if (Math.abs(a.atMs - b.atMs) > SAME_WINDOW_MS) return false;
  return isSameDwellPlace(
    { title: a.title, lat: a.lat, lng: a.lng, atMs: a.atMs },
    { title: b.title, lat: b.lat, lng: b.lng, atMs: b.atMs },
  );
}

function samePlaceVisit(a: VisitLogEntry, b: VisitLogEntry): boolean {
  if (a.poiId != null && b.poiId != null && a.poiId === b.poiId) {
    return Math.abs(a.arrivedAtMs - b.arrivedAtMs) <= 12 * 60 * 60_000;
  }
  if (titlesMatch(a.name, b.name)) {
    // Gleiche Adresse hintereinander / am Tag → mergen (nicht nur ±90 Min)
    return Math.abs(a.arrivedAtMs - b.arrivedAtMs) <= 12 * 60 * 60_000;
  }
  if (Math.abs(a.arrivedAtMs - b.arrivedAtMs) > SAME_WINDOW_MS) return false;
  if (
    a.lat != null &&
    a.lng != null &&
    b.lat != null &&
    b.lng != null
  ) {
    return isSameDwellPlace(
      { title: a.name, lat: a.lat, lng: a.lng, atMs: a.arrivedAtMs },
      { title: b.name, lat: b.lat, lng: b.lng, atMs: b.arrivedAtMs },
    );
  }
  return false;
}

/**
 * Prefer visitLog as SSOT: drop historical clones of the same place/time.
 * Also collapse duplicate hist↔hist and visit↔visit for the day.
 */
export function cleanupTimelineDuplicates(dateKey: string): {
  removedHist: number;
  removedVisits: number;
  removedPlan: number;
} {
  const visits = getVisitsForDate(dateKey).sort(
    (a, b) => a.arrivedAtMs - b.arrivedAtMs,
  );
  const histAll = useHistoricalTimelineStore.getState().entries;
  const dayHist = histAll
    .filter((e) => e.dayKey === dateKey)
    .sort((a, b) => a.atMs - b.atMs);

  const dropHistIds = new Set<string>();

  // 1) Hist, die schon als Visit existieren → raus
  for (const h of dayHist) {
    if (visits.some((v) => samePlaceVisitHist(v, h))) {
      dropHistIds.add(h.id);
    }
  }

  // 2) Hist↔Hist Duplikate (behalte ersten / längeren Confidence)
  const keptHist: HistoricalEntry[] = [];
  for (const h of dayHist) {
    if (dropHistIds.has(h.id)) continue;
    const dup = keptHist.find((k) => samePlaceHist(k, h));
    if (dup) {
      if (h.confidence > dup.confidence) {
        dropHistIds.add(dup.id);
        keptHist.splice(keptHist.indexOf(dup), 1, h);
      } else {
        dropHistIds.add(h.id);
      }
      continue;
    }
    keptHist.push(h);
  }

  // 3) Visit↔Visit Duplikate (gleiche Adresse mergen: früheste Ankunft + spätestes Ende)
  const dropVisitIds = new Set<string>();
  const keptVisits: VisitLogEntry[] = [];
  const mergeInto = new Map<string, VisitLogEntry>();
  for (const v of visits) {
    // Fremder Ort zwischen zwei gleichen Adressen → kein Merge
    const dup = keptVisits.find((k) => {
      if (!samePlaceVisit(k, v)) return false;
      const between = visits.filter(
        (x) =>
          x.arrivedAtMs > k.arrivedAtMs &&
          x.arrivedAtMs < v.arrivedAtMs &&
          !dropVisitIds.has(x.id),
      );
      if (between.some((x) => !samePlaceVisit(k, x))) return false;
      return true;
    });
    if (dup) {
      dropVisitIds.add(v.id);
      const arrived = Math.min(dup.arrivedAtMs, v.arrivedAtMs);
      const leftCandidates = [dup.leftAtMs, v.leftAtMs].filter(
        (x): x is number => x != null && Number.isFinite(x),
      );
      const leftAtMs =
        dup.leftAtMs == null || v.leftAtMs == null
          ? null
          : leftCandidates.length
            ? Math.max(...leftCandidates)
            : null;
      const dwellMin =
        leftAtMs != null
          ? Math.max(1, Math.round((leftAtMs - arrived) / 60_000))
          : Math.max(dup.dwellMin ?? 0, v.dwellMin ?? 0) || null;
      mergeInto.set(dup.id, {
        ...dup,
        arrivedAtMs: arrived,
        leftAtMs,
        dwellMin,
        lat: dup.lat ?? v.lat,
        lng: dup.lng ?? v.lng,
      });
      const idx = keptVisits.findIndex((k) => k.id === dup.id);
      if (idx >= 0) keptVisits[idx] = mergeInto.get(dup.id)!;
      continue;
    }
    keptVisits.push(v);
  }

  if (dropHistIds.size > 0) {
    useHistoricalTimelineStore
      .getState()
      .hydrateEntries(histAll.filter((e) => !dropHistIds.has(e.id)));
  }
  if (dropVisitIds.size > 0 || mergeInto.size > 0) {
    patchVisitEntries(mergeInto, [...dropVisitIds]);
  }

  // 4) FuturePlan-Duplikate (gleicher Name / nahe Koords / überlappende Zeit)
  const removedPlan = cleanupFuturePlanDuplicates(dateKey);

  return {
    removedHist: dropHistIds.size,
    removedVisits: dropVisitIds.size,
    removedPlan,
  };
}

/** Doppelte Plan-Stops am Tag mergen/löschen (Choice-Stops ausnehmen). */
export function cleanupFuturePlanDuplicates(dateKey: string): number {
  const {
    useFuturePlanStore,
  } = require('./futurePlanState') as typeof import('./futurePlanState');
  const store = useFuturePlanStore.getState();
  if (store.plan.dayKey !== dateKey) return 0;
  const stops = store.plan.stops.filter(
    (s) =>
      !s.id.startsWith('choice_') &&
      !s.id.startsWith('wake_') &&
      !s.id.startsWith('ft:') &&
      s.kind !== 'wish' &&
      s.kind !== 'nav_leg',
  );
  const drop = new Set<string>();
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i]!;
    if (drop.has(a.id)) continue;
    for (let j = i + 1; j < stops.length; j++) {
      const b = stops[j]!;
      if (drop.has(b.id)) continue;
      const sameName =
        placeNameKey(a.title) === placeNameKey(b.title) &&
        placeNameKey(a.title).length >= 3;
      const near =
        a.lat != null &&
        a.lng != null &&
        b.lat != null &&
        b.lng != null &&
        isSameDwellPlace(
          {
            title: a.title,
            lat: a.lat,
            lng: a.lng,
            atMs: a.plannedStartMs ?? 0,
          },
          {
            title: b.title,
            lat: b.lat,
            lng: b.lng,
            atMs: b.plannedStartMs ?? 0,
          },
        );
      const timeOverlap =
        a.plannedStartMs != null &&
        b.plannedStartMs != null &&
        Math.abs(a.plannedStartMs - b.plannedStartMs) < SAME_WINDOW_MS;
      if ((sameName || near) && (timeOverlap || sameName)) {
        // Behalte hardAnchor / früheren Stop
        if (b.hardAnchor && !a.hardAnchor) {
          drop.add(a.id);
        } else {
          drop.add(b.id);
        }
      }
    }
  }
  for (const id of drop) store.removeStop(id);
  return drop.size;
}
