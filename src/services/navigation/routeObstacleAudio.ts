/**
 * Audio-Trigger für Brücken (Pflicht) und Treppen (optional) entlang der aktiven Route.
 */

import { distanceMeters } from './bearing';
import type { RouteObstacleHit, RouteObstacleSummary } from './routeObstaclePolicy';

const APPROACH_M = 55;
/** Brücken: erst kurz vorher ansagen. */
const BRIDGE_APPROACH_M = 35;
const spokenKeys = new Set<string>();

let summary: RouteObstacleSummary | null = null;

export function setActiveRouteObstacles(
  next: RouteObstacleSummary | null,
): void {
  summary = next;
  spokenKeys.clear();
}

export function getActiveRouteObstacles(): RouteObstacleSummary | null {
  return summary;
}

export function resetRouteObstacleAudio(): void {
  spokenKeys.clear();
  summary = null;
}

function keyOf(h: RouteObstacleHit): string {
  return `${h.kind}:${h.lat.toFixed(5)},${h.lng.toFixed(5)}`;
}

/**
 * Wenn User einen Audio-Punkt nähert → Sprachzeile (einmalig).
 * Brücke: immer. Treppe: optional (default an). Crossing: Hinweis möglich.
 */
export function maybeRouteObstacleCue(opts: {
  lat: number;
  lng: number;
  speakStairs?: boolean;
}): string | null {
  if (!summary?.hits.length) return null;
  const speakStairs = opts.speakStairs !== false;

  for (const h of summary.hits) {
    if (h.lat === 0 && h.lng === 0) continue; // instruction-only
    if (h.kind === 'stairs' && !speakStairs) continue;
    const limitM = h.kind === 'bridge' ? BRIDGE_APPROACH_M : APPROACH_M;
    const d = distanceMeters(opts.lat, opts.lng, h.lat, h.lng);
    if (d > limitM) continue;
    const k = keyOf(h);
    if (spokenKeys.has(k)) continue;
    spokenKeys.add(k);

    if (h.kind === 'bridge') {
      return 'Gleich über die Brücke — bleib auf dem Weg, du bist richtig.';
    }
    if (h.kind === 'stairs') {
      return 'Gleich Treppen — kurz schieben oder tragen, dann geht’s weiter.';
    }
    if (h.kind === 'crossing') {
      return 'Gleich Bahnübergang — wenn die Schranke zu ist, kurz warten, ich hab Puffer eingeplant.';
    }
  }
  return null;
}
