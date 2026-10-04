/**
 * Gap-Fill Policy — pure helpers (Node-smoke ohne RN/Expo).
 */

import type { FuturePlanStop } from './futurePlanState';

export function isTravelPlaceholderTitle(title: string): boolean {
  return /\b(anreise|aufbruch|öpnv\s+(zu|nach)|bahn\s+nach|zug\s+nach)\b/i.test(
    title,
  );
}

/** Echte Timeline-Anker — keine Journey-Halte, keine Choice/Flight. */
export function isGapFillRealStop(
  s: Pick<
    FuturePlanStop,
    'kind' | 'id' | 'title' | 'lat' | 'lng' | 'choiceSide' | 'groupId'
  >,
): boolean {
  if (s.kind === 'nav_leg') return false;
  if (s.id.startsWith('choice_') || s.id.startsWith('ft:')) return false;
  if (s.choiceSide != null) return false;
  // ÖPNV-Akkordeon-Halte sind keine Gap-Fill-Anker (sonst Doppel-ÖPNV)
  if (s.groupId) return false;
  if (isTravelPlaceholderTitle(s.title)) return false;
  if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return false;
  return true;
}

/** Tour-interne Micro-Legs: Tour hat eigene Beine — kein Extra-ÖPNV dazwischen. */
export function shouldSkipTourInternalLeg(
  a: Pick<FuturePlanStop, 'id' | 'planTaskId'>,
  b: Pick<FuturePlanStop, 'id' | 'planTaskId'>,
): boolean {
  const aTour = a.id.startsWith('tour_') || a.id.startsWith('explore_');
  const bTour = b.id.startsWith('tour_') || b.id.startsWith('explore_');
  if (!aTour || !bTour) return false;
  if (a.planTaskId && b.planTaskId && a.planTaskId === b.planTaskId) {
    return true;
  }
  // Gleiche Tour-Request-Prefix: tour_<reqId>_…
  const aReq = a.id.match(/^tour_([^_]+)_/)?.[1];
  const bReq = b.id.match(/^tour_([^_]+)_/)?.[1];
  if (aReq && bReq && aReq === bReq) return true;
  return false;
}

/** Bekannte Stop-IDs (keine Nav-Legs / keine Journey-Halte). */
export function knownGapFillStopIds(
  stops: Array<Pick<FuturePlanStop, 'id' | 'kind' | 'groupId'>>,
): string[] {
  return stops
    .filter((s) => s.kind !== 'nav_leg' && !s.groupId)
    .map((s) => s.id)
    .filter(Boolean);
}

/**
 * Ziel-Stop-Id aus Nav-Leg-Id (`nav_here_DEST` / `nav_FROM_DEST`).
 * Bei Unterstrichen in FROM/DEST: längstes Match gegen knownStopIds.
 */
export function navLegDestKey(
  legId: string,
  knownStopIds: string[] = [],
): string {
  const id = String(legId || '').trim();
  if (!id) return '';
  if (id.startsWith('nav_here_')) return id.slice('nav_here_'.length);
  let best = '';
  for (const stopId of knownStopIds) {
    if (!stopId) continue;
    if (
      (id === `nav_${stopId}` || id.endsWith(`_${stopId}`)) &&
      stopId.length > best.length
    ) {
      best = stopId;
    }
  }
  if (best) return best;
  // Heuristik ohne Known-Set: alles nach erstem Segment hinter nav_
  const bare = id.replace(/^nav_/, '');
  const parts = bare.split('_').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1]!;
  return bare || id;
}

/** True wenn bereits Journey-Gruppe oder Fallback zum selben Ziel-Stop. */
export function destAlreadyHasTravel(
  destId: string,
  stops: Array<Pick<FuturePlanStop, 'id' | 'kind' | 'groupId'>>,
  knownStopIds?: string[],
): boolean {
  const dest = String(destId || '').trim();
  if (!dest) return false;
  const known = knownStopIds ?? knownGapFillStopIds(stops);
  return stops.some((s) => {
    if (s.kind !== 'nav_leg' && !s.groupId) return false;
    const keys = [s.id, s.groupId].filter(Boolean) as string[];
    return keys.some((k) => navLegDestKey(k, known) === dest);
  });
}

/**
 * Rebuild nach Gap-Fill: alte Fallback-Nav-Legs weg, Journey-Gruppen + Live behalten.
 * Max. eine Reise pro Ziel-Stop — kein „ÖPNV nach Ziel“ + „ÖPNV nach Dammtor“ parallel.
 */
export function mergeGapFillPlanStops(opts: {
  currentStops: FuturePlanStop[];
  newLegs: FuturePlanStop[];
  isLiveNavLegId: (id: string) => boolean;
  plannedJourneyGroupExists: (navId: string) => boolean;
}): FuturePlanStop[] {
  const known = knownGapFillStopIds(opts.currentStops);
  const liveNav = opts.currentStops.filter((s) => opts.isLiveNavLegId(s.id));
  const plannedGroupsRaw = opts.currentStops.filter(
    (s) =>
      Boolean(s.groupId) &&
      !opts.isLiveNavLegId(s.id) &&
      opts.plannedJourneyGroupExists(s.groupId!),
  );
  // Max. eine Journey-Gruppe pro Ziel-Stop (keine Doppel-Akkordeons)
  const keepGroupByDest = new Map<string, string>();
  for (const s of plannedGroupsRaw) {
    if (!s.groupId) continue;
    const d = navLegDestKey(s.groupId, known) || s.groupId;
    if (!keepGroupByDest.has(d)) keepGroupByDest.set(d, s.groupId);
  }
  const keepGroupIds = new Set(keepGroupByDest.values());
  const plannedGroups = plannedGroupsRaw.filter(
    (s) => s.groupId != null && keepGroupIds.has(s.groupId),
  );
  // Journey-Gruppen decken ihr Ziel ab — kein paralleler Fallback
  const coveredDest = new Set<string>(keepGroupByDest.keys());
  const refreshed = opts.currentStops.filter(
    (s) => s.kind !== 'nav_leg' && !opts.isLiveNavLegId(s.id),
  );
  // Cap: max ein Fallback-Leg pro Ziel-Stop-Id (nav_*_DEST / nav_here_DEST)
  const seenDest = new Set<string>(coveredDest);
  const capped: FuturePlanStop[] = [];
  for (const leg of opts.newLegs) {
    // Bereits Journey-Gruppe für denselben navId → kein Fallback-Duplikat
    if (opts.plannedJourneyGroupExists(leg.id)) continue;
    const destKey = navLegDestKey(leg.id, known) || leg.id;
    if (seenDest.has(destKey)) continue;
    // Generischer „ÖPNV nach Ziel“-Fallback weicht echter Journey zum Dest
    if (
      /^ÖPNV (zu|nach) Ziel$/i.test(leg.title.trim()) &&
      coveredDest.size > 0
    ) {
      continue;
    }
    seenDest.add(destKey);
    capped.push(leg);
  }
  return [...refreshed, ...liveNav, ...plannedGroups, ...capped];
}

/**
 * Nach echter Journey: Fallback-Zeilen zum selben Ziel weg
 * (sonst „?“ / „~ unterwegs“ neben dem Akkordeon).
 */
export function pruneStaleFallbackLegsForDest(opts: {
  stops: FuturePlanStop[];
  destId: string;
  keepGroupId?: string | null;
  isLiveNavLegId?: (id: string) => boolean;
}): FuturePlanStop[] {
  const dest = String(opts.destId || '').trim();
  if (!dest) return opts.stops;
  const known = knownGapFillStopIds(opts.stops);
  const isLive = opts.isLiveNavLegId ?? (() => false);
  return opts.stops.filter((s) => {
    if (isLive(s.id)) return true;
    if (s.groupId) {
      if (opts.keepGroupId && s.groupId === opts.keepGroupId) return true;
      // Andere Journey zum selben Dest → weg (max eine Gruppe)
      if (
        opts.keepGroupId &&
        navLegDestKey(s.groupId, known) === dest &&
        s.groupId !== opts.keepGroupId
      ) {
        return false;
      }
      return true;
    }
    if (s.kind !== 'nav_leg') return true;
    // Fallback-Einzeiler ohne groupId zum selben Dest → weg
    if (navLegDestKey(s.id, known) === dest) return false;
    if (/^ÖPNV (zu|nach) Ziel$/i.test(s.title.trim())) return false;
    return true;
  });
}

/** Zählt Fallback-Zeilen „ÖPNV nach Ziel“ (Smoke: Re-Apply). */
export function countOepnvNachZielTitles(stops: FuturePlanStop[]): number {
  return stops.filter(
    (s) =>
      s.kind === 'nav_leg' &&
      /^ÖPNV (zu|nach) Ziel$/i.test(s.title.trim()) &&
      !s.groupId,
  ).length;
}

/** Zählt ÖPNV-Accordion/Fallback-Köpfe zum selben Dest (Smoke: ≤1). */
export function countTravelHeadsForDest(
  stops: FuturePlanStop[],
  destId: string,
): number {
  const known = knownGapFillStopIds(stops);
  const dest = String(destId || '').trim();
  if (!dest) return 0;
  const heads = new Set<string>();
  for (const s of stops) {
    if (s.kind !== 'nav_leg') continue;
    const key = s.groupId || s.id;
    if (navLegDestKey(key, known) !== dest) continue;
    heads.add(key);
  }
  return heads.size;
}
