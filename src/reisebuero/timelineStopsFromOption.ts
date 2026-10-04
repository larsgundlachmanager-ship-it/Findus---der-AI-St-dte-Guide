/**
 * Pure: ReiseOption → Timeline-Stops (ohne Zustand/RN).
 * Timetable 1:1 je Kalendertag (Wochentag + Datum + Links).
 */

import { offsetDateKey, todayDateKey } from '../utils/dateKeys';
import type { FuturePlanStop } from '../module2/timeline/futurePlanState';
import type { ReiseLedger, ReiseOption, TransportChoice } from './types';

function dayKeyFromLedger(ledger: ReiseLedger): string {
  return ledger.dateStart?.value || todayDateKey();
}

function nights(ledger: ReiseLedger): number {
  return (
    ledger.stayNights?.value ??
    (ledger.stayDays?.value ? Math.max(1, ledger.stayDays.value - 1) : 2)
  );
}

function selectedTransport(opt: ReiseOption): TransportChoice | null {
  return (
    opt.transports?.find((t) => t.id === opt.selectedTransportId) ||
    opt.transports?.[0] ||
    null
  );
}

function transportNotes(tr: TransportChoice): string {
  return [
    tr.flightNumber
      ? `${tr.carrier ? tr.carrier + ' ' : ''}${tr.flightNumber}`
      : null,
    tr.departAt ? `Ab ${tr.departAt}` : null,
    tr.priceEur != null
      ? tr.kind === 'flight'
        ? `ca. ${tr.priceEur} € p.P.`
        : `ca. ${tr.priceEur} €`
      : null,
    tr.transfers === 0 ? 'Direkt' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

/** Echte Book-URL — leer/Platzhalter → null (kein Fake-Link). */
export function usableBookUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  if (/^(about:blank|javascript:)/i.test(u)) return null;
  return u;
}

export type TimelineDayBucket = {
  dayKey: string;
  stops: FuturePlanStop[];
};

type MutableBuckets = Map<string, FuturePlanStop[]>;

function pushOn(buckets: MutableBuckets, dayKey: string, stop: FuturePlanStop): void {
  const dk = /^\d{4}-\d{2}-\d{2}/.test(dayKey) ? dayKey.slice(0, 10) : dayKey;
  const list = buckets.get(dk) || [];
  list.push(stop);
  buckets.set(dk, list);
}

function appendBookWishBits(
  buckets: MutableBuckets,
  dayKey: string,
  opt: ReiseOption,
  ledger: ReiseLedger,
  tr: TransportChoice | null,
  stayBookUrl: string | null,
): void {
  const bookBits: Array<{ id: string; title: string; url: string | null | undefined }> = [];
  if (ledger.bookedFlight?.value !== true && (tr?.kind === 'flight' || opt.flightBookUrl)) {
    bookBits.push({
      id: 'book_flight',
      title: 'Flug gebucht?',
      url: tr?.bookUrl || opt.flightBookUrl,
    });
  }
  if (ledger.bookedRail?.value !== true && tr?.kind === 'train' && tr.bookUrl) {
    bookBits.push({ id: 'book_train', title: 'Bahn gebucht?', url: tr.bookUrl });
  }
  if (ledger.bookedStay?.value !== true) {
    bookBits.push({
      id: 'book_stay',
      title: 'Unterkunft gebucht?',
      url: stayBookUrl,
    });
  }
  if (opt.transferBookUrl && ledger.bookedTransfer?.value !== true) {
    bookBits.push({
      id: 'book_taxi',
      title:
        opt.transferEur != null
          ? `Taxi vorbestellen (~${opt.transferEur} €)?`
          : 'Taxi vorbestellen?',
      url: opt.transferBookUrl,
    });
  }
  if (opt.carBookUrl && ledger.bookedCar?.value !== true) {
    bookBits.push({ id: 'book_car', title: 'Mietwagen gebucht?', url: opt.carBookUrl });
  }
  if (opt.packageBookUrl) {
    bookBits.push({ id: 'book_package', title: 'Paket öffnen?', url: opt.packageBookUrl });
  }
  // Magazin-Checklist + Wish-Chapters mit Partner-Links
  for (const item of opt.bookingChecklist ?? []) {
    if (item.alreadyBooked || !item.url) continue;
    const lab = `${item.label || ''} ${item.id || ''}`;
    if (ledger.bookedFlight?.value === true && /flug|flight|kiwi|aviasales/i.test(lab)) continue;
    if (ledger.bookedRail?.value === true && /bahn|zug|rail|train/i.test(lab)) continue;
    if (ledger.bookedStay?.value === true && /stay|hotel|unterkunft|apartment|airbnb/i.test(lab)) continue;
    if (ledger.bookedCar?.value === true && /mietwagen|car|auto/i.test(lab)) continue;
    if (ledger.bookedTransfer?.value === true && /taxi|transfer|uber/i.test(lab)) continue;
    bookBits.push({
      id: `chk_${item.id}`,
      title: item.label || 'Buchen?',
      url: item.url,
    });
  }
  for (const ch of opt.wishChapters ?? []) {
    if (!ch.bookUrl || !ch.met) continue;
    bookBits.push({
      id: `wish_${ch.id}`,
      title: `${ch.title} öffnen?`,
      url: ch.bookUrl,
    });
  }

  const seen = new Set<string>();
  for (const b of bookBits) {
    const url = usableBookUrl(b.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    pushOn(buckets, dayKey, {
      id: `rb_${b.id}_${opt.id}`,
      title: b.title,
      bufferMin: 0,
      transport: 'unknown',
      kind: 'wish',
      emoji: '✅',
      notes: 'Tippen zum Buchen — dann abhaken',
      mapsUrl: url,
      status: 'planned',
    });
  }
}

/**
 * Timetable → Timeline-Tage (1:1). Jeder DayPlan-Tag = eigener Calendar-Tag.
 */
export function buildTimelineDayBuckets(
  opt: ReiseOption,
  ledger: ReiseLedger,
): TimelineDayBucket[] {
  const start = dayKeyFromLedger(ledger);
  const n = nights(ledger);
  const end = offsetDateKey(n, Date.parse(`${start}T12:00:00`));
  const adults = ledger.adults?.value ?? 2;
  const buckets: MutableBuckets = new Map();
  const tr = selectedTransport(opt);
  const stay = opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0];
  const stayUrl = usableBookUrl(stay?.bookUrl || opt.stayBookUrl || null);
  const days = opt.days ?? [];
  const hops = ledger.hopStops?.value ?? [];
  let hopByDay: string[] = [];
  try {
    const { assignHopCitiesToDays } =
      require('./research/hopDayAnnotate') as typeof import('./research/hopDayAnnotate');
    hopByDay = assignHopCitiesToDays(days.length, hops);
  } catch {
    hopByDay = hops.map((h) => h.city);
  }

  const dayHasOutbound = days.some((d) =>
    (d.blocks ?? []).some((b) => /^(flug|bahn|fernbus|anreise)/i.test(b.title)),
  );
  if (!dayHasOutbound) {
    try {
      const { buildHubFeederPlan } =
        require('./research/hubFeederPlan') as typeof import('./research/hubFeederPlan');
      const plan = buildHubFeederPlan({ ledger, transport: tr });
      let feederHour = 5;
      for (const leg of plan?.legs ?? []) {
        const isBus = /flixbus|🚌/i.test(`${leg.title} ${leg.detail}`);
        pushOn(buckets, start, {
          id: `rb_${leg.id}_${opt.id}`,
          title: leg.title,
          bufferMin: leg.role === 'airport_transit' ? 25 : 20,
          transport: 'transit',
          kind: 'nav_leg',
          emoji: leg.role === 'airport_transit' ? '🚇' : isBus ? '🚌' : '🚆',
          notes: [leg.detail, leg.priceEur != null ? `ca. ${leg.priceEur} €` : null]
            .filter(Boolean)
            .join(' · '),
          mapsUrl: usableBookUrl(leg.bookUrl),
          status: 'planned',
          plannedStartMs: Date.parse(
            `${start}T${String(feederHour).padStart(2, '0')}:00:00`,
          ),
        });
        feederHour += leg.role === 'long_haul' ? 4 : 1;
      }
    } catch {
      /* soft */
    }
  }

  if (days.length > 0) {
    let hour = 10;
    for (let di = 0; di < days.length; di++) {
      const day = days[di]!;
      const dk = (/^\d{4}-\d{2}-\d{2}/.test(day.dayKey) ? day.dayKey.slice(0, 10) : null) || start;
      const wd =
        day.weekdayLabel ||
        (/^\d{4}-\d{2}-\d{2}/.test(dk)
          ? WD[new Date(`${dk}T12:00:00`).getDay()]
          : null);
      const hopCity = hopByDay[di] || hops[Math.min(di, Math.max(0, hops.length - 1))]?.city || null;
      let hopLat = opt.lat;
      let hopLng = opt.lng;
      if (hopCity) {
        try {
          const { approxPinForSpark } =
            require('./research/sparkGeo') as typeof import('./research/sparkGeo');
          const pin = approxPinForSpark(hopCity);
          if (pin?.lat != null && pin?.lng != null) {
            hopLat = pin.lat;
            hopLng = pin.lng;
          }
        } catch {
          /* soft */
        }
      }
      const dayLabel = [
        wd,
        /^\d{4}-\d{2}-\d{2}/.test(dk)
          ? `${Number(dk.slice(8, 10))}.${Number(dk.slice(5, 7))}.`
          : null,
        hopCity,
      ]
        .filter(Boolean)
        .join(' ');

      for (const block of day.blocks ?? []) {
        const isTransit = /^(flug|bahn|fernbus|camper\/auto|anreise|check-in|check-out|transfer|zug)/i.test(
          block.title,
        );
        const t = (block.time || '').slice(0, 5);
        const startMs = Date.parse(
          `${dk}T${/^\d{2}:\d{2}$/.test(t) ? t : `${String(hour).padStart(2, '0')}:00`}:00`,
        );
        hour = Math.min(20, hour + (isTransit ? 2 : 3));
        const bookedBit =
          (/flug/i.test(block.title) && ledger.bookedFlight?.value === true) ||
          (/bahn|zug/i.test(block.title) && ledger.bookedRail?.value === true) ||
          (/check-in|unterkunft/i.test(block.title) && ledger.bookedStay?.value === true);
        const bookUrl = bookedBit ? null : usableBookUrl(block.bookUrl);
        pushOn(buckets, dk, {
          id: `rb_day_${opt.id}_${block.id}`,
          title: `${dayLabel ? dayLabel + ' · ' : ''}${block.title}`,
          lat: hopLat,
          lng: hopLng,
          bufferMin: isTransit ? 30 : 25,
          transport: /flug/i.test(block.title)
            ? 'flight'
            : /bahn|fernbus|zug/i.test(block.title)
              ? 'transit'
              : 'unknown',
          kind: isTransit ? 'nav_leg' : 'stop',
          emoji: /feier|club|bar|party/i.test(block.title)
            ? '🎉'
            : /spa|thermal|bad/i.test(block.title)
              ? '🧖'
              : /essen|food|markt/i.test(block.title)
                ? '🍽️'
                : /flug/i.test(block.title)
                  ? '✈️'
                  : /bahn|zug/i.test(block.title)
                    ? '🚆'
                    : /check-in|hotel|unterkunft/i.test(block.title)
                      ? '🏨'
                      : '📍',
          notes: [
            bookedBit ? 'schon gebucht' : null,
            day.title,
            block.detail,
            block.costEur != null ? `ca. ${block.costEur} €` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          mapsUrl: bookUrl,
          websiteUrl: bookUrl && /ticket|event|konzert|museum/i.test(`${block.title} ${block.detail || ''}`)
            ? bookUrl
            : null,
          status: 'planned',
          plannedStartMs: Number.isFinite(startMs) ? startMs : undefined,
          hardAnchor: /check-in/i.test(block.title) || undefined,
          userFixedTime: /^\d{2}:\d{2}$/.test(t) || undefined,
        });
      }
      hour = 10;
    }
    if (ledger.needCar?.value === true && ledger.bookedCar?.value !== true) {
      const all = [...buckets.values()].flat();
      const hasCar = all.some((s) => /mietwagen/i.test(s.title || ''));
      if (!hasCar) {
        pushOn(buckets, start, {
          id: `rb_xfer_${opt.id}`,
          title: 'Mietwagen vor Ort',
          lat: opt.lat,
          lng: opt.lng,
          bufferMin: 20,
          transport: 'car',
          kind: 'nav_leg',
          emoji: '🚗',
          notes: 'noch buchen',
          mapsUrl: usableBookUrl(opt.carBookUrl),
          status: 'planned',
        });
      }
    }
  } else {
    // ——— Legacy ohne DayPlan ———
    if (tr?.kind === 'flight' || (!tr && opt.flightBookUrl) || ledger.bookedFlight?.value === true) {
      const booked = ledger.bookedFlight?.value === true;
      pushOn(buckets, start, {
        id: `rb_fly_${opt.id}`,
        title: booked
          ? `Flug → ${opt.placeName} · schon gebucht`
          : tr?.flightNumber
            ? `Flug ${tr.flightNumber} → ${opt.placeName}`
            : `Flug → ${opt.placeName}`,
        lat: opt.lat,
        lng: opt.lng,
        bufferMin: 45,
        transport: 'flight',
        kind: 'nav_leg',
        emoji: '✈️',
        notes: booked ? 'schon gebucht' : tr ? transportNotes(tr) : 'Flug buchen',
        mapsUrl: booked ? null : usableBookUrl(tr?.bookUrl || opt.flightBookUrl),
        status: 'planned',
        plannedStartMs: Date.parse(`${start}T${(tr?.departAt || '08:00').slice(0, 5)}:00`),
      });
    } else if (tr?.kind === 'train' || ledger.bookedRail?.value === true) {
      const booked = ledger.bookedRail?.value === true;
      pushOn(buckets, start, {
        id: `rb_train_${opt.id}`,
        title: booked ? `Bahn → ${opt.placeName} · schon gebucht` : `Bahn → ${opt.placeName}`,
        lat: opt.lat,
        lng: opt.lng,
        bufferMin: 30,
        transport: 'transit',
        kind: 'nav_leg',
        emoji: '🚆',
        notes: booked ? 'schon gebucht' : tr ? transportNotes(tr) || tr.label : 'Bahn',
        mapsUrl: booked ? null : usableBookUrl(tr?.bookUrl),
        status: 'planned',
        plannedStartMs: Date.parse(`${start}T${(tr?.departAt || '08:00').slice(0, 5)}:00`),
      });
    }

    if (
      opt.transferBookUrl ||
      opt.carBookUrl ||
      (opt.transferEur != null && opt.transferEur > 0) ||
      ledger.bookedTransfer?.value === true ||
      (ledger.needCar?.value === true && ledger.bookedCar?.value !== true)
    ) {
      const flyIn =
        tr?.kind === 'flight' || Boolean(opt.flightBookUrl) || ledger.bookedFlight?.value === true;
      const xferBooked = ledger.bookedTransfer?.value === true;
      const carNeed = ledger.needCar?.value === true && ledger.bookedCar?.value !== true;
      pushOn(buckets, start, {
        id: `rb_xfer_${opt.id}`,
        title: xferBooked
          ? 'Transfer · schon gebucht'
          : carNeed
            ? 'Mietwagen vor Ort'
            : flyIn
              ? 'Taxi Flughafen → Unterkunft'
              : 'Transfer → Unterkunft',
        lat: opt.lat,
        lng: opt.lng,
        bufferMin: 20,
        transport: opt.carBookUrl || carNeed ? 'car' : 'taxi',
        kind: 'nav_leg',
        emoji: carNeed ? '🚗' : '🚕',
        notes: xferBooked
          ? 'schon gebucht'
          : opt.transferEur != null
            ? `ca. ${opt.transferEur} € für die Gruppe · vorbestellen`
            : carNeed
              ? 'noch buchen'
              : 'Anreise zur Unterkunft',
        mapsUrl: xferBooked
          ? null
          : usableBookUrl(opt.transferBookUrl || opt.carBookUrl || null),
        status: 'planned',
      });
    }

    const stayBooked = ledger.bookedStay?.value === true;
    pushOn(buckets, start, {
      id: `rb_stay_${opt.id}`,
      title: stayBooked
        ? `${stay?.name || opt.stayName || 'Unterkunft'} · schon gebucht`
        : stay?.name || opt.stayName || opt.title,
      lat: opt.lat,
      lng: opt.lng,
      bufferMin: 30,
      transport: 'unknown',
      kind: 'stop',
      emoji: '🏨',
      notes: stayBooked
        ? 'schon gebucht'
        : [
            opt.buyInEur != null ? `Buy-in ${opt.buyInEur} € p.P. (${adults} Pers.)` : null,
            stay?.priceEur != null ? `Stay ca. ${stay.priceEur} € gesamt` : null,
          ]
            .filter(Boolean)
            .join(' · '),
      mapsUrl: stayBooked ? null : stayUrl,
      websiteUrl: stayBooked ? null : usableBookUrl(opt.packageBookUrl),
      status: 'planned',
      plannedStartMs: Date.parse(`${start}T15:00:00`),
      plannedEndMs: Date.parse(`${end}T11:00:00`),
      hardAnchor: true,
    });

    if (tr?.kind === 'flight' || (!tr && opt.flightBookUrl)) {
      pushOn(buckets, end, {
        id: `rb_fly_back_${opt.id}`,
        title:
          ledger.bookedFlight?.value === true
            ? `Rückflug ← ${opt.placeName} · schon gebucht`
            : `Rückflug ← ${opt.placeName}`,
        bufferMin: 45,
        transport: 'flight',
        kind: 'nav_leg',
        emoji: '✈️',
        notes: ledger.bookedFlight?.value === true ? 'schon gebucht' : tr?.arriveAt || 'Rückflug buchen',
        mapsUrl:
          ledger.bookedFlight?.value === true
            ? null
            : usableBookUrl(tr?.bookUrl || opt.flightBookUrl),
        status: 'planned',
        plannedStartMs: Date.parse(`${end}T12:00:00`),
      });
    }
  }

  for (const [i, act] of (ledger.bookedActivities?.value ?? []).slice(0, 4).entries()) {
    if (!act?.name) continue;
    const actDay =
      act.dayHint && /^\d{4}-\d{2}-\d{2}/.test(act.dayHint)
        ? act.dayHint.slice(0, 10)
        : start;
    pushOn(buckets, actDay, {
      id: `rb_act_${i}_${opt.id}`,
      title: `${act.name} · schon gebucht`,
      lat: opt.lat,
      lng: opt.lng,
      bufferMin: 15,
      transport: 'unknown',
      kind: 'stop',
      emoji: '🎟️',
      notes: act.dayHint || 'Ticket steht',
      mapsUrl: null,
      status: 'planned',
      plannedStartMs: Date.parse(`${actDay}T${String(16 + i).padStart(2, '0')}:00:00`),
    });
  }

  appendBookWishBits(buckets, start, opt, ledger, tr, stayUrl);

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, stops]) => ({ dayKey, stops }));
}

/** Flache Liste (Tests / Legacy) — Reihenfolge = Kalendertage. */
export function buildTimelineStopsFromOption(
  opt: ReiseOption,
  ledger: ReiseLedger,
): FuturePlanStop[] {
  return buildTimelineDayBuckets(opt, ledger).flatMap((b) => b.stops);
}
