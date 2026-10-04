/**
 * Hub-Zubringer: Heimat ≠ Abflugstadt → Bahn/FlixBus/FlixTrain + ÖPNV zum Airport,
 * dann Flug + Transfer zum Hotel. Stadt-agnostisch (kein Orts-Hardcode).
 */

import type { JourneyBeat, ReiseLedger, ReiseOption, TransportChoice } from '../types';
import { HUB_IATA_CITY, hubCityFromIata } from './hubPreNight';
import { buildFlixBusSearchUrl } from './surfaceLiveFares';

export type FeederMode = 'db' | 'flixbus' | 'flixtrain' | 'transit';

export type FeederLegChoice = {
  mode: FeederMode;
  label: string;
  bookUrl: string;
  priceEur: number | null;
  durationHint: string | null;
  preferred: boolean;
};

export type HubFeederLeg = {
  id: string;
  /** local_rail | long_haul | airport_transit */
  role: 'local_rail' | 'long_haul' | 'airport_transit';
  fromLabel: string;
  toLabel: string;
  title: string;
  detail: string;
  bookUrl: string | null;
  priceEur: number | null;
  durationHint: string | null;
  icon: string;
  /** Alternativen (DB / FlixBus / FlixTrain) — long_haul */
  choices?: FeederLegChoice[];
};

export type HubFeederPlan = {
  needed: boolean;
  home: string;
  hubCity: string;
  hubIata: string;
  airportLabel: string;
  boardingCity: string;
  dateKey: string | null;
  legs: HubFeederLeg[];
};

/** Große DE-Schienen-/Fernbus-Knoten (Board für Flix/ICE). */
const MAJOR_BOARDING: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Hamburg', lat: 53.5528, lng: 10.0067 },
  { name: 'Berlin', lat: 52.5200, lng: 13.4050 },
  { name: 'Hannover', lat: 52.3759, lng: 9.7320 },
  { name: 'Bremen', lat: 53.0793, lng: 8.8017 },
  { name: 'Köln', lat: 50.9413, lng: 6.9583 },
  { name: 'Düsseldorf', lat: 51.2277, lng: 6.7735 },
  { name: 'Frankfurt', lat: 50.1109, lng: 8.6821 },
  { name: 'München', lat: 48.1351, lng: 11.5820 },
  { name: 'Stuttgart', lat: 48.7758, lng: 9.1829 },
  { name: 'Nürnberg', lat: 49.4521, lng: 11.0767 },
  { name: 'Leipzig', lat: 51.3397, lng: 12.3731 },
  { name: 'Dortmund', lat: 51.5136, lng: 7.4653 },
];

const AIRPORT_LABEL: Record<string, string> = {
  BER: 'Flughafen Berlin Brandenburg',
  HAM: 'Hamburg Airport',
  BRE: 'Bremen Airport',
  HAJ: 'Hannover Airport',
  CGN: 'Flughafen Köln/Bonn',
  DUS: 'Flughafen Düsseldorf',
  FRA: 'Flughafen Frankfurt',
  MUC: 'Flughafen München',
  STR: 'Flughafen Stuttgart',
  DTM: 'Dortmund Airport',
  NUE: 'Flughafen Nürnberg',
  LEJ: 'Flughafen Leipzig/Halle',
  HHN: 'Frankfurt-Hahn',
  FMM: 'Memmingen Airport',
  NRN: 'Weeze Airport',
};

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss');
}

function samePlace(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function isMajorBoardingCity(name: string): boolean {
  return MAJOR_BOARDING.some((m) => samePlace(m.name, name));
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lookupHomeCoords(
  home: string,
  homeLat?: number | null,
  homeLng?: number | null,
): { lat: number; lng: number } | null {
  if (homeLat != null && homeLng != null && Number.isFinite(homeLat) && Number.isFinite(homeLng)) {
    return { lat: homeLat, lng: homeLng };
  }
  try {
    const { SEED_PLACES } = require('./candidates') as {
      SEED_PLACES: Array<{ name: string; lat: number; lng: number }>;
    };
    const hit = SEED_PLACES.find((p) => samePlace(p.name, home));
    if (hit) return { lat: hit.lat, lng: hit.lng };
  } catch {
    /* soft */
  }
  return null;
}

/** Nächster großer Knoten für Fernbus/ICE. */
export function resolveBoardingCity(opts: {
  home: string;
  hubCity: string;
  homeLat?: number | null;
  homeLng?: number | null;
}): string {
  const home = opts.home.trim();
  if (isMajorBoardingCity(home)) {
    return MAJOR_BOARDING.find((m) => samePlace(m.name, home))!.name;
  }
  const here = lookupHomeCoords(home, opts.homeLat, opts.homeLng);
  if (here) {
    let best = MAJOR_BOARDING[0]!;
    let bestD = Infinity;
    for (const m of MAJOR_BOARDING) {
      // Nicht das Flug-Hub als Board, wenn ein anderer Knoten klar näher ist
      // (Prisdorf → Hamburg statt Berlin, obwohl Flug ab BER)
      const d = haversineKm(here, m);
      const hubPenalty = samePlace(m.name, opts.hubCity) ? 40 : 0;
      const score = d + hubPenalty;
      if (score < bestD) {
        bestD = score;
        best = m;
      }
    }
    return best.name;
  }
  // Ohne Koordinaten: home bleibt Start der Fernsuche (DB/Flix mit Ortsname)
  return home;
}

function bahnUrl(from: string, to: string, dateKey?: string | null): string {
  try {
    const { buildDbJourneySearchUrl } = require('../../services/transit/transitTicketFareParse') as {
      buildDbJourneySearchUrl: (o: {
        from: string;
        to: string;
        dateKey?: string | null;
      }) => string | null;
    };
    return (
      buildDbJourneySearchUrl({ from, to, dateKey }) ||
      `https://www.bahn.de/buchung/fahrplan/suche?so=${encodeURIComponent(from)}&zo=${encodeURIComponent(to)}`
    );
  } catch {
    const hd = (dateKey || '').slice(0, 10);
    const dateQ = /^\d{4}-\d{2}-\d{2}$/.test(hd)
      ? `&hd=${encodeURIComponent(`${hd}T08:00:00`)}`
      : '';
    return `https://www.bahn.de/buchung/fahrplan/suche?so=${encodeURIComponent(from)}&zo=${encodeURIComponent(to)}${dateQ}`;
  }
}

function flixBusUrl(from: string, to: string, dateKey?: string | null): string {
  return buildFlixBusSearchUrl({
    originCity: from,
    destCity: to,
    checkin: dateKey || '',
  });
}

function flixTrainUrl(from: string, to: string, dateKey?: string | null): string {
  return buildFlixBusSearchUrl({
    originCity: from,
    destCity: to,
    checkin: dateKey || '',
    train: true,
  });
}

function airportLabelFor(iata: string, hubCity: string): string {
  return AIRPORT_LABEL[iata] || `Flughafen ${hubCity}`;
}

function feederDateKey(ledger: ReiseLedger, tr: TransportChoice | null): string | null {
  const flyDay = tr?.departDateKey || (tr?.departAt || '').slice(0, 10) || null;
  if (flyDay && /^\d{4}-\d{2}-\d{2}$/.test(flyDay)) {
    // Zubringer oft am Flugtag früh — oder Vortag bei hubPreNight
    if (tr?.hubPreNight) {
      try {
        const { hubPreNightDateKey } = require('./hubPreNight') as typeof import('./hubPreNight');
        return hubPreNightDateKey(flyDay) || flyDay;
      } catch {
        return flyDay;
      }
    }
    return flyDay;
  }
  return ledger.dateStart?.value?.slice(0, 10) || null;
}

function pickPreferred(choices: FeederLegChoice[]): FeederLegChoice {
  const priced = choices.filter((c) => c.priceEur != null && c.priceEur > 0);
  if (priced.length) {
    return priced.reduce((a, b) => ((a.priceEur ?? 9e9) <= (b.priceEur ?? 9e9) ? a : b));
  }
  // Ohne Live-Preis: FlixBus als günstige Option markieren, DB immer dabei
  return choices.find((c) => c.mode === 'flixbus') || choices[0]!;
}

export function buildHubFeederPlan(opts: {
  ledger: ReiseLedger;
  transport: TransportChoice | null;
  homeLat?: number | null;
  homeLng?: number | null;
  /** Live Fernbus-Preis wenn schon geholt */
  liveBusPriceEur?: number | null;
  liveBusDuration?: string | null;
}): HubFeederPlan | null {
  const home = (opts.ledger.originCity?.value || '').trim();
  if (!home) return null;
  const tr = opts.transport;
  if (!tr || tr.kind !== 'flight') return null;
  const hubIata = (tr.fromIata || opts.ledger.airportIata?.value || '').toUpperCase();
  const hubCity = hubCityFromIata(hubIata) || HUB_IATA_CITY[hubIata] || null;
  if (!hubCity) return null;
  if (samePlace(home, hubCity)) {
    // Nur Airport-ÖPNV innerhalb derselben Stadt
    const dateKey = feederDateKey(opts.ledger, tr);
    const airport = airportLabelFor(hubIata, hubCity);
    return {
      needed: true,
      home,
      hubCity,
      hubIata,
      airportLabel: airport,
      boardingCity: hubCity,
      dateKey,
      legs: [
        {
          id: 'feeder-airport',
          role: 'airport_transit',
          fromLabel: `${hubCity} Hbf`,
          toLabel: airport,
          title: `${hubCity} → ${hubIata}`,
          detail: `ÖPNV/Bahn zum ${airport} — Anschluss vor dem Flug.`,
          bookUrl: bahnUrl(`${hubCity} Hbf`, airport, dateKey),
          priceEur: null,
          durationHint: null,
          icon: '🚇',
        },
      ],
    };
  }

  const boarding = resolveBoardingCity({
    home,
    hubCity,
    homeLat: opts.homeLat,
    homeLng: opts.homeLng,
  });
  const dateKey = feederDateKey(opts.ledger, tr);
  const airport = airportLabelFor(hubIata, hubCity);
  const legs: HubFeederLeg[] = [];

  // 1) Dorf/Kleinstadt → großer Bahnhof (Regional)
  if (!samePlace(home, boarding)) {
    legs.push({
      id: 'feeder-local',
      role: 'local_rail',
      fromLabel: home,
      toLabel: `${boarding} Hbf`,
      title: `${home} → ${boarding} Hbf`,
      detail: 'Regionalbahn zum Fernverkehrs-Knoten — dort umsteigen auf Flix/ICE.',
      bookUrl: bahnUrl(home, `${boarding} Hbf`, dateKey),
      priceEur: null,
      durationHint: null,
      icon: '🚆',
    });
  }

  // 2) Fernstrecke Board → Hub (DB + FlixBus + FlixTrain), günstigste bevorzugen
  if (!samePlace(boarding, hubCity)) {
    const choices: FeederLegChoice[] = [
      {
        mode: 'flixbus',
        label: `FlixBus ${boarding} → ${hubCity}`,
        bookUrl: flixBusUrl(boarding, hubCity, dateKey),
        priceEur: opts.liveBusPriceEur ?? null,
        durationHint: opts.liveBusDuration ?? null,
        preferred: false,
      },
      {
        mode: 'flixtrain',
        label: `FlixTrain ${boarding} → ${hubCity}`,
        bookUrl: flixTrainUrl(boarding, hubCity, dateKey),
        priceEur: null,
        durationHint: null,
        preferred: false,
      },
      {
        mode: 'db',
        label: `DB ${boarding} → ${hubCity}`,
        bookUrl: bahnUrl(`${boarding} Hbf`, `${hubCity} Hbf`, dateKey),
        priceEur: null,
        durationHint: null,
        preferred: false,
      },
    ];
    const pref = pickPreferred(choices);
    const marked = choices.map((c) => ({
      ...c,
      preferred: c.mode === pref.mode,
    }));
    legs.push({
      id: 'feeder-long',
      role: 'long_haul',
      fromLabel: boarding,
      toLabel: hubCity,
      title: `${boarding} → ${hubCity}`,
      detail: `Rausgesucht: ${pref.label} — am Flugtag passend und günstig.`,
      bookUrl: pref.bookUrl,
      priceEur: pref.priceEur,
      durationHint: pref.durationHint,
      icon: pref.mode === 'flixbus' ? '🚌' : '🚆',
      choices: marked,
    });
  }

  // 3) Hub-Stadt → Flughafen
  legs.push({
    id: 'feeder-airport',
    role: 'airport_transit',
    fromLabel: `${hubCity} Hbf`,
    toLabel: airport,
    title: `${hubCity} → ${hubIata}`,
    detail: `Zum ${airport} — S-Bahn/Regional, damit der Check-in sitzt.`,
    bookUrl: bahnUrl(`${hubCity} Hbf`, airport, dateKey),
    priceEur: null,
    durationHint: null,
    icon: '🚇',
  });

  return {
    needed: legs.length > 0,
    home,
    hubCity,
    hubIata,
    airportLabel: airport,
    boardingCity: boarding,
    dateKey,
    legs,
  };
}

export function hubFeederToJourneyBeats(plan: HubFeederPlan | null): JourneyBeat[] {
  if (!plan?.needed) return [];
  return plan.legs.map((leg) => ({
    id: leg.id,
    kind: 'train_out' as const,
    title: leg.title,
    detail: leg.detail,
    bookUrl: leg.bookUrl,
    priceEur: leg.priceEur,
    durationHint: leg.durationHint,
    icon: leg.icon,
    photoUrl: null,
  }));
}

/** Checklist-Zeilen: nur der bevorzugte Long-Haul + Local/Airport — kein Partner-Vergleich. */
export function hubFeederChecklistItems(
  plan: HubFeederPlan | null,
): Array<{ id: string; label: string; url: string; kind: 'train' | 'other' }> {
  if (!plan?.needed) return [];
  const out: Array<{ id: string; label: string; url: string; kind: 'train' | 'other' }> = [];
  for (const leg of plan.legs) {
    if (leg.role === 'long_haul' && leg.choices?.length) {
      const pref = leg.choices.find((c) => c.preferred) || leg.choices[0]!;
      out.push({
        id: `feeder-${leg.id}-${pref.mode}`,
        label: pref.label,
        url: pref.bookUrl,
        kind: pref.mode === 'flixbus' ? 'other' : 'train',
      });
      continue;
    }
    if (leg.bookUrl) {
      out.push({
        id: `feeder-${leg.id}`,
        label: leg.title,
        url: leg.bookUrl,
        kind: 'train',
      });
    }
  }
  return out;
}

export async function enrichHubFeederLivePrices(
  plan: HubFeederPlan,
): Promise<HubFeederPlan> {
  const long = plan.legs.find((l) => l.role === 'long_haul');
  if (!long?.choices?.length) return plan;
  try {
    const { lookupFernbusLiveQuote } = await import('./surfaceLiveFares');
    const quote = await lookupFernbusLiveQuote({
      originCity: long.fromLabel,
      destCity: long.toLabel,
      checkin: plan.dateKey || '',
    });
    if (quote.priceEur == null && !quote.durationHint) return plan;
    const choices = long.choices.map((c) =>
      c.mode === 'flixbus'
        ? {
            ...c,
            priceEur: quote.priceEur ?? c.priceEur,
            durationHint: quote.durationHint ?? c.durationHint,
          }
        : c,
    );
    const pref = pickPreferred(choices);
    const marked = choices.map((c) => ({ ...c, preferred: c.mode === pref.mode }));
    return {
      ...plan,
      legs: plan.legs.map((l) =>
        l.id === long.id
          ? {
              ...l,
              choices: marked,
              bookUrl: pref.bookUrl,
              priceEur: pref.priceEur,
              durationHint: pref.durationHint,
              detail: `Rausgesucht: ${pref.label} — am Flugtag passend und günstig.`,
              icon: pref.mode === 'flixbus' ? '🚌' : '🚆',
            }
          : l,
      ),
    };
  } catch {
    return plan;
  }
}
