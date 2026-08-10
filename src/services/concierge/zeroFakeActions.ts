/**
 * Zero-Fake Action Guard — Buttons ohne echtes Backend wegfiltern.
 * Verhindert „Turnierplan“-Chips ohne URL / Login-only Quellen.
 */

import type { QuickAction } from '../../types/concierge';

const HOLLOW_LABEL =
  /\b(turnierplan|spielplan|ansetzung(?:en)?|matchplan|liveticker|ergebnis(?:se)?\s*live|schwarzes\s+brett)\b/iu;

const FAKE_RESERVATION_CLAIM =
  /\b(tisch\s+(?:ist\s+)?(?:reserviert|gebucht)|ich\s+habe\s+(?:einen\s+)?tisch\s+reserviert|reservierung\s+(?:ist\s+)?(?:durch|fertig|bestätigt|bestaetigt)|ich\s+habe\s+.*\s+reserviert)\b/iu;

const FAKE_NAV_STARTED_CLAIM =
  /\b(navigation\s+(?:ist\s+)?(?:gestartet|läuft|laeuft)|ich\s+starte\s+(?:direkt\s+)?die\s+navigation|kompass\s+(?:ist\s+)?(?:an|aktiv))\b/iu;

function hasOpenableUrl(a: QuickAction): boolean {
  const url = a.payload.url?.trim();
  return !!url && /^(https?:\/\/|mailto:)/i.test(url);
}

/** Leere Affiliate-Ticket-Suchen (AWIN/Tiqets/Musement) ohne belegtes Produkt. */
function isHollowAffiliateTicketSearch(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  const decoded = (() => {
    try {
      return decodeURIComponent(u);
    } catch {
      return u;
    }
  })();
  if (/musement\.com\/.*\/search\/?\?/i.test(decoded)) return true;
  if (
    /awin1\.com\/cread\.php/i.test(u) &&
    /tiqets\.com.*\/search/i.test(decoded)
  ) {
    return true;
  }
  if (/tiqets\.com\/[^?\s]*\/search\/?\?/i.test(decoded)) return true;
  return false;
}

function hasRealReservationAction(actions: QuickAction[]): boolean {
  return actions.some(
    (a) =>
      a.type === 'CONFIRM_API_RESERVATION' ||
      a.type === 'SEND_RESERVATION_EMAIL' ||
      a.type === 'TRIGGER_AI_CALL' ||
      a.type === 'DIAL_PHONE',
  );
}

/**
 * Behält nur Actions, die die App wirklich ausführen kann.
 */
export function stripUnbackedActions(actions: QuickAction[]): QuickAction[] {
  return actions.filter((a) => {
    // ActionBoard Pending-Chips (Deep Recharge lädt noch) — behalten
    if (a.payload.pending === true && a.payload.actionBoardId) return true;
    if (a.type === 'OPEN_URL' && !hasOpenableUrl(a)) return false;
    // Interne Pending-Placeholder nie öffnen lassen → raus wenn nicht pending
    if (
      a.type === 'OPEN_URL' &&
      /findus\.local\/pending/i.test(a.payload.url ?? '') &&
      !a.payload.pending
    ) {
      return false;
    }
    // Ticket-Buttons ohne Inventar (nur Suche) → nie zeigen
    if (
      a.type === 'OPEN_URL' &&
      isHollowAffiliateTicketSearch(a.payload.url ?? '') &&
      /\b(ticket|tiqets|musement|eintritt)\b/iu.test(a.label)
    ) {
      return false;
    }

    if (HOLLOW_LABEL.test(a.label) || HOLLOW_LABEL.test(a.payload.textPrompt ?? '')) {
      if (a.type === 'OPEN_URL' && hasOpenableUrl(a) && /^https?:\/\//i.test(a.payload.url ?? '')) {
        return true;
      }
      return false;
    }

    if (a.type === 'SHOW_MORE' && !a.payload.textPrompt?.trim()) return false;

    if (a.type === 'START_NAVIGATION') {
      const hasId = a.payload.targetPoiId != null && String(a.payload.targetPoiId).length > 0;
      const hasName = !!(a.payload.destName?.trim() || a.label.replace(/^📍\s*/u, '').trim());
      const hasCoords =
        typeof a.payload.destLat === 'number' &&
        typeof a.payload.destLng === 'number';
      if (!hasId && !hasName && !hasCoords) return false;
    }

    return true;
  });
}

/**
 * Entfernt Fake-Claims aus Speech („Tisch reserviert“ / „Nav gestartet“)
 * solange keine echte Action/Execution vorliegt.
 */
export function stripFakeReservationClaims(
  speech: string,
  actions: QuickAction[] = [],
): string {
  let t = speech;
  if (FAKE_RESERVATION_CLAIM.test(t) && !hasRealReservationAction(actions)) {
    t = t
      .replace(
        FAKE_RESERVATION_CLAIM,
        'Tisch reservieren können wir nach deiner Bestätigung',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (FAKE_NAV_STARTED_CLAIM.test(t)) {
    const hasNavBtn = actions.some((a) => a.type === 'START_NAVIGATION');
    const hasReminder = actions.some((a) => a.type === 'SET_DEPARTURE_REMINDER');
    if (!hasNavBtn || hasReminder) {
      t = t
        .replace(
          FAKE_NAV_STARTED_CLAIM,
          'die Route merke ich mir — Navigation startest du per Button',
        )
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return t;
}

/** Speech gibt zu: keine Details / schwarzes Brett → keine Placebo-Buttons erzwingen. */
export function speechAdmitsNoActionableData(speech: string): boolean {
  return /\b(schwarze[sn]?\s+brett|keine\s+details|liegen\s+mir\s+.*nicht\s+vor|nicht\s+abrufbar|kein\s+zugriff|ansetzungen\s+.*abhäng|login|anmelden)\b/iu.test(
    speech,
  );
}
