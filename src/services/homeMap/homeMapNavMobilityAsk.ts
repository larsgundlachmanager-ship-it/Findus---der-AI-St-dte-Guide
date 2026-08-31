/**
 * Karten-Navigation ab 1,4 km Luftlinie: Live-Guard Fuß vs ÖPNV (+ Taxi wenn Pref).
 *
 * Struktur: Zeiten belegen → kurz fragen → Wahl startet sofort.
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */

import { airNeedsTransitLookahead } from '../../module2/planning/planMobilityPolicy';
import { publishPitchToLive, useLivePitchStore } from '../../module2/pitch/publishPitchUi';
import type { PitchOptionCard, PitchResult } from '../../module2/pitch/types';
import type { QuickAction } from '../../types/concierge';
import { formatDurationMinutesDe } from '../navigation/travelEta';
import type { HomeMapNavTarget } from './homeMapNavStart';

const TRANSIT_PREFETCH_MS = 4500;

export type MapNavMobilityAskInput = {
  dest: HomeMapNavTarget;
  origin: { lat: number; lng: number };
  walkMin: number;
  /** Schon geplante ÖPNV-Minuten — kein zweites Prefetch. */
  transitMin?: number | null;
  airMeters?: number;
  includeTaxi?: boolean;
  hideWalk?: boolean;
  preferBike?: boolean;
};

function mapsSearchUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function walkAction(dest: HomeMapNavTarget): QuickAction {
  return {
    type: 'START_NAVIGATION',
    label: 'Zu Fuß',
    payload: {
      destName: dest.name,
      destLat: dest.lat,
      destLng: dest.lng,
      targetPoiId: dest.poiId != null && dest.poiId > 0 ? dest.poiId : undefined,
      skipDestVerify: true,
      skipClosingGate: true,
      preferWalk: true,
    },
  };
}

function transitAction(dest: HomeMapNavTarget): QuickAction {
  return {
    type: 'START_NAVIGATION',
    label: 'ÖPNV',
    payload: {
      destName: dest.name,
      destLat: dest.lat,
      destLng: dest.lng,
      targetPoiId: dest.poiId != null && dest.poiId > 0 ? dest.poiId : undefined,
      skipDestVerify: true,
      skipClosingGate: true,
      preferTransit: true,
      journeyNav: true,
    },
  };
}

function taxiAction(dest: HomeMapNavTarget): QuickAction {
  try {
    const { buildUberRideAction } = require('../affiliate/affiliateService') as {
      buildUberRideAction: (
        lat: number,
        lng: number,
        name: string,
        poiId?: number,
      ) => QuickAction;
    };
    return buildUberRideAction(dest.lat, dest.lng, dest.name, dest.poiId);
  } catch {
    return transitAction(dest);
  }
}

function clockHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildAskSpeech(
  destName: string,
  walkMin: number,
  transitMin: number | null,
  arriveMs: number | null,
  opts?: { hideWalk?: boolean; includeTaxi?: boolean; preferBike?: boolean },
): string {
  const walk = formatDurationMinutesDe(walkMin, 'speech');
  const place = destName.trim() || 'der Ort';
  const ride =
    transitMin != null && transitMin > 0
      ? formatDurationMinutesDe(transitMin, 'speech')
      : null;
  const arrive =
    arriveMs != null && Number.isFinite(arriveMs)
      ? ` — Ankunft gegen ${clockHm(arriveMs)} Uhr`
      : '';
  if (opts?.hideWalk) {
    if (ride) {
      return opts.includeTaxi
        ? `${place} — mit dem ÖPNV ${ride}${arrive}. Taxi geht auch.`
        : `${place} — mit dem ÖPNV ${ride}${arrive}.`;
    }
    return `${place} — ich nehme den ÖPNV.`;
  }
  if (ride) {
    const mode = opts?.preferBike ? 'Mit dem Rad' : 'Zu Fuß';
    return `${place} klingt gut. ${mode} ${walk}. Mit dem ÖPNV ${ride}${arrive}.`;
  }
  return `${place} klingt gut. Zu Fuß ${walk} — mit dem ÖPNV wären wir deutlich schneller.`;
}

function buildOptions(
  dest: HomeMapNavTarget,
  walkMin: number,
  transitMin: number | null,
  opts?: { hideWalk?: boolean; includeTaxi?: boolean; preferBike?: boolean },
): PitchOptionCard[] {
  const mapsUrl = mapsSearchUrl(dest.lat, dest.lng);
  const walkLabel = formatDurationMinutesDe(walkMin, 'short');
  const rideLabel =
    transitMin != null && transitMin > 0
      ? formatDurationMinutesDe(transitMin, 'short')
      : null;
  const cards: PitchOptionCard[] = [];
  if (!opts?.hideWalk) {
    cards.push({
      id: 'map_nav_walk',
      name: opts?.preferBike ? 'Rad' : 'Zu Fuß',
      lat: dest.lat,
      lng: dest.lng,
      role: 'favorite',
      speechPitch: '',
      bullets: [walkLabel, dest.name].slice(0, 2),
      mapsUrl,
      actions: [opts?.preferBike ? bikeAction(dest) : walkAction(dest)],
    });
  }
  cards.push({
    id: 'map_nav_transit',
    name: 'ÖPNV',
    lat: dest.lat,
    lng: dest.lng,
    role: opts?.hideWalk ? 'favorite' : 'alternative',
    speechPitch: '',
    bullets: [rideLabel ?? 'Verbindung suchen', dest.name].slice(0, 2),
    mapsUrl,
    actions: [transitAction(dest)],
  });
  if (opts?.includeTaxi) {
    cards.push({
      id: 'map_nav_taxi',
      name: 'Taxi',
      lat: dest.lat,
      lng: dest.lng,
      role: 'alternative',
      speechPitch: '',
      bullets: [dest.name],
      mapsUrl,
      actions: [taxiAction(dest)],
    });
  }
  return cards;
}

function bikeAction(dest: HomeMapNavTarget): QuickAction {
  return {
    type: 'START_NAVIGATION',
    label: 'Rad',
    payload: {
      destName: dest.name,
      destLat: dest.lat,
      destLng: dest.lng,
      targetPoiId: dest.poiId != null && dest.poiId > 0 ? dest.poiId : undefined,
      skipDestVerify: true,
      skipClosingGate: true,
      preferBike: true,
    },
  };
}

export async function prefetchTransitMin(
  opts: MapNavMobilityAskInput,
): Promise<{ transitMin: number; arriveMs: number | null } | null> {
  try {
    const { planTransitHandsFree } = await import(
      '../navigation/handsFreeNav/transitBridge'
    );
    const { rememberJourneyForStart } = await import(
      '../navigation/journeyStartCache'
    );
    const best = await Promise.race([
      planTransitHandsFree({
        from: opts.origin,
        to: { lat: opts.dest.lat, lng: opts.dest.lng },
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), TRANSIT_PREFETCH_MS),
      ),
    ]);
    if (!best) return null;
    const transitMin = Math.max(1, Math.round(best.durationSec / 60));
    rememberJourneyForStart({
      itinerary: best,
      destName: opts.dest.name,
      destLat: opts.dest.lat,
      destLng: opts.dest.lng,
    });
    const arriveMs =
      best.endTime instanceof Date && Number.isFinite(best.endTime.getTime())
        ? best.endTime.getTime()
        : null;
    return { transitMin, arriveMs };
  } catch {
    return null;
  }
}

function publishAsk(
  dest: HomeMapNavTarget,
  walkMin: number,
  transitMin: number | null,
  arriveMs: number | null,
  ui?: { hideWalk?: boolean; includeTaxi?: boolean; preferBike?: boolean },
): void {
  const spoken = buildAskSpeech(dest.name, walkMin, transitMin, arriveMs, ui);
  const result: PitchResult = {
    requestId: `map_nav_mobility_${Date.now()}`,
    softFail: false,
    spokenText: spoken,
    summary: dest.name,
    options: buildOptions(dest, walkMin, transitMin, ui),
    uiLayout: 'live_split',
  };
  publishPitchToLive(result, dest.name);
}

/**
 * Live-Guard zeigen + sprechen. Nicht die Route starten.
 * Prefetch blockiert die UI nicht — Ask sofort, Zeiten nachziehen.
 */
export async function presentMapNavMobilityAsk(
  opts: MapNavMobilityAskInput,
): Promise<void> {
  const walkMin = Math.max(1, Math.round(opts.walkMin));
  const ui = {
    hideWalk: opts.hideWalk === true,
    includeTaxi: opts.includeTaxi === true,
    preferBike: opts.preferBike === true,
  };
  if (
    opts.airMeters != null &&
    !airNeedsTransitLookahead({
      airMeters: opts.airMeters,
      preferBike: opts.preferBike,
    }) &&
    !ui.hideWalk
  ) {
    return;
  }

  try {
    useLivePitchStore.getState().setLoading(opts.dest.name);
  } catch {
    /* soft */
  }

  const knownTransit =
    opts.transitMin != null && opts.transitMin > 0
      ? Math.max(1, Math.round(opts.transitMin))
      : null;

  // Sofort Ask — Mic/UI nicht 4.5s auf Prefetch warten lassen.
  publishAsk(opts.dest, walkMin, knownTransit, null, ui);
  try {
    const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text: buildAskSpeech(opts.dest.name, walkMin, knownTransit, null, ui).slice(
        0,
        420,
      ),
      turnId: `map_nav_mobility_${Date.now()}`,
    });
  } catch {
    /* soft */
  }

  if (knownTransit != null) return;

  void prefetchTransitMin(opts).then((prefetched) => {
    if (!prefetched?.transitMin) return;
    publishAsk(
      opts.dest,
      walkMin,
      prefetched.transitMin,
      prefetched.arriveMs,
      ui,
    );
  });
}
