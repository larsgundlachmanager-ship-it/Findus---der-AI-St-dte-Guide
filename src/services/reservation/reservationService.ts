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
import { getReservationContact } from '../../types/userProfile';
import type {
  PoiReservationInfo,
  ReservationExecuteResult,
  ReservationRequestDetails,
  ReservationTier,
} from '../../types/reservation';
import { env } from '../../config/env';
import { parseTagsJson } from '../geo/triggerPolicy';

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

/**
 * Baut Reservierungs-Meta aus POI + Fakten (Tags / Text).
 * Später: Pack-Felder openTableId etc. direkt aus Stadt-JSON.
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
  let bookingUrl = fromFacts.bookingUrl;

  if (/opentable/.test(blob) || tags.includes('opentable')) {
    provider = 'opentable';
    openTableId = tags.find((t) => t.startsWith('ot:'))?.slice(3);
  } else if (/quandoo/.test(blob) || tags.includes('quandoo')) {
    provider = 'quandoo';
    quandooId = tags.find((t) => t.startsWith('qd:'))?.slice(3);
  } else if (/resmio/.test(blob) || tags.includes('resmio')) {
    provider = 'resmio';
    resmioId = tags.find((t) => t.startsWith('rm:'))?.slice(3);
  } else if (/dish\.de|dish\b/.test(blob)) {
    provider = 'dish';
  }

  const supportsDirectApi =
    provider === 'opentable' ||
    provider === 'quandoo' ||
    provider === 'resmio' ||
    Boolean(bookingUrl);

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

/** Welche Stufe Findus dem User anbieten soll. */
export function resolveReservationTier(
  info: PoiReservationInfo,
  _profile: UserProfile | null,
): ReservationTier[] {
  const tiers: ReservationTier[] = [];

  if (info.supportsDirectApi || info.bookingUrl) {
    tiers.push('API');
  }
  // E-Mail-Stufe immer anbieten, wenn Restaurant-Adresse bekannt (mailto-Fallback)
  if (info.reservationEmail) {
    tiers.push('EMAIL');
  }
  if (info.phoneNumber) {
    if (env.vapiApiKey() || env.blandApiKey() || env.reservationAiCallWebhook()) {
      tiers.push('AI_CALL');
    }
    tiers.push('DIAL_ONLY');
  }
  return tiers.length ? tiers : ['DIAL_ONLY'];
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
      speechHint: `Online geht hier nichts — soll ich dir die Nummer von ${info.name} zum Anrufen aufschalten?`,
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
  // Partner-Keys später; bis dahin: Booking-URL oder ehrlicher Stub
  const url =
    info.bookingUrl ||
    (info.openTableId
      ? `https://www.opentable.de/restaurant/profile/${encodeURIComponent(info.openTableId)}`
      : info.quandooId
        ? `https://www.quandoo.de/place/${encodeURIComponent(info.quandooId)}`
        : null);

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
    pendingSetup: true,
    message:
      'Direkt-API ist vorbereitet, aber noch nicht angebunden. Trage OpenTable/Quandoo-Keys in .env ein oder hinterlege eine bookingUrl am POI.',
  };
}

async function executeEmailReservation(
  info: PoiReservationInfo,
  details: ReservationRequestDetails,
  profile: UserProfile,
): Promise<ReservationExecuteResult> {
  const contact = getReservationContact(profile);
  if (!info.reservationEmail) {
    return {
      ok: false,
      tier: 'EMAIL',
      message: 'Für dieses Restaurant habe ich keine E-Mail-Adresse.',
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

  // Tier 2a: Backend (Resend/SendGrid-Proxy)
  if (endpoint) {
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

  // Tier 2b: Mailto-Fallback — öffnet die Mail-App vorausgefüllt (immer verfügbar)
  const mailto = buildReservationMailto(info, details, contact);
  try {
    const can = await Linking.canOpenURL(mailto);
    if (!can) {
      return {
        ok: false,
        tier: 'EMAIL',
        pendingSetup: !endpoint,
        message: endpoint
          ? 'E-Mail-Versand fehlgeschlagen und Mail-App nicht verfügbar.'
          : 'Mail-App nicht verfügbar. Hinterlege EXPO_PUBLIC_RESERVATION_EMAIL_ENDPOINT für Server-Versand.',
      };
    }
    await Linking.openURL(mailto);
    return {
      ok: true,
      tier: 'EMAIL',
      message: endpoint
        ? `Server-Versand hat nicht geklappt — ich habe die Anfrage an ${info.name} in deiner Mail-App vorausgefüllt. Bitte absenden.`
        : `Ich habe die Reservierungs-Anfrage an ${info.name} in deiner Mail-App vorausgefüllt (${details.partySize} Personen, ${details.timeLabel}). Bitte absenden — die Antwort kommt auf ${contact.email}.`,
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
  const subject = `Reservierungsanfrage: ${info.name} – ${details.timeLabel}`;
  const body = [
    'Guten Tag,',
    '',
    `hiermit möchte ich einen Tisch bei ${info.name} reservieren:`,
    '',
    `Name: ${contact.fullName}`,
    `Personen: ${details.partySize}`,
    `Wunschzeit: ${details.timeLabel}`,
    details.dateIso ? `Datum: ${details.dateIso}` : null,
    details.notes ? `Hinweis: ${details.notes}` : null,
    '',
    'Rückmeldung bitte an:',
    contact.email,
    contact.phoneNumber || null,
    '',
    'Viele Grüße',
    contact.fullName,
    '',
    '(Anfrage über die Findus App)',
  ]
    .filter((line) => line != null)
    .join('\n');

  return (
    `mailto:${encodeURIComponent(info.reservationEmail!)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
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
    return {
      ok: false,
      tier: 'AI_CALL',
      pendingSetup: true,
      message:
        'KI-Anruf ist vorbereitet. Trage Vapi/Bland-Keys oder EXPO_PUBLIC_RESERVATION_AI_CALL_WEBHOOK in .env ein. Bis dahin kann ich dir die Nummer zum Anrufen aufschalten.',
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
        'Der KI-Anruf ist fehlgeschlagen. Soll ich dir stattdessen die Nummer zum Anrufen aufschalten?',
    };
  }
}

export async function executeReservation(
  tier: ReservationTier,
  info: PoiReservationInfo,
  details: ReservationRequestDetails,
  profile: UserProfile | null,
): Promise<ReservationExecuteResult> {
  if (tier === 'API') {
    return executeApiReservation(info, details);
  }
  if (tier === 'EMAIL') {
    if (!profile) {
      return {
        ok: false,
        tier: 'EMAIL',
        message: 'Profil fehlt für die E-Mail-Reservierung.',
      };
    }
    return executeEmailReservation(info, details, profile);
  }
  if (tier === 'AI_CALL') {
    if (!profile) {
      return {
        ok: false,
        tier: 'AI_CALL',
        message: 'Profil fehlt für den KI-Anruf.',
      };
    }
    return executeAiCall(info, details, profile);
  }

  // DIAL_ONLY
  if (!info.phoneNumber) {
    return {
      ok: false,
      tier: 'DIAL_ONLY',
      message: 'Keine Nummer hinterlegt.',
    };
  }
  const tel = `tel:${info.phoneNumber.replace(/[^\d+]/g, '')}`;
  const can = await Linking.canOpenURL(tel);
  if (!can) {
    return { ok: false, tier: 'DIAL_ONLY', message: 'Anrufe nicht möglich.' };
  }
  await Linking.openURL(tel);
  return {
    ok: true,
    tier: 'DIAL_ONLY',
    message: `Ich öffne die Anruf-App für ${info.name}.`,
  };
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
User-Kontakt: Name=${contact.fullName || '—'} Email=${contact.email || '—'} Tel=${contact.phoneNumber || '—'}
canSendEmail=${contact.canSendEmail} canCall=${contact.canCall}
Bevorzugte Stufen: ${preferredTier.join(' → ')}
Empfohlener Speech-Ton: ${speechHint}

Action-Typen:
- CONFIRM_API_RESERVATION (payload: partySize, timeLabel, targetPoiId)
- SEND_RESERVATION_EMAIL (payload: partySize, timeLabel, targetPoiId)
- TRIGGER_AI_CALL (payload: partySize, timeLabel, targetPoiId)
- DIAL_PHONE (payload: phoneNumber)
NIEMALS eine Reservierung als „gebucht“ bestätigen, bevor der User explizit Ja gesagt / den Button getippt hat und executeReservation ok=true liefert.
`.trim();
}
