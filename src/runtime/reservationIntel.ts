/**
 * Reservation intelligence (Modul 2) — abstract, no hardcoded restaurant names.
 * Checks POI facts for hours/kitchen/contact; builds action buttons.
 */

import type { Poi, PoiWithFacts } from '../db/types';
import type { UserProfile } from '../types/userProfile';
import type { GeminiConciergeResponse, QuickAction } from '../types/concierge';
import type {
  PoiReservationInfo,
  ReservationTier,
} from '../types/reservation';
import { getFactsForPoi } from '../db/database';
import {
  buildPoiReservationInfo,
  describeReservationOffer,
  resolveReservationBookingUrl,
  resolveReservationTier,
} from '../services/reservation/reservationService';
import { getCachedUserProfile } from '../services/userProfileService';
import { getReservationContact } from '../types/userProfile';
import { resolvePersonaEngine } from '../services/personaEngine';
import { withReservationPrefill, parseDateIso, parseTimeHm, parsePartySize, parseReservationOccasion, buildReservationMailtoDraft } from '../services/reservation/reservationPrefill';

function parseTimeFromLabel(tl: string): string | null {
  return parseTimeHm(tl);
}

export type VenueOpenStatus = 'open' | 'closed' | 'unknown';

export type ReservationIntelEval = {
  info: PoiReservationInfo;
  openStatus: VenueOpenStatus;
  hoursHint: string | null;
  kitchenClosed: boolean;
  reachable: boolean;
  highlights: string[];
  preferredTiers: ReservationTier[];
  partySize: number | null;
  timeLabel: string | null;
  dateIso: string | null;
  occasion: string | null;
  missingUserFields: Array<'partySize' | 'timeLabel' | 'dateIso'>;
  promptHints: string[];
};

const PARTY_RE =
  /\b(für|fuer)\s+(\d{1,2})\s*(person|personen|leute|gäste|gaeste|pax)\b/iu;
const TIME_RE =
  /\b(um|gegen|circa|ca\.?)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(?:uhr)?\b/iu;
const TIME_WORD_RE =
  /\b(heute\s+(mittag|abend|nacht)|morgen\s+(mittag|abend)|mittag|abendessen|frühstück|fruehstueck)\b/iu;

function parseOpenStatus(facts: string[]): VenueOpenStatus {
  const joined = facts.join(' ').toLowerCase();
  if (/heute\s+geschlossen|aktuell\s+geschlossen|kitchen\s+closed|küche\s+geschlossen|kueche\s+geschlossen/.test(joined)) {
    return 'closed';
  }
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const ranges: Array<{ open: number; close: number }> = [];
  const re = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    const close = Number(m[3]) * 60 + Number(m[4]);
    if (close > open) ranges.push({ open, close });
  }
  if (!ranges.length) return 'unknown';
  if (ranges.some((r) => mins >= r.open && mins < r.close)) return 'open';
  if (ranges.some((r) => r.open > mins && r.open - mins <= 180)) return 'unknown';
  return 'closed';
}

function extractHoursHint(facts: string[]): string | null {
  const joined = facts.join(' | ');
  const range =
    joined.match(
      /(montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonntags?)[^.]{0,40}?(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/i,
    ) ||
    joined.match(
      /\b(?:von|ab)\s+(\d{1,2}[:.]\d{2})\s*(?:bis|[-–])\s*(\d{1,2}[:.]\d{2})\b/i,
    );
  if (range) return range[0].replace(/\s+/g, ' ').trim().slice(0, 80);
  if (/\bgeschlossen\b/i.test(joined)) return 'laut Daten geschlossen';
  return null;
}

function detectKitchenClosed(facts: string[]): boolean {
  const blob = facts.join(' ').toLowerCase();
  return /küche\s+(?:schließt|schliesst|zu)|kitchen\s+closed|warme\s+küche\s+bis|keine\s+warme\s+küche/.test(
    blob,
  );
}

function extractHighlights(facts: string[]): string[] {
  const out: string[] = [];
  for (const f of facts) {
    const t = f.replace(/^\[[^\]]+\]\s*/u, '').trim();
    if (t.length < 28 || t.length > 160) continue;
    if (
      /(empfohlen|besonders|beliebt|highlight|spezialität|spezialitaet|signature|vegetar|vegan|fisch|steak|terrasse|blick)/i.test(
        t,
      )
    ) {
      out.push(t.slice(0, 120));
    }
    if (out.length >= 2) break;
  }
  return out;
}

function defaultPartySize(profile: UserProfile | null): number {
  const travelParty =
    profile?.travelParty ?? resolvePersonaEngine(profile ?? undefined).travelParty;
  switch (travelParty) {
    case 'solo':
      return 1;
    case 'couple':
    case 'date':
      return 2;
    case 'family':
    case 'friends':
      return 4;
    default:
      return 2;
  }
}

function defaultTimeLabel(): string {
  const h = new Date().getHours();
  if (h < 12) return 'heute Mittag';
  if (h < 17) return 'heute Abend';
  return 'heute gegen 19 Uhr';
}

export function extractReservationUserInput(text: string): {
  partySize: number | null;
  timeLabel: string | null;
  dateIso: string | null;
  occasion: string | null;
} {
  const partySize = parsePartySize(text);
  const timeHm = parseTimeHm(text);
  let timeLabel: string | null = timeHm ? `um ${timeHm} Uhr` : null;

  if (!timeLabel) {
    const tw = text.match(TIME_WORD_RE);
    if (tw) timeLabel = tw[0].trim();
  }
  if (!timeLabel) {
    const tm = text.match(TIME_RE);
    if (tm) {
      const h = tm[2];
      const min = tm[3] ? `:${tm[3]}` : '';
      timeLabel = `um ${h}${min} Uhr`;
    }
  }

  // Legacy PARTY_RE fallback if parsePartySize missed
  let party = partySize;
  if (party == null) {
    const pm = text.match(PARTY_RE);
    if (pm?.[2]) {
      const n = parseInt(pm[2], 10);
      if (n >= 1 && n <= 20) party = n;
    }
  }

  return {
    partySize: party,
    timeLabel,
    dateIso: parseDateIso(text),
    occasion: parseReservationOccasion(text),
  };
}

export async function evaluateReservationIntel(
  poi: Poi | PoiWithFacts,
  userText: string,
  profile?: UserProfile | null,
): Promise<ReservationIntelEval> {
  const p = profile ?? getCachedUserProfile();
  const factRows =
    'facts' in poi && Array.isArray(poi.facts)
      ? poi.facts.map((f) => f.fact_text)
      : (await getFactsForPoi(poi.id)).map((f) => f.fact_text);

  const info = buildPoiReservationInfo(poi, factRows);
  const openStatus = parseOpenStatus(factRows);
  const hoursHint = extractHoursHint(factRows);
  const kitchenClosed = detectKitchenClosed(factRows);
  const highlights = extractHighlights(factRows);
  const preferredTiers = resolveReservationTier(info, p);
  const extracted = extractReservationUserInput(userText);

  const partySize = extracted.partySize ?? null;
  const timeLabel = extracted.timeLabel ?? null;
  const dateIso = extracted.dateIso ?? null;
  const occasion = extracted.occasion ?? null;
  const missingUserFields: ReservationIntelEval['missingUserFields'] = [];
  if (!partySize) missingUserFields.push('partySize');
  if (!dateIso) missingUserFields.push('dateIso');
  if (!timeLabel) missingUserFields.push('timeLabel');

  const reachable = Boolean(
    info.phoneNumber || info.reservationEmail || info.bookingUrl || info.supportsDirectApi,
  );

  const promptHints: string[] = [];
  if (openStatus === 'closed') {
    promptHints.push('Venue likely closed now — suggest alternative time or honest no-dead-end.');
  } else if (openStatus === 'open') {
    promptHints.push('Venue appears open per local facts.');
  }
  if (kitchenClosed) {
    promptHints.push('Kitchen may be closed or limited — mention before booking.');
  }
  if (!reachable) {
    promptHints.push('No direct booking channel in data — navigation or general info only.');
  }
  if (missingUserFields.length) {
    promptHints.push(
      `Ask user once, briefly, only for: ${missingUserFields.join(', ')} (never re-ask name/email/phone from profile).`,
    );
  }
  if (occasion) {
    promptHints.push(`Occasion/note from speech: ${occasion} — put into booking notes.`);
  }

  return {
    info,
    openStatus,
    hoursHint,
    kitchenClosed,
    reachable,
    highlights,
    preferredTiers,
    partySize,
    timeLabel,
    dateIso,
    occasion,
    missingUserFields,
    promptHints,
  };
}

export function buildReservationQuickActions(
  eval_: ReservationIntelEval,
  profile?: UserProfile | null,
  coords?: { lat: number; lng: number },
): QuickAction[] {
  const { info, preferredTiers, partySize, timeLabel, dateIso, occasion } = eval_;
  const p = profile ?? getCachedUserProfile();
  const contact = p ? getReservationContact(p) : null;
  const actions: QuickAction[] = [];
  const ps = partySize ?? defaultPartySize(p);
  const tl = timeLabel ?? defaultTimeLabel();
  const timeHm = parseTimeFromLabel(tl);
  const poiLat = coords?.lat;
  const poiLng = coords?.lng;

  actions.push({
    type: 'START_NAVIGATION',
    label: 'Navigation',
    payload: {
      targetPoiId: info.poiId,
      destName: info.name,
      destLat: poiLat,
      destLng: poiLng,
    },
  });

  if (info.bookingUrl) {
    const prefilled = withReservationPrefill(info.bookingUrl, {
      partySize: ps,
      timeHm,
      dateIso: dateIso ?? null,
      guestName: contact?.fullName ?? null,
      guestEmail: contact?.email ?? null,
      guestPhone: contact?.phoneNumber ?? null,
      notes: occasion,
    });
    actions.push({
      type: 'OPEN_URL',
      label: 'Reservieren',
      payload: { url: prefilled, targetPoiId: info.poiId },
    });
  }

  const tier = preferredTiers[0];
  if (
    tier === 'API' &&
    (resolveReservationBookingUrl(info) || info.provider === 'resmio')
  ) {
    actions.push({
      type: 'CONFIRM_API_RESERVATION',
      label: 'Reservieren',
      payload: {
        targetPoiId: info.poiId,
        partySize: ps,
        timeLabel: tl,
      },
    });
  }

  if (info.phoneNumber) {
    actions.push({
      type: 'DIAL_PHONE',
      label: 'Anrufen',
      payload: {
        phoneNumber: info.phoneNumber,
        targetPoiId: info.poiId,
      },
    });
  }

  // Mail-Entwurf immer anbieten (To ggf. leer — User ergänzt Rest.-Adresse)
  actions.push({
    type: 'OPEN_URL',
    label: 'Mail-Entwurf',
    payload: {
      url: buildReservationMailtoDraft({
        restaurantEmail: info.reservationEmail ?? null,
        restaurantName: info.name,
        guestName: contact?.fullName ?? '',
        guestEmail: contact?.email ?? '',
        guestPhone: contact?.phoneNumber ?? null,
        partySize: ps,
        timeHm,
        dateIso: dateIso ?? null,
        notes: occasion,
      }),
      targetPoiId: info.poiId,
    },
  });

  if (tier === 'AI_CALL' && !info.phoneNumber) {
    actions.push({
      type: 'TRIGGER_AI_CALL',
      label: 'KI-Anruf',
      payload: {
        targetPoiId: info.poiId,
        partySize: ps,
        timeLabel: tl,
      },
    });
  }

  return actions.slice(0, 5);
}

/** Merge reservation intel into concierge response (actions + bullets). */
export async function applyReservationIntel(
  response: GeminiConciergeResponse,
  poiId: number,
  userText: string,
): Promise<GeminiConciergeResponse> {
  const { getPoiWithFacts } = await import('../db/database');
  const poi = await getPoiWithFacts(poiId);
  if (!poi) return response;

  const eval_ = await evaluateReservationIntel(poi, userText);
  const offer = describeReservationOffer(eval_.info, getCachedUserProfile());
  const stdActions = buildReservationQuickActions(eval_, getCachedUserProfile(), {
    lat: poi.lat,
    lng: poi.lng,
  });

  const existingTypes = new Set(response.quickActions.map((a) => a.type));
  const mergedActions = [
    ...response.quickActions,
    ...stdActions.filter((a) => !existingTypes.has(a.type)),
  ];

  const bullets = [...response.visualBullets];
  if (eval_.hoursHint && !bullets.some((b) => b.includes(eval_.hoursHint!))) {
    bullets.unshift(eval_.hoursHint);
  }
  if (eval_.kitchenClosed) {
    bullets.push('Küche evtl. eingeschränkt — Zeit prüfen');
  }
  for (const h of eval_.highlights.slice(0, 2)) {
    if (!bullets.includes(h)) bullets.push(h);
  }
  if (eval_.partySize && (eval_.timeLabel || eval_.dateIso)) {
    bullets.unshift(
      [
        eval_.partySize ? `${eval_.partySize} Pers.` : null,
        eval_.dateIso
          ? eval_.dateIso.split('-').reverse().join('.')
          : null,
        eval_.timeLabel,
        eval_.occasion,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }

  let speechText = response.speechText.trim();
  if (!speechText) {
    speechText = offer.speechHint;
  }

  return {
    ...response,
    speechText,
    cardTitle: response.cardTitle ?? `Reservierung · ${eval_.info.name}`,
    visualBullets: bullets.slice(0, 3),
    quickActions: mergedActions.slice(0, 5),
  };
}

export function reservationIntelPromptBlock(eval_: ReservationIntelEval): string {
  const lines = [
    '=== RESERVATION INTEL (Modul 2) ===',
    `Venue: ${eval_.info.name} (#${eval_.info.poiId})`,
    `Open: ${eval_.openStatus}${eval_.hoursHint ? ` · ${eval_.hoursHint}` : ''}`,
    `Kitchen limited: ${eval_.kitchenClosed}`,
    `Reachable: ${eval_.reachable} · Tiers: ${eval_.preferredTiers.join(' → ')}`,
    eval_.highlights.length
      ? `Highlights: ${eval_.highlights.join(' | ')}`
      : null,
    eval_.partySize ? `User partySize: ${eval_.partySize}` : null,
    eval_.dateIso ? `User date: ${eval_.dateIso}` : null,
    eval_.timeLabel ? `User time: ${eval_.timeLabel}` : null,
    eval_.occasion ? `Occasion/notes: ${eval_.occasion}` : null,
    eval_.missingUserFields.length
      ? `Still ask user once for: ${eval_.missingUserFields.join(', ')}`
      : 'User gave enough for booking actions',
    ...eval_.promptHints.map((h) => `- ${h}`),
    'Offer quickActions: Navigation, Speisekarte (if URL), Reservieren/Mail-Entwurf/Anruf as appropriate.',
    'NEVER confirm booked until user taps action and executeReservation returns ok.',
    'Profile already has guest name/email/phone after setup — do not re-ask. Allergies stay in profile, not reservation forms.',
  ].filter(Boolean);
  return lines.join('\n');
}
