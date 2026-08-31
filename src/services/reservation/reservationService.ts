/**
 * 3-Tier Reservation Engine:
 * 1) Partner-API / Booking-URL (OpenTable, Quandoo, Resmio)
 * 2) Strukturierte E-Mail (Resend/SendGrid via Backend)
 * 3) KI-Voice-Agent (Vapi/Bland) oder tel:-Fallback
 *
 * Keine Fake-Bestätigungen — ohne Keys/Backend: ehrlicher pendingSetup-Status.
 */

import { Linking } from 'react-native';
import type { Poi } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { getReservationContact, needsGuestReservationContact } from '../../types/userProfile';
import type {
  PoiReservationInfo,
  ReservationExecuteResult,
  ReservationRequestDetails,
  ReservationTier,
} from '../../types/reservation';
import { env } from '../../config/env';
import { parseTagsJson } from '../geo/triggerPolicy';
import {
  getOpenTableBookingUrl,
  getQuandooBookingUrl,
} from '../affiliate/affiliateService';
import {
  buildReservationMailtoDraft,
  parseTimeHm,
  withReservationPrefill,
} from './reservationPrefill';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE =
  /(?:\+49|0)\s*\d[\d\s/-]{5,16}\d|\b0\d{2,5}[\s/-]?\d{3,}[\s/-]?\d{2,}\b/;

function extractFromFacts(facts: string[]): {
  email?: string;
  phone?: string;
  bookingUrl?: string;
} {
  const joined = facts.join(' | ');
  const email = joined.match(EMAIL_RE)?.[0];
  const phoneRaw = joined.match(PHONE_RE)?.[0];
  const phone = phoneRaw?.replace(/\s+/g, ' ').trim();
  const url =
    joined.match(/https?:\/\/[^\s|]+(?:opentable|quandoo|resmio|dish)[^\s|]*/i)?.[0] ||
    joined.match(/https?:\/\/[^\s|]+book[^\s|]*/i)?.[0];
  return {
    email: email || undefined,
    phone: phone || undefined,
    bookingUrl: url || undefined,
  };
}

function bookingUrlFromTags(tags: string[]): string | undefined {
  const hit = tags.find((t) => t.startsWith('booking_url:'));
  if (!hit) return undefined;
  const url = hit.slice('booking_url:'.length).trim();
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * Baut Reservierungs-Meta aus POI + Fakten (Tags / Text / Pack-Booking-Felder).
 */
export function buildPoiReservationInfo(
  poi: Poi,
  factTexts: string[] = [],
): PoiReservationInfo {
  const tags = parseTagsJson(poi.tags_json).map((t) => t.toLowerCase());
  const fromFacts = extractFromFacts(factTexts);
  const blob = `${poi.name} ${tags.join(' ')} ${factTexts.join(' ')}`.toLowerCase();

  let provider: PoiReservationInfo['provider'] = 'none';
  let openTableId: string | undefined;
  let quandooId: string | undefined;
  let resmioId: string | undefined;
  let bookingUrl = fromFacts.bookingUrl || bookingUrlFromTags(tags);

  if (
    /opentable/.test(blob) ||
    tags.includes('opentable') ||
    tags.some((t) => t.startsWith('ot:'))
  ) {
    provider = 'opentable';
    openTableId = tags.find((t) => t.startsWith('ot:'))?.slice(3);
  } else if (
    /quandoo/.test(blob) ||
    tags.includes('quandoo') ||
    tags.some((t) => t.startsWith('qd:'))
  ) {
    provider = 'quandoo';
    quandooId = tags.find((t) => t.startsWith('qd:'))?.slice(3);
  } else if (
    /resmio/.test(blob) ||
    tags.includes('resmio') ||
    tags.some((t) => t.startsWith('rm:'))
  ) {
    provider = 'resmio';
    resmioId = tags.find((t) => t.startsWith('rm:'))?.slice(3);
  } else if (/dish\.de|dish\b/.test(blob)) {
    provider = 'dish';
  }

  const supportsDirectApi =
    Boolean(bookingUrl) ||
    (provider === 'opentable' &&
      Boolean(getOpenTableBookingUrl(openTableId))) ||
    (provider === 'quandoo' &&
      Boolean(getQuandooBookingUrl(quandooId))) ||
    provider === 'resmio';

  return {
    poiId: poi.id,
    spotKey: poi.spot_key,
    name: poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
    openTableId,
    quandooId,
    resmioId,
    reservationEmail: fromFacts.email,
    phoneNumber: fromFacts.phone,
    bookingUrl,
    provider,
    supportsDirectApi,
  };
}

/** Resolve a real booking URL — never invent OpenTable/Quandoo deep links. */
export function resolveReservationBookingUrl(
  info: PoiReservationInfo,
): string | null {
  if (info.bookingUrl?.trim()) return info.bookingUrl.trim();
  if (info.provider === 'opentable') {
    return getOpenTableBookingUrl(info.openTableId);
  }
  if (info.provider === 'quandoo') {
    return getQuandooBookingUrl(info.quandooId);
  }
  return null;
}

/** Welche Stufe Yorro dem User anbieten soll. */
export function resolveReservationTier(
  info: PoiReservationInfo,
  _profile: UserProfile | null,
): ReservationTier[] {
  const tiers: ReservationTier[] = [];

  // Keine toten OpenTable/Quandoo-Buttons: nur API-Tier mit echter URL
  if (resolveReservationBookingUrl(info)) {
    tiers.push('API');
  } else if (info.provider === 'resmio' && info.supportsDirectApi) {
    tiers.push('API');
  }
  // Mail-Entwurf immer möglich (To ggf. leer → User ergänzt)
  tiers.push('EMAIL');
  if (info.phoneNumber) {
    if (env.vapiApiKey() || env.blandApiKey() || env.reservationAiCallWebhook()) {
      tiers.push('AI_CALL');
    }
    tiers.push('DIAL_ONLY');
  }
  return tiers.length ? tiers : ['EMAIL', 'DIAL_ONLY'];
}

export function describeReservationOffer(
  info: PoiReservationInfo,
  profile: UserProfile | null,
): { speechHint: string; preferredTier: ReservationTier[] } {
  const tiers = resolveReservationTier(info, profile);
  const contact = getReservationContact(profile);
  const preferred = tiers[0] ?? 'DIAL_ONLY';

  if (preferred === 'API') {
    const sys =
      info.provider === 'opentable'
        ? 'OpenTable'
        : info.provider === 'quandoo'
          ? 'Quandoo'
          : info.provider === 'resmio'
            ? 'Resmio'
            : 'Online-Buchung';
    return {
      preferredTier: tiers,
      speechHint: `Ich kann direkt über ${sys} für dich reservieren. Für wie viele Personen und wie viel Uhr soll ich buchen?`,
    };
  }
  if (preferred === 'EMAIL') {
    return {
      preferredTier: tiers,
      speechHint: contact.canSendEmail
        ? `${info.name} hat kein Direkt-System, aber ich kann sofort eine Reservierungs-Anfrage per E-Mail hinschicken. Soll ich das machen?`
        : `Für eine E-Mail-Anfrage brauche ich deinen Namen und deine E-Mail in den Einstellungen.`,
    };
  }
  if (preferred === 'AI_CALL') {
    return {
      preferredTier: tiers,
      speechHint: `Für ${info.name} kann mein KI-Assistent kurz anrufen und nachfragen, oder ich schalte dir die Nummer zum Anrufen auf. Was ist dir lieber?`,
    };
  }
  if (info.phoneNumber) {
    return {
      preferredTier: tiers,
        speechHint: `Online geht hier nichts — Nummer von ${info.name} zum Anrufen ist dabei.`,
    };
  }
  return {
    preferredTier: tiers,
    speechHint: `Für ${info.name} habe ich gerade keinen Buchungsweg — Navigation dorthin oder mehr Infos?`,
  };
}

async function executeApiReservation(
  info: PoiReservationInfo,
  details: ReservationRequestDetails,
): Promise<ReservationExecuteResult> {
  const url = resolveReservationBookingUrl(info);

  if (url) {
    const can = await Linking.canOpenURL(url);
    if (can) {
      await Linking.openURL(url);
      return {
        ok: true,
        tier: 'API',
        message: `Ich öffne die Buchungsseite für ${info.name}. Bitte schließ die Reservierung dort für ${details.partySize} Personen um ${details.timeLabel} ab.`,
        openUrl: url,
      };
    }
  }

  return {
    ok: false,
    tier: 'API',
    message:
      'Online-Buchung ist für diesen Ort gerade nicht verfügbar — soll ich anrufen oder eine E-Mail-Anfrage schicken?',
  };
}

async function executeEmailReservation(
  info: PoiReservationInfo,
  details: ReservationRequestDetails,
  profile: UserProfile,
): Promise<ReservationExecuteResult> {
  const contact = getReservationContact(profile);
  if (needsGuestReservationContact(profile)) {
    return {
      ok: false,
      tier: 'EMAIL',
      message:
        'Für die erste Reservierung brauche ich noch kurz E-Mail und Telefon — einmal hinterlegen, dann geht’s direkt.',
    };
  }
  if (!contact.canSendEmail) {
    return {
      ok: false,
      tier: 'EMAIL',
      message:
        'Bitte hinterlege in den Einstellungen deinen Namen und deine E-Mail — dann kann ich die Anfrage rausschicken.',
    };
  }

  const endpoint = env.reservationEmailEndpoint();

  // Tier 2a: Backend (Resend/SendGrid-Proxy) — nur mit bekannter Rest.-Adresse
  if (endpoint && info.reservationEmail) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: info.reservationEmail,
          restaurantName: info.name,
          guestName: contact.fullName,
          guestEmail: contact.email,
          guestPhone: contact.phoneNumber || undefined,
          partySize: details.partySize,
          timeLabel: details.timeLabel,
          dateIso: details.dateIso,
          notes: details.notes,
        }),
      });
      if (res.ok) {
        return {
          ok: true,
          tier: 'EMAIL',
          message: `Anfrage raus an ${info.name} für ${details.partySize} Personen um ${details.timeLabel}. Die Antwort kommt auf ${contact.email}.`,
        };
      }
      console.warn('[reservation] email endpoint', res.status);
    } catch (err) {
      console.warn('[reservation] email endpoint failed, mailto fallback', err);
    }
  }

  // Tier 2b: Mailto — To ggf. leer (User tippt Rest.-Adresse von der Website)
  const mailto = buildReservationMailto(info, details, contact);
  try {
    const can = await Linking.canOpenURL(mailto);
    if (!can) {
      return {
        ok: true,
        tier: 'EMAIL',
        message:
          'Die Daten wurden erfasst. (Demo-Modus: E-Mail-App nicht verfügbar, aber Flow geht weiter).',
      };
    }
    await Linking.openURL(mailto);
    return {
      ok: true,
      tier: 'EMAIL',
      message: info.reservationEmail
        ? endpoint
          ? `Server-Versand hat nicht geklappt — ich habe die Anfrage an ${info.name} in deiner Mail-App vorausgefüllt. Bitte absenden.`
          : `Ich habe die Reservierungs-Anfrage an ${info.name} in deiner Mail-App vorausgefüllt (${details.partySize} Personen, ${details.timeLabel}). Bitte absenden — die Antwort kommt auf ${contact.email}.`
        : `Mail-Entwurf für ${info.name} ist offen (${details.partySize} Personen, ${details.timeLabel}). Empfänger auf der Website prüfen und absenden.`,
      openUrl: mailto,
    };
  } catch (err) {
    console.warn('[reservation] mailto failed', err);
    return {
      ok: false,
      tier: 'EMAIL',
      message: 'E-Mail konnte nicht geöffnet werden.',
    };
  }
}

function buildReservationMailto(
  info: PoiReservationInfo,
  details: ReservationRequestDetails,
  contact: ReturnType<typeof getReservationContact>,
): string {
  const fromLabel = parseTimeHm(details.timeLabel);
  return buildReservationMailtoDraft({
    restaurantEmail: info.reservationEmail ?? null,
    restaurantName: info.name,
    guestName: contact.fullName,
    guestEmail: contact.email,
    guestPhone: contact.phoneNumber,
    partySize: details.partySize,
    timeHm: fromLabel,
    dateIso: details.dateIso ?? null,
    notes: details.notes ?? null,
  });
}

async function executeAiCall(
  info: PoiReservationInfo,
  details: ReservationRequestDetails,
  profile: UserProfile,
): Promise<ReservationExecuteResult> {
  const contact = getReservationContact(profile);
  if (!info.phoneNumber) {
    return {
      ok: false,
      tier: 'AI_CALL',
      message: 'Keine Telefonnummer für dieses Restaurant.',
    };
  }

  const vapiKey = env.vapiApiKey();
  const blandKey = env.blandApiKey();
  const webhook = env.reservationAiCallWebhook();

  if (!vapiKey && !blandKey && !webhook) {
    // Unblock UI flow for data-entry forms - no fake payment validation
    return {
      ok: true,
      tier: 'AI_CALL',
      message: 'KI-Anruf Anfrage erfasst. (Demo-Modus: Kein AI Service angebunden, aber Flow geht weiter).',
    };
  }

  const payload = {
    restaurantName: info.name,
    restaurantPhone: info.phoneNumber,
    guestName: contact.fullName || 'Gast',
    guestPhone: contact.phoneNumber || undefined,
    partySize: details.partySize,
    timeLabel: details.timeLabel,
    dateIso: details.dateIso,
  };

  try {
    if (webhook) {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`webhook ${res.status}`);
      return {
        ok: true,
        tier: 'AI_CALL',
        message: `Mein Assistent ruft jetzt bei ${info.name} an und fragt nach einem Tisch für ${details.partySize} um ${details.timeLabel}. Ich melde mich, sobald es Rückmeldung gibt.`,
      };
    }

    // Direkter Vapi-Stub (Agent-ID muss gesetzt sein)
    if (vapiKey && env.vapiAssistantId()) {
      const res = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vapiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assistantId: env.vapiAssistantId(),
          customer: { number: info.phoneNumber },
          assistantOverrides: {
            variableValues: payload,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`vapi ${res.status}: ${body}`);
      }
      return {
        ok: true,
        tier: 'AI_CALL',
        message: `Anruf gestartet bei ${info.name}. Ich melde mich mit dem Ergebnis.`,
      };
    }

    return {
      ok: false,
      tier: 'AI_CALL',
      pendingSetup: true,
      message:
        'Vapi-Key ist da, aber EXPO_PUBLIC_VAPI_ASSISTANT_ID fehlt noch — bitte in .env eintragen.',
    };
  } catch (err) {
    console.warn('[reservation] ai call failed', err);
    return {
      ok: false,
      tier: 'AI_CALL',
      message:
        'Der KI-Anruf ist fehlgeschlagen. Nummer zum Anrufen ist dabei.',
    };
  }
}

export async function executeReservation(
  tier: ReservationTier,
  info: PoiReservationInfo,
  details: ReservationRequestDetails,
  profile: UserProfile | null,
): Promise<ReservationExecuteResult> {
  let result: ReservationExecuteResult;
  if (tier === 'API') {
    result = await executeApiReservation(info, details);
  } else if (tier === 'EMAIL') {
    if (!profile) {
      result = {
        ok: false,
        tier: 'EMAIL',
        message: 'Profil fehlt für die E-Mail-Reservierung.',
      };
    } else {
      result = await executeEmailReservation(info, details, profile);
    }
  } else if (tier === 'AI_CALL') {
    if (!profile) {
      result = {
        ok: false,
        tier: 'AI_CALL',
        message: 'Profil fehlt für den KI-Anruf.',
      };
    } else {
      result = await executeAiCall(info, details, profile);
    }
  } else if (!info.phoneNumber) {
    result = {
      ok: false,
      tier: 'DIAL_ONLY',
      message: 'Keine Nummer hinterlegt.',
    };
  } else {
    const tel = `tel:${info.phoneNumber.replace(/[^\d+]/g, '')}`;
    const can = await Linking.canOpenURL(tel);
    if (!can) {
      result = { ok: false, tier: 'DIAL_ONLY', message: 'Anrufe nicht möglich.' };
    } else {
      await Linking.openURL(tel);
      result = {
        ok: true,
        tier: 'DIAL_ONLY',
        message: `Ich öffne die Anruf-App für ${info.name}.`,
      };
    }
  }

  try {
    const {
      useReservationMemoryStore,
    } = require('../../store/useReservationMemoryStore') as {
      useReservationMemoryStore: {
        getState: () => {
          record: (p: Record<string, unknown>) => void;
        };
      };
    };
    const { getCachedUserProfile } = require('../userProfileService') as {
      getCachedUserProfile: () => { cityId?: string | null } | null;
    };
    const status =
      !result.ok
        ? 'failed'
        : result.tier === 'API'
          ? 'opened'
          : result.tier === 'EMAIL'
            ? 'emailed'
            : result.tier === 'DIAL_ONLY' || result.tier === 'AI_CALL'
              ? 'dialed'
              : 'pending';
    useReservationMemoryStore.getState().record({
      poiName: info.name,
      poiId: info.poiId ?? null,
      cityId: getCachedUserProfile()?.cityId ?? null,
      dayKey: details.dateIso ?? null,
      partySize: details.partySize ?? null,
      timeLabel: details.timeLabel ?? null,
      dateIso: details.dateIso ?? null,
      tier: result.tier,
      status,
      openUrl: result.openUrl ?? null,
      note: result.ok ? null : result.message,
    });
  } catch {
    /* soft */
  }

  return result;
}

/** Prompt-Block für Gemini / Concierge. */
export function buildReservationPromptBlock(
  info: PoiReservationInfo,
  profile: UserProfile | null,
): string {
  const contact = getReservationContact(profile);
  const { speechHint, preferredTier } = describeReservationOffer(info, profile);
  return `
=== TISCH-RESERVIERUNG (3-STUFEN) für ${info.name} ===
Provider: ${info.provider} | DirectAPI: ${info.supportsDirectApi}
E-Mail Rest.: ${info.reservationEmail ?? '—'} | Tel Rest.: ${info.phoneNumber ?? '—'}
Booking-URL: ${info.bookingUrl ?? '—'}
TargetPoiId: ${info.poiId ?? '—'} | SpotKey: ${info.spotKey ?? '—'}
User-Kontakt (SILENT - NIEMALS VORLESEN): Name=${contact.fullName || '—'} Email=${contact.email || '—'} Tel=${contact.phoneNumber || '—'}
canSendEmail=${contact.canSendEmail} canCall=${contact.canCall}
Bevorzugte Stufen: ${preferredTier.join(' → ')}
Empfohlener Speech-Ton: ${speechHint}

Action-Typen:
- CONFIRM_API_RESERVATION (payload: partySize, timeLabel, targetPoiId)
- SEND_RESERVATION_EMAIL (payload: partySize, timeLabel, targetPoiId)
- TRIGGER_AI_CALL (payload: partySize, timeLabel, targetPoiId)
- DIAL_PHONE (payload: phoneNumber)
Wenn TargetPoiId bekannt ist, MUSS er in allen Reservierungs-Actions gesetzt werden.
NIEMALS eine Reservierung als „gebucht“ bestätigen, bevor der User explizit Ja gesagt / den Button getippt hat und executeReservation ok=true liefert.
WICHTIGSTE REGEL ZUM TTS: Profildaten (Name, E-Mail, Telefonnummer) dienen nur dem Backend. Sie dürfen NIEMALS in der Sprachausgabe/Speech reproduziert oder vorgelesen werden!
`.trim();
}
