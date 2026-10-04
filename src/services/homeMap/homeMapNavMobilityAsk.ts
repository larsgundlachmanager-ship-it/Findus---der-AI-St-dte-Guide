/**
 * Karten-Navigation ab 1,4 km Luftlinie: Live-Guard Fuß vs ÖPNV (+ Taxi wenn Pref).
 *
 * Struktur: Zeiten belegen → kurz fragen → Wahl startet sofort.
 * Pitch-Karten müssen unterscheidbar sein (Umstiege / Fußdauer) — nicht zwei gleiche „ca. 30 Min“.
 * Call-1-Bridge nicht abwürgen: Speech erst wenn keine Fuse/Queue läuft.
 *
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
const SPEECH_IDLE_WAIT_MS = 12_000;

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

type TransitMeta = {
  transitMin: number;
  arriveMs: number | null;
  transfers: number | null;
  lineHint: string | null;
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

/** Exported for smokes — Pitch-Zeile Umstiege. */
export function transferLabelDe(transfers: number | null | undefined): string {
  if (transfers == null || !Number.isFinite(transfers)) return 'Verbindung';
  const n = Math.max(0, Math.round(transfers));
  if (n <= 0) return 'ohne Umstieg';
  if (n === 1) return '1× umsteigen';
  return `${n}× umsteigen`;
}

function airDistLabel(airMeters?: number): string | null {
  if (airMeters == null || !Number.isFinite(airMeters) || airMeters < 200) {
    return null;
  }
  if (airMeters >= 1000) {
    return `ca. ${(airMeters / 1000).toFixed(1).replace('.', ',')} km`;
  }
  return `ca. ${Math.round(airMeters)} m`;
}

function buildAskSpeech(
  destName: string,
  walkMin: number,
  transit: TransitMeta | null,
  opts?: {
    hideWalk?: boolean;
    includeTaxi?: boolean;
    preferBike?: boolean;
    airMeters?: number;
  },
): string {
  const walk = formatDurationMinutesDe(walkMin, 'speech');
  const place = destName.trim() || 'dem Ziel';
  const ride =
    transit != null && transit.transitMin > 0
      ? formatDurationMinutesDe(transit.transitMin, 'speech')
      : null;
  const transferBit =
    transit?.transfers != null
      ? `, ${transferLabelDe(transit.transfers)}`
      : '';
  const arrive =
    transit?.arriveMs != null && Number.isFinite(transit.arriveMs)
      ? ` — Ankunft gegen ${clockHm(transit.arriveMs)} Uhr`
      : '';
  const dist = airDistLabel(opts?.airMeters);
  const distBit = dist ? ` (${dist})` : '';

  if (opts?.hideWalk) {
    if (ride) {
      return opts.includeTaxi
        ? `Alles klar — ich plane dich nach ${place}. Mit dem ÖPNV ${ride}${transferBit}${arrive}. Taxi geht auch.`
        : `Alles klar — ich plane dich nach ${place}. Mit dem ÖPNV ${ride}${transferBit}${arrive}.`;
    }
    return `Alles klar — ich plane dich nach ${place} mit dem ÖPNV.`;
  }
  if (ride) {
    const mode = opts?.preferBike ? 'Mit dem Rad' : 'Zu Fuß';
    return (
      `Alles klar — ich plane die Route nach ${place}. ` +
      `${mode} ${walk}${distBit}. Mit dem ÖPNV ${ride}${transferBit}${arrive}.`
    );
  }
  return (
    `Alles klar — ich plane die Route nach ${place}. ` +
    `Zu Fuß ${walk}${distBit} — mit dem ÖPNV wären wir meist schneller.`
  );
}

function buildOptions(
  dest: HomeMapNavTarget,
  walkMin: number,
  transit: TransitMeta | null,
  opts?: {
    hideWalk?: boolean;
    includeTaxi?: boolean;
    preferBike?: boolean;
    airMeters?: number;
  },
): PitchOptionCard[] {
  const mapsUrl = mapsSearchUrl(dest.lat, dest.lng);
  const walkDur = formatDurationMinutesDe(walkMin, 'short');
  const rideDur =
    transit != null && transit.transitMin > 0
      ? formatDurationMinutesDe(transit.transitMin, 'short')
      : null;
  const dist = airDistLabel(opts?.airMeters);
  const cards: PitchOptionCard[] = [];
  if (!opts?.hideWalk) {
    const walkBullets = [
      opts?.preferBike ? `${walkDur} mit dem Rad` : `${walkDur} zu Fuß`,
      dist ?? 'direkter Weg',
    ].slice(0, 2);
    cards.push({
      id: 'map_nav_walk',
      name: opts?.preferBike ? 'Rad' : 'Zu Fuß',
      lat: dest.lat,
      lng: dest.lng,
      role: 'favorite',
      speechPitch: '',
      bullets: walkBullets,
      mapsUrl,
      actions: [opts?.preferBike ? bikeAction(dest) : walkAction(dest)],
    });
  }
  const transfer = transferLabelDe(transit?.transfers ?? null);
  const arriveBit =
    transit?.arriveMs != null && Number.isFinite(transit.arriveMs)
      ? `Ankunft ${clockHm(transit.arriveMs)}`
      : transit?.lineHint
        ? String(transit.lineHint)
        : 'Tür zu Tür';
  const transitBullets = [
    rideDur ? `${transfer} · ${rideDur}` : transfer,
    arriveBit,
  ].slice(0, 2);
  cards.push({
    id: 'map_nav_transit',
    name: 'ÖPNV',
    lat: dest.lat,
    lng: dest.lng,
    role: opts?.hideWalk ? 'favorite' : 'alternative',
    speechPitch: '',
    bullets: transitBullets,
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
      bullets: ['direkt', dest.name].slice(0, 2),
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function speechBusyNow(): boolean {
  try {
    const { isSpeechActive } = require('../../module2/speech/speechQueue') as {
      isSpeechActive: () => boolean;
    };
    if (isSpeechActive()) return true;
  } catch {
    /* soft */
  }
  try {
    const { isFusedTurnLive } = require('../../module2/speech/fusedTurnSpeech') as {
      isFusedTurnLive: () => boolean;
    };
    if (isFusedTurnLive()) return true;
  } catch {
    /* soft */
  }
  try {
    const st = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { isAudiblySpeaking?: boolean; isGenerating?: boolean };
      };
    };
    const g = st.useFinnusStore.getState();
    if (g.isAudiblySpeaking || g.isGenerating) return true;
  } catch {
    /* soft */
  }
  return false;
}

/**
 * Call-1-Bridge / Haupt-Speech nicht abwürgen — Ask-Stimme erst wenn frei.
 */
async function speakAskWhenIdle(text: string, turnId: string): Promise<void> {
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 420);
  if (!trimmed) return;
  const deadline = Date.now() + SPEECH_IDLE_WAIT_MS;
  while (Date.now() < deadline && speechBusyNow()) {
    await sleep(250);
  }
  if (speechBusyNow()) {
    if (__DEV__) {
      console.log('[mobilityAsk] skip voice — Call-1/Haupt-Speech noch aktiv');
    }
    return;
  }
  try {
    const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text: trimmed,
      turnId,
    });
  } catch {
    /* soft */
  }
}

export async function prefetchTransitMin(
  opts: MapNavMobilityAskInput,
): Promise<TransitMeta | null> {
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
    const transfers =
      typeof best.transfers === 'number' && Number.isFinite(best.transfers)
        ? Math.max(0, Math.round(best.transfers))
        : null;
    const lineHint =
      typeof best.firstTransitLine === 'string' && best.firstTransitLine.trim()
        ? best.firstTransitLine.trim().slice(0, 24)
        : null;
    return { transitMin, arriveMs, transfers, lineHint };
  } catch {
    return null;
  }
}

function publishAsk(
  dest: HomeMapNavTarget,
  walkMin: number,
  transit: TransitMeta | null,
  ui?: {
    hideWalk?: boolean;
    includeTaxi?: boolean;
    preferBike?: boolean;
    airMeters?: number;
  },
): string {
  const spoken = buildAskSpeech(dest.name, walkMin, transit, ui);
  const result: PitchResult = {
    requestId: `map_nav_mobility_${Date.now()}`,
    softFail: false,
    spokenText: spoken,
    summary: dest.name,
    options: buildOptions(dest, walkMin, transit, ui),
    uiLayout: 'live_split',
  };
  publishPitchToLive(result, dest.name);
  return spoken;
}

/**
 * Live-Guard zeigen + sprechen. Nicht die Route starten.
 * Prefetch blockiert die UI nicht — Ask sofort, Zeiten nachziehen.
 * Stimme wartet auf freie TTS (kein Call-1-Abbruch).
 */
export async function presentMapNavMobilityAsk(
  opts: MapNavMobilityAskInput,
): Promise<void> {
  const walkMin = Math.max(1, Math.round(opts.walkMin));
  const ui = {
    hideWalk: opts.hideWalk === true,
    includeTaxi: opts.includeTaxi === true,
    preferBike: opts.preferBike === true,
    airMeters: opts.airMeters,
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

  const knownTransit: TransitMeta | null =
    opts.transitMin != null && opts.transitMin > 0
      ? {
          transitMin: Math.max(1, Math.round(opts.transitMin)),
          arriveMs: null,
          transfers: null,
          lineHint: null,
        }
      : null;

  const turnId = `map_nav_mobility_${Date.now()}`;
  // Sofort UI — Stimme erst wenn Call-1 fertig UND Prefetch kurz Zeit hatte.
  publishAsk(opts.dest, walkMin, knownTransit, ui);

  const speakFinal = (meta: TransitMeta | null) => {
    const spoken = publishAsk(opts.dest, walkMin, meta, ui);
    void speakAskWhenIdle(spoken, turnId);
  };

  if (knownTransit != null && knownTransit.transfers != null) {
    speakFinal(knownTransit);
    return;
  }

  const prefetched = await Promise.race([
    prefetchTransitMin(opts),
    sleep(1600).then(() => null as TransitMeta | null),
  ]);
  if (prefetched?.transitMin) {
    speakFinal(prefetched);
    return;
  }
  // Prefetch noch offen — UI schon da; Speech mit bisherigem Stand, Update nur UI.
  speakFinal(knownTransit);
  void prefetchTransitMin(opts).then((late) => {
    if (!late?.transitMin) return;
    publishAsk(opts.dest, walkMin, late, ui);
  });
}
