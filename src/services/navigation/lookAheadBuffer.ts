/**
 * Look-Ahead Buffer — komplexe Kreuzungen (Hands-Free).
 * TTS: OSM Overpass only. Street View: availability + community cache.
 * No Gemini vision.
 */

import { distanceMeters } from './bearing';
import { streetViewAvailable } from './googleMapsNav';
import type { NavWaypoint, TransportMode } from './navigationTypes';
import { predictiveWarmDistanceM } from './navPredictiveCue';
import { turnPrefetchKey, warmNavTurnCue } from './navTurnPrefetch';
import type { ClassifiedTurn } from './turnComplexityClassifier';
import { clearVisionCueCache } from './visionCueCache';
import { fetchOsmVisualLandmark } from './osmVisualLandmark';
import { scrubRoboticNavSpeak } from './spatialOrientation';

export const PREFETCH_ZONE_MIN_M = 40;
export const PREFETCH_ZONE_MAX_M = 50;
export const PREFETCH_ZONE_BIKE_MIN_M = 80;
export const PREFETCH_ZONE_BIKE_MAX_M = 100;

type SlotStatus = 'idle' | 'fetching_sv' | 'ready' | 'failed';

type LookAheadSlot = {
  turnId: string;
  waypointIndex: number;
  lat: number;
  lng: number;
  heading: number;
  maneuver: string;
  turnWord: string;
  roadName: string | null;
  placeHint: string | null;
  status: SlotStatus;
  /** OSM-basierter TTS-Cue (kein Gemini-Vision). */
  visionCue: string | null;
  streetViewReady: boolean;
  prefetchedAt: number | null;
  ttsWarmed: boolean;
  buttonOffered: boolean;
};

let slots = new Map<string, LookAheadSlot>();
let activeJob: Promise<void> | null = null;
let classifiedTurns: ClassifiedTurn[] = [];
/** Letztes Street-View-Angebot (für Voice „zeig Street View“). */
let lastStreetViewOffer: {
  lat: number;
  lng: number;
  heading: number;
  atMs: number;
} | null = null;

export function getLastStreetViewOffer(): {
  lat: number;
  lng: number;
  heading: number;
} | null {
  if (!lastStreetViewOffer) return null;
  if (Date.now() - lastStreetViewOffer.atMs > 15 * 60_000) return null;
  return lastStreetViewOffer;
}

export function isStreetViewVoiceAsk(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return /\b(street\s*view|straßenansicht|strassenansicht|live[-\s]?aufnahme|nahschau\w*|schau\s+(?:mal\s+)?nah|zeig(?:e| mir)?\s+(?:die\s+)?(?:kreuzung|straße|strasse|aufnahme)|aufnahme\s+(?:zeigen|bitte)|hast\s+du\s+(?:das\s+)?nicht\s+gesehen|nicht\s+gesehen\??)\b/iu.test(
    t,
  );
}

/** Voice: zuletzt angebotene Kreuzung als Street View öffnen. */
export async function fulfillStreetViewVoiceAsk(): Promise<{
  ok: boolean;
  message?: string;
}> {
  const offer = getLastStreetViewOffer();
  if (!offer) {
    return {
      ok: false,
      message: 'Gerade habe ich keine Street-View-Kreuzung parat.',
    };
  }
  try {
    const { handleQuickAction } = await import('../actionHandlerService');
    const r = await handleQuickAction({
      type: 'SHOW_STREET_VIEW',
      label: 'Street View zeigen',
      payload: {
        destLat: offer.lat,
        destLng: offer.lng,
        headingDeg: offer.heading,
        destName: 'Kreuzung',
      },
    });
    return {
      ok: r.ok !== false,
      message: r.message,
    };
  } catch (err) {
    console.warn('[lookAhead] street view voice failed', err);
    return { ok: false, message: 'Street View ließ sich nicht laden.' };
  }
}

function turnWordFromManeuver(maneuver: string | null | undefined): string {
  const m = (maneuver ?? '').toLowerCase();
  if (m.includes('sharp-left') || m.includes('sharp_left')) return 'scharf links';
  if (m.includes('sharp-right') || m.includes('sharp_right')) return 'scharf rechts';
  if (m.includes('slight-left') || m.includes('slight_left')) return 'leicht links';
  if (m.includes('slight-right') || m.includes('slight_right')) return 'leicht rechts';
  if (m.includes('left')) return 'links';
  if (m.includes('right')) return 'rechts';
  if (m.includes('uturn') || m.includes('u-turn')) return 'umdrehen';
  return 'geradeaus';
}

function prefetchZone(transportMode: TransportMode): {
  min: number;
  max: number;
} {
  if (transportMode === 'bicycle') {
    return { min: PREFETCH_ZONE_BIKE_MIN_M, max: PREFETCH_ZONE_BIKE_MAX_M };
  }
  return { min: PREFETCH_ZONE_MIN_M, max: PREFETCH_ZONE_MAX_M };
}

function slotId(waypointIndex: number): string {
  return `turn:${waypointIndex}`;
}

/**
 * OSM Overpass → TTS. Street View nur Availability (kein Bild-Fetch).
 */
async function buildOsmTurnCue(opts: {
  lat: number;
  lng: number;
  heading: number;
  turn: string;
  roadName: string | null;
  placeHint: string | null;
}): Promise<{ cue: string | null; streetViewReady: boolean }> {
  let streetViewReady = false;
  try {
    streetViewReady = await streetViewAvailable(opts.lat, opts.lng);
    // One-time SV meta → local cache → community dataset for all users
    if (streetViewReady) {
      void import('../../runtime/growthModule').then((g) => {
        void g.warmStreetViewForPoint({
          lat: opts.lat,
          lng: opts.lng,
          headingDeg: opts.heading,
        });
        g.noteGrowthCacheWrite();
      });
    }
  } catch {
    streetViewReady = false;
  }

  const osm = await fetchOsmVisualLandmark({
    lat: opts.lat,
    lng: opts.lng,
    radiusM: 55,
    headingDeg: opts.heading,
  });

  const turnPart =
    opts.turn === 'geradeaus'
      ? 'geh weiter geradeaus'
      : `abbiegen nach ${opts.turn}`;

  if (osm?.ttsLine) {
    const cue = scrubRoboticNavSpeak(`${osm.ttsLine} Dann ${turnPart}.`);
    return { cue, streetViewReady };
  }

  if (opts.placeHint) {
    return {
      cue: scrubRoboticNavSpeak(
        `Orientier dich an ${opts.placeHint} — dann ${turnPart}.`,
      ),
      streetViewReady,
    };
  }

  // Keine Straßennamen — visuelle Kreuzung reicht
  void opts.roadName;

  return {
    cue: scrubRoboticNavSpeak(`Gleich ${turnPart}.`),
    streetViewReady,
  };
}

async function runPrefetch(slot: LookAheadSlot): Promise<void> {
  slot.status = 'fetching_sv';
  const { cue, streetViewReady } = await buildOsmTurnCue({
    lat: slot.lat,
    lng: slot.lng,
    heading: slot.heading,
    turn: slot.turnWord,
    roadName: slot.roadName,
    placeHint: slot.placeHint,
  });
  slot.streetViewReady = streetViewReady;
  if (cue) {
    slot.visionCue = cue;
    slot.status = 'ready';
    slot.prefetchedAt = Date.now();
  } else {
    slot.status = 'failed';
  }
}

function enqueuePrefetch(slot: LookAheadSlot): void {
  if (activeJob) return;
  activeJob = runPrefetch(slot).finally(() => {
    activeJob = null;
    const next = [...slots.values()].find(
      (s) => s.status === 'idle' && s !== slot,
    );
    if (next) enqueuePrefetch(next);
  });
}

export function registerClassifiedTurns(turns: ClassifiedTurn[]): void {
  classifiedTurns = turns.filter((t) => t.complexity === 'complex');
  for (const t of classifiedTurns) {
    const id = slotId(t.waypointIndex);
    if (slots.has(id)) continue;
    slots.set(id, {
      turnId: id,
      waypointIndex: t.waypointIndex,
      lat: t.lat,
      lng: t.lng,
      heading: t.headingDeg,
      maneuver: t.maneuver ?? 'turn',
      turnWord: turnWordFromManeuver(t.maneuver),
      roadName: t.roadName,
      placeHint: t.landmark,
      status: 'idle',
      visionCue: null,
      streetViewReady: false,
      prefetchedAt: null,
      ttsWarmed: false,
      buttonOffered: false,
    });
  }
}

export function resetLookAheadBuffer(): void {
  slots.clear();
  classifiedTurns = [];
  activeJob = null;
  clearVisionCueCache();
}

function distanceToTurnM(
  waypoints: NavWaypoint[],
  fromIndex: number,
  userLat: number,
  userLng: number,
  turnIndex: number,
): number | null {
  if (turnIndex < 0 || turnIndex >= waypoints.length) return null;
  let total = distanceMeters(
    userLat,
    userLng,
    waypoints[fromIndex]?.lat ?? userLat,
    waypoints[fromIndex]?.lng ?? userLng,
  );
  for (let i = fromIndex; i < turnIndex; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (a && b) total += distanceMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

export function tickLookAheadBuffer(opts: {
  userLat: number;
  userLng: number;
  waypointIndex: number;
  waypoints: NavWaypoint[];
  transportMode: TransportMode;
}): void {
  const zone = prefetchZone(opts.transportMode);
  const warmAtM = predictiveWarmDistanceM(opts.transportMode);

  for (const ct of classifiedTurns) {
    const id = slotId(ct.waypointIndex);
    const slot = slots.get(id);
    if (!slot) continue;

    const dist = distanceToTurnM(
      opts.waypoints,
      opts.waypointIndex,
      opts.userLat,
      opts.userLng,
      ct.waypointIndex,
    );
    if (dist == null) continue;

    if (slot.status === 'idle' && dist >= zone.min && dist <= zone.max + 15) {
      enqueuePrefetch(slot);
    }

    if (
      slot.status === 'ready' &&
      slot.visionCue &&
      !slot.ttsWarmed &&
      dist <= warmAtM
    ) {
      const key = turnPrefetchKey(ct.waypointIndex, slot.visionCue);
      slot.ttsWarmed = true;
      void warmNavTurnCue(key, slot.visionCue);
    }
  }
}

export function consumeVisionCue(waypointIndex: number): string | null {
  const slot = slots.get(slotId(waypointIndex));
  if (!slot || slot.status !== 'ready' || !slot.visionCue) return null;
  return slot.visionCue;
}

export function getVisionCueStatus(
  waypointIndex: number,
): SlotStatus | 'not_complex' {
  const slot = slots.get(slotId(waypointIndex));
  if (!slot) return 'not_complex';
  return slot.status;
}

export function isStreetViewButtonReady(waypointIndex: number): boolean {
  return Boolean(slots.get(slotId(waypointIndex))?.streetViewReady);
}

export function buildComplexTurnFallback(
  maneuver: string | null | undefined,
): string {
  const turn = turnWordFromManeuver(maneuver);
  if (turn === 'geradeaus') {
    return 'Gleich weiter geradeaus.';
  }
  return `An der nächsten Kreuzung ${turn}.`;
}

export function isComplexTurnWaypoint(
  wp: NavWaypoint | null | undefined,
): boolean {
  return wp?.turnComplexity === 'complex';
}

export { turnWordFromManeuver };
