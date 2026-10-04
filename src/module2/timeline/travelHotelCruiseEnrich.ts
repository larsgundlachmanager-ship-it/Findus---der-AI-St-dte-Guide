/**
 * Hotel/Cruise Evidence-Enrich — Voice-Heuristik + belegte Research/Session.
 * Keine Fake-Preise/Zeiten: Research füllt nur leere Slots; Voice gewinnt.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { QuickAction } from '../../types/concierge';
import type { CruisePortCall, HotelStammParsed } from './travelScheduleHarden';

function voiceHasCheckIn(text: string): boolean {
  return /\bcheck[\s-]?in\b|\beinchecken\b/iu.test(text);
}
function voiceHasCheckOut(text: string): boolean {
  return /\bcheck[\s-]?out\b|\bauschecken\b/iu.test(text);
}
function voiceHasBreakfastTime(text: string): boolean {
  return /\b(frühstück|fruehstueck|breakfast)\b.{0,20}\b(?:um|ab|von)\s*\d/iu.test(
    text,
  );
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
    return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
  }
}

/** Check-in/out/Frühstück-Zeiten aus Research-Blob ziehen (nur belegt). */
export function extractHotelPolicyTimesFromBlob(blob: string): {
  checkInHm: string | null;
  checkOutHm: string | null;
  breakfastHm: string | null;
  breakfastMentioned: boolean;
} {
  const t = String(blob || '').replace(/\s+/g, ' ');
  let checkInHm: string | null = null;
  let checkOutHm: string | null = null;
  let breakfastHm: string | null = null;
  const ci = t.match(
    /\bcheck[\s-]?in\b[^.]{0,48}?((?:ab|um|from)?\s*\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?)/iu,
  );
  if (ci?.[1]) checkInHm = clockFromBlob(ci[1]);
  const co = t.match(
    /\bcheck[\s-]?out\b[^.]{0,48}?((?:bis|um|until)?\s*\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?)/iu,
  );
  if (co?.[1]) checkOutHm = clockFromBlob(co[1]);
  const bf = t.match(
    /\b(?:frühstück|fruehstueck|breakfast)\b[^.]{0,48}?((?:ab|um|von|from)?\s*\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?)/iu,
  );
  if (bf?.[1]) breakfastHm = clockFromBlob(bf[1]);
  const breakfastMentioned =
    /\b(?:frühstück|fruehstueck|breakfast)\b/iu.test(t) &&
    /\b(inkl|inklusive|included|angeboten|buffet)\b/iu.test(t);
  return { checkInHm, checkOutHm, breakfastHm, breakfastMentioned };
}

export async function researchHotelPolicyTimes(opts: {
  hotelName: string;
  cityHint?: string | null;
}): Promise<{
  checkInHm: string | null;
  checkOutHm: string | null;
  breakfastHm: string | null;
  breakfastMentioned: boolean;
  sourceUrl: string | null;
}> {
  const name = (opts.hotelName || '').trim();
  if (!name || name.toLowerCase() === 'hotel') {
    return {
      checkInHm: null,
      checkOutHm: null,
      breakfastHm: null,
      breakfastMentioned: false,
      sourceUrl: null,
    };
  }
  try {
    const { runWebResearch } = await import('../../services/research/webResearchService');
    const q = [
      name,
      opts.cityHint,
      'Check-in Check-out Frühstück Zeiten official',
    ]
      .filter(Boolean)
      .join(' ');
    const web = await runWebResearch(q, { force: true });
    const blob = [
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
      ...(web?.sources ?? []).map((s) => s.title || ''),
    ]
      .filter(Boolean)
      .join(' · ');
    const times = extractHotelPolicyTimesFromBlob(blob);
    const shop = (web?.sources ?? []).find((s) =>
      /hotel|booking|expedia|official|check.?in/i.test(`${s.url} ${s.title}`),
    );
    return { ...times, sourceUrl: shop?.url ?? web?.sources?.[0]?.url ?? null };
  } catch {
    return {
      checkInHm: null,
      checkOutHm: null,
      breakfastHm: null,
      breakfastMentioned: false,
      sourceUrl: null,
    };
  }
}

export async function enrichHotelStammEvidence(opts: {
  parsed: HotelStammParsed;
  userText: string;
  cityHint?: string | null;
}): Promise<{
  parsed: HotelStammParsed;
  actions: QuickAction[];
  evidenceNotes: string[];
  speechExtra: string;
}> {
  const text = opts.userText;
  let parsed = { ...opts.parsed };
  const evidenceNotes: string[] = [];
  const actions: QuickAction[] = [];

  // Stay-Daten → dayKey / Check-out-Tag
  try {
    const { parseHotelStayDates } = require('../../services/concierge/hotelAvailabilityService') as {
      parseHotelStayDates: (t?: string | null) => { checkin: string; checkout: string };
    };
    const dates = parseHotelStayDates(text);
    if (dates.checkin && /^\d{4}-\d{2}-\d{2}$/.test(dates.checkin)) {
      parsed = {
        ...parsed,
        dayKey: dates.checkin,
        checkoutDayKey:
          dates.checkout && /^\d{4}-\d{2}-\d{2}$/.test(dates.checkout)
            ? dates.checkout
            : parsed.checkoutDayKey,
      };
      evidenceNotes.push(`Aufenthalt ${dates.checkin}→${dates.checkout}`);
    }
  } catch {
    /* soft */
  }

  // Research nur für fehlende Slots
  const needResearch =
    parsed.hotelName.toLowerCase() !== 'hotel' &&
    ((!voiceHasCheckIn(text) && parsed.checkInHm === '15:00') ||
      (!voiceHasCheckOut(text) && !parsed.checkOutHm) ||
      (parsed.breakfast && !voiceHasBreakfastTime(text)));

  if (needResearch) {
    const res = await researchHotelPolicyTimes({
      hotelName: parsed.hotelName,
      cityHint: opts.cityHint,
    });
    if (!voiceHasCheckIn(text) && res.checkInHm) {
      parsed = { ...parsed, checkInHm: res.checkInHm };
      evidenceNotes.push(`Check-in ${res.checkInHm} (belegt)`);
    }
    if (!voiceHasCheckOut(text) && res.checkOutHm) {
      parsed = { ...parsed, checkOutHm: res.checkOutHm };
      evidenceNotes.push(`Check-out ${res.checkOutHm} (belegt)`);
    }
    if (res.breakfastMentioned || res.breakfastHm) {
      parsed = {
        ...parsed,
        breakfast: true,
        breakfastHm:
          voiceHasBreakfastTime(text) && parsed.breakfastHm
            ? parsed.breakfastHm
            : res.breakfastHm || parsed.breakfastHm || '07:30',
      };
      if (res.breakfastHm) {
        evidenceNotes.push(`Frühstück ${res.breakfastHm} (belegt)`);
      }
    }
    if (res.sourceUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: '🏨 Hotel-Info',
        payload: { url: res.sourceUrl },
      });
    }
  }

  // Live-Buchung wenn Name + Stay22 greift
  if (parsed.hotelName.toLowerCase() !== 'hotel') {
    try {
      const { buildHotelBookingPack } = await import(
        '../../services/concierge/hotelBookingPack'
      );
      const pack = await buildHotelBookingPack(
        {
          poiId: -1,
          name: parsed.hotelName,
          lat: undefined,
          lng: undefined,
          source: 'concierge',
        },
        { userText: text },
      );
      if (pack.actions.length) {
        actions.push(...pack.actions.slice(0, 2));
        if (pack.speechExtra) evidenceNotes.push(pack.speechExtra.slice(0, 80));
      }
    } catch {
      /* soft — kein Fake-Buchungsbutton */
    }
  }

  const speechExtra = evidenceNotes.length
    ? evidenceNotes.slice(0, 2).join(' · ')
    : '';

  return { parsed, actions: actions.slice(0, 3), evidenceNotes, speechExtra };
}

/** PortCalls aus Reisebüro-DayPlans (Hafen · Name). */
export function portCallsFromOptionDays(
  days: Array<{
    dayKey: string;
    title: string;
    blocks?: Array<{ title: string; time?: string; detail?: string }>;
  }>,
): CruisePortCall[] {
  const out: CruisePortCall[] = [];
  for (const day of days || []) {
    const m = String(day.title || '').match(
      /\bHafen\s*[·•\-–]\s*(.+)$/iu,
    );
    if (!m?.[1]) continue;
    const portName = m[1].trim().slice(0, 40);
    const blocks = day.blocks || [];
    const arrive =
      blocks.find((b) => /schiff\s+an|ankunft/i.test(b.title))?.time ||
      null;
    const depart =
      blocks.find((b) => /ablegen|wieder\s+an\s+bord|all[\s-]?aboard/i.test(b.title))
        ?.time || null;
    out.push({
      dayKey: day.dayKey,
      portName,
      arriveAt: arrive || null,
      departAt: depart || null,
      shoreHint:
        blocks.find((b) => /landgang|stadt/i.test(b.title))?.detail || null,
    });
  }
  return out;
}

export function readActiveCruiseOptionSnapshot(): {
  portCity: string | null;
  embarkDate: string | null;
  disembarkDate: string | null;
  embarkLatestTime: string | null;
  shipArriveTime: string | null;
  portCalls: CruisePortCall[];
  packageBookUrl: string | null;
  title: string | null;
} | null {
  try {
    const { useReisebueroStore } = require('../../reisebuero/store') as {
      useReisebueroStore: {
        getState: () => {
          trip: {
            selectedOptionId: string | null;
            options: Array<{
              id: string;
              title?: string;
              placeName?: string;
              packageBookUrl?: string | null;
              days?: Array<{
                dayKey: string;
                title: string;
                blocks?: Array<{ title: string; time?: string; detail?: string }>;
              }>;
            }>;
            ledger?: {
              dateStart?: { value?: string } | null;
              dateEnd?: { value?: string } | null;
              destinationHint?: { value?: string } | null;
              cruiseEmbarkPort?: { value?: string } | null;
            };
          };
        };
      };
    };
    const trip = useReisebueroStore.getState().trip;
    const opt =
      trip.options.find((o) => o.id === trip.selectedOptionId) ||
      trip.options[0] ||
      null;
    if (!opt && !trip.ledger?.dateStart?.value) return null;
    const days = opt?.days || [];
    const embarkDay = days.find((d) => /einschiff/i.test(d.title));
    const disembarkDay = days.find((d) => /ausschiff/i.test(d.title));
    const embarkLatest =
      embarkDay?.blocks?.find((b) => /einschiff/i.test(b.title))?.time || null;
    const shipArrive =
      disembarkDay?.blocks?.find((b) => /schiff\s+an|ankunft/i.test(b.title))
        ?.time || null;
    return {
      portCity:
        trip.ledger?.cruiseEmbarkPort?.value ||
        trip.ledger?.destinationHint?.value ||
        opt?.placeName ||
        null,
      embarkDate:
        embarkDay?.dayKey || trip.ledger?.dateStart?.value || null,
      disembarkDate:
        disembarkDay?.dayKey || trip.ledger?.dateEnd?.value || null,
      embarkLatestTime: embarkLatest,
      shipArriveTime: shipArrive,
      portCalls: portCallsFromOptionDays(days),
      packageBookUrl: opt?.packageBookUrl || null,
      title: opt?.title || null,
    };
  } catch {
    return null;
  }
}

export async function enrichCruiseGlanceEvidence(opts: {
  userText: string;
  portCity: string;
  embarkDate: string;
  disembarkDate: string;
  embarkLatestTime: string | null;
  shipArriveTime: string | null;
  portCalls: CruisePortCall[];
}): Promise<{
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
    note?: string | null;
  }>;
  mealFlexNote: string | null;
  highlights: Array<{
    title: string;
    dayKey?: string | null;
    timeHm?: string | null;
    detail?: string | null;
  }>;
  shipName: string | null;
  luggageLogistics: {
    stationDropOff: boolean;
    stationShuttle: boolean;
    railAndCruise: boolean;
    note: string | null;
  } | null;
  actions: QuickAction[];
  speechExtra: string;
  evidenceNotes: string[];
}> {
  const evidenceNotes: string[] = [];
  const actions: QuickAction[] = [];
  let {
    portCity,
    embarkDate,
    disembarkDate,
    embarkLatestTime,
    shipArriveTime,
    portCalls,
  } = opts;
  let checkInStartHm: string | null = null;
  let checkInEndHm: string | null = null;
  let sailDepartHm: string | null = null;
  let meals: Array<{
    kind: 'breakfast' | 'lunch' | 'dinner';
    startHm: string | null;
    endHm?: string | null;
    note?: string | null;
  }> = [];
  let mealFlexNote: string | null = null;
  let highlights: Array<{
    title: string;
    dayKey?: string | null;
    timeHm?: string | null;
    detail?: string | null;
  }> = [];
  let shipName: string | null = null;
  let luggageLogistics: {
    stationDropOff: boolean;
    stationShuttle: boolean;
    railAndCruise: boolean;
    note: string | null;
  } | null = null;

  const snap = readActiveCruiseOptionSnapshot();
  if (snap) {
    if (snap.portCity && (portCity === 'Hafen' || !portCity)) {
      portCity = snap.portCity;
      evidenceNotes.push(`Hafen ${portCity} (Reisebüro)`);
    }
    if (snap.embarkDate) embarkDate = snap.embarkDate;
    if (snap.disembarkDate) disembarkDate = snap.disembarkDate;
    if (!embarkLatestTime && snap.embarkLatestTime) {
      embarkLatestTime = snap.embarkLatestTime;
      evidenceNotes.push(`Einschiffen ${embarkLatestTime} (belegt)`);
    }
    if (!shipArriveTime && snap.shipArriveTime) {
      shipArriveTime = snap.shipArriveTime;
      evidenceNotes.push(`Ankunft ${shipArriveTime} (belegt)`);
    }
    if ((!portCalls || portCalls.length === 0) && snap.portCalls.length) {
      portCalls = snap.portCalls;
      evidenceNotes.push(`${snap.portCalls.length} Häfen (Option)`);
    }
    if (snap.packageBookUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: '🚢 Kreuzfahrt buchen',
        payload: { url: snap.packageBookUrl },
      });
    }
    if (snap.title) shipName = snap.title;
  }

  // Live Mein-Schiff / AIDA / Programm-Evidence (nur fehlende Slots füllen)
  const needProgramResearch =
    /\b(mein\s+schiff|aida|adidia|aidia|aiida|bordprogramm|tagesprogramm|check[\s-]?in|frühstück|fruehstueck|mittag|abendessen|zwischenhalt|hafen|danzig|gdynia)\b/iu.test(
      opts.userText,
    ) ||
    !embarkLatestTime ||
    !(portCalls && portCalls.length);

  if (needProgramResearch) {
    try {
      const {
        researchCruiseProgramEvidence,
        voicePortHintsFromText,
      } = await import('./cruiseProgramResearch');
      const voicePorts = [
        ...voicePortHintsFromText(opts.userText),
        ...(portCalls || []).map((p) => p.portName),
      ];
      const prog = await researchCruiseProgramEvidence({
        userText: opts.userText,
        embarkDate,
        portCity,
        voicePorts,
      });
      if (prog.portCity && (portCity === 'Hafen' || !portCity)) {
        portCity = prog.portCity;
      }
      if (prog.embarkDate) embarkDate = prog.embarkDate;
      if (prog.disembarkDate) disembarkDate = prog.disembarkDate;
      if (!embarkLatestTime && prog.embarkLatestHm) {
        embarkLatestTime = prog.embarkLatestHm;
      }
      if (!shipArriveTime && prog.shipArriveHm) {
        shipArriveTime = prog.shipArriveHm;
      }
      if (prog.checkInStartHm) checkInStartHm = prog.checkInStartHm;
      if (prog.checkInEndHm) checkInEndHm = prog.checkInEndHm;
      if (prog.sailDepartHm) sailDepartHm = prog.sailDepartHm;
      if (prog.meals.length) meals = prog.meals;
      if (prog.mealFlexNote) mealFlexNote = prog.mealFlexNote;
      if (prog.highlights.length) highlights = prog.highlights;
      if (prog.shipName) shipName = prog.shipName;
      else if (prog.lineName && !shipName) shipName = prog.lineName;
      if (prog.luggageLogistics) luggageLogistics = prog.luggageLogistics;
      if (prog.portCalls.length) {
        // Research gewinnt bei Zeiten; Voice-only ohne Beleg nicht erfinden
        const byName = new Map(
          (portCalls || []).map((p) => [p.portName.toLowerCase(), p]),
        );
        portCalls = prog.portCalls.map((p) => {
          const prev = byName.get(p.portName.toLowerCase());
          return {
            ...p,
            arriveAt: p.arriveAt || prev?.arriveAt || null,
            departAt: p.departAt || prev?.departAt || null,
            shoreHint: p.shoreHint || prev?.shoreHint || null,
          };
        });
      }
      evidenceNotes.push(...prog.evidenceNotes.slice(0, 4));
      if (prog.unresolvedHints.length) {
        evidenceNotes.push(...prog.unresolvedHints.slice(0, 2));
      }
      for (const url of prog.sourceUrls.slice(0, 2)) {
        if (actions.some((a) => a.payload.url === url)) continue;
        const label = /check-in/i.test(url)
          ? '📋 Check-in Info'
          : /mein.?schiff/i.test(url)
            ? '🚢 Mein Schiff'
            : /aida/i.test(url)
              ? '🚢 AIDA'
              : '🔗 Programm-Quelle';
        actions.push({
          type: 'OPEN_URL',
          label,
          payload: { url },
        });
      }
    } catch {
      /* soft */
    }
  }

  // Partner-Suchlinks (AIDA / Lidl / C24) — immer belegt, keine Fake-Preise
  try {
    const { parseBriefSlots } = require('../../reisebuero/parseBriefSlots') as {
      parseBriefSlots: (t: string) => Record<string, unknown>;
    };
    const { cloneEmptyLedger, mergeLedger } = require('../../reisebuero/slotLedger') as {
      cloneEmptyLedger: () => Record<string, unknown>;
      mergeLedger: (a: Record<string, unknown>, b: Record<string, unknown>) => Record<string, unknown>;
    };
    const { cruisePartnerSearchLinks } = require('../../reisebuero/research/cruiseSearch') as {
      cruisePartnerSearchLinks: (l: Record<string, unknown>) => Array<{
        id: string;
        label: string;
        url: string;
      }>;
    };
    const ledger = mergeLedger(cloneEmptyLedger(), parseBriefSlots(opts.userText));
    if (!ledger.tripShape) {
      (ledger as { tripShape?: unknown }).tripShape = {
        value: 'cruise',
        source: 'inferred',
        hardness: 'wish',
      };
    }
    if (portCity && portCity !== 'Hafen' && !(ledger as { cruiseEmbarkPort?: unknown }).cruiseEmbarkPort) {
      (ledger as { cruiseEmbarkPort?: unknown }).cruiseEmbarkPort = {
        value: portCity,
        source: 'inferred',
        hardness: 'wish',
      };
    }
    if (embarkDate && !(ledger as { dateStart?: unknown }).dateStart) {
      (ledger as { dateStart?: unknown }).dateStart = {
        value: embarkDate,
        source: 'inferred',
        hardness: 'wish',
      };
    }
    const links = cruisePartnerSearchLinks(ledger as never);
    for (const l of links.slice(0, 3)) {
      if (actions.some((a) => a.payload.url === l.url)) continue;
      actions.push({
        type: 'OPEN_URL',
        label: l.label.slice(0, 36),
        payload: { url: l.url },
      });
    }
  } catch {
    /* soft */
  }

  return {
    portCity,
    embarkDate,
    disembarkDate,
    embarkLatestTime,
    shipArriveTime,
    portCalls: portCalls || [],
    checkInStartHm,
    checkInEndHm,
    sailDepartHm,
    meals,
    mealFlexNote,
    highlights,
    shipName,
    luggageLogistics,
    actions: actions.slice(0, 4),
    speechExtra: evidenceNotes.slice(0, 3).join(' · '),
    evidenceNotes,
  };
}
