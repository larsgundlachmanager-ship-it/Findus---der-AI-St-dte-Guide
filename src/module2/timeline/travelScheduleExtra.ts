/**
 * Extra Timeline-Kinds: Flug / FlixBus / Event — Research → belegte Stops.
 * Keine Fake-Zeiten; Fan-out über travelScheduleHarden.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { QuickAction } from '../../types/concierge';
import type { FuturePlanStop } from './futurePlanState';
import { upsertFutureStopSafe } from './planNowGuard';

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

function clockFromBlob(blob: string): string | null {
  try {
    const { extractSpokenClock } = require('../../services/research/extractSpokenClock') as {
      extractSpokenClock: (s: string) => string | null;
    };
    return extractSpokenClock(blob);
  } catch {
    const m = blob.match(/\b(\d{1,2})[:.](\d{2})\b/);
    if (!m) return null;
    const h = Number(m[1]);
    if (h > 23) return null;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
}

function openCalendarSoft(): void {
  try {
    const { requestOpenPlanCalendar } = require('./planCalendarUiStore') as {
      requestOpenPlanCalendar: () => void;
    };
    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }
}

function upsertStops(stops: FuturePlanStop[]): boolean {
  let ok = false;
  for (const s of stops) {
    if (upsertFutureStopSafe(s)) ok = true;
  }
  if (ok) openCalendarSoft();
  return ok;
}

export function hasScheduleWriteSignal(text: string): boolean {
  return /\b(trag|eintragen|hinzufüg|timeline|kalender|terminkalender|notier|speicher|rein\s+damit)\b/iu.test(
    String(text || ''),
  );
}

/** Flug + Timeline-Write (nicht reiner flight_only-Pitch). */
export function looksLikeFlightScheduleWrite(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const flight =
    /\b(flug|fliegen|abflug|boarding|gate\b|flughafen)\b/iu.test(t) ||
    /\b[A-Z]{1,3}\s?\d{2,4}[A-Z]?\b/.test(t);
  if (!flight) return false;
  return (
    hasScheduleWriteSignal(t) ||
    /\b(check[\s-]?in|boarding|abflugzeit|ankunftszeit)\b/iu.test(t)
  );
}

/** FlixBus / Fernbus → Timeline. */
export function looksLikeFlixBusScheduleWrite(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const bus =
    /\b(flix\s*bus|fernbus|reisebus)\b/iu.test(t) ||
    (/\bbus\b/iu.test(t) && /\b(nach|von)\b/iu.test(t) && !/\b(bahn|zug|öpnv|oepnv)\b/iu.test(t));
  if (!bus) return false;
  return (
    hasScheduleWriteSignal(t) ||
    /\b(abfahrt|ankunft|verbindung|ticket)\b/iu.test(t)
  );
}

/** Event / Konzert / Festival / Kino → Timeline. */
export function looksLikeEventScheduleWrite(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const ev =
    /\b(konzert|festival|festival|theater|kino|vorstellung|match|spiel|party|event|auftakt|einlass)\b/iu.test(
      t,
    );
  if (!ev) return false;
  return (
    hasScheduleWriteSignal(t) ||
    /\b(einlass|beginn|startet|um\s+\d|ticket)\b/iu.test(t)
  );
}

export function parseFlightIdentFromText(text: string): string | null {
  const m = String(text || '').match(/\b([A-Z]{1,3})\s?(\d{2,4}[A-Z]?)\b/);
  if (!m) return null;
  const ident = `${m[1]}${m[2]}`.toUpperCase();
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(ident)) return null;
  if (/^(ICE|IC|RE|RB|S|U|BUS|PDF)$/i.test(m[1]!)) return null;
  return ident;
}

export function parseCityPairFromText(text: string): {
  origin: string | null;
  dest: string | null;
} {
  const t = String(text || '');
  const vonNach = t.match(
    /\b(?:von|ab)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})\s+(?:nach|Richtung|richtung)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})/u,
  );
  if (vonNach) return { origin: vonNach[1]!, dest: vonNach[2]! };
  const nach = t.match(/\bnach\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})/u);
  return { origin: null, dest: nach?.[1] || null };
}

export function extractFlightSlotsFromBlob(blob: string): {
  checkInHm: string | null;
  boardingHm: string | null;
  departHm: string | null;
  arriveHm: string | null;
  destLabel: string | null;
  gate: string | null;
} {
  const t = String(blob || '').replace(/\s+/g, ' ');
  const checkInHm =
    clockFromBlob(
      t.match(/\bcheck[\s-]?in\b[^.]{0,40}?((?:ab|um|from)?\s*\d{1,2}(?:[:.]\d{2})?)/iu)?.[1] ||
        '',
    ) || null;
  const boardingHm =
    clockFromBlob(
      t.match(/\bboarding\b[^.]{0,40}?((?:ab|um|from)?\s*\d{1,2}(?:[:.]\d{2})?)/iu)?.[1] || '',
    ) || null;
  const departHm =
    clockFromBlob(
      t.match(
        /\b(?:abflug|departure|startet)\b[^.]{0,40}?((?:um|ab|at)?\s*\d{1,2}(?:[:.]\d{2})?)/iu,
      )?.[1] || '',
    ) || null;
  const arriveHm =
    clockFromBlob(
      t.match(
        /\b(?:ankunft|arrival|landet)\b[^.]{0,40}?((?:um|ab|at)?\s*\d{1,2}(?:[:.]\d{2})?)/iu,
      )?.[1] || '',
    ) || null;
  const dest =
    t.match(/\b(?:nach|to)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})/u)?.[1] || null;
  const gate = t.match(/\bgate\s*([A-Z]?\d{1,3}[A-Z]?)\b/i)?.[1] || null;
  return { checkInHm, boardingHm, departHm, arriveHm, destLabel: dest, gate };
}

export function extractBusSlotsFromBlob(blob: string): {
  departHm: string | null;
  arriveHm: string | null;
  durationNote: string | null;
} {
  const t = String(blob || '').replace(/\s+/g, ' ');
  const departHm =
    clockFromBlob(
      t.match(
        /\b(?:abfahrt|departure|fährt|faehrt)\b[^.]{0,40}?((?:um|ab)?\s*\d{1,2}(?:[:.]\d{2})?)/iu,
      )?.[1] || '',
    ) || null;
  const arriveHm =
    clockFromBlob(
      t.match(
        /\b(?:ankunft|arrival|ankommt)\b[^.]{0,40}?((?:um|ab)?\s*\d{1,2}(?:[:.]\d{2})?)/iu,
      )?.[1] || '',
    ) || null;
  const dur = t.match(/\b(\d{1,2})\s*(?:h|std|stunden)(?:\s*(\d{1,2})\s*min)?/iu);
  const durationNote = dur
    ? `${dur[1]}h${dur[2] ? ` ${dur[2]}min` : ''}`
    : null;
  return { departHm, arriveHm, durationNote };
}

export function extractEventSlotsFromBlob(blob: string): {
  startHm: string | null;
  doorsHm: string | null;
  title: string | null;
  venue: string | null;
  ticketUrl: string | null;
} {
  const t = String(blob || '').replace(/\s+/g, ' ');
  const startHm =
    clockFromBlob(
      t.match(
        /\b(?:beginn|start|startet|um)\b[^.]{0,24}?(\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?)/iu,
      )?.[1] || '',
    ) ||
    clockFromBlob(t) ||
    null;
  const doorsHm =
    clockFromBlob(
      t.match(/\b(?:einlass|doors?\s*open)\b[^.]{0,24}?(\d{1,2}(?:[:.]\d{2})?)/iu)?.[1] ||
        '',
    ) || null;
  const venue =
    t.match(/\b(?:in|im|at)\s+(?:der\s+|dem\s+)?([A-ZÄÖÜ][\wÄÖÜäöüß.\s-]{3,40})/u)?.[1]
      ?.trim()
      ?.slice(0, 40) || null;
  const title =
    t.match(
      /\b((?:Konzert|Festival|Theater|Kino|Party|Match|Spiel)\s+[A-Za-zÄÖÜäöüß0-9][\wÄÖÜäöüß.\s-]{2,40})/u,
    )?.[1]
      ?.trim()
      ?.slice(0, 48) || null;
  const ticketUrl =
    t.match(/https?:\/\/[^\s]+\b(?:ticket|eventim|reservix|eventbrite)[^\s]*/i)?.[0] ||
    null;
  return { startHm, doorsHm, title, venue, ticketUrl };
}

export async function tryFlightScheduleToTimeline(opts: {
  userText: string;
}): Promise<{
  ok: boolean;
  speech: string;
  bullets: string[];
  actions: QuickAction[];
} | null> {
  const text = opts.userText;
  if (!looksLikeFlightScheduleWrite(text)) return null;
  const dayKey = dayKeyFromText(text);
  const ident = parseFlightIdentFromText(text);
  const pair = parseCityPairFromText(text);
  const voiceClock = clockFromBlob(text);
  const evidenceNotes: string[] = [];
  const actions: QuickAction[] = [];
  let checkInHm: string | null = null;
  let boardingHm: string | null = null;
  let departHm: string | null = voiceClock;
  let arriveHm: string | null = null;
  let destLabel = pair.dest || 'Flug';
  let gate: string | null = null;
  let flightIdent = ident || 'FLIGHT';

  if (ident) {
    try {
      const { fetchFlightByIdent } = await import(
        '../../services/flights/FlightTrackingService'
      );
      const live = await fetchFlightByIdent(ident, { dateKey: dayKey });
      if (live) {
        flightIdent = live.ident || ident;
        destLabel =
          live.destinationName?.split('/')[0]?.trim() ||
          live.destinationCode ||
          destLabel;
        const dep = live.estimatedDeparture ?? live.scheduledDeparture;
        const arr = live.estimatedArrival ?? live.scheduledArrival;
        if (dep) {
          departHm = `${String(dep.getHours()).padStart(2, '0')}:${String(dep.getMinutes()).padStart(2, '0')}`;
          evidenceNotes.push(`Abflug ${departHm} (Live)`);
        }
        if (arr) {
          arriveHm = `${String(arr.getHours()).padStart(2, '0')}:${String(arr.getMinutes()).padStart(2, '0')}`;
          evidenceNotes.push(`Ankunft ${arriveHm} (Live)`);
        }
        gate = live.departureGate || null;
        const boardMin = live.boardingWindowMin || 40;
        if (dep) {
          const b = new Date(dep.getTime() - boardMin * 60_000);
          boardingHm = `${String(b.getHours()).padStart(2, '0')}:${String(b.getMinutes()).padStart(2, '0')}`;
          const c = new Date(dep.getTime() - (boardMin + 45) * 60_000);
          checkInHm = `${String(c.getHours()).padStart(2, '0')}:${String(c.getMinutes()).padStart(2, '0')}`;
        }
      }
    } catch {
      /* soft — Research-Fallback */
    }
  }

  if (!departHm || !boardingHm) {
    try {
      const { runWebResearch } = await import('../../services/research/webResearchService');
      const q = [
        ident || 'Flug',
        pair.origin,
        pair.dest ? `nach ${pair.dest}` : '',
        dayKey,
        'Abflug Boarding Check-in Ankunft Gate',
      ]
        .filter(Boolean)
        .join(' ');
      const web = await runWebResearch(q, { force: true });
      const blob = [
        web?.speechHint,
        ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
      ]
        .filter(Boolean)
        .join(' · ');
      const slots = extractFlightSlotsFromBlob(blob);
      checkInHm = checkInHm || slots.checkInHm;
      boardingHm = boardingHm || slots.boardingHm;
      departHm = departHm || slots.departHm || voiceClock;
      arriveHm = arriveHm || slots.arriveHm;
      destLabel = slots.destLabel || destLabel;
      gate = gate || slots.gate;
      const src = web?.sources?.[0]?.url;
      if (src) {
        actions.push({
          type: 'OPEN_URL',
          label: '✈️ Flug-Info',
          payload: { url: src },
        });
      }
      if (slots.departHm) evidenceNotes.push(`Abflug ${slots.departHm} (belegt)`);
    } catch {
      /* soft */
    }
  }

  if (!departHm && !boardingHm && !checkInHm) {
    return {
      ok: false,
      speech:
        'Flugzeiten hab ich noch nicht belegt — Flugnummer oder Abflugzeit nennen, dann trag ich Check-in, Boarding und Abflug ein.',
      bullets: [],
      actions,
    };
  }

  const groupId = `flight_${flightIdent.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 16)}`;
  const stops: FuturePlanStop[] = [];
  const push = (id: string, title: string, hm: string, emoji: string, hard: boolean) => {
    const ms = hmToMs(dayKey, hm);
    if (ms == null) return;
    stops.push({
      id: `${groupId}_${id}`,
      title,
      plannedStartMs: ms,
      plannedEndMs: ms + 30 * 60_000,
      bufferMin: 15,
      transport: 'unknown',
      hardAnchor: hard,
      userFixedTime: true,
      kind: 'stop',
      emoji,
      groupId,
      groupLabel: `${flightIdent} · ${destLabel}`,
      notes: gate && id === 'board' ? `Gate ${gate}` : undefined,
      planPriority: 2,
      badge: gate && id === 'board' ? `Gate ${gate}` : null,
    });
  };
  if (checkInHm) push('checkin', `Check-in · ${flightIdent}`, checkInHm, '🧳', true);
  if (boardingHm) push('board', `Boarding · ${flightIdent}`, boardingHm, '🛂', true);
  if (departHm) push('dep', `Abflug · ${destLabel}`, departHm, '✈️', true);
  if (arriveHm) push('arr', `Ankunft · ${destLabel}`, arriveHm, '🛬', true);

  const ok = upsertStops(stops);
  const bullets = [
    checkInHm ? `Check-in ${checkInHm}` : '',
    boardingHm ? `Boarding ${boardingHm}` : '',
    departHm ? `Abflug ${departHm}` : '',
    arriveHm ? `Ankunft ${arriveHm}` : '',
  ].filter(Boolean);
  return {
    ok,
    speech: ok
      ? `Flug ${flightIdent} nach ${destLabel} liegt in der Timeline${evidenceNotes[0] ? ` — ${evidenceNotes[0]}` : ''}.`
      : 'Flugzeiten notiert — Timeline kurz prüfen.',
    bullets: bullets.slice(0, 4),
    actions: actions.slice(0, 2),
  };
}

export async function tryFlixBusScheduleToTimeline(opts: {
  userText: string;
  cityHint?: string | null;
}): Promise<{
  ok: boolean;
  speech: string;
  bullets: string[];
  actions: QuickAction[];
} | null> {
  const text = opts.userText;
  if (!looksLikeFlixBusScheduleWrite(text)) return null;
  const dayKey = dayKeyFromText(text);
  const pair = parseCityPairFromText(text);
  const origin = pair.origin || opts.cityHint || 'Start';
  const dest = pair.dest || 'Ziel';
  const voiceClock = clockFromBlob(text);
  let departHm: string | null = voiceClock;
  let arriveHm: string | null = null;
  const evidenceNotes: string[] = [];
  const actions: QuickAction[] = [];

  try {
    const { buildFlixBusSearchUrl } = await import(
      '../../reisebuero/research/surfaceLiveFares'
    );
    const url = buildFlixBusSearchUrl({
      originCity: origin,
      destCity: dest,
      checkin: dayKey,
      adults: 1,
    });
    actions.push({
      type: 'OPEN_URL',
      label: '🚌 FlixBus buchen',
      payload: { url },
    });
  } catch {
    /* soft */
  }

  try {
    const { runWebResearch } = await import('../../services/research/webResearchService');
    const q = `FlixBus ${origin} nach ${dest} ${dayKey} Abfahrt Ankunft Fahrzeit`;
    const web = await runWebResearch(q, { force: true });
    const blob = [
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
    ]
      .filter(Boolean)
      .join(' · ');
    const slots = extractBusSlotsFromBlob(blob);
    departHm = departHm || slots.departHm;
    arriveHm = arriveHm || slots.arriveHm;
    if (slots.departHm) evidenceNotes.push(`Abfahrt ${slots.departHm} (belegt)`);
    if (slots.arriveHm) evidenceNotes.push(`Ankunft ${slots.arriveHm} (belegt)`);
    if (slots.durationNote) evidenceNotes.push(slots.durationNote);
  } catch {
    /* soft */
  }

  if (!departHm) {
    return {
      ok: false,
      speech:
        actions.length
          ? `FlixBus ${origin}→${dest}: Buchungslink liegt bereit — genaue Abfahrt noch nicht belegt.`
          : `FlixBus ${origin}→${dest}: Abfahrt noch nicht belegt.`,
      bullets: actions.map((a) => a.label).slice(0, 2),
      actions,
    };
  }

  const groupId = `flix_${origin}_${dest}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .slice(0, 24);
  const stops: FuturePlanStop[] = [];
  const depMs = hmToMs(dayKey, departHm);
  if (depMs != null) {
    stops.push({
      id: `${groupId}_dep`,
      title: `FlixBus · ${origin} → ${dest}`,
      plannedStartMs: depMs,
      plannedEndMs: depMs + 15 * 60_000,
      bufferMin: 20,
      transport: 'transit',
      hardAnchor: true,
      userFixedTime: true,
      kind: 'stop',
      emoji: '🚌',
      groupId,
      groupLabel: `FlixBus ${origin}→${dest}`,
      notes: evidenceNotes.join(' · ') || undefined,
      planPriority: 2,
    });
  }
  if (arriveHm) {
    const arrMs = hmToMs(dayKey, arriveHm);
    if (arrMs != null) {
      stops.push({
        id: `${groupId}_arr`,
        title: `Ankunft FlixBus · ${dest}`,
        plannedStartMs: arrMs,
        plannedEndMs: arrMs + 15 * 60_000,
        bufferMin: 10,
        transport: 'transit',
        hardAnchor: true,
        userFixedTime: true,
        kind: 'stop',
        emoji: '🚏',
        groupId,
        groupLabel: `FlixBus ${origin}→${dest}`,
        planPriority: 2,
      });
    }
  }

  const ok = upsertStops(stops);
  return {
    ok: ok || actions.length > 0,
    speech: ok
      ? `FlixBus ${origin}→${dest} liegt in der Timeline${departHm ? ` — Abfahrt ${departHm}` : ''}.`
      : `FlixBus ${origin}→${dest}: Link bereit, Zeiten noch dünn.`,
    bullets: [
      departHm ? `Abfahrt ${departHm}` : '',
      arriveHm ? `Ankunft ${arriveHm}` : '',
      ...actions.map((a) => a.label),
    ]
      .filter(Boolean)
      .slice(0, 4),
    actions: actions.slice(0, 2),
  };
}

export async function tryEventScheduleToTimeline(opts: {
  userText: string;
  cityHint?: string | null;
}): Promise<{
  ok: boolean;
  speech: string;
  bullets: string[];
  actions: QuickAction[];
} | null> {
  const text = opts.userText;
  if (!looksLikeEventScheduleWrite(text)) return null;
  const dayKey = dayKeyFromText(text);
  const voiceClock = clockFromBlob(text);
  const actions: QuickAction[] = [];
  let startHm: string | null = voiceClock;
  let doorsHm: string | null = null;
  let title: string | null = null;
  let venue: string | null = null;

  try {
    const { runWebResearch } = await import('../../services/research/webResearchService');
    const q = [
      text.slice(0, 120),
      opts.cityHint,
      'Beginn Einlass Ticket Ort',
    ]
      .filter(Boolean)
      .join(' ');
    const web = await runWebResearch(q, { force: true });
    const blob = [
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
      ...(web?.sources ?? []).map((s) => `${s.title} ${s.url}`),
    ]
      .filter(Boolean)
      .join(' · ');
    const slots = extractEventSlotsFromBlob(blob);
    startHm = startHm || slots.startHm;
    doorsHm = doorsHm || slots.doorsHm;
    title = slots.title || title;
    venue = slots.venue || venue;
    if (slots.ticketUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: '🎟️ Tickets',
        payload: { url: slots.ticketUrl },
      });
    } else {
      const shop = (web?.sources ?? []).find((s) =>
        /ticket|eventim|reservix|official/i.test(`${s.url} ${s.title}`),
      );
      if (shop?.url) {
        actions.push({
          type: 'OPEN_URL',
          label: '🎟️ Event-Info',
          payload: { url: shop.url },
        });
      }
    }
  } catch {
    /* soft */
  }

  // Voice title soft
  if (!title) {
    const m = text.match(
      /\b((?:Konzert|Festival|Kino|Theater|Party|Match)\s+[^,]{3,40})/iu,
    );
    title = m?.[1]?.trim().slice(0, 48) || 'Event';
  }

  if (!startHm && !doorsHm) {
    return {
      ok: false,
      speech: `${title}: Startzeit noch nicht belegt — Uhrzeit oder Ticket-Link, dann trag ich's ein.`,
      bullets: actions.map((a) => a.label).slice(0, 2),
      actions,
    };
  }

  const groupId = `event_${String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .slice(0, 20)}`;
  const stops: FuturePlanStop[] = [];
  if (doorsHm) {
    const ms = hmToMs(dayKey, doorsHm);
    if (ms != null) {
      stops.push({
        id: `${groupId}_doors`,
        title: `Einlass · ${title}`,
        plannedStartMs: ms,
        plannedEndMs: ms + 20 * 60_000,
        bufferMin: 15,
        transport: 'walk',
        hardAnchor: true,
        userFixedTime: true,
        kind: 'stop',
        emoji: '🚪',
        groupId,
        groupLabel: title || 'Event',
        notes: venue || undefined,
        planPriority: 2,
      });
    }
  }
  if (startHm) {
    const ms = hmToMs(dayKey, startHm);
    if (ms != null) {
      stops.push({
        id: `${groupId}_start`,
        title: title || 'Event',
        plannedStartMs: ms,
        plannedEndMs: ms + 90 * 60_000,
        bufferMin: 20,
        transport: 'walk',
        hardAnchor: true,
        userFixedTime: true,
        kind: 'stop',
        emoji: '🎭',
        groupId,
        groupLabel: title || 'Event',
        notes: venue || undefined,
        planPriority: 2,
      });
    }
  }

  const ok = upsertStops(stops);
  return {
    ok: ok || actions.length > 0,
    speech: ok
      ? `${title} liegt in der Timeline${startHm ? ` — Beginn ${startHm}` : ''}${venue ? ` · ${venue}` : ''}.`
      : `${title}: Infos notiert — Timeline prüfen.`,
    bullets: [
      doorsHm ? `Einlass ${doorsHm}` : '',
      startHm ? `Beginn ${startHm}` : '',
      venue || '',
      ...actions.map((a) => a.label),
    ]
      .filter(Boolean)
      .slice(0, 4),
    actions: actions.slice(0, 2),
  };
}
