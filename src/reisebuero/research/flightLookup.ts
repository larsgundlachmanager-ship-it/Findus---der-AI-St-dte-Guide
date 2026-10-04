/**
 * Echte Flugpreise + Zeiten/Flugnummer (Travelpayouts Data API).
 */

import { env } from '../../config/env';

export type FlightQuote = {
  priceEur: number;
  departAt: string | null;
  returnAt: string | null;
  flightNumber: string | null;
  carrier: string | null;
  transfers: number | null;
  departDate: string | null;
};

function clockFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m?.[1] ?? null;
}

function flightNo(airline?: string | null, num?: string | number | null): string | null {
  const a = (airline || '').trim().toUpperCase();
  const n = String(num ?? '').trim();
  if (!n) return null;
  if (/^[A-Z0-9]{2}\d/i.test(n)) return n.toUpperCase();
  if (a) return `${a}${n}`;
  return n;
}

function token(): string {
  return env.travelpayoutsToken() || '';
}

/** Günstigster Flug im Monat / auf Route — inkl. Uhrzeit + Flugnummer. */
export async function lookupCheapFlight(opts: {
  origin: string;
  destination: string;
  /** yyyy-mm oder yyyy-mm-dd */
  departMonthOrDate: string;
  returnMonthOrDate?: string | null;
}): Promise<FlightQuote | null> {
  const tok = token();
  if (!tok) return null;
  const origin = opts.origin.toUpperCase();
  const destination = opts.destination.toUpperCase();
  try {
    const u = new URL('https://api.travelpayouts.com/v1/prices/cheap');
    u.searchParams.set('origin', origin);
    u.searchParams.set('destination', destination);
    const dep = opts.departMonthOrDate.slice(0, 7);
    u.searchParams.set('depart_date', dep);
    if (opts.returnMonthOrDate) {
      u.searchParams.set('return_date', opts.returnMonthOrDate.slice(0, 7));
    }
    u.searchParams.set('currency', 'eur');
    u.searchParams.set('token', tok);
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: { 'X-Access-Token': tok },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      success?: boolean;
      data?: Record<
        string,
        Record<
          string,
          {
            price?: number;
            airline?: string;
            flight_number?: string | number;
            departure_at?: string;
            return_at?: string;
            transfers?: number;
          }
        >
      >;
    };
    if (!json.success || !json.data) return null;
    const bucket = json.data[destination] || Object.values(json.data)[0];
    if (!bucket) return null;
    let best: FlightQuote | null = null;
    for (const row of Object.values(bucket)) {
      const price = Number(row.price ?? 0);
      if (!(price > 0)) continue;
      const q: FlightQuote = {
        priceEur: price,
        departAt: clockFromIso(row.departure_at),
        returnAt: clockFromIso(row.return_at),
        flightNumber: flightNo(row.airline, row.flight_number),
        carrier: (row.airline || '').trim().toUpperCase() || null,
        transfers: typeof row.transfers === 'number' ? row.transfers : null,
        departDate: row.departure_at?.slice(0, 10) ?? null,
      };
      if (!best || q.priceEur < best.priceEur) best = q;
    }
    return best;
  } catch {
    return null;
  }
}

/** Calendar-Tag mit Meta — für konkretes Datum. */
export async function lookupCalendarFlightDay(opts: {
  origin: string;
  destination: string;
  date: string;
  nights: number;
}): Promise<FlightQuote | null> {
  const tok = token();
  if (!tok) return null;
  const month = opts.date.slice(0, 7);
  try {
    const u = new URL('https://api.travelpayouts.com/v1/prices/calendar');
    u.searchParams.set('origin', opts.origin.toUpperCase());
    u.searchParams.set('destination', opts.destination.toUpperCase());
    u.searchParams.set('depart_date', month);
    u.searchParams.set('calendar_type', 'departure_date');
    u.searchParams.set('currency', 'eur');
    u.searchParams.set('market', 'de');
    u.searchParams.set('length', String(Math.max(1, Math.min(30, opts.nights))));
    u.searchParams.set('token', tok);
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: { 'X-Access-Token': tok },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      success?: boolean;
      data?: Record<
        string,
        {
          price?: number;
          value?: number;
          airline?: string;
          flight_number?: string | number;
          departure_at?: string;
          return_at?: string;
          transfers?: number;
        }
      >;
    };
    if (!json.success || !json.data) return null;
    const exact = json.data[opts.date];
    const pick =
      exact ||
      Object.entries(json.data).sort(
        (a, b) => Number(a[1].price ?? a[1].value ?? 9e9) - Number(b[1].price ?? b[1].value ?? 9e9),
      )[0]?.[1];
    if (!pick) return null;
    const price = Number(pick.price ?? pick.value ?? 0);
    if (!(price > 0)) return null;
    return {
      priceEur: price,
      departAt: clockFromIso(pick.departure_at),
      returnAt: clockFromIso(pick.return_at),
      flightNumber: flightNo(pick.airline, pick.flight_number),
      carrier: (pick.airline || '').trim().toUpperCase() || null,
      transfers: typeof pick.transfers === 'number' ? pick.transfers : null,
      departDate: pick.departure_at?.slice(0, 10) ?? opts.date,
    };
  } catch {
    return null;
  }
}

/** Beste Quote: erst Exact-Tag, sonst Cheap-Monat. */
export async function lookupBestFlightQuote(opts: {
  origin: string;
  destination: string;
  checkin: string;
  checkout: string;
}): Promise<FlightQuote | null> {
  const nights = Math.max(
    1,
    Math.round(
      (Date.parse(`${opts.checkout}T12:00:00`) - Date.parse(`${opts.checkin}T12:00:00`)) /
        86_400_000,
    ) || 2,
  );
  const day = await lookupCalendarFlightDay({
    origin: opts.origin,
    destination: opts.destination,
    date: opts.checkin,
    nights,
  });
  if (day?.flightNumber && day.departAt) return day;
  const cheap = await lookupCheapFlight({
    origin: opts.origin,
    destination: opts.destination,
    departMonthOrDate: opts.checkin,
    returnMonthOrDate: opts.checkout,
  });
  if (!cheap) return day;
  if (!day) return cheap;
  // Merge: Preis vom günstigeren, Meta wo vorhanden
  return {
    priceEur: Math.min(day.priceEur, cheap.priceEur),
    departAt: day.departAt || cheap.departAt,
    returnAt: day.returnAt || cheap.returnAt,
    flightNumber: day.flightNumber || cheap.flightNumber,
    carrier: day.carrier || cheap.carrier,
    transfers: day.transfers ?? cheap.transfers,
    departDate: day.departDate || cheap.departDate,
  };
}
