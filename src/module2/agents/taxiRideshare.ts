/**
 * Taxi / Uber organisieren — Fakten für die Synthese, kein Vorlese-Skript.
 * Zusagen, Auto-Dauer, Uber-Button, Taxinummer zum Anrufen.
 */

import type { AgentResult } from '../types';
import type { PipelineTask } from '../types';
import type { RucksackState } from '../rucksack/rucksackStore';
import { anchorCoords } from '../rucksack/rucksackStore';
import {
  extractTaxiDestName,
  wantsTaxiRide,
} from '../../services/mobility/taxiRideIntent';
import { estimateDrivingEta } from '../../services/navigation/drivingEta';
import {
  formatDistanceKmOrM,
  formatDurationMinutesDe,
} from '../../services/navigation/travelEta';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';

function isVagueTaxiDest(name: string): boolean {
  const n = name.replace(/\s+/g, ' ').trim();
  if (n.length < 3) return true;
  return /^(steak(?:haus|restaurant)?|restaurant|essen|ziel|dahin|dorthin|dort|da|hin)$/iu.test(
    n,
  );
}

function abandonTransitForTaxi(): void {
  try {
    const { stopJourneyLeaveWatch } = require('../../services/navigation/journeyLeaveBy') as {
      stopJourneyLeaveWatch: (reason?: string) => void;
    };
    stopJourneyLeaveWatch('taxi_switch');
  } catch {
    /* soft */
  }
  try {
    const { clearRememberedJourney } = require('../../services/navigation/journeyStartCache') as {
      clearRememberedJourney: () => void;
    };
    clearRememberedJourney();
  } catch {
    /* soft */
  }
  try {
    const { clearMultiStopTour } = require('../../services/navigation/multiStopTour') as {
      clearMultiStopTour: () => void;
    };
    clearMultiStopTour();
  } catch {
    /* soft */
  }
  try {
    const { stopNavigation } = require('../../services/navigation/navigationService') as {
      stopNavigation: (o?: { silent?: boolean; reason?: string }) => Promise<void>;
    };
    void stopNavigation({ silent: true, reason: 'manual' });
  } catch {
    /* soft */
  }
  try {
    const { clearLiveNavFromPlan } = require('../timeline/syncLiveNavToPlan') as {
      clearLiveNavFromPlan: (o?: { abandon?: boolean }) => void;
    };
    clearLiveNavFromPlan({ abandon: true });
  } catch {
    /* soft */
  }
}

function resolveActiveRideDest(extracted: string): {
  name: string;
  lat: number | null;
  lng: number | null;
} {
  let name = extracted.trim();
  let lat: number | null = null;
  let lng: number | null = null;

  try {
    const { useLivePitchStore } = require('../pitch/publishPitchUi') as {
      useLivePitchStore: {
        getState: () => {
          selectedOptionId: string | null;
          options: Array<{
            id: string;
            name: string;
            lat: number;
            lng: number;
          }>;
        };
      };
    };
    const pitch = useLivePitchStore.getState();
    const chosen =
      pitch.options.find((o) => o.id === pitch.selectedOptionId) ||
      pitch.options[0];
    if (chosen && Number.isFinite(chosen.lat) && Number.isFinite(chosen.lng)) {
      if (!name || isVagueTaxiDest(name)) name = chosen.name;
      lat = chosen.lat;
      lng = chosen.lng;
    }
  } catch {
    /* soft */
  }

  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          navTargetName: string | null;
          pendingNavOffer: {
            name?: string;
            lat?: number;
            lng?: number;
          } | null;
          multiStopTour: {
            stops?: Array<{
              name?: string;
              lat?: number;
              lng?: number;
              role?: string | null;
            }>;
          } | null;
        };
      };
    };
    const st = useFinnusStore.getState();
    const offer = st.pendingNavOffer;
    if (
      offer &&
      typeof offer.lat === 'number' &&
      typeof offer.lng === 'number' &&
      (lat == null || isVagueTaxiDest(extracted))
    ) {
      if (!name || isVagueTaxiDest(name)) name = offer.name || name;
      lat = offer.lat;
      lng = offer.lng;
    }
    const destStop = [...(st.multiStopTour?.stops ?? [])]
      .reverse()
      .find(
        (s) =>
          s.role === 'dest' ||
          (typeof s.lat === 'number' && typeof s.lng === 'number'),
      );
    if (
      destStop &&
      typeof destStop.lat === 'number' &&
      typeof destStop.lng === 'number' &&
      lat == null
    ) {
      if (!name || isVagueTaxiDest(name)) {
        name = destStop.name || st.navTargetName || name;
      }
      lat = destStop.lat;
      lng = destStop.lng;
    }
    if ((!name || isVagueTaxiDest(name)) && st.navTargetName) {
      name = st.navTargetName;
    }
  } catch {
    /* soft */
  }

  return { name: name.trim(), lat, lng };
}

export async function runTaxiRideshare(opts: {
  task: PipelineTask;
  rucksack: RucksackState;
}): Promise<AgentResult | null> {
  const text = opts.task.rewrittenText || opts.task.rawText || '';
  if (!wantsTaxiRide(text) && opts.task.jobId !== 'taxi_rideshare') {
    return null;
  }

  abandonTransitForTaxi();

  const a = anchorCoords(opts.rucksack);
  let destName = extractTaxiDestName(text);
  if (!destName || isVagueTaxiDest(destName)) {
    try {
      const { getShortTerm } = await import('../context/shortTermContext');
      const last = getShortTerm().lastPlaceName?.trim() || '';
      if (last && !isVagueTaxiDest(last)) destName = last;
    } catch {
      /* keep extracted */
    }
  }

  const active = resolveActiveRideDest(destName);
  destName = active.name || destName;
  let lat: number | null = active.lat;
  let lng: number | null = active.lng;
  let resolved = destName;

  if (destName && (lat == null || lng == null) && !isVagueTaxiDest(destName)) {
    try {
      const { geocodePlaceName } = await import(
        '../../services/navigation/googleMapsNav'
      );
      const geo = await geocodePlaceName(destName, {
        biasLat: a.lat,
        biasLng: a.lng,
        cityHint: opts.task.city || opts.rucksack.cityHint,
      });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        lat = geo.lat;
        lng = geo.lng;
        resolved = geo.label?.trim() || destName;
      }
    } catch {
      /* soft */
    }
  }

  let driveMin: number | null = null;
  let driveKm = '';
  if (lat != null && lng != null) {
    try {
      const eta = await estimateDrivingEta({
        fromLat: a.lat,
        fromLng: a.lng,
        toLat: lat,
        toLng: lng,
      });
      driveMin = eta.minutes;
      driveKm = formatDistanceKmOrM(eta.distanceM);
    } catch {
      /* soft */
    }
  }

  let taxiName = '';
  let taxiPhone = '';
  try {
    const { searchPlacesByText } = await import(
      '../../services/navigation/googleMapsNav'
    );
    const hits = await searchPlacesByText({
      query: 'Taxi',
      lat: a.lat,
      lng: a.lng,
      radiusM: 12_000,
      includedType: 'taxi_stand',
      enrich: true,
    });
    const withPhone = hits.find((h) => h.phoneNumber?.trim());
    const pick = withPhone || hits[0];
    if (pick) {
      taxiName = pick.name;
      taxiPhone = pick.phoneNumber?.trim() || '';
    }
    if (!taxiPhone) {
      const again = await searchPlacesByText({
        query: 'Taxi Unternehmen',
        lat: a.lat,
        lng: a.lng,
        radiusM: 15_000,
        enrich: true,
      });
      const p2 = again.find((h) => h.phoneNumber?.trim());
      if (p2) {
        taxiName = p2.name;
        taxiPhone = p2.phoneNumber.trim();
      }
    }
  } catch {
    /* soft */
  }

  const buttons: AgentResult['buttons'] = [];
  if (lat != null && lng != null) {
    buttons.push({
      id: 'taxi_uber',
      label: shortenActionLabel('🚗 Uber'),
      payload: {
        kind: 'book_uber',
        destLat: lat,
        destLng: lng,
        destName: resolved || destName || 'Ziel',
      },
    });
  }
  if (taxiPhone) {
    buttons.push({
      id: 'taxi_dial',
      label: shortenActionLabel(`📞 ${taxiName || 'Taxi'}`),
      payload: { kind: 'dial', phone: taxiPhone },
    });
  }

  const destBit = resolved || destName || 'dein Ziel';
  const durBit =
    driveMin != null
      ? `Fahrt mit dem Auto: ${formatDurationMinutesDe(driveMin, 'speech')}${
          driveKm ? ` (${driveKm})` : ''
        }`
      : destName
        ? 'Fahrtdauer gerade nicht sauber geladen'
        : '';
  const arrivalBit =
    driveMin != null
      ? `Ankunft ungefähr ${new Date(Date.now() + driveMin * 60_000).toLocaleTimeString(
          'de-DE',
          { hour: '2-digit', minute: '2-digit' },
        )} wenn ihr jetzt losfahrt (ohne Wartezeit auf den Wagen — die ist nicht belegbar)`
      : '';
  const taxiBit = taxiPhone
    ? `Taxi-Zentrale: ${taxiName || 'Taxi'} ${taxiPhone}`
    : 'Keine belegte Taxinummer in der Nähe';

  return {
    agent: 'mobility',
    ok: true,
    draftText: [
      'FAKTEN Taxi/Uber (nicht wörtlich vorlesen):',
      `Ziel: ${destBit}`,
      durBit,
      arrivalBit,
      'Uber: Deep-Link zur Produktwahl (Preis + wann ein Wagen da wäre auf der Seite). Wartezeit nicht erfinden.',
      taxiBit,
      'FLOW: Die Bridge hat den Auftrag schon zugesagt. Haupt-Speech = Fortsetzung: wir fahren mit dem Taxi/Uber zum aktiven Ziel. Uber-Link zuerst (Pickup = aktueller Standort, Dropoff = Restaurant/Adresse). Fahrtdauer wenn belegt. Taxinummer nur als Alternative zum selbst Anrufen. ÖPNV-Route ist beendet. Nicht die Taxizentrale als Ziel vorlesen. Keine Permission-Frage.',
    ]
      .filter(Boolean)
      .join('\n'),
    bullets: [
      destBit,
      driveMin != null
        ? `Auto ${formatDurationMinutesDe(driveMin, 'short')}`
        : '',
      taxiPhone ? taxiName || 'Taxi anrufen' : 'Uber buchen',
    ].filter(Boolean).slice(0, 3),
    buttons,
    meta: {
      taxiRideshare: true,
      destName: destBit,
      destLat: lat,
      destLng: lng,
      driveMin,
      taxiPhone: taxiPhone || null,
      taxiName: taxiName || null,
    },
  };
}
