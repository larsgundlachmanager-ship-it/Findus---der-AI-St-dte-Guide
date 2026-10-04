/**
 * Kreuzfahrt-Reiseplan (stadt-agnostisch).
 * Blaupause: Flug → ggf. Vornacht Hotel nahe Terminal → Transfers → Einschiffen → Kreuzfahrt → Rückreise.
 * Buy-in = ehrliche Summe belegter Zeilen; fehlende Preise = Gap, kein Fake.
 */

import type {
  BookingCheckItem,
  DayPlan,
  PriceBreakdownLine,
  ReiseLedger,
  ReiseOption,
} from '../types';

export type CruiseTransferLeg = {
  id: string;
  label: string;
  /** Gruppenpreis (€) wenn belegt. */
  amountEur: number | null;
  bookUrl: string | null;
};

export type CruiseBuyInParts = {
  /** Flug Hin p.P. (wenn getrennt; sonst in flightPerPersonEur RT). */
  flightOutPerPersonEur: number | null;
  /** Flug Rück p.P. */
  flightReturnPerPersonEur: number | null;
  /** Legacy/kompakt: Hin+Rück p.P. */
  flightPerPersonEur: number | null;
  /** Vornacht-Hotel Gruppe. */
  preNightStayEur: number | null;
  /** Summe aller Transfer-Beine (Gruppe). */
  transferEur: number | null;
  /** Kabine / Kreuzfahrt-Preis für die Gruppe (Cabin-Total). */
  cruiseEur: number | null;
  adults: number;
};

export function isCruiseLedger(ledger: ReiseLedger): boolean {
  if (ledger.tripShape?.value === 'cruise') return true;
  const musts = ledger.mustHaves?.value ?? [];
  const wishes = ledger.wishHaves?.value ?? [];
  const nice = ledger.niceHaves?.value ?? [];
  if ([...musts, ...wishes, ...nice].includes('cruise')) return true;
  const blob = [
    ledger.destinationHint?.value,
    ledger.highlightWant?.value,
    ledger.purpose?.value,
    ledger.extraWishes?.value,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\bkreuzfahrt|familienkreuzfahrt|cruise\b/i.test(blob);
}

/** Flug ein Tag vor Einschiffen → Vornacht nahe Terminal empfohlen. */
export function needsCruisePreNight(opts: {
  embarkDate: string | null;
  flightArriveDate: string | null;
}): boolean {
  if (!opts.embarkDate) return true; // unbekannt → lieber Vornacht einplanen
  if (!opts.flightArriveDate) return true;
  return opts.flightArriveDate < opts.embarkDate;
}

export function buildCruiseSearchUrl(opts: {
  portCity?: string | null;
  dateStart?: string | null;
  adults?: number;
}): string {
  const q = [
    'Kreuzfahrt',
    opts.portCity ? `ab ${opts.portCity}` : '',
    opts.dateStart ? opts.dateStart : '',
    opts.adults && opts.adults > 1 ? `${opts.adults} Personen` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function buildCruisePortHotelSearchUrl(opts: {
  portCity: string;
  checkin?: string | null;
  checkout?: string | null;
}): string {
  const q = [
    `Hotel nahe Kreuzfahrtterminal ${opts.portCity}`,
    opts.checkin ? `Check-in ${opts.checkin}` : '',
    opts.checkout ? `Check-out ${opts.checkout}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/**
 * Buy-in Kreuzfahrt:
 * Flug Hin p.P.×N + Flug Rück p.P.×N + Hotel + Transfers + Kreuzfahrt(Cabin)
 * = total ÷ N
 *
 * Beispiel (2 Pers.): 100+200 Flug p.P. ⇒ 600 Flug gesamt + Hotel 100 + Taxis 100 + Cruise 1000 = 1800 ⇒ 900 p.P.
 */
export function cruiseBuyInFromParts(parts: CruiseBuyInParts): {
  buyInEur: number | null;
  totalPackage: number | null;
  buyInLabel: string;
  flightTotal: number;
  transferTotal: number;
} {
  const adults = Math.max(1, parts.adults);
  let flightTotal = 0;
  if (
    (parts.flightOutPerPersonEur != null && parts.flightOutPerPersonEur > 0) ||
    (parts.flightReturnPerPersonEur != null && parts.flightReturnPerPersonEur > 0)
  ) {
    const out = parts.flightOutPerPersonEur != null && parts.flightOutPerPersonEur > 0
      ? parts.flightOutPerPersonEur
      : 0;
    const ret =
      parts.flightReturnPerPersonEur != null && parts.flightReturnPerPersonEur > 0
        ? parts.flightReturnPerPersonEur
        : 0;
    flightTotal = (out + ret) * adults;
  } else if (parts.flightPerPersonEur != null && parts.flightPerPersonEur > 0) {
    flightTotal = parts.flightPerPersonEur * adults;
  }
  const stay =
    parts.preNightStayEur != null && parts.preNightStayEur > 0 ? parts.preNightStayEur : 0;
  const transfer =
    parts.transferEur != null && parts.transferEur > 0 ? parts.transferEur : 0;
  const cruise = parts.cruiseEur != null && parts.cruiseEur > 0 ? parts.cruiseEur : 0;
  // Kabine = Kern (wie Stay), nicht Magazin-„Extras“ — buyInFromParts lässt extrasEur weg.
  const totalPackage = Math.round(flightTotal + stay + transfer + cruise);
  if (totalPackage <= 0) {
    return {
      buyInEur: null,
      totalPackage: null,
      buyInLabel: 'Kreuzfahrt Buy-in p.P. (belegte Zeilen)',
      flightTotal: 0,
      transferTotal: 0,
    };
  }
  return {
    buyInEur: Math.round(totalPackage / adults),
    totalPackage,
    buyInLabel:
      'p.P. = (Flug×Pers. + Vornacht-Hotel + Transfers + Kreuzfahrt) ÷ Pers. — nur belegte Preise',
    flightTotal,
    transferTotal: transfer,
  };
}

export function sumTransferLegs(legs: CruiseTransferLeg[]): number | null {
  const amounts = legs.map((l) => l.amountEur).filter((n): n is number => n != null && n > 0);
  if (!amounts.length) return null;
  return Math.round(amounts.reduce((a, b) => a + b, 0));
}

/** Detail-Zeilen wie im User-Beispiel (ehrlich, null wenn unbelegt). */
export function buildCruisePriceBreakdown(opts: {
  flightOutPerPersonEur?: number | null;
  flightReturnPerPersonEur?: number | null;
  flightPerPersonEur?: number | null;
  preNightStayEur?: number | null;
  transferAirportToHotelEur?: number | null;
  transferHotelToTerminalEur?: number | null;
  transferTerminalToAirportEur?: number | null;
  /** Wenn Einzel-Transfers unbekannt: eine belegte Transfer-Summe. */
  transferCombinedEur?: number | null;
  cruiseEur?: number | null;
  buyInEur?: number | null;
}): PriceBreakdownLine[] {
  const lines: PriceBreakdownLine[] = [];
  if (opts.flightOutPerPersonEur != null && opts.flightOutPerPersonEur > 0) {
    lines.push({
      id: 'flight_out',
      label: 'Flug hin',
      amountEur: opts.flightOutPerPersonEur,
      scope: 'per_person',
    });
  }
  if (opts.flightReturnPerPersonEur != null && opts.flightReturnPerPersonEur > 0) {
    lines.push({
      id: 'flight_return',
      label: 'Flug zurück',
      amountEur: opts.flightReturnPerPersonEur,
      scope: 'per_person',
    });
  }
  if (
    !(opts.flightOutPerPersonEur || opts.flightReturnPerPersonEur) &&
    opts.flightPerPersonEur != null &&
    opts.flightPerPersonEur > 0
  ) {
    lines.push({
      id: 'flight',
      label: 'Flug Hin+Rück',
      amountEur: opts.flightPerPersonEur,
      scope: 'per_person',
    });
  }
  const hasLegTransfers =
    (opts.transferAirportToHotelEur != null && opts.transferAirportToHotelEur > 0) ||
    (opts.transferHotelToTerminalEur != null && opts.transferHotelToTerminalEur > 0) ||
    (opts.transferTerminalToAirportEur != null && opts.transferTerminalToAirportEur > 0);

  if (opts.transferAirportToHotelEur != null && opts.transferAirportToHotelEur > 0) {
    lines.push({
      id: 'xfer_apt_hotel',
      label: 'Taxi Flughafen → Hotel',
      amountEur: opts.transferAirportToHotelEur,
      scope: 'group',
    });
  }
  if (opts.preNightStayEur != null && opts.preNightStayEur > 0) {
    lines.push({
      id: 'prenight',
      label: 'Hotel Vornacht (nahe Terminal)',
      amountEur: opts.preNightStayEur,
      scope: 'group',
    });
  }
  if (opts.transferHotelToTerminalEur != null && opts.transferHotelToTerminalEur > 0) {
    lines.push({
      id: 'xfer_hotel_term',
      label: 'Taxi Hotel → Kreuzfahrtterminal',
      amountEur: opts.transferHotelToTerminalEur,
      scope: 'group',
    });
  }
  if (opts.cruiseEur != null && opts.cruiseEur > 0) {
    lines.push({
      id: 'cruise',
      label: 'Kreuzfahrt (Kabine / Gruppe)',
      amountEur: opts.cruiseEur,
      scope: 'group',
    });
  }
  if (opts.transferTerminalToAirportEur != null && opts.transferTerminalToAirportEur > 0) {
    lines.push({
      id: 'xfer_term_apt',
      label: 'Taxi Terminal → Flughafen',
      amountEur: opts.transferTerminalToAirportEur,
      scope: 'group',
    });
  }
  // Ein Gesamt-Transfer nur wenn keine Einzelbeine belegt (kein Fake-Split).
  if (
    !hasLegTransfers &&
    opts.transferCombinedEur != null &&
    opts.transferCombinedEur > 0
  ) {
    lines.push({
      id: 'xfer_combined',
      label: 'Transfers (Flughafen ↔ Hotel ↔ Terminal)',
      amountEur: opts.transferCombinedEur,
      scope: 'group',
    });
  }
  if (opts.buyInEur != null && opts.buyInEur > 0) {
    lines.push({
      id: 'buyin',
      label: 'Buy-in p.P.',
      amountEur: opts.buyInEur,
      scope: 'total',
    });
  }
  return lines;
}

export function buildCruiseDayPlans(opts: {
  portCity: string;
  embarkDate: string;
  disembarkDate: string;
  preNight: boolean;
  preNightDate?: string | null;
  flightLabel?: string | null;
  stayName?: string | null;
  embarkLatestTime?: string | null;
  shipArriveTime?: string | null;
  /** Belegte Hafen-Stops (An/Ab) — mittlere Seetage. */
  portCalls?: Array<{
    dayKey: string;
    portName: string;
    arriveAt?: string | null;
    departAt?: string | null;
    shoreHint?: string | null;
  }> | null;
  /** Check-in-Fenster am Einschifftag (belegt). */
  checkInStartHm?: string | null;
  checkInEndHm?: string | null;
  /** Schiff-Abfahrt Einschifftag (belegt). */
  sailDepartHm?: string | null;
  /** Nur mit Clock — keine Fake-Meal-Zeiten. */
  meals?: Array<{
    kind: 'breakfast' | 'lunch' | 'dinner';
    startHm: string | null;
    endHm?: string | null;
    note?: string | null;
  }> | null;
  mealFlexNote?: string | null;
  highlights?: Array<{
    title: string;
    dayKey?: string | null;
    timeHm?: string | null;
    detail?: string | null;
  }> | null;
  /** Belegte Bahn-Gepäckabgabe am Bahnhof / ZOB. */
  stationLuggageDrop?: boolean;
  /** Belegter Shuttle Bahnhof ↔ Terminal. */
  stationShuttle?: boolean;
  luggageLogisticsNote?: string | null;
}): DayPlan[] {
  const days: DayPlan[] = [];
  const mealLabel = (k: string) =>
    k === 'breakfast' ? 'Frühstück' : k === 'lunch' ? 'Mittagessen' : 'Abendessen';
  if (opts.preNight && opts.preNightDate) {
    days.push({
      dayKey: opts.preNightDate,
      title: 'Tag · Anreise + Vornacht',
      blocks: [
        {
          id: 'cruise-flight-in',
          title: 'Flug zum Hafen',
          detail: opts.flightLabel || `Richtung ${opts.portCity}`,
          costEur: null,
        },
        {
          id: 'cruise-xfer-hotel',
          title: 'Transfer Flughafen → Hotel',
          detail: 'nahe Kreuzfahrtterminal',
          costEur: null,
        },
        {
          id: 'cruise-prenight',
          title: 'Hotel Vornacht',
          detail: opts.stayName || `Hotel nahe Terminal ${opts.portCity}`,
          costEur: null,
        },
      ],
    });
  }
  const embarkBlocks: DayPlan['blocks'] = [
    ...(opts.preNight
      ? [
          {
            id: 'cruise-xfer-term',
            title: 'Transfer Hotel → Terminal',
            detail: `Kreuzfahrtterminal ${opts.portCity}`,
            costEur: null as number | null,
          },
        ]
      : [
          {
            id: 'cruise-flight-same',
            title: 'Flug + Transfer zum Terminal',
            detail: opts.flightLabel || opts.portCity,
            costEur: null as number | null,
          },
        ]),
  ];
  if (opts.stationLuggageDrop || opts.stationShuttle) {
    embarkBlocks.unshift({
      id: 'cruise-station-luggage',
      title: opts.stationLuggageDrop
        ? 'Gepäckabgabe Bahnhof'
        : 'Shuttle Bahnhof → Terminal',
      detail:
        opts.luggageLogisticsNote ||
        [
          opts.stationLuggageDrop ? 'Koffer am Bahnhof abgeben (belegt)' : null,
          opts.stationShuttle ? 'Shuttle-Bus zum Terminal (belegt)' : null,
        ]
          .filter(Boolean)
          .join(' · ') ||
        'Bahn-Anreise: Gepäck/Shuttle (belegt)',
      costEur: null,
    });
  }
  if (opts.checkInStartHm) {
    embarkBlocks.push({
      id: 'cruise-checkin',
      title: 'Check-in Terminal',
      detail: opts.checkInEndHm
        ? `Fenster ${opts.checkInStartHm}–${opts.checkInEndHm} (belegt)`
        : `ab ${opts.checkInStartHm} (belegt)`,
      time: opts.checkInStartHm,
      costEur: null,
    });
  }
  embarkBlocks.push({
    id: 'cruise-board',
    title: 'Einschiffen',
    detail: opts.embarkLatestTime
      ? `Spätestens an Bord: ${opts.embarkLatestTime} (belegt)`
      : 'Einschiffzeit / All-aboard belegen — vor Abfahrt prüfen',
    time: opts.embarkLatestTime ?? undefined,
    costEur: null,
  });
  embarkBlocks.push({
    id: 'cruise-sail',
    title: 'Kreuzfahrt startet',
    detail: opts.sailDepartHm
      ? `Abfahrt ${opts.portCity} ca. ${opts.sailDepartHm} (belegt)`
      : `Abfahrt ${opts.portCity}`,
    time: opts.sailDepartHm ?? undefined,
    costEur: null,
  });
  if (opts.mealFlexNote) {
    embarkBlocks.push({
      id: 'cruise-meals-flex',
      title: 'Verpflegung an Bord',
      detail: opts.mealFlexNote,
      costEur: null,
    });
  }
  for (const meal of opts.meals ?? []) {
    if (!meal.startHm) continue;
    embarkBlocks.push({
      id: `cruise-meal-${meal.kind}`,
      title: mealLabel(meal.kind),
      detail: meal.endHm
        ? `${meal.startHm}–${meal.endHm} (belegt)`
        : `${meal.startHm} (belegt)${meal.note ? ` · ${meal.note}` : ''}`,
      time: meal.startHm,
      costEur: null,
    });
  }
  for (const h of (opts.highlights ?? []).slice(0, 3)) {
    if (h.dayKey && h.dayKey !== opts.embarkDate) continue;
    embarkBlocks.push({
      id: `cruise-hl-${h.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '_')
        .slice(0, 16)}`,
      title: h.title,
      detail: h.detail || 'Highlight (belegt)',
      time: h.timeHm ?? undefined,
      costEur: null,
    });
  }
  days.push({
    dayKey: opts.embarkDate,
    title: 'Tag · Einschiffen',
    blocks: embarkBlocks,
  });
  for (const call of opts.portCalls ?? []) {
    if (!call.dayKey || call.dayKey === opts.embarkDate || call.dayKey === opts.disembarkDate) {
      continue;
    }
    const arrive = (call.arriveAt || '').trim();
    const depart = (call.departAt || '').trim();
    const portBlocks: DayPlan['blocks'] = [
      {
        id: `cruise-port-in-${call.dayKey}`,
        title: `Schiff an · ${call.portName}`,
        detail: arrive ? `Ankunft ca. ${arrive} (belegt)` : 'Ankunftszeit belegen',
        time: arrive || undefined,
        costEur: null,
      },
      {
        id: `cruise-port-shore-${call.dayKey}`,
        title: 'Landgang / Stadt',
        detail:
          call.shoreHint ||
          `Hafen → ${call.portName}: Bahn/Shuttle/Tour im Zeitfenster — zurück vor Ablegen`,
        costEur: null,
      },
      {
        id: `cruise-port-out-${call.dayKey}`,
        title: 'Wieder an Bord',
        detail: depart
          ? `Ablegen ca. ${depart} (belegt) — All-aboard vorher`
          : 'Ablegezeit belegen — Puffer einplanen',
        time: depart || undefined,
        costEur: null,
      },
    ];
    for (const meal of opts.meals ?? []) {
      if (!meal.startHm) continue;
      portBlocks.push({
        id: `cruise-meal-${call.dayKey}-${meal.kind}`,
        title: mealLabel(meal.kind),
        detail: `${meal.startHm} (belegt)`,
        time: meal.startHm,
        costEur: null,
      });
    }
    for (const h of opts.highlights ?? []) {
      if (h.dayKey && h.dayKey !== call.dayKey) continue;
      if (!h.dayKey) continue;
      portBlocks.push({
        id: `cruise-hl-${call.dayKey}-${h.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, '_')
          .slice(0, 12)}`,
        title: h.title,
        detail: h.detail || 'Highlight (belegt)',
        time: h.timeHm ?? undefined,
        costEur: null,
      });
    }
    days.push({
      dayKey: call.dayKey,
      title: `Hafen · ${call.portName}`,
      blocks: portBlocks,
    });
  }
  days.push({
    dayKey: opts.disembarkDate,
    title: 'Tag · Ausschiffen + Rückreise',
    blocks: [
      {
        id: 'cruise-arrive',
        title: 'Schiff an',
        detail: opts.shipArriveTime
          ? `Ankunft Hafen ca. ${opts.shipArriveTime} (belegt)`
          : 'Ankunftszeit Hafen belegen',
        time: opts.shipArriveTime ?? undefined,
        costEur: null,
      },
      {
        id: 'cruise-xfer-apt',
        title: 'Transfer Terminal → Flughafen',
        detail: 'Puffer bis Boarding prüfen',
        costEur: null,
      },
      {
        id: 'cruise-flight-home',
        title: 'Rückflug',
        detail: 'Heimreise',
        costEur: null,
      },
    ],
  });
  return days;
}

export function buildCruiseBookingChecklist(opts: {
  flightUrl?: string | null;
  stayUrl?: string | null;
  cruiseUrl?: string | null;
  transferAirportHotelUrl?: string | null;
  transferHotelTerminalUrl?: string | null;
  transferTerminalAirportUrl?: string | null;
  portCity?: string | null;
}): BookingCheckItem[] {
  const items: BookingCheckItem[] = [];
  if (opts.flightUrl) {
    items.push({
      id: 'cruise-flight',
      label: 'Flug buchen',
      url: opts.flightUrl,
      kind: 'flight',
      clickedAtMs: null,
    });
  }
  if (opts.stayUrl) {
    items.push({
      id: 'cruise-prenight',
      label: 'Hotel Vornacht (nahe Terminal)',
      url: opts.stayUrl,
      kind: 'stay',
      clickedAtMs: null,
    });
  }
  if (opts.transferAirportHotelUrl) {
    items.push({
      id: 'cruise-xfer-1',
      label: 'Taxi Flughafen → Hotel',
      url: opts.transferAirportHotelUrl,
      kind: 'transfer',
      clickedAtMs: null,
    });
  }
  if (opts.transferHotelTerminalUrl) {
    items.push({
      id: 'cruise-xfer-2',
      label: 'Taxi Hotel → Terminal',
      url: opts.transferHotelTerminalUrl,
      kind: 'transfer',
      clickedAtMs: null,
    });
  }
  items.push({
    id: 'cruise-fare',
    label: opts.portCity ? `Kreuzfahrt ab ${opts.portCity}` : 'Kreuzfahrt suchen / buchen',
    url: opts.cruiseUrl ?? null,
    kind: 'cruise',
    clickedAtMs: null,
  });
  if (opts.transferTerminalAirportUrl) {
    items.push({
      id: 'cruise-xfer-3',
      label: 'Taxi Terminal → Flughafen',
      url: opts.transferTerminalAirportUrl,
      kind: 'transfer',
      clickedAtMs: null,
    });
  }
  return items;
}

/** Speech-Struktur (kein festes Skript) — Buy-in + Plan-Reihenfolge. */
export function buildCruiseSpeechSkeleton(opts: {
  portCity: string;
  buyInEur: number | null;
  adults: number;
  preNight: boolean;
  missing: string[];
  /** Belegte Gepäck-/Shuttle-Notiz (Bahnhof → Terminal), sonst Soft-Hinweis. */
  luggageLogisticsNote?: string | null;
  /** Konkretes oder empfohlenes Schiff. */
  shipName?: string | null;
  /** Zweite Schiff-Alternative. */
  shipAlt?: string | null;
}): string {
  const shipBit = opts.shipName
    ? opts.shipAlt
      ? `Schiff: ${opts.shipName} — Alternative ${opts.shipAlt}.`
      : `Schiff: ${opts.shipName}.`
    : '';
  const buy =
    opts.buyInEur != null
      ? `Buy-in ca. ${opts.buyInEur} Euro p.P. für ${opts.adults} — Summe aus belegten Zeilen.`
      : 'Buy-in noch nicht final — Kreuzfahrt- oder Flugpreis fehlt noch.';
  const pre = opts.preNight
    ? 'Flug oft einen Tag vorher, Hotel nahe Terminal, morgens zum Schiff.'
    : 'Anreise und Einschiffen am selben Tag — Zeiten eng prüfen.';
  const luggage = (opts.luggageLogisticsNote || '').trim()
    ? opts.luggageLogisticsNote!.trim().slice(0, 180)
    : 'Bei Bahn-Anreise lohnt der Blick auf Gepäckabgabe am Bahnhof und den Shuttle zum Terminal — Details stehen in den Reederei-Reiseinfos, wenn belegt.';
  const gaps = opts.missing.length
    ? `Noch belegen: ${opts.missing.slice(0, 3).join(', ')}.`
    : 'Zeiten und Links stehen — durchbuchen möglich.';
  return [
    `Kreuzfahrt ab ${opts.portCity}.`,
    shipBit,
    pre,
    luggage,
    'Plan: Anreise, Transfer, ggf. Vornacht, Einschiffen, Kreuzfahrt, Rücktransfer, Rückreise.',
    buy,
    gaps,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Option mit Kreuzfahrt-Plan anreichern (nach normalem Funnel-Build).
 * Nutzt vorhandene Flug/Stay/Transfer-Preise; Cruise-Preis nur wenn belegt übergeben.
 */
export function enrichOptionAsCruisePlan(
  opt: ReiseOption,
  ledger: ReiseLedger,
  extras?: {
    cruiseEur?: number | null;
    cruiseUrl?: string | null;
    embarkLatestTime?: string | null;
    shipArriveTime?: string | null;
    flightOutPerPersonEur?: number | null;
    flightReturnPerPersonEur?: number | null;
    transferAirportToHotelEur?: number | null;
    transferHotelToTerminalEur?: number | null;
    transferTerminalToAirportEur?: number | null;
    /** Belegte Zwischenhäfen (An/Ab) — ein Blick in DayPlans. */
    portCalls?: Array<{
      dayKey: string;
      portName: string;
      arriveAt?: string | null;
      departAt?: string | null;
      shoreHint?: string | null;
    }> | null;
  },
): ReiseOption {
  const adults = Math.max(1, ledger.adults?.value ?? 2);
  const portCity =
    ledger.destinationHint?.value ||
    opt.placeName ||
    'Hafen';
  const embarkDate = ledger.dateStart?.value || '';
  const disembarkDate = ledger.dateEnd?.value || embarkDate;
  const preNightDate =
    embarkDate && /^\d{4}-\d{2}-\d{2}$/.test(embarkDate)
      ? (() => {
          const t = Date.parse(`${embarkDate}T12:00:00`) - 86_400_000;
          const d = new Date(t);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })()
      : null;
  // Vornacht: Stay vorhanden ODER Flug typisch Tag vorher (Default bei Kreuzfahrt).
  const preNight =
    Boolean(opt.stayName) ||
    Boolean(opt.stayPriceEur) ||
    needsCruisePreNight({
      embarkDate: embarkDate || null,
      flightArriveDate: null,
    });

  const transferAirportHotel = extras?.transferAirportToHotelEur ?? null;
  const transferHotelTerm = extras?.transferHotelToTerminalEur ?? null;
  const transferTermApt = extras?.transferTerminalToAirportEur ?? null;
  const transferSum =
    sumTransferLegs([
      {
        id: '1',
        label: 'apt-hotel',
        amountEur: transferAirportHotel,
        bookUrl: null,
      },
      {
        id: '2',
        label: 'hotel-term',
        amountEur: transferHotelTerm,
        bookUrl: null,
      },
      {
        id: '3',
        label: 'term-apt',
        amountEur: transferTermApt,
        bookUrl: null,
      },
    ]) ??
    (opt.transferEur != null && opt.transferEur > 0 ? opt.transferEur : null);

  const flightPp = opt.flightPriceEur ?? null;
  const buy = cruiseBuyInFromParts({
    flightOutPerPersonEur: extras?.flightOutPerPersonEur ?? null,
    flightReturnPerPersonEur: extras?.flightReturnPerPersonEur ?? null,
    flightPerPersonEur:
      extras?.flightOutPerPersonEur || extras?.flightReturnPerPersonEur
        ? null
        : flightPp,
    preNightStayEur: preNight ? opt.stayPriceEur ?? null : null,
    transferEur: transferSum,
    cruiseEur: extras?.cruiseEur ?? opt.extrasEur ?? null,
    adults,
  });

  const missing: string[] = [];
  if (extras?.cruiseEur == null && (opt.extrasEur == null || opt.extrasEur <= 0)) {
    missing.push('Kreuzfahrtpreis');
  }
  if (flightPp == null && extras?.flightOutPerPersonEur == null) missing.push('Flugpreis');
  if (preNight && (opt.stayPriceEur == null || opt.stayPriceEur <= 0)) {
    missing.push('Vornacht-Hotelpreis');
  }
  if (!extras?.embarkLatestTime) missing.push('Einschiffzeit');
  if (!extras?.shipArriveTime) missing.push('Ankunftszeit Hafen');

  const cruiseUrl =
    extras?.cruiseUrl ||
    buildCruiseSearchUrl({
      portCity,
      dateStart: embarkDate || null,
      adults,
    });
  const stayUrl =
    opt.stayBookUrl ||
    (preNight
      ? buildCruisePortHotelSearchUrl({
          portCity,
          checkin: preNightDate,
          checkout: embarkDate || null,
        })
      : null);

  const checklist = buildCruiseBookingChecklist({
    flightUrl: opt.flightBookUrl,
    stayUrl,
    cruiseUrl,
    transferAirportHotelUrl: opt.transferBookUrl,
    transferHotelTerminalUrl: null,
    transferTerminalAirportUrl: null,
    portCity,
  });

  const days =
    embarkDate && disembarkDate
      ? buildCruiseDayPlans({
          portCity,
          embarkDate,
          disembarkDate,
          preNight,
          preNightDate,
          flightLabel: opt.transports?.[0]?.label ?? null,
          stayName: opt.stayName,
          embarkLatestTime: extras?.embarkLatestTime ?? null,
          shipArriveTime: extras?.shipArriveTime ?? null,
          portCalls: extras?.portCalls ?? null,
        })
      : opt.days;

  const hasLegTransfers =
    (transferAirportHotel != null && transferAirportHotel > 0) ||
    (transferHotelTerm != null && transferHotelTerm > 0) ||
    (transferTermApt != null && transferTermApt > 0);
  const priceBreakdown = buildCruisePriceBreakdown({
    flightOutPerPersonEur: extras?.flightOutPerPersonEur ?? null,
    flightReturnPerPersonEur: extras?.flightReturnPerPersonEur ?? null,
    flightPerPersonEur:
      extras?.flightOutPerPersonEur || extras?.flightReturnPerPersonEur
        ? null
        : flightPp,
    preNightStayEur: preNight ? opt.stayPriceEur ?? null : null,
    transferAirportToHotelEur: transferAirportHotel,
    transferHotelToTerminalEur: transferHotelTerm,
    transferTerminalToAirportEur: transferTermApt,
    transferCombinedEur: hasLegTransfers ? null : transferSum,
    cruiseEur: extras?.cruiseEur ?? opt.extrasEur ?? null,
    buyInEur: buy.buyInEur,
  });

  const gaps = [...(opt.gaps ?? [])];
  for (const m of missing) {
    if (!gaps.some((g) => g.includes(m))) gaps.push(`Kreuzfahrt: ${m} noch belegen`);
  }

  let shipName: string | null =
    ledger.cruiseShipName?.value && ledger.cruiseShipName.value !== 'open'
      ? ledger.cruiseShipName.value
      : null;
  let shipAlt: string | null = null;
  if (!shipName) {
    try {
      const { matchCruiseShipsFromLedger } = require('./cruiseShipFit') as {
        matchCruiseShipsFromLedger: (l: typeof ledger) => {
          fits: Array<{ ship: { name: string } }>;
        };
      };
      const fit = matchCruiseShipsFromLedger(ledger);
      shipName = fit.fits[0]?.ship.name ?? null;
      shipAlt = fit.fits[1]?.ship.name ?? null;
    } catch {
      /* soft */
    }
  }

  const speech = buildCruiseSpeechSkeleton({
    portCity,
    buyInEur: buy.buyInEur,
    adults,
    preNight,
    missing,
    shipName,
    shipAlt,
  });

  const notes = [...(opt.decisionNotes ?? [])];
  if (shipName && !notes.some((n) => /schiff/i.test(n))) {
    notes.push(
      shipAlt
        ? `Schiff-Fit: ${shipName} (Alt. ${shipAlt})`
        : `Schiff: ${shipName}`,
    );
  }
  if (!notes.some((n) => /kreuzfahrt/i.test(n))) {
    notes.push(
      preNight
        ? 'Kreuzfahrt-Plan: Vornacht nahe Terminal eingeplant'
        : 'Kreuzfahrt-Plan: Anreise und Einschiffen prüfen',
    );
  }

  return {
    ...opt,
    title: opt.title?.includes('Kreuzfahrt') ? opt.title : `Kreuzfahrt · ${portCity}`,
    days,
    bookingChecklist: checklist,
    priceBreakdown,
    buyInEur: buy.buyInEur ?? opt.buyInEur,
    buyInLabel: buy.buyInLabel,
    totalEur: buy.totalPackage ?? opt.totalEur,
    pricePerPerson: buy.buyInEur ?? opt.pricePerPerson,
    extrasEur: extras?.cruiseEur ?? opt.extrasEur ?? null,
    transferEur: transferSum ?? opt.transferEur,
    gaps,
    decisionNotes: notes,
    speechSummary: speech.slice(0, 800),
    experienceSummary: speech.slice(0, 300),
    packageBookUrl: opt.packageBookUrl || cruiseUrl,
  };
}
