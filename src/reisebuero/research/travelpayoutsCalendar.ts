/**
 * Travelpayouts Calendar / cheap prices — beste Zeitfenster für N Nächte.
 * Token optional; ohne Token synthetische Fenster aus dateWindow/Month.
 */

import { env } from '../../config/env';
import { offsetDateKey } from '../../utils/dateKeys';
import type { ReiseLedger } from '../types';

export type CalendarSlot = {
  id: string;
  checkin: string;
  checkout: string;
  fromIata: string;
  toIata: string;
  priceEur: number | null;
  label: string;
  source: 'travelpayouts' | 'synthetic';
  departAt?: string | null;
  arriveAt?: string | null;
  returnAt?: string | null;
  flightNumber?: string | null;
  carrier?: string | null;
  transfers?: number | null;
  earlyArrival?: boolean;
};

function nightsOf(ledger: ReiseLedger): number {
  if (ledger.stayNights?.value) return ledger.stayNights.value;
  if (ledger.stayNightsMax?.value) {
    return Math.round(
      ((ledger.stayNights?.value ?? 2) + ledger.stayNightsMax.value) / 2,
    );
  }
  if (ledger.stayDays?.value) return Math.max(1, ledger.stayDays.value - 1);
  return 2;
}

function monthKeysFromWindow(ledger: ReiseLedger): string[] {
  const w = (ledger.dateWindow?.value || '').trim();
  const y = new Date().getFullYear();
  if (/^\d{4}-\d{2}\.\.\d{4}-\d{2}$/.test(w)) {
    const [a, b] = w.split('..');
    const out: string[] = [];
    let [ys, ms] = a!.split('-').map(Number) as [number, number];
    const [ye, me] = b!.split('-').map(Number) as [number, number];
    while (ys < ye || (ys === ye && ms <= me)) {
      out.push(`${ys}-${String(ms).padStart(2, '0')}`);
      ms += 1;
      if (ms > 12) {
        ms = 1;
        ys += 1;
      }
      if (out.length > 12) break;
    }
    return out;
  }
  if (/^\d{4}-\d{2}$/.test(w)) return [w];
  if (/^\d{4}$/.test(w)) {
    return Array.from({ length: 12 }, (_, i) => `${w}-${String(i + 1).padStart(2, '0')}`);
  }
  if (ledger.dateMonth?.value) return [ledger.dateMonth.value];
  if (ledger.dateStart?.value) return [ledger.dateStart.value.slice(0, 7)];
  const now = new Date();
  const m = now.getMonth() + 1;
  return [`${y}-${String(m).padStart(2, '0')}`];
}

function fridayOfMonth(ym: string, week = 1): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1, 1, 12, 0, 0);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (week - 1) * 7);
  if (d.getMonth() !== m - 1) d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

async function fetchTpCalendar(opts: {
  origin: string;
  destination: string;
  month: string;
  nights: number;
}): Promise<
  Array<{
    date: string;
    price: number;
    departAt: string | null;
    arriveAt: string | null;
    returnAt: string | null;
    flightNumber: string | null;
    carrier: string | null;
    transfers: number | null;
  }>
> {
  const token = env.travelpayoutsToken();
  if (!token) return [];
  try {
    const u = new URL('https://api.travelpayouts.com/v1/prices/calendar');
    u.searchParams.set('origin', opts.origin.toUpperCase());
    u.searchParams.set('destination', opts.destination.toUpperCase());
    u.searchParams.set('depart_date', opts.month);
    u.searchParams.set('calendar_type', 'departure_date');
    u.searchParams.set('currency', 'eur');
    u.searchParams.set('market', 'de');
    u.searchParams.set('length', String(Math.max(1, Math.min(30, opts.nights))));
    u.searchParams.set('token', token);
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: { 'X-Access-Token': token },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      success?: boolean;
      data?: Record<
        string,
        {
          value?: number;
          price?: number;
          departure_at?: string;
          return_at?: string;
          airline?: string;
          flight_number?: string | number;
          transfers?: number;
        }
      >;
    };
    if (json.success === false) return [];
    const data = json.data || {};
    const monthPrefix = opts.month;
    const rows = Object.entries(data)
      .map(([date, v]) => ({
        date,
        price: Number(v.value ?? v.price ?? 0),
        departAt: clockFromIso(v.departure_at),
        arriveAt: null as string | null,
        returnAt: clockFromIso(v.return_at),
        flightNumber: flightNo(v.airline, v.flight_number),
        carrier: (v.airline || '').trim().toUpperCase() || null,
        transfers: typeof v.transfers === 'number' ? v.transfers : null,
      }))
      .filter((x) => x.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
    const inMonth = rows.filter((x) => x.date.startsWith(monthPrefix));
    return inMonth.length ? inMonth : rows;
  } catch {
    return [];
  }
}

/**
 * Top Zeitfenster für Hin+Rück über Nächte — Calendar API oder synthetisch.
 */
export async function findBestCalendarSlots(opts: {
  ledger: ReiseLedger;
  fromIatas: string[];
  toIata: string;
  maxSlots?: number;
}): Promise<CalendarSlot[]> {
  const nights = nightsOf(opts.ledger);
  const months = monthKeysFromWindow(opts.ledger);
  const maxSlots = opts.maxSlots ?? 4;
  const froms = opts.fromIatas.length ? opts.fromIatas : ['HAM'];
  const collected: CalendarSlot[] = [];

  let hardPinned = false;
  try {
    const { isDateHardPinned } = await import('./hardPins');
    hardPinned = isDateHardPinned(opts.ledger);
  } catch {
    hardPinned = Boolean(opts.ledger.dateStart?.value && opts.ledger.dateFlex?.value === 'exact');
  }

  for (const from of froms.slice(0, 4)) {
    for (const month of months.slice(0, 4)) {
      const rows = await fetchTpCalendar({
        origin: from,
        destination: opts.toIata,
        month,
        nights,
      });
      for (const row of rows) {
        const checkin = row.date;
        const checkout = offsetDateKey(nights, Date.parse(`${checkin}T12:00:00`));
        collected.push({
          id: `${from}-${opts.toIata}-${checkin}`,
          checkin,
          checkout,
          fromIata: from,
          toIata: opts.toIata,
          priceEur: row.price,
          label: `${from}→${opts.toIata} ${checkin}`,
          source: 'travelpayouts',
          departAt: row.departAt,
          arriveAt: row.arriveAt,
          returnAt: row.returnAt,
          flightNumber: row.flightNumber,
          carrier: row.carrier,
          transfers: row.transfers,
        });
      }
    }
  }

  if (!collected.length && !hardPinned) {
    // Synthetisch: Freitage der Monate — nur wenn Datum offen
    for (const month of months.slice(0, 4)) {
      for (let w = 1; w <= 3; w += 1) {
        const checkin = fridayOfMonth(month, w);
        const checkout = offsetDateKey(nights, Date.parse(`${checkin}T12:00:00`));
        for (const from of froms.slice(0, 2)) {
          collected.push({
            id: `syn-${from}-${checkin}`,
            checkin,
            checkout,
            fromIata: from,
            toIata: opts.toIata,
            priceEur: null,
            label: `${from}→${opts.toIata} ${checkin}`,
            source: 'synthetic',
          });
        }
      }
    }
  }

  // Exact / Flex-Fenster aus Ledger (Must-Da-Sein + ±Tage)
  if (hardPinned) {
    try {
      const { filterSlotsToHardPin } = await import('./hardPins');
      const kept = filterSlotsToHardPin(opts.ledger, collected);
      collected.length = 0;
      collected.push(...kept);
    } catch {
      /* soft */
    }
  }

  try {
    const { buildFlexTravelWindows } = await import('./presenceFlex');
    const flexWins = buildFlexTravelWindows(opts.ledger);
    for (const w of flexWins.slice(0, Math.max(4, maxSlots))) {
      collected.unshift({
        id: `flex-${w.checkin}-${w.checkout}`,
        checkin: w.checkin,
        checkout: w.checkout,
        fromIata: froms[0]!,
        toIata: opts.toIata,
        priceEur: null,
        label: w.label,
        source: 'synthetic',
        earlyArrival: w.earlyDays > 0 || w.shiftDays < 0,
      });
    }
  } catch {
    if (opts.ledger.dateStart?.value) {
      const checkin = opts.ledger.dateStart.value;
      const checkout =
        opts.ledger.dateEnd?.value ||
        offsetDateKey(nights, Date.parse(`${checkin}T12:00:00`));
      collected.unshift({
        id: `exact-${checkin}`,
        checkin,
        checkout,
        fromIata: froms[0]!,
        toIata: opts.toIata,
        priceEur: null,
        label: `Fix ${checkin}`,
        source: 'synthetic',
      });
    }
  }

  let priced = collected.filter((c) => c.priceEur != null).sort((a, b) => (a.priceEur! - b.priceEur!));
  let rest = collected.filter((c) => c.priceEur == null);
  if (hardPinned) {
    try {
      const { filterSlotsToHardPin } = await import('./hardPins');
      priced = filterSlotsToHardPin(opts.ledger, priced);
      rest = filterSlotsToHardPin(opts.ledger, rest);
    } catch {
      /* soft */
    }
  }
  const merged = [...priced, ...rest];
  const seen = new Set<string>();
  const out: CalendarSlot[] = [];
  for (const s of merged) {
    const key = `${s.checkin}:${s.fromIata}:${s.checkout}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxSlots) break;
  }

  // Early-Deal nur wenn User explizit Flex erlaubt — nie still ±1 erzwingen
  const flexN = Math.max(
    opts.ledger.arrivalFlexDays?.value ?? 0,
    opts.ledger.departureFlexDays?.value ?? 0,
    0,
  );
  const pinned = opts.ledger.dateStart?.value;
  if (pinned && flexN > 0 && !hardPinned) {
    const earlyKey = offsetDateKey(-1, Date.parse(`${pinned}T12:00:00`));
    const exactP = priced.find((s) => s.checkin === pinned);
    const earlyP = priced.find((s) => s.checkin === earlyKey);
    if (
      earlyP?.priceEur != null &&
      (exactP?.priceEur == null || earlyP.priceEur <= exactP.priceEur * 0.92)
    ) {
      const tagged: CalendarSlot = {
        ...earlyP,
        earlyArrival: true,
        label: `${earlyP.fromIata}→${earlyP.toIata} ${earlyP.checkin} · 1 Tag früher, günstiger`,
      };
      return [tagged, ...out.filter((s) => s.id !== tagged.id)].slice(0, maxSlots);
    }
  }
  // Hard-Pin: gepinntes Datum zuerst
  if (hardPinned && pinned) {
    const exact = out.find((s) => s.checkin.slice(0, 10) === pinned.slice(0, 10));
    if (exact) {
      return [exact, ...out.filter((s) => s.id !== exact.id)].slice(0, maxSlots);
    }
  }
  return out;
}
