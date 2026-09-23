/**
 * Reise nachtragen — Timeline harden (Bahn / Hotel-Stamm / Kreuzfahrt-Blick).
 * Nutzt bestehende Engines; kein neues Plan-System.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { FuturePlanStop } from './futurePlanState';
import { upsertFutureStopSafe } from './planNowGuard';

export type TravelScheduleKind =
  | 'train'
  | 'hotel_stamm'
  | 'cruise_glance'
  | 'flight'
  | 'flixbus'
  | 'event'
  | 'packlist'
  | null;

/** „Morgen 12 Uhr Bahn nach Kiel“ / „trag die Verbindung ein“. */
export function looksLikeTrainScheduleWrite(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const hasRail =
    /\b(bahn|zug|ice|ic\b|re\b|rb\b|s-bahn|regional|fernverkehr|verbindung)\b/iu.test(
      t,
    ) || /\b(nehmen|fahre|fahr|mit\s+der\s+bahn)\b/iu.test(t);
  const hasClock =
    /\b(?:um\s+)?(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)?\s*(?:uhr)?\b/iu.test(t) ||
    /\b(morgen|übermorgen|uebermorgen|heute|nächste[nrs]?\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))\b/iu.test(
      t,
    );
  const hasDest =
    /\b(?:nach|Richtung|richtung)\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß.-]{2,}/u.test(t) ||
    /\b(eintragen|timeline|kalender|trage)\b/iu.test(t);
  return hasRail && (hasClock || hasDest);
}

/** Hotel-Stammdaten: Check-in/out/Frühstück nachtragen. */
export function looksLikeHotelStammWrite(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const hotel =
    /\b(hotel|unterkunft|pension|hostel|airbnb|übernacht|uebernacht)\b/iu.test(t);
  if (!hotel) return false;
  const checkSlot =
    /\b(check[\s-]?in|check[\s-]?out|einchecken|auschecken)\b/iu.test(t);
  const breakfast =
    /\b(frühstück|fruehstueck|breakfast)\b/iu.test(t);
  const write =
    /\b(trag|eintragen|rein|dazu|timeline|kalender|notier|speicher)\b/iu.test(t);
  // Check-in/out allein reicht; Frühstück nur mit Write oder zusammen mit Check.
  return checkSlot || (breakfast && (write || checkSlot));
}

/** Kreuzfahrt-Blick: Programm / Häfen / Ein-/Ausschiffen — nur Timeline-Write, kein Pitch. */
export function looksLikeCruiseScheduleWrite(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const cruise =
    /\b(kreuzfahrt|einschiff|ausschiff|bordprogramm|zwischenhalt|hafenstopp|ablegen|all[\s-]?aboard|mein(?:en|em|e)?\s+schiff|aida|adidia|aidia|aiida)\b/iu.test(
      t,
    );
  if (!cruise) return false;
  // Harte Write-/Programm-Signale — sonst stiehlt das den Reisebüro-/Quick-Pitch-Pfad
  return /\b(trag|eintragen|hinzufüg|timeline|kalender|terminkalender|notier|speicher|zwischenhalt|hafenstopp|einschiff|ausschiff|programm\s+ein|häfen|haefen|bordprogramm|tagesprogramm|check[\s-]?in)\b/iu.test(
    t,
  );
}

export function detectTravelScheduleKind(text: string): TravelScheduleKind {
  const all = detectAllTravelScheduleKinds(text);
  return all[0] ?? null;
}

/** Mehrere Kinds in einem Satz (Bahn+Hotel+Flug+…) — Fan-out. */
export function detectAllTravelScheduleKinds(text: string): TravelScheduleKind[] {
  const t = String(text || '');
  const kinds: TravelScheduleKind[] = [];
  let hasWrite = false;
  try {
    const { hasScheduleWriteSignal } = require('./travelScheduleExtra') as {
      hasScheduleWriteSignal: (s: string) => boolean;
    };
    hasWrite = hasScheduleWriteSignal(t);
  } catch {
    hasWrite = /\b(trag|eintragen|hinzufüg|timeline|kalender|terminkalender|notier|speicher)\b/iu.test(
      t,
    );
  }

  if (looksLikeCruiseScheduleWrite(t)) kinds.push('cruise_glance');
  if (looksLikeHotelStammWrite(t)) kinds.push('hotel_stamm');
  try {
    const { looksLikePackListAsk } = require('./packListBuilder') as {
      looksLikePackListAsk: (s: string) => boolean;
    };
    if (looksLikePackListAsk(t)) kinds.push('packlist');
    const { looksLikePackWalkStart, looksLikePackWalkReply } = require('./packListWalk') as {
      looksLikePackWalkStart: (s: string) => boolean;
      looksLikePackWalkReply: (s: string) => boolean;
    };
    let walking = false;
    try {
      const { usePackListStore } = require('../../store/usePackListStore') as {
        usePackListStore: { getState: () => { isWalkActive: () => boolean } };
      };
      walking = usePackListStore.getState().isWalkActive();
    } catch {
      walking = false;
    }
    if (
      looksLikePackWalkStart(t) ||
      (walking && looksLikePackWalkReply(t))
    ) {
      if (!kinds.includes('packlist')) kinds.push('packlist');
    }
    try {
      const {
        looksLikeRefuseLaundry,
        looksLikeConfirmLaundry,
      } = require('./packListLaundry') as {
        looksLikeRefuseLaundry: (s: string) => boolean;
        looksLikeConfirmLaundry: (s: string) => boolean;
      };
      if (looksLikeRefuseLaundry(t) || looksLikeConfirmLaundry(t)) {
        if (!kinds.includes('packlist')) kinds.push('packlist');
      }
      const { looksLikePackContextFollowUp } = require('./packListTripHints') as {
        looksLikePackContextFollowUp: (s: string) => boolean;
      };
      if (looksLikePackContextFollowUp(t)) {
        if (!kinds.includes('packlist')) kinds.push('packlist');
      }
    } catch {
      /* soft */
    }
  } catch {
    /* soft */
  }
  try {
    const {
      looksLikeFlightScheduleWrite,
      looksLikeFlixBusScheduleWrite,
      looksLikeEventScheduleWrite,
    } = require('./travelScheduleExtra') as {
      looksLikeFlightScheduleWrite: (s: string) => boolean;
      looksLikeFlixBusScheduleWrite: (s: string) => boolean;
      looksLikeEventScheduleWrite: (s: string) => boolean;
    };
    if (looksLikeFlightScheduleWrite(t)) kinds.push('flight');
    if (looksLikeFlixBusScheduleWrite(t)) kinds.push('flixbus');
    if (looksLikeEventScheduleWrite(t)) kinds.push('event');
  } catch {
    /* soft */
  }
  if (looksLikeTrainScheduleWrite(t) && hasWrite) {
    kinds.push('train');
  }
  return kinds;
}

/** JobShape schedule_write — Hotel/Cruise/Flug/Bus/Event; Bahn nur mit Write-Verb. */
export function looksLikeTravelScheduleWriteJob(text: string): boolean {
  if (looksLikeHotelStammWrite(text) || looksLikeCruiseScheduleWrite(text)) {
    return true;
  }
  try {
    const { looksLikePackListAsk } = require('./packListBuilder') as {
      looksLikePackListAsk: (s: string) => boolean;
    };
    if (looksLikePackListAsk(text)) return true;
    const { looksLikePackWalkStart, looksLikePackWalkReply } = require('./packListWalk') as {
      looksLikePackWalkStart: (s: string) => boolean;
      looksLikePackWalkReply: (s: string) => boolean;
    };
    if (looksLikePackWalkStart(text)) return true;
    try {
      const { usePackListStore } = require('../../store/usePackListStore') as {
        usePackListStore: { getState: () => { isWalkActive: () => boolean } };
      };
      if (
        usePackListStore.getState().isWalkActive() &&
        looksLikePackWalkReply(text)
      ) {
        return true;
      }
    } catch {
      /* soft */
    }
  } catch {
    /* soft */
  }
  try {
    const {
      looksLikeFlightScheduleWrite,
      looksLikeFlixBusScheduleWrite,
      looksLikeEventScheduleWrite,
      hasScheduleWriteSignal,
    } = require('./travelScheduleExtra') as {
      looksLikeFlightScheduleWrite: (s: string) => boolean;
      looksLikeFlixBusScheduleWrite: (s: string) => boolean;
      looksLikeEventScheduleWrite: (s: string) => boolean;
      hasScheduleWriteSignal: (s: string) => boolean;
    };
    if (
      looksLikeFlightScheduleWrite(text) ||
      looksLikeFlixBusScheduleWrite(text) ||
      looksLikeEventScheduleWrite(text)
    ) {
      return true;
    }
    return looksLikeTrainScheduleWrite(text) && hasScheduleWriteSignal(text);
  } catch {
    return (
      looksLikeTrainScheduleWrite(text) &&
      /\b(trag|eintragen|timeline|kalender|notier|speicher)\b/iu.test(text)
    );
  }
}

function dayKeyFromText(text: string, now = Date.now()): string {
  try {
    const { dateKeyFromMs, offsetDateKey } = require('../../utils/dateKeys') as {
      dateKeyFromMs: (ms: number) => string;
      offsetDateKey: (n: number) => string;
    };
    const t = text.toLowerCase();
    if (/\bübermorgen|uebermorgen\b/.test(t)) return offsetDateKey(2);
    if (/\bmorgen\b/.test(t)) return offsetDateKey(1);
    if (/\bheute\b/.test(t)) return dateKeyFromMs(now);
    const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) return iso[1]!;
  } catch {
    /* soft */
  }
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hmToMs(dayKey: string, hm: string): number | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dayKey.split('-').map(Number);
  const dt = new Date(y!, mo! - 1, d!, Number(m[1]), Number(m[2]), 0, 0);
  return dt.getTime();
}

function parseHm(text: string): string | null {
  const m = text.match(
    /\b(?:um\s+)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr)?\b/iu,
  );
  if (!m) return null;
  const h = String(m[1]).padStart(2, '0');
  const mm = m[2] != null ? m[2] : '00';
  return `${h}:${mm}`;
}

export type HotelStammParsed = {
  hotelName: string;
  dayKey: string;
  /** Check-out-Tag wenn Stay belegt (sonst Folgetag-Heuristik). */
  checkoutDayKey?: string | null;
  checkInHm: string | null;
  checkOutHm: string | null;
  breakfast: boolean;
  breakfastHm: string | null;
};

export function parseHotelStammFromText(text: string): HotelStammParsed {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const dayKey = dayKeyFromText(t);
  let hotelName = 'Hotel';
  const named = t.match(
    /\b(?:hotel|unterkunft|pension)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß.'-]{1,40}(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß.']{1,24}){0,3})/iu,
  );
  if (named?.[1]) {
    hotelName = named[1]
      .replace(
        /\s+(?:check[\s-]?in|check[\s-]?out|frühstück|fruehstueck|breakfast|um|ab|eintragen).*$/iu,
        '',
      )
      .trim()
      .slice(0, 48);
    if (!hotelName) hotelName = 'Hotel';
  }

  let checkInHm: string | null = null;
  let checkOutHm: string | null = null;
  const ci = t.match(
    /\bcheck[\s-]?in\s*(?:um\s*|ab\s*|:\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr)?/iu,
  );
  if (ci) {
    checkInHm = `${String(ci[1]).padStart(2, '0')}:${ci[2] ?? '00'}`;
  }
  const co = t.match(
    /\bcheck[\s-]?out\s*(?:um\s*|bis\s*|:\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr)?/iu,
  );
  if (co) {
    checkOutHm = `${String(co[1]).padStart(2, '0')}:${co[2] ?? '00'}`;
  }
  const breakfast = /\b(frühstück|fruehstueck|breakfast)\b/iu.test(t);
  let breakfastHm: string | null = null;
  const bf = t.match(
    /\bfrühstück|fruehstueck|breakfast\b.{0,24}?(?:um\s*|ab\s*|von\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?/iu,
  );
  if (bf?.[1]) {
    breakfastHm = `${String(bf[1]).padStart(2, '0')}:${bf[2] ?? '00'}`;
  } else if (breakfast) {
    breakfastHm = '07:30';
  }
  if (!checkInHm && /\beinchecken\b/iu.test(t)) checkInHm = parseHm(t) || '15:00';
  if (!checkOutHm && /\bauschecken\b/iu.test(t)) checkOutHm = parseHm(t) || '11:00';

  return {
    hotelName,
    dayKey,
    checkInHm: checkInHm || '15:00',
    checkOutHm,
    breakfast,
    breakfastHm,
  };
}

export type CruisePortCall = {
  dayKey: string;
  portName: string;
  arriveAt?: string | null;
  departAt?: string | null;
  shoreHint?: string | null;
};

/** „Zwischenhalt Kiel 10 Uhr, ab 18 Uhr“ / „Häfen: Kiel, Oslo, Bergen“. */
export function parseCruisePortsFromText(
  text: string,
  embarkDayKey: string,
): CruisePortCall[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const out: CruisePortCall[] = [];
  const dayKey = dayKeyFromText(t) || embarkDayKey;

  const single = [
    ...t.matchAll(
      /\b(?:zwischenhalt|hafen|in)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})(?:\s+(?:um\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr)?)?(?:.{0,40}?(?:ab|ablegen|weiter)\s*(?:um\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?)?/giu,
    ),
  ];
  for (const m of single) {
    const port = (m[1] || '').trim();
    if (!port || /kreuzfahrt|schiff|hotel|flug/i.test(port)) continue;
    const arrive =
      m[2] != null
        ? `${String(m[2]).padStart(2, '0')}:${m[3] ?? '00'}`
        : null;
    const depart =
      m[4] != null
        ? `${String(m[4]).padStart(2, '0')}:${m[5] ?? '00'}`
        : null;
    out.push({
      dayKey,
      portName: port.slice(0, 40),
      arriveAt: arrive,
      departAt: depart,
    });
  }

  const list = t.match(
    /\b(?:häfen|haefen|hafenliste|zwischenhalte)\s*:?\s*([A-ZÄÖÜa-zäöüß,\s.-]{6,120})/iu,
  );
  if (list?.[1] && out.length === 0) {
    const parts = list[1]
      .split(/,| und |\/|\s+–\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3);
    let i = 0;
    for (const p of parts.slice(0, 8)) {
      try {
        const { offsetDateKey } = require('../../utils/dateKeys') as {
          offsetDateKey: (n: number) => string;
        };
        const base = embarkDayKey || dayKey;
        const dk = offsetDateKey
          ? (() => {
              const baseMs = Date.parse(`${base}T12:00:00`);
              const d = new Date(baseMs + (i + 1) * 86_400_000);
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })()
          : dayKey;
        out.push({ dayKey: dk, portName: p.slice(0, 40) });
        i += 1;
      } catch {
        out.push({ dayKey, portName: p.slice(0, 40) });
      }
    }
  }
  return out;
}

export function upsertHotelStammToTimeline(
  parsed: HotelStammParsed,
): { ok: boolean; speech: string; bullets: string[] } {
  const groupId = `hotel_stamm_${parsed.hotelName
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/giu, '_')
    .slice(0, 20)}`;
  const stops: FuturePlanStop[] = [];
  const addDays = (iso: string, n: number): string => {
    try {
      const t = Date.parse(`${iso}T12:00:00`) + n * 86_400_000;
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch {
      return iso;
    }
  };
  const checkoutDay =
    parsed.checkoutDayKey && /^\d{4}-\d{2}-\d{2}$/.test(parsed.checkoutDayKey)
      ? parsed.checkoutDayKey
      : parsed.checkInHm && Number(parsed.checkInHm.split(':')[0]) >= 12
        ? addDays(parsed.dayKey, 1)
        : parsed.dayKey;

  const ciMs = parsed.checkInHm
    ? hmToMs(parsed.dayKey, parsed.checkInHm)
    : null;
  if (ciMs != null) {
    stops.push({
      id: `${groupId}_checkin`,
      title: `Check-in · ${parsed.hotelName}`,
      plannedStartMs: ciMs,
      plannedEndMs: ciMs + 30 * 60_000,
      bufferMin: 15,
      transport: 'unknown',
      hardAnchor: true,
      userFixedTime: true,
      kind: 'stop',
      emoji: '🏨',
      groupId,
      groupLabel: parsed.hotelName,
      notes: 'Hotel Check-in',
      planPriority: 2,
    });
  }
  if (parsed.breakfast && parsed.breakfastHm) {
    // Frühstück an jedem Morgen zwischen Check-in-Folgetag und Check-out
    const firstBf =
      parsed.checkInHm && Number(parsed.checkInHm.split(':')[0]) >= 12
        ? addDays(parsed.dayKey, 1)
        : parsed.dayKey;
    let bfDay = firstBf;
    let guard = 0;
    while (guard < 14) {
      const bfMs = hmToMs(bfDay, parsed.breakfastHm);
      if (bfMs != null) {
        stops.push({
          id: `${groupId}_breakfast_${bfDay}`,
          title: `Frühstück · ${parsed.hotelName}`,
          plannedStartMs: bfMs,
          plannedEndMs: bfMs + 60 * 60_000,
          bufferMin: 10,
          transport: 'walk',
          kind: 'stop',
          emoji: '🥐',
          groupId,
          groupLabel: parsed.hotelName,
          notes: 'Hotel-Frühstück',
          planPriority: 4,
        });
      }
      if (bfDay >= checkoutDay) break;
      bfDay = addDays(bfDay, 1);
      guard += 1;
    }
  }
  if (parsed.checkOutHm) {
    const coMs = hmToMs(checkoutDay, parsed.checkOutHm);
    if (coMs != null) {
      stops.push({
        id: `${groupId}_checkout`,
        title: `Check-out · ${parsed.hotelName}`,
        plannedStartMs: coMs,
        plannedEndMs: coMs + 20 * 60_000,
        bufferMin: 10,
        transport: 'unknown',
        hardAnchor: true,
        userFixedTime: true,
        kind: 'stop',
        emoji: '🧳',
        groupId,
        groupLabel: parsed.hotelName,
        notes: 'Hotel Check-out',
        planPriority: 2,
      });
    }
  }

  let ok = false;
  for (const s of stops) {
    if (upsertFutureStopSafe(s)) ok = true;
  }
  try {
    const { requestOpenPlanCalendar } = require('./planCalendarUiStore') as {
      requestOpenPlanCalendar: () => void;
    };
    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }

  const bullets = [
    parsed.checkInHm ? `Check-in ${parsed.checkInHm}` : '',
    parsed.breakfast ? `Frühstück ${parsed.breakfastHm || ''}`.trim() : '',
    parsed.checkOutHm ? `Check-out ${parsed.checkOutHm}` : '',
  ].filter(Boolean);
  const speech = ok
    ? `Hab ${parsed.hotelName} in der Timeline: ${bullets.join(', ')}.`
    : `Die Hotel-Zeiten hab ich notiert — schau kurz in die Timeline.`;
  return { ok, speech, bullets: bullets.slice(0, 3) };
}

export function upsertCruiseGlanceToTimeline(opts: {
  portCity: string;
  embarkDate: string;
  disembarkDate: string;
  embarkLatestTime?: string | null;
  shipArriveTime?: string | null;
  portCalls?: CruisePortCall[] | null;
  shipName?: string | null;
  checkInStartHm?: string | null;
  checkInEndHm?: string | null;
  sailDepartHm?: string | null;
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
  stationLuggageDrop?: boolean;
  stationShuttle?: boolean;
  luggageLogisticsNote?: string | null;
}): { ok: boolean; speech: string; bullets: string[]; dayCount: number } {
  try {
    const { buildCruiseDayPlans } = require('../../reisebuero/research/cruisePlan') as {
      buildCruiseDayPlans: (o: Record<string, unknown>) => Array<{
        dayKey: string;
        title: string;
        blocks: Array<{ id: string; title: string; detail?: string; time?: string }>;
      }>;
    };
    const { stopsFromOptionDays } = require('../../reisebuero/timelineStopsFromOption') as {
      stopsFromOptionDays?: (days: unknown, ledger?: unknown) => FuturePlanStop[];
    };
    const days = buildCruiseDayPlans({
      portCity: opts.portCity,
      embarkDate: opts.embarkDate,
      disembarkDate: opts.disembarkDate,
      preNight: false,
      embarkLatestTime: opts.embarkLatestTime ?? null,
      shipArriveTime: opts.shipArriveTime ?? null,
      portCalls: opts.portCalls ?? [],
      checkInStartHm: opts.checkInStartHm ?? null,
      checkInEndHm: opts.checkInEndHm ?? null,
      sailDepartHm: opts.sailDepartHm ?? null,
      meals: opts.meals ?? [],
      mealFlexNote: opts.mealFlexNote ?? null,
      highlights: opts.highlights ?? [],
      stationLuggageDrop: opts.stationLuggageDrop === true,
      stationShuttle: opts.stationShuttle === true,
      luggageLogisticsNote: opts.luggageLogisticsNote ?? null,
    });

    let stops: FuturePlanStop[] = [];
    if (typeof stopsFromOptionDays === 'function') {
      stops = stopsFromOptionDays(days, null) || [];
    } else {
      // Fallback: direkte Stops aus DayPlans
      const groupId = `cruise_${opts.portCity
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '_')
        .slice(0, 16)}`;
      for (const day of days) {
        for (const b of day.blocks) {
          const hm = (b.time || '09:00').slice(0, 5);
          const ms = hmToMs(day.dayKey, /^\d{1,2}:\d{2}$/.test(hm) ? hm : '09:00');
          if (ms == null) continue;
          stops.push({
            id: `${groupId}_${b.id}`,
            title: b.title,
            plannedStartMs: ms,
            plannedEndMs: ms + 45 * 60_000,
            bufferMin: 15,
            transport: /schiff|einschiff|ausschiff|hafen|ablegen|check[\s-]?in/i.test(b.title)
              ? 'unknown'
              : 'walk',
            kind: 'stop',
            emoji: /einschiff|schiff|check/i.test(b.title) ? '🚢' : '⚓',
            groupId,
            groupLabel: opts.shipName || `Kreuzfahrt ${opts.portCity}`,
            notes: b.detail,
            hardAnchor: /einschiff|ausschiff|ablegen|schiff an|check[\s-]?in/i.test(b.title),
            userFixedTime: Boolean(b.time),
            planPriority: 2,
          });
        }
      }
    }

    const groupId = `cruise_${opts.portCity
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '_')
      .slice(0, 16)}`;
    stops = stops.map((s) => ({
      ...s,
      groupId: s.groupId || groupId,
      groupLabel: s.groupLabel || opts.shipName || `Kreuzfahrt ${opts.portCity}`,
    }));

    let ok = false;
    for (const s of stops) {
      if (upsertFutureStopSafe(s)) ok = true;
    }
    try {
      const { requestOpenPlanCalendar } = require('./planCalendarUiStore') as {
        requestOpenPlanCalendar: () => void;
      };
      requestOpenPlanCalendar();
    } catch {
      /* soft */
    }

    const line = opts.shipName || `Kreuzfahrt ${opts.portCity}`;
    const portN = opts.portCalls?.length ?? 0;
    const luggageNote = (opts.luggageLogisticsNote || '').trim();
    const bullets = [
      opts.checkInStartHm
        ? `Check-in ${opts.checkInStartHm}${opts.checkInEndHm ? `–${opts.checkInEndHm}` : ''}`
        : '',
      opts.stationLuggageDrop
        ? 'Gepäckabgabe Bahnhof'
        : opts.stationShuttle
          ? 'Shuttle Bahnhof→Terminal'
          : '',
      `Einschiffen ${opts.embarkDate}${opts.embarkLatestTime ? ` ${opts.embarkLatestTime}` : ''}`,
      opts.sailDepartHm ? `Abfahrt ${opts.sailDepartHm}` : '',
      portN ? `${portN} Zwischenhafen${portN > 1 ? 'e' : ''}` : '',
      `Ausschiffen ${opts.disembarkDate}${opts.shipArriveTime ? ` ${opts.shipArriveTime}` : ''}`,
    ].filter(Boolean);
    const speechCore = ok
      ? `${line} ab ${opts.portCity} liegt in der Timeline — Check-in, Einschiffen, Häfen und Ausschiffen auf einen Blick.`
      : `Kreuzfahrt-Plan notiert — Timeline kurz prüfen.`;
    const speechLuggage = luggageNote
      ? ` ${luggageNote}`
      : opts.stationLuggageDrop || opts.stationShuttle
        ? ' Gepäckabgabe am Bahnhof und Shuttle zum Terminal sind mit drauf, soweit belegt.'
        : '';
    return {
      ok,
      speech: `${speechCore}${speechLuggage}`.trim(),
      bullets: bullets.slice(0, 4),
      dayCount: days.length,
    };
  } catch (err) {
    console.warn('[travelSchedule] cruise glance failed', err);
    return {
      ok: false,
      speech: 'Kreuzfahrt-Zeiten konnte ich gerade nicht eintragen.',
      bullets: [],
      dayCount: 0,
    };
  }
}

/** Soft: „Bahn nach Kiel“ → Query, die Transit/Journey erkennt. */
export function normalizeTrainScheduleQuery(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  if (/\b(verbindung|fahrplan|abfahrt|wann\s+fährt|wann\s+faehrt)\b/iu.test(t)) {
    return t;
  }
  if (/\b(?:bahn|zug|ice|ic\b|re\b|rb\b)\b/iu.test(t) && /\bnach\b/iu.test(t)) {
    return `Verbindung ${t}`;
  }
  return t;
}

/**
 * Bahn/ÖPNV: prepareTransitFollowUp → rememberJourneyForStart → Timeline.
 */
export async function tryTrainScheduleToTimeline(opts: {
  userText: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<{
  ok: boolean;
  speech: string;
  bullets: string[];
  destName?: string;
} | null> {
  const text = String(opts.userText || '').trim();
  if (!looksLikeTrainScheduleWrite(text)) return null;
  try {
    const { prepareTransitFollowUp } = require('../../services/transit/transitAdvisor') as {
      prepareTransitFollowUp: (t: string) => Promise<{
        advice: {
          destinationHint?: string | null;
          stationName?: string;
          walkMinutes?: number | null;
          arrivalLabel?: string | null;
          departures?: Array<{ line?: string; when?: Date }>;
        };
        reply: string;
        offerNavigation: boolean;
      } | null>;
    };
    const query = normalizeTrainScheduleQuery(text);
    const follow = await prepareTransitFollowUp(query);
    if (!follow) {
      try {
        const { explainDestinationJourneyMiss } = require('../../services/transit/transitAdvisor') as {
          explainDestinationJourneyMiss: (t: string) => Promise<{
            speech: string;
            bullets: string[];
          }>;
        };
        const miss = await explainDestinationJourneyMiss(text);
        return { ok: false, speech: miss.speech, bullets: miss.bullets };
      } catch {
        return {
          ok: false,
          speech:
            'Keine passende Verbindung gefunden — Uhrzeit oder Ziel nochmal klar sagen, dann trage ich sie ein.',
          bullets: [],
        };
      }
    }
    try {
      const { requestOpenPlanCalendar } = require('./planCalendarUiStore') as {
        requestOpenPlanCalendar: () => void;
      };
      requestOpenPlanCalendar();
    } catch {
      /* soft */
    }
    const dep = follow.advice.departures?.[0];
    const depLabel =
      dep?.when instanceof Date
        ? `${String(dep.when.getHours()).padStart(2, '0')}:${String(dep.when.getMinutes()).padStart(2, '0')}`
        : null;
    const bullets = [
      dep?.line && depLabel ? `${dep.line} ${depLabel}` : dep?.line || '',
      follow.advice.arrivalLabel ? `→ ${follow.advice.arrivalLabel}` : '',
      follow.advice.stationName ? `ab ${follow.advice.stationName}` : '',
    ].filter(Boolean);
    const speech = /timeline|eingetragen|kalender/i.test(follow.reply)
      ? follow.reply
      : `${follow.reply} Liegt in der Timeline.`;
    return {
      ok: true,
      speech,
      bullets: bullets.slice(0, 3),
      destName: follow.advice.destinationHint || undefined,
    };
  } catch (err) {
    console.warn('[travelSchedule] train failed', err);
    return null;
  }
}

type ScheduleHardenResult = {
  kind: TravelScheduleKind;
  ok: boolean;
  speech: string;
  bullets: string[];
  actions?: Array<{
    type: string;
    label: string;
    payload: Record<string, unknown>;
  }>;
};

async function runOneTravelScheduleKind(
  kind: NonNullable<TravelScheduleKind>,
  opts: {
    userText: string;
    lat?: number | null;
    lng?: number | null;
    cityHint?: string | null;
  },
): Promise<ScheduleHardenResult | null> {
  if (kind === 'hotel_stamm') {
    let parsed = parseHotelStammFromText(opts.userText);
    let actions: NonNullable<ScheduleHardenResult['actions']> = [];
    let speechExtra = '';
    try {
      const { enrichHotelStammEvidence } = require('./travelHotelCruiseEnrich') as {
        enrichHotelStammEvidence: (o: {
          parsed: HotelStammParsed;
          userText: string;
          cityHint?: string | null;
        }) => Promise<{
          parsed: HotelStammParsed;
          actions: NonNullable<ScheduleHardenResult['actions']>;
          speechExtra: string;
        }>;
      };
      const en = await enrichHotelStammEvidence({
        parsed,
        userText: opts.userText,
        cityHint: opts.cityHint,
      });
      parsed = en.parsed;
      actions = en.actions;
      speechExtra = en.speechExtra;
    } catch (err) {
      console.warn('[travelSchedule] hotel enrich soft-fail', err);
    }
    const r = upsertHotelStammToTimeline(parsed);
    return {
      kind,
      ok: r.ok,
      speech: speechExtra ? `${r.speech} ${speechExtra}`.trim() : r.speech,
      bullets: [...r.bullets, ...actions.map((a) => a.label)].slice(0, 3),
      actions,
    };
  }

  if (kind === 'cruise_glance') {
    let cruiseText = opts.userText;
    try {
      const { repairCruiseVoiceText } = require('../../services/stt/cruiseVoiceRepair') as {
        repairCruiseVoiceText: (s: string) => string;
      };
      cruiseText = repairCruiseVoiceText(opts.userText) || opts.userText;
    } catch {
      cruiseText = opts.userText;
    }
    const embark = dayKeyFromText(cruiseText);
    let disembark = embark;
    try {
      const t = Date.parse(`${embark}T12:00:00`) + 7 * 86_400_000;
      const d = new Date(t);
      disembark = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch {
      /* soft */
    }
    let portCity =
      (() => {
        try {
          const { cruisePortCityFromText } = require('../../services/stt/cruiseVoiceRepair') as {
            cruisePortCityFromText: (s: string) => string | null;
          };
          return cruisePortCityFromText(cruiseText);
        } catch {
          return null;
        }
      })() ||
      cruiseText.match(
        /\b(?:ab|von|in|nach|bei)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})/u,
      )?.[1] ||
      'Hafen';
    if (/^(cruise|center|schiff|kreuzfahrt|terminal|hafen)$/i.test(portCity)) {
      portCity = 'Hafen';
    }
    let ports = parseCruisePortsFromText(cruiseText, embark);
    const embarkHm = cruiseText.match(
      /\beinschiff(?:en)?\s*(?:um\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?/iu,
    );
    const arriveHm = cruiseText.match(
      /\b(?:ausschiff|ankunft)\s*(?:um\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?/iu,
    );
    let embarkLatestTime = embarkHm
      ? `${String(embarkHm[1]).padStart(2, '0')}:${embarkHm[2] ?? '00'}`
      : null;
    let shipArriveTime = arriveHm
      ? `${String(arriveHm[1]).padStart(2, '0')}:${arriveHm[2] ?? '00'}`
      : null;
    let actions: NonNullable<ScheduleHardenResult['actions']> = [];
    let speechExtra = '';
    try {
      const { enrichCruiseGlanceEvidence } = require('./travelHotelCruiseEnrich') as {
        enrichCruiseGlanceEvidence: (o: {
          userText: string;
          portCity: string;
          embarkDate: string;
          disembarkDate: string;
          embarkLatestTime: string | null;
          shipArriveTime: string | null;
          portCalls: CruisePortCall[];
        }) => Promise<{
          portCity: string;
          embarkDate: string;
          disembarkDate: string;
          embarkLatestTime: string | null;
          shipArriveTime: string | null;
          portCalls: CruisePortCall[];
          checkInStartHm: string | null;
          checkInEndHm: string | null;
          sailDepartHm: string | null;
          meals: Array<{
            kind: 'breakfast' | 'lunch' | 'dinner';
            startHm: string | null;
            endHm?: string | null;
          }>;
          mealFlexNote: string | null;
          highlights: Array<{ title: string; detail?: string | null }>;
          shipName: string | null;
          luggageLogistics: {
            stationDropOff: boolean;
            stationShuttle: boolean;
            railAndCruise: boolean;
            note: string | null;
          } | null;
          actions: NonNullable<ScheduleHardenResult['actions']>;
          speechExtra: string;
        }>;
      };
      const en = await enrichCruiseGlanceEvidence({
        userText: cruiseText,
        portCity,
        embarkDate: embark,
        disembarkDate: disembark,
        embarkLatestTime,
        shipArriveTime,
        portCalls: ports,
      });
      portCity = en.portCity;
      disembark = en.disembarkDate;
      embarkLatestTime = en.embarkLatestTime;
      shipArriveTime = en.shipArriveTime;
      ports = en.portCalls;
      actions = en.actions;
      speechExtra = en.speechExtra;
      const embarkDate = en.embarkDate || embark;
      const luggage = en.luggageLogistics;
      const r = upsertCruiseGlanceToTimeline({
        portCity,
        embarkDate,
        disembarkDate: disembark,
        embarkLatestTime,
        shipArriveTime,
        portCalls: ports,
        shipName: en.shipName,
        checkInStartHm: en.checkInStartHm,
        checkInEndHm: en.checkInEndHm,
        sailDepartHm: en.sailDepartHm,
        meals: en.meals,
        mealFlexNote: en.mealFlexNote,
        highlights: en.highlights,
        stationLuggageDrop: luggage?.stationDropOff === true,
        stationShuttle: luggage?.stationShuttle === true,
        luggageLogisticsNote: luggage?.note ?? null,
      });
      return {
        kind,
        ok: r.ok,
        speech: speechExtra ? `${r.speech} ${speechExtra}`.trim() : r.speech,
        bullets: [...r.bullets, ...actions.map((a) => a.label)].slice(0, 4),
        actions,
      };
    } catch (err) {
      console.warn('[travelSchedule] cruise enrich soft-fail', err);
    }
    const r = upsertCruiseGlanceToTimeline({
      portCity,
      embarkDate: embark,
      disembarkDate: disembark,
      embarkLatestTime,
      shipArriveTime,
      portCalls: ports,
    });
    return { kind, ok: r.ok, speech: r.speech, bullets: r.bullets, actions };
  }

  if (kind === 'train') {
    const r = await tryTrainScheduleToTimeline(opts);
    if (!r) return null;
    return { kind, ok: r.ok, speech: r.speech, bullets: r.bullets };
  }

  if (kind === 'flight' || kind === 'flixbus' || kind === 'event') {
    try {
      const extra = await import('./travelScheduleExtra');
      if (kind === 'flight') {
        const r = await extra.tryFlightScheduleToTimeline({
          userText: opts.userText,
        });
        if (!r) return null;
        return {
          kind,
          ok: r.ok,
          speech: r.speech,
          bullets: r.bullets,
          actions: r.actions as ScheduleHardenResult['actions'],
        };
      }
      if (kind === 'flixbus') {
        const r = await extra.tryFlixBusScheduleToTimeline({
          userText: opts.userText,
          cityHint: opts.cityHint,
        });
        if (!r) return null;
        return {
          kind,
          ok: r.ok,
          speech: r.speech,
          bullets: r.bullets,
          actions: r.actions as ScheduleHardenResult['actions'],
        };
      }
      const r = await extra.tryEventScheduleToTimeline({
        userText: opts.userText,
        cityHint: opts.cityHint,
      });
      if (!r) return null;
      return {
        kind,
        ok: r.ok,
        speech: r.speech,
        bullets: r.bullets,
        actions: r.actions as ScheduleHardenResult['actions'],
      };
    } catch (err) {
      console.warn('[travelSchedule] extra kind failed', kind, err);
      return null;
    }
  }

  if (kind === 'packlist') {
    try {
      const { tryPackListToTimeline } = await import('./packListHarden');
      const r = await tryPackListToTimeline(opts);
      if (!r) return null;
      return {
        kind,
        ok: r.ok,
        speech: r.speech,
        bullets: r.bullets,
        actions: r.actions as ScheduleHardenResult['actions'],
      };
    } catch (err) {
      console.warn('[travelSchedule] packlist failed', err);
      return null;
    }
  }

  return null;
}

/**
 * Call-1 schedule_write — alle erkannten Kinds (Hotel+Flug+Bus+…) lückenlos
 * nacheinander in die Timeline, nur mit Belegen.
 */
export async function runTravelScheduleHarden(opts: {
  userText: string;
  lat?: number | null;
  lng?: number | null;
  cityHint?: string | null;
  /** Compound: Nav + Timeline, auch ohne „trag ein“. */
  forceKinds?: TravelScheduleKind[] | null;
}): Promise<
  (ScheduleHardenResult & { kinds?: TravelScheduleKind[] }) | null
> {
  const kinds = opts.forceKinds?.length
    ? opts.forceKinds.filter(Boolean)
    : detectAllTravelScheduleKinds(opts.userText);
  if (!kinds.length) return null;

  const parts: ScheduleHardenResult[] = [];
  for (const kind of kinds) {
    if (!kind) continue;
    try {
      const r = await runOneTravelScheduleKind(kind, opts);
      if (r) parts.push(r);
    } catch (err) {
      console.warn('[travelSchedule] kind failed', kind, err);
    }
  }
  if (!parts.length) return null;

  const actions = parts.flatMap((p) => p.actions || []).slice(0, 5);
  const bullets = parts.flatMap((p) => p.bullets).slice(0, 6);
  const speech = parts
    .map((p) => p.speech)
    .filter(Boolean)
    .join(' ');
  return {
    kind: parts[0]!.kind,
    kinds,
    ok: parts.some((p) => p.ok),
    speech,
    bullets,
    actions: actions.length ? actions : undefined,
  };
}
