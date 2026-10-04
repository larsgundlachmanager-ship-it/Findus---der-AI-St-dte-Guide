/**
 * Taxi / Transfer / Zwischenstopp — überall dieselbe Blaupause.
 * Cruise-Terminal, Fähre, Bahnhof, Hotel, Flughafen: Legs + Buchungs-URL, kein Fake-Preis.
 */

import type { ReiseLedger, ReiseOption } from '../types';
import type { AccessLeg } from './tripPackageSpine';
import { resolvePackageBlueprint } from './packageBlueprint';

export type TransferHub =
  | 'airport'
  | 'station'
  | 'ferry_port'
  | 'cruise_terminal'
  | 'stay'
  | 'home'
  | 'waypoint';

function mapsDirUrl(destQuery: string, mode: 'driving' | 'transit'): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destQuery)}&travelmode=${mode}`;
}

/** Uber Prefill wenn Dropoff-GPS da — sonst Maps. Gleiche Blaupause wie M2. */
function bookUrlForDropoff(opts: {
  destQuery: string;
  destLat?: number | null;
  destLng?: number | null;
  taxi: boolean;
  mode: 'driving' | 'transit';
}): string {
  const lat = opts.destLat;
  const lng = opts.destLng;
  if (
    opts.taxi &&
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    try {
      const {
        buildUberGoUrl,
        uberPlaceFromAddress,
      } = require('../../services/affiliate/partnerBookingDeepLink') as {
        buildUberGoUrl: (o: {
          clientId: string;
          dropoff: unknown;
          pickupMyLocation?: boolean;
        }) => string;
        uberPlaceFromAddress: (
          lat: number,
          lng: number,
          address: string,
        ) => unknown;
      };
      const clientId =
        process.env.EXPO_PUBLIC_UBER_CLIENT_ID ||
        process.env.UBER_CLIENT_ID ||
        '';
      const url = buildUberGoUrl({
        clientId,
        dropoff: uberPlaceFromAddress(lat, lng, opts.destQuery),
        pickupMyLocation: true,
      });
      if (url && /uber\.com/i.test(url)) return url;
    } catch {
      /* Maps-Fallback */
    }
  }
  return mapsDirUrl(opts.destQuery, opts.mode);
}

export function wantsTaxiTransfers(ledger: ReiseLedger): boolean {
  const p = ledger.transferPref?.value;
  if (p === 'public' || p === 'walk' || p === 'rental') return false;
  if (p === 'taxi' || p === 'package') return true;
  const bp = resolvePackageBlueprint(ledger);
  // Road/Camping/Tour: kein Default-Airport-Taxi — nur wenn User Taxi/Zwischenstopp sagt
  if (bp === 'road' || bp === 'camping' || bp === 'route_tour') return false;
  // Overnight fly/cruise/ferry/rail: Taxi einplanen (Just-Do-It)
  return true;
}

export function transferTravelMode(
  ledger: ReiseLedger,
): 'driving' | 'transit' {
  const p = ledger.transferPref?.value;
  if (p === 'public') return 'transit';
  return 'driving';
}

function hubLabel(hub: TransferHub): string {
  switch (hub) {
    case 'airport':
      return 'Flughafen';
    case 'station':
      return 'Bahnhof';
    case 'ferry_port':
      return 'Fährhafen';
    case 'cruise_terminal':
      return 'Kreuzfahrtterminal';
    case 'stay':
      return 'Hotel';
    case 'home':
      return 'Start';
    default:
      return 'Zwischenstopp';
  }
}

/** Eine Taxi-/Transfer-Leg: Uber wenn Dropoff-GPS, sonst Maps. */
export function buildTaxiLeg(opts: {
  id: string;
  from: TransferHub;
  to: TransferHub;
  destQuery: string;
  amountEur?: number | null;
  ledger: ReiseLedger;
  notes?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  label?: string | null;
}): AccessLeg {
  const mode = transferTravelMode(opts.ledger);
  const taxi = wantsTaxiTransfers(opts.ledger) || opts.from === 'waypoint';
  const label =
    opts.label ||
    (taxi
      ? `Taxi ${hubLabel(opts.from)} → ${hubLabel(opts.to)}`
      : `Transfer ${hubLabel(opts.from)} → ${hubLabel(opts.to)}`);
  const bookUrl = bookUrlForDropoff({
    destQuery: opts.destQuery,
    destLat: opts.destLat,
    destLng: opts.destLng,
    taxi,
    mode,
  });
  return {
    id: opts.id,
    kind: 'transfer',
    label,
    amountEur: opts.amountEur ?? null,
    scope: 'group',
    bookUrl,
    notes:
      opts.notes ??
      (taxi
        ? /uber\.com/i.test(bookUrl)
          ? 'Uber Prefill — Pickup GPS, Originalziel bleibt'
          : 'Taxi/Maps — Uber-Prefill in Modul 2 wenn GPS da'
        : null),
  };
}

const HUB_CITY: Record<string, string> = {
  HAM: 'Hamburg',
  BRE: 'Bremen',
  BER: 'Berlin',
  HAJ: 'Hannover',
  CGN: 'Köln',
  DUS: 'Düsseldorf',
  FRA: 'Frankfurt',
  MUC: 'München',
  STR: 'Stuttgart',
  DTM: 'Dortmund',
};

function bahnFeederUrl(from: string, to: string, dateKey?: string | null): string {
  const so = encodeURIComponent(from);
  const zo = encodeURIComponent(`${to} Hbf`);
  const hd = (dateKey || '').slice(0, 10);
  const dateQ = hd ? `&hd=${encodeURIComponent(`${hd}T08:00:00`)}` : '';
  return `https://www.bahn.de/buchung/fahrplan/suche?so=${so}&zo=${zo}${dateQ}`;
}

function buildHomeHubTrainLeg(ledger: ReiseLedger, fromIata?: string | null): AccessLeg | null {
  try {
    const { buildHubFeederPlan, hubFeederChecklistItems } = require('./hubFeederPlan') as typeof import('./hubFeederPlan');
    const fakeTr = {
      id: 'fly',
      kind: 'flight' as const,
      label: '',
      departAt: null,
      arriveAt: null,
      priceEur: null,
      bookUrl: null,
      better: false,
      fromIata: fromIata || ledger.airportIata?.value || null,
    };
    const plan = buildHubFeederPlan({ ledger, transport: fakeTr });
    const items = hubFeederChecklistItems(plan);
    const preferred = items.find((i) => i.label.startsWith('★')) || items[0];
    if (!preferred) return null;
    return {
      id: 'xfer-home-hub',
      kind: 'train',
      label: preferred.label.replace(/^★\s*/, ''),
      amountEur: null,
      scope: 'per_person',
      bookUrl: preferred.url,
      notes: 'Zubringer Heimat→Hub (FlixBus/FlixTrain/DB) — Anschluss zum Flug',
    };
  } catch {
    /* fallback */
  }
  const home = ledger.originCity?.value?.trim();
  if (!home) return null;
  const hub = (fromIata || ledger.airportIata?.value || '').toUpperCase();
  const destCity =
    (hub && HUB_CITY[hub]) ||
    (ledger.originCities?.value ?? []).find((c) =>
      Object.values(HUB_CITY).some((h) => h.toLowerCase() === c.toLowerCase()),
    ) ||
    null;
  if (!destCity) return null;
  if (home.toLowerCase() === destCity.toLowerCase()) return null;
  return {
    id: 'xfer-home-hub',
    kind: 'train',
    label: `Zubringer ${home} → ${destCity}`,
    amountEur: null,
    scope: 'per_person',
    bookUrl: bahnFeederUrl(home, destCity, ledger.dateStart?.value),
    notes: 'Bahn zum Abflughafen — Anschluss sitzt, auch wenn ihr nicht in der Airport-Stadt wohnt',
  };
}

function destQueryForStay(opt: ReiseOption, ledger: ReiseLedger): string {
  if (opt.stayName) return String(opt.stayName);
  if (opt.placeName) return String(opt.placeName);
  if (opt.lat && opt.lng) return `${opt.lat},${opt.lng}`;
  return ledger.destinationHint?.value || 'Unterkunft';
}

function stayCoords(opt: ReiseOption): { lat: number; lng: number } | null {
  if (
    opt.lat != null &&
    opt.lng != null &&
    Number.isFinite(opt.lat) &&
    Number.isFinite(opt.lng)
  ) {
    return { lat: opt.lat, lng: opt.lng };
  }
  return null;
}

export function parseZwischenstoppPlace(blob: string): string | null {
  const t = String(blob || '');
  if (!t) return null;
  // Flug-Layover nicht als Taxi-Stopp
  if (
    /\b(?:max(?:imal)?|höchstens|hoechstens).{0,16}zwischenstopp\b/iu.test(t) &&
    !/\b(taxi|uber|bolt)\b/iu.test(t)
  ) {
    return null;
  }
  if (
    /\b(umsteigen|layover|direktflug)\b/iu.test(t) &&
    !/\b(taxi|uber|bolt|einfügen|einlegen)\b/iu.test(t)
  ) {
    return null;
  }
  if (
    !/\bzwischenstopp\b/iu.test(t) &&
    !(
      /\b(taxi|uber|bolt)\b/iu.test(t) &&
      /\b(stopp\s+in|halt\s+in|umweg|einfügen|einlegen)\b/iu.test(t)
    )
  ) {
    return null;
  }
  const named = t.match(
    /\b(?:zwischenstopp|stopp|halt)\s+(?:in|bei|am|an)\s+([A-ZÄÖÜ][\p{L}\-]{2,40})/iu,
  );
  if (named?.[1]) return named[1];
  if (/\b(taxi|uber|bolt|transfer|einfügen|einlegen)\b/iu.test(t)) {
    return 'Zwischenstopp';
  }
  return 'Zwischenstopp';
}

function parseZwischenstoppWishes(ledger: ReiseLedger): string[] {
  const blob = [
    ledger.extraWishes?.value,
    ledger.highlightWant?.value,
    ...(ledger.mustActivities?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ');
  const place = parseZwischenstoppPlace(blob);
  return place ? [place] : [];
}

/**
 * Standard-Transfer-Legs je Blueprint — Taxi überall, nicht nur Flughafen.
 */
export function buildAccessTransferLegs(
  ledger: ReiseLedger,
  opt: ReiseOption,
): AccessLeg[] {
  const bp = resolvePackageBlueprint(ledger);
  const stayQ = destQueryForStay(opt, ledger);
  const stayGps = stayCoords(opt);
  const port =
    ledger.cruiseEmbarkPort?.value ||
    ledger.destinationHint?.value ||
    opt.placeName;
  const amount = opt.transferEur != null && opt.transferEur > 0 ? opt.transferEur : null;
  const legs: AccessLeg[] = [];
  const taxiOn = wantsTaxiTransfers(ledger) || ledger.transferPref?.value === 'taxi';

  const split =
    amount != null
      ? Math.round(amount / (bp === 'cruise' ? 3 : 2))
      : null;

  const stayDrop = {
    destQuery: stayQ,
    destLat: stayGps?.lat ?? null,
    destLng: stayGps?.lng ?? null,
  };

  if (bp === 'cruise') {
    if (ledger.cruiseEmbarkBias?.value === 'near_home') {
      legs.push(
        buildTaxiLeg({
          id: 'xfer-home-term',
          from: 'home',
          to: 'cruise_terminal',
          destQuery: `Kreuzfahrtterminal ${port}`,
          amountEur: amount,
          ledger,
          notes: 'ohne Flug — direkt zum Hafen',
        }),
      );
    } else {
      legs.push(
        buildTaxiLeg({
          id: 'xfer-apt-hotel',
          from: 'airport',
          to: 'stay',
          destQuery: stayDrop.destQuery,
          destLat: stayDrop.destLat,
          destLng: stayDrop.destLng,
          amountEur: split,
          ledger,
        }),
      );
      legs.push(
        buildTaxiLeg({
          id: 'xfer-hotel-term',
          from: 'stay',
          to: 'cruise_terminal',
          destQuery: `Kreuzfahrtterminal ${port}`,
          amountEur: split,
          ledger,
        }),
      );
      legs.push(
        buildTaxiLeg({
          id: 'xfer-term-apt',
          from: 'cruise_terminal',
          to: 'airport',
          destQuery: `Flughafen ${port}`,
          amountEur: split,
          ledger,
        }),
      );
    }
  } else if (bp === 'ferry_island' || bp === 'fly_ferry' || bp === 'drive_ferry') {
    if (bp === 'fly_ferry') {
      legs.push(
        buildTaxiLeg({
          id: 'xfer-apt-port',
          from: 'airport',
          to: 'ferry_port',
          destQuery: `Fährhafen ${port}`,
          amountEur: split,
          ledger,
        }),
      );
    }
    legs.push(
      buildTaxiLeg({
        id: 'xfer-port-stay',
        from: 'ferry_port',
        to: 'stay',
        destQuery: stayDrop.destQuery,
        destLat: stayDrop.destLat,
        destLng: stayDrop.destLng,
        amountEur: split,
        ledger,
      }),
    );
    legs.push(
      buildTaxiLeg({
        id: 'xfer-stay-port-ret',
        from: 'stay',
        to: 'ferry_port',
        destQuery: `Fährhafen ${port}`,
        amountEur: null,
        ledger,
      }),
    );
  } else if (bp === 'rail_day' || bp === 'rail_night' || bp === 'fly_rail') {
    if (bp === 'fly_rail') {
      legs.push(
        buildTaxiLeg({
          id: 'xfer-apt-station',
          from: 'airport',
          to: 'station',
          destQuery: `Bahnhof ${port}`,
          amountEur: split,
          ledger,
        }),
      );
    }
    legs.push(
      buildTaxiLeg({
        id: 'xfer-station-stay',
        from: 'station',
        to: 'stay',
        destQuery: stayDrop.destQuery,
        destLat: stayDrop.destLat,
        destLng: stayDrop.destLng,
        amountEur: amount ?? split,
        ledger,
      }),
    );
  } else if (bp === 'road' || bp === 'camping' || bp === 'route_tour') {
    if (taxiOn) {
      legs.push(
        buildTaxiLeg({
          id: 'xfer-hub-stay',
          from: 'home',
          to: 'stay',
          destQuery: stayDrop.destQuery,
          destLat: stayDrop.destLat,
          destLng: stayDrop.destLng,
          amountEur: amount,
          ledger,
        }),
      );
    }
  } else {
    // fly_stay — Zubringer-Kette Heimat→Board→Hub→Airport, dann Flughafen ↔ Stay
    const flyFrom =
      opt.transports?.find((t) => t.kind === 'flight')?.fromIata ||
      ledger.airportIata?.value ||
      null;
    try {
      const {
        buildHubFeederPlan,
        hubFeederChecklistItems,
      } = require('./hubFeederPlan') as typeof import('./hubFeederPlan');
      const tr =
        opt.transports?.find((t) => t.kind === 'flight') ||
        ({
          id: 'fly',
          kind: 'flight' as const,
          label: '',
          departAt: null,
          arriveAt: null,
          priceEur: null,
          bookUrl: null,
          better: false,
          fromIata: flyFrom,
        } as const);
      const plan = buildHubFeederPlan({ ledger, transport: tr as any });
      for (const item of hubFeederChecklistItems(plan)) {
        legs.push({
          id: item.id.replace(/^feeder-/, 'xfer-'),
          kind: item.kind === 'train' ? 'train' : 'bus',
          label: item.label.replace(/^★\s*/, ''),
          amountEur: null,
          scope: 'per_person',
          bookUrl: item.url,
          notes: 'Zubringer zum Abflug — rausgesucht, dann ÖPNV Airport',
        });
      }
    } catch {
      const homeFeeder = buildHomeHubTrainLeg(ledger, flyFrom);
      if (homeFeeder) legs.push(homeFeeder);
    }
    const fromHub: TransferHub =
      ledger.mode?.value === 'train' ? 'station' : 'airport';
    legs.push(
      buildTaxiLeg({
        id: 'xfer-hub-stay',
        from: fromHub,
        to: 'stay',
        destQuery: stayDrop.destQuery,
        destLat: stayDrop.destLat,
        destLng: stayDrop.destLng,
        amountEur: amount,
        ledger,
      }),
    );
    legs.push(
      buildTaxiLeg({
        id: 'xfer-stay-hub-ret',
        from: 'stay',
        to: fromHub,
        destQuery: fromHub === 'station' ? `Bahnhof ${port}` : `Flughafen ${port}`,
        amountEur: null,
        ledger,
      }),
    );
  }

  for (const stop of parseZwischenstoppWishes(ledger)) {
    legs.push(
      buildTaxiLeg({
        id: `xfer-waypoint-${stop.slice(0, 12)}`,
        from: 'waypoint',
        to: 'stay',
        destQuery: stop,
        amountEur: null,
        ledger,
        label: `Taxi Zwischenstopp ${stop} (Originalziel bleibt)`,
        notes: 'Zwischenstopp einfügen — Originalziel bleibt',
      }),
    );
  }

  return legs;
}

/** Checklist/Breakdown um Transfer-Legs ergänzen (keine Doppel-IDs). */
export function mergeTransferLegsIntoOption(
  opt: ReiseOption,
  legs: AccessLeg[],
): ReiseOption {
  if (!legs.length) return opt;
  const checklist = [...(opt.bookingChecklist ?? [])];
  for (const leg of legs) {
    if (!leg.bookUrl) continue;
    if (checklist.some((c) => c.url === leg.bookUrl || c.id === `book-${leg.id}`)) {
      continue;
    }
    checklist.push({
      id: `book-${leg.id}`,
      label: leg.label,
      url: leg.bookUrl,
      kind: 'transfer',
      clickedAtMs: null,
    });
  }
  const breakdown = [...(opt.priceBreakdown ?? [])];
  for (const leg of legs) {
    if (leg.amountEur == null || !(leg.amountEur > 0)) continue;
    if (breakdown.some((l) => l.id === leg.id)) continue;
    breakdown.push({
      id: leg.id,
      label: leg.label,
      amountEur: leg.amountEur,
      scope: 'group',
    });
  }
  return {
    ...opt,
    bookingChecklist: checklist,
    priceBreakdown: breakdown.length ? breakdown : opt.priceBreakdown,
    transferBookUrl: opt.transferBookUrl || legs[0]?.bookUrl || null,
    decisionNotes: [
      ...(opt.decisionNotes ?? []),
      'Transfers: Taxi/Zwischenstopp wie überall — Originalziel bleibt',
    ].slice(0, 12),
  };
}

/** Modul-2: Taxi nicht nur Flughafen — Terminal, Fähre, Bahnhof, Zwischenstopp. */
export function looksLikeTaxiTransferHub(text: string): boolean {
  const t = text || '';
  const taxiCue = /\b(taxi|uber|bolt|transfer|welcome\s*pick|abhol)\b/iu.test(t);
  if (!taxiCue) return false;
  // kein \b vor terminal — „Kreuzfahrtterminal“ ist ein Wort
  return /(flughafen|airport|zum\s+flug|zum\s+flieger|boarding|terminal|kreuzfahrt|fähre|faehre|fährhafen|bahnhof|hbf|hotel|zwischenstopp|einschiff)/iu.test(
    t,
  );
}
