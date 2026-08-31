/**
 * ÖPNV vs Taxi zum Flughafen — Zeiten + Buttons, keine Permission-Frage.
 */

import type { QuickAction } from '../../types/concierge';
import { formatDurationMinutesDe } from '../navigation/travelEta';
import { planJourney, type JourneyItinerary } from '../transit/journeyPlanner';
import { formatJourneyForConcierge } from '../transit/formatJourneyCard';
import { rememberJourneyForStart } from '../navigation/journeyStartCache';
import { buildUberRideAction } from '../affiliate/affiliateService';
import { taxiDurationWithRushHour } from '../affiliate/partnerDeepPrefill';
import { estimateDrivingEta } from '../navigation/drivingEta';
import { haversineMeters } from '../../db/database';
import { isSaneAirportAccessTransit } from './airportAccessSane';
import {
  buildGetTransferNewUrl,
  buildWelcomePickupsTransferUrl,
} from '../affiliate/partnerTpxDeepLink';

export type AirportAccessCompare = {
  transit: JourneyItinerary | null;
  transitLeaveMs: number | null;
  transitMin: number | null;
  taxiMin: number;
  taxiPrice: string | null;
  tight: boolean;
  recommend: 'transit' | 'taxi' | 'either';
  speechBit: string;
  bullets: string[];
  journeyDetail: string | null;
  actions: QuickAction[];
};

function clock(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function taxiMinFromDist(distM: number): number {
  return Math.max(8, Math.round(distM / 450) + 3);
}

function taxiPriceFromDist(distM: number): string | null {
  if (!Number.isFinite(distM) || distM < 800) return null;
  const low = Math.max(8, Math.round(3.5 + (distM / 1000) * 1.9));
  const high = Math.max(low + 3, Math.round(low * 1.4));
  return `ca. ${low}–${high} €`;
}

export async function compareAirportAccess(opts: {
  from: { lat: number; lng: number };
  airport: { lat: number; lng: number; name: string };
  arriveBy: Date;
  nowMs?: number;
}): Promise<AirportAccessCompare> {
  const now = opts.nowMs ?? Date.now();
  const distM = haversineMeters(
    opts.from.lat,
    opts.from.lng,
    opts.airport.lat,
    opts.airport.lng,
  );
  const arriveByMs = opts.arriveBy.getTime();
  const guessLeave = arriveByMs - taxiMinFromDist(distM) * 60_000;
  let taxiMin = taxiDurationWithRushHour(taxiMinFromDist(distM), guessLeave);
  try {
    const eta = await estimateDrivingEta({
      fromLat: opts.from.lat,
      fromLng: opts.from.lng,
      toLat: opts.airport.lat,
      toLng: opts.airport.lng,
      atMs: guessLeave,
    });
    if (eta.minutes >= 1) {
      taxiMin = eta.minutes;
    }
  } catch {
    /* haversine fallback */
  }
  const taxiPrice = taxiPriceFromDist(distM);

  let transit: JourneyItinerary | null = null;
  const arriveByInFuture = arriveByMs > now + 5 * 60_000;
  try {
    if (arriveByInFuture) {
      const plan = await planJourney({
        from: opts.from,
        to: { lat: opts.airport.lat, lng: opts.airport.lng },
        travelMode: 'transit',
        arriveBy: opts.arriveBy,
        numItineraries: 2,
      });
      const cand = (plan.itineraries ?? []).find((it) =>
        isSaneAirportAccessTransit(it, {
          arriveByMs,
          taxiMin,
          nowMs: now,
        }),
      );
      transit = cand ?? null;
    }
  } catch {
    transit = null;
  }

  const transitMin = transit
    ? Math.max(1, Math.round(transit.durationSec / 60))
    : null;
  const transitLeaveMs = transit?.startTime?.getTime() ?? null;
  const taxiLeaveMs = opts.arriveBy.getTime() - taxiMin * 60_000;
  const tightTransit =
    transitLeaveMs != null && transitLeaveMs <= now + 2 * 60_000;
  const tightTaxi = taxiLeaveMs <= now + 2 * 60_000;

  let recommend: AirportAccessCompare['recommend'] = 'either';
  if (!transit) recommend = 'taxi';
  else if (tightTransit && !tightTaxi) recommend = 'taxi';
  else if (transitMin != null && taxiMin + 8 < transitMin) recommend = 'taxi';
  else if (transitMin != null && transitMin + 5 <= taxiMin) recommend = 'transit';

  const card = transit
    ? formatJourneyForConcierge(transit, opts.airport.name)
    : null;
  if (transit) {
    rememberJourneyForStart({
      itinerary: transit,
      destName: opts.airport.name,
      destLat: opts.airport.lat,
      destLng: opts.airport.lng,
    });
  }

  const actions: QuickAction[] = [];
  actions.push(
    buildUberRideAction(opts.airport.lat, opts.airport.lng, opts.airport.name, undefined, {
      pickupTimeLabel: clock(new Date(taxiLeaveMs)),
    }),
  );
  if (transit) {
    actions.push({
      type: 'START_NAVIGATION',
      label: 'ÖPNV Flughafen',
      payload: {
        destLat: opts.airport.lat,
        destLng: opts.airport.lng,
        destName: opts.airport.name,
        journeyNav: true,
      },
    });
  }
  try {
    const citySlug =
      opts.airport.name
        .replace(/\b(airport|flughafen|international)\b/gi, '')
        .trim()
        .split(/\s+/)[0] || 'city';
    const wp = buildWelcomePickupsTransferUrl({
      citySlug,
      dateIso: opts.arriveBy.toISOString().slice(0, 10),
      timeHm: clock(new Date(taxiLeaveMs)),
      toName: opts.airport.name,
      toLat: opts.airport.lat,
      toLng: opts.airport.lng,
      toType: 'airport',
    });
    if (wp) {
      actions.push({
        type: 'OPEN_URL',
        label: 'Transfer Welcome Pickups',
        payload: { url: wp },
      });
    }
  } catch {
    /* soft */
  }
  try {
    const gt = buildGetTransferNewUrl();
    // GetTransfer /new ohne Prefill = Hollow-Homepage — keinen Button.
    if (gt && /gettransfer\.com\/.+\/.+/i.test(gt) && !/\/transfers\/new\/?$/i.test(gt)) {
      actions.push({
        type: 'OPEN_URL',
        label: 'Transfer GetTransfer',
        payload: { url: gt },
      });
    }
  } catch {
    /* soft */
  }
  while (actions.length > 4) actions.pop();

  const taxiBit = `Taxi ${formatDurationMinutesDe(taxiMin, 'speech')}${
    taxiPrice ? ` (${taxiPrice})` : ''
  }`;
  const transitBit = transitMin
    ? `ÖPNV ${formatDurationMinutesDe(transitMin, 'speech')}` +
      (transitLeaveMs
        ? `, Losgehen gegen ${clock(new Date(transitLeaveMs))}`
        : '')
    : 'keine belegte ÖPNV-Kette';

  let speechBit = `${transitBit}. ${taxiBit}.`;
  if (recommend === 'taxi') {
    speechBit += ' Taxi ist hier die sicherere Karte.';
  } else if (recommend === 'transit' && !tightTransit) {
    speechBit += ' Mit der Bahn kommst du entspannt hin.';
  }

  const bullets = [
    transitMin
      ? `ÖPNV ${formatDurationMinutesDe(transitMin, 'short')}`
      : 'ÖPNV unklar',
    `Taxi ${formatDurationMinutesDe(taxiMin, 'short')}${taxiPrice ? ` · ${taxiPrice}` : ''}`,
  ];

  return {
    transit,
    transitLeaveMs,
    transitMin,
    taxiMin,
    taxiPrice,
    tight: tightTransit || tightTaxi,
    recommend,
    speechBit,
    bullets,
    journeyDetail: card
      ? (card.bullets ?? []).join('\n')
      : null,
    actions,
  };
}
