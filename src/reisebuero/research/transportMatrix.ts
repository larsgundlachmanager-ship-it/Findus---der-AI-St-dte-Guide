/**
 * Transport-Matrix: Flug / Bahn / Bus / Camper — je Art nur der beste Buchungslink
 * (Yorro vergleicht intern; User sieht keine Partner-Vergleichszeilen).
 */

import { buildAviasalesRoundtripUrl } from '../../services/affiliate/aviasalesRoundtrip';
import {
  buildKiwiSearchPageUrl,
  TRAVELPAYOUTS_MARKER,
} from '../../services/affiliate/travelpayoutsPartners';
import type { ReiseLedger, TransportChoice } from '../types';
import type { CalendarSlot } from './travelpayoutsCalendar';
import { lookupBestFlightQuote } from './flightLookup';
import { formatFlightTransportLabel, formatFinalPriceEur, stripAbPriceWording } from './storyMagazine';
import { needsHubPreNight, tagHubPreNightOnTransports } from './hubPreNight';

export async function buildFlightTransportChoices(opts: {
  ledger: ReiseLedger;
  slot: CalendarSlot;
  placeIata?: string | null;
}): Promise<TransportChoice[]> {
  const to = (opts.placeIata || opts.slot.toIata).toUpperCase();
  const from = opts.slot.fromIata.toUpperCase();
  const checkin = opts.slot.checkin;
  const checkout = opts.slot.checkout;
  const choices: TransportChoice[] = [];

  const quote = await lookupBestFlightQuote({
    origin: from,
    destination: to,
    checkin,
    checkout,
  });

  const departAt = quote?.departAt ?? opts.slot.departAt ?? null;
  const returnClock = quote?.returnAt ?? opts.slot.returnAt ?? null;
  const flightNumber = quote?.flightNumber ?? opts.slot.flightNumber ?? null;
  const carrier = quote?.carrier ?? opts.slot.carrier ?? null;
  const transfers = quote?.transfers ?? opts.slot.transfers ?? null;
  const priceEur = quote?.priceEur ?? opts.slot.priceEur ?? null;

  const adults = Math.max(1, opts.ledger.adults?.value ?? 1);
  const infants = Math.max(0, opts.ledger.infants?.value ?? 0);
  // Baby oft in children+infants — Kiwi nur einmal als infant
  const children = Math.max(0, (opts.ledger.children?.value ?? 0) - infants);
  const cabinBags = opts.ledger.cabinBags?.value ?? null;
  const checkedBags = opts.ledger.checkedBags?.value ?? null;
  let kiwiUrl: string | null = null;
  try {
    kiwiUrl = buildKiwiSearchPageUrl({
      fromIata: from,
      toIata: to,
      dateKey: checkin,
      returnDateKey: checkout && checkout !== checkin ? checkout : null,
      adults,
      children,
      infants,
      cabinBags,
      checkedBags,
      directOnly: opts.ledger.directFlight?.value === true,
    });
  } catch {
    kiwiUrl = null;
  }
  let avia: string | null = null;
  try {
    avia = buildAviasalesRoundtripUrl({
      fromIata: from,
      toIata: to,
      dateKey: checkin,
      returnDateKey: checkout && checkout !== checkin ? checkout : null,
      adults,
      marker: TRAVELPAYOUTS_MARKER,
    });
  } catch {
    avia = null;
  }

  const flightLabel = formatFlightTransportLabel({
    fromIata: from,
    toIata: to,
    departAt,
    flightNumber,
    priceEur,
    transfers,
  });

  choices.push({
    id: `fly-best-${from}-${checkin}`,
    kind: 'flight',
    label: flightLabel,
    departAt,
    arriveAt: returnClock ? `Rück ${returnClock}` : null,
    priceEur,
    bookUrl: kiwiUrl || avia,
    better: true,
    fromIata: from,
    toIata: to,
    durationHint: transfers === 0 ? 'Direkt' : null,
    flightNumber,
    carrier,
    transfers,
    departDateKey: checkin,
    earlyArrival: Boolean(opts.slot.earlyArrival),
    hubPreNight: needsHubPreNight({ kind: 'flight', departAt }, opts.ledger),
  });
  // Nur der beste Flug — Alternativ-Portale nicht als zweite Buchungszeile (Yorro hat verglichen).
  return choices.slice(0, 1);
}

export async function buildTrainTransportChoices(opts: {
  ledger: ReiseLedger;
  originCity: string;
  destCity: string;
  checkin: string;
  checkout?: string | null;
}): Promise<TransportChoice[]> {
  const choices: TransportChoice[] = [];
  const [{ lookupRailJourneyTiming, sanitizeRailCityName }, fareMod] = await Promise.all([
    import('./railJourneyTiming'),
    import('./surfaceLiveFares').catch(() => null),
  ]);
  const { isJunkPlaceName, sanitizeTravelPlaceName } = await import('../placeNameSanity');
  const homeFallback = sanitizeTravelPlaceName(
    opts.ledger.originCity?.value || 'Hamburg',
    'Hamburg',
  );
  const originCity = sanitizeRailCityName(
    opts.originCity || opts.ledger.originCity?.value || homeFallback,
    homeFallback,
  );
  const destRaw = (opts.destCity || '').trim();
  // Kein Bahn-Deeplink ohne echten Zielort (nie „davon“ / Deixis)
  if (!destRaw || isJunkPlaceName(destRaw)) {
    return [];
  }
  const destCity = destRaw;
  const lookupBahnLiveQuote = fareMod?.lookupBahnLiveQuote ?? null;
  const preferHour =
    typeof opts.ledger.departAfterHour?.value === 'number' &&
    opts.ledger.departAfterHour.value >= 0 &&
    opts.ledger.departAfterHour.value <= 23
      ? opts.ledger.departAfterHour.value
      : 7;
  const [timing, fareRaw] = await Promise.all([
    lookupRailJourneyTiming({
      originCity,
      destCity,
      checkin: opts.checkin,
      preferHour,
    }),
    lookupBahnLiveQuote
      ? lookupBahnLiveQuote({
          originCity,
          destCity,
          checkin: opts.checkin,
          checkout: opts.checkout,
          bahncard: opts.ledger.bahncard?.value,
          skipTiming: true,
        }).catch(() => ({ priceEur: null, note: null, roundtrip: false, source: 'none' as const }))
      : Promise.resolve({ priceEur: null, note: null, roundtrip: false, source: 'none' as const }),
  ]);
  const fare = {
    priceEur: fareRaw.priceEur ?? null,
    note: fareRaw.note ?? null,
    roundtrip: Boolean((fareRaw as { roundtrip?: boolean }).roundtrip),
  };
  const depart = timing.departAt ?? null;
  const arrive = timing.arriveAt ?? null;
  const durationHint = timing.durationHint;
  const fromStation = timing.fromStation || `${originCity} Hbf`;
  const toStation = timing.toStation || destCity;
  const viaHint = timing.viaHint ?? null;
  const transfers = timing.transfers ?? null;

  let bookUrl: string | null = null;
  try {
    const { buildDbJourneySearchUrl } = require('../../services/transit/transitTicketFareParse') as {
      buildDbJourneySearchUrl: (o: {
        from: string;
        to: string;
        dateKey?: string | null;
        returnDateKey?: string | null;
        bahncard?: string | null;
      }) => string | null;
    };
    bookUrl = buildDbJourneySearchUrl({
      from: fromStation,
      to: toStation,
      dateKey: opts.checkin,
      returnDateKey: opts.checkout && opts.checkout !== opts.checkin ? opts.checkout : null,
      bahncard: opts.ledger.bahncard?.value,
    });
  } catch {
    const so = encodeURIComponent(fromStation);
    const zo = encodeURIComponent(toStation);
    const hd = encodeURIComponent(`${opts.checkin}T08:00:00`);
    bookUrl = `https://www.bahn.de/buchung/fahrplan/suche?so=${so}&zo=${zo}&hd=${hd}&kl=2`;
  }

  const priceBit =
    fare.priceEur != null
      ? `${fare.priceEur}€ p.P.${fare.roundtrip ? ' Hin+Rück' : ''}`
      : null;
  const timeBit =
    depart && arrive ? `${depart}→${arrive}` : depart ? `ab ${depart}` : null;
  const viaBit = viaHint && viaHint !== 'Direkt' ? viaHint : transfers === 0 ? 'Direkt' : viaHint;
  const dateBit = (timing.departDateKey || opts.checkin || '').slice(0, 10);
  choices.push({
    id: `train-best-${opts.checkin}`,
    kind: 'train',
    label: [`Bahn ${fromStation} → ${toStation}`, dateBit || null, timeBit, viaBit, durationHint, priceBit]
      .filter(Boolean)
      .join(' · '),
    departAt: depart,
    arriveAt: arrive,
    priceEur: fare.priceEur,
    bookUrl,
    better: true,
    durationHint:
      [durationHint, fare.note, fare.priceEur == null ? 'Preis auf bahn.de' : null]
        .filter(Boolean)
        .join(' · ') || null,
    fromStation,
    toStation,
    viaHint: viaBit,
    transfers,
    departDateKey: timing.departDateKey || opts.checkin.slice(0, 10),
  });
  // Nur die beste Bahn — kein Spar-Fenster / Omio als zweite Buchungszeile.
  return choices.slice(0, 1);
}

/** FlixBus / Fernbus — Live-Preis wenn belegt, sonst Partner ohne Fake-Preis. */
export async function buildBusTransportChoices(opts: {
  ledger: ReiseLedger;
  originCity: string;
  destCity: string;
  checkin: string;
}): Promise<TransportChoice[]> {
  const { sanitizeTravelPlaceName, isJunkPlaceName } = await import('../placeNameSanity');
  const originCity = sanitizeTravelPlaceName(opts.originCity, 'Hamburg');
  const destCity = (opts.destCity || '').trim();
  if (!destCity || isJunkPlaceName(destCity)) return [];
  const surface = opts.ledger.surfacePref?.value;
  // FlixTrain≠Bus: bei train_only / train_ok_bus_no keinen Bus-Track bauen
  if (surface === 'train_only' || surface === 'train_ok_bus_no') {
    return [];
  }
  const adults = Math.max(1, opts.ledger.adults?.value ?? 1);
  const { buildFlixBusSearchUrl } = await import('./surfaceLiveFares');
  const flix = buildFlixBusSearchUrl({
    originCity,
    destCity,
    checkin: opts.checkin,
    adults,
    train: surface === 'bus_only' ? false : undefined,
  });

  let quote: {
    priceEur: number | null;
    note: string | null;
    departAt?: string | null;
    arriveAt?: string | null;
    durationHint?: string | null;
    source: string;
  } = {
    priceEur: null,
    note: null,
    source: 'none',
  };
  try {
    const { lookupFernbusLiveQuote } = await import('./surfaceLiveFares');
    quote = await lookupFernbusLiveQuote({
      originCity,
      destCity,
      checkin: opts.checkin,
    });
  } catch {
    /* soft */
  }

  const priceBit =
    quote.priceEur != null ? formatFinalPriceEur(quote.priceEur) : null;
  const liveBit =
    quote.priceEur != null
      ? quote.note || 'belegt'
      : quote.durationHint
        ? 'Fahrzeit belegt · Preis im Partner'
        : 'Preis im Partner';

  // Ein Link: Yorro hat intern verglichen — User bucht nur FlixBus step-by-step.
  return [
    {
      id: `bus-flix-${opts.checkin}`,
      kind: 'bus',
      label: stripAbPriceWording(
        [
          `Fernbus ${originCity}→${destCity}`,
          quote.durationHint,
          priceBit,
          quote.note && quote.priceEur != null ? quote.note : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      departAt: quote.departAt ?? null,
      arriveAt: quote.arriveAt ?? null,
      priceEur: quote.priceEur,
      bookUrl: flix,
      better: true,
      durationHint: quote.durationHint ?? liveBit,
      fromStation: originCity,
      toStation: destCity,
    },
  ];
}

/** Camper / Wohnmobil — Live-Gesamtmiete wenn belegt. */
export async function buildCamperTransportChoices(opts: {
  ledger: ReiseLedger;
  originCity: string;
  destCity: string;
  checkin: string;
  checkout: string;
}): Promise<TransportChoice[]> {
  const adults = opts.ledger.adults?.value ?? 2;
  const paul = `https://www.paulcamper.de/wohnmobil-mieten?q=${encodeURIComponent(opts.originCity)}&from=${encodeURIComponent(opts.checkin)}&to=${encodeURIComponent(opts.checkout)}&guests=${adults}`;

  let quote: {
    priceEur: number | null;
    note: string | null;
    durationHint?: string | null;
  } = { priceEur: null, note: null };
  try {
    const { lookupCamperLiveQuote } = await import('./surfaceLiveFares');
    quote = await lookupCamperLiveQuote({
      originCity: opts.originCity,
      destCity: opts.destCity,
      checkin: opts.checkin,
      checkout: opts.checkout,
      guests: adults,
    });
  } catch {
    /* soft */
  }

  const priceBit =
    quote.priceEur != null ? formatFinalPriceEur(quote.priceEur) : null;

  return [
    {
      id: `camper-${opts.checkin}`,
      kind: 'car',
      label: stripAbPriceWording(
        [
          `Camper von ${opts.originCity} → ${opts.destCity}`,
          quote.durationHint,
          priceBit,
          quote.note,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      departAt: null,
      arriveAt: null,
      priceEur: quote.priceEur,
      bookUrl: paul,
      better: true,
      durationHint:
        quote.priceEur != null
          ? 'Wohnmobil · Live-Miete'
          : 'Wohnmobil / Campervan · Preis im Partner',
    },
  ];
}

/**
 * Multimodal parallel: Flug + Bahn + Bus (+ optional Camper).
 * Eco/DE-nah: Bahn/Bus nach vorne; Insel/fly: Flug first.
 */
export async function buildMultimodalTransportChoices(opts: {
  ledger: ReiseLedger;
  originCity: string;
  destCity: string;
  checkin: string;
  checkout: string;
  placeIata?: string | null;
  fromIata?: string | null;
  preferEco?: boolean;
  allowCamper?: boolean;
  flyLikely?: boolean;
}): Promise<TransportChoice[]> {
  const tasks: Array<Promise<TransportChoice[]>> = [];
  if (opts.placeIata && opts.fromIata && (opts.flyLikely || !opts.preferEco)) {
    tasks.push(
      (async () => {
        const slot = {
          id: 'mm',
          checkin: opts.checkin,
          checkout: opts.checkout,
          fromIata: opts.fromIata!,
          toIata: opts.placeIata!,
          priceEur: null as number | null,
          label: `${opts.fromIata}→${opts.placeIata}`,
          source: 'synthetic' as const,
        };
        return buildFlightTransportChoices({
          ledger: opts.ledger,
          slot,
          placeIata: opts.placeIata,
        });
      })(),
    );
  }
  if (!opts.flyLikely || opts.preferEco) {
    tasks.push(
      buildTrainTransportChoices({
        ledger: opts.ledger,
        originCity: opts.originCity,
        destCity: opts.destCity,
        checkin: opts.checkin,
      }),
    );
    tasks.push(
      buildBusTransportChoices({
        ledger: opts.ledger,
        originCity: opts.originCity,
        destCity: opts.destCity,
        checkin: opts.checkin,
      }),
    );
  }
  if (opts.allowCamper || opts.ledger.mode?.value === 'camping') {
    tasks.push(
      buildCamperTransportChoices({
        ledger: opts.ledger,
        originCity: opts.originCity,
        destCity: opts.destCity,
        checkin: opts.checkin,
        checkout: opts.checkout,
      }),
    );
  }
  const chunks = await Promise.all(
    tasks.map((p) => p.catch(() => [] as TransportChoice[])),
  );
  let all = chunks.flat();
  if (opts.preferEco) {
    all = [
      ...all.filter((t) => t.kind === 'train' || t.kind === 'bus'),
      ...all.filter((t) => t.kind !== 'train' && t.kind !== 'bus'),
    ];
  }
  const out: TransportChoice[] = [];
  const seen = new Set<string>();
  for (const t of all) {
    const key = `${t.kind}-${t.better ? 'b' : 'a'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 4) break;
  }
  return tagHubPreNightOnTransports(out, opts.ledger);
}
