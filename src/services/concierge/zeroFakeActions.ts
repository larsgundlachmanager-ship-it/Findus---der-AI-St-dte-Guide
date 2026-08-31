/**
 * Zero-Fake Action Guard — Buttons ohne echtes Backend wegfiltern.
 * Verhindert „Turnierplan“-Chips ohne URL / Login-only Quellen.
 * Partner: leere Portal-/Such-Links nie als „Buchen“ (alle Affiliate).
 */

import type { QuickAction } from '../../types/concierge';
import {
  isHollowPartnerUrl,
  looksLikePartnerBookClaim,
  rejectHollowPartnerBookAction,
} from '../affiliate/hollowPartnerUrl';

const HOLLOW_LABEL =
  /\b(turnierplan|spielplan|ansetzung(?:en)?|matchplan|liveticker|ergebnis(?:se)?\s*live|schwarzes\s+brett)\b/iu;

const FAKE_RESERVATION_CLAIM =
  /\b(tisch\s+(?:ist\s+)?(?:reserviert|gebucht)|ich\s+habe\s+(?:einen\s+)?tisch\s+reserviert|reservierung\s+(?:ist\s+)?(?:durch|fertig|bestätigt|bestaetigt)|ich\s+habe\s+.*\s+reserviert)\b/iu;

const FAKE_NAV_STARTED_CLAIM =
  /\b(navigation\s+(?:ist\s+)?(?:gestartet|läuft|laeuft|startet)|ich\s+starte\s+(?:direkt\s+)?die\s+navigation|ich\s+(führ|fuehr|bring)(?:e|en)?(?:\s+\w+){0,4}\s+hin|führ\s+dich\s+hin|fuehr\s+dich\s+hin|kompass\s+(?:ist\s+)?(?:an|aktiv)|route\s+(?:startet|läuft|laeuft)|schalt(?:e|)\s+(?:dir\s+)?(?:sofort\s+)?den\s+kompass|mach(?:e|)\s+(?:dir\s+)?(?:sofort\s+)?den\s+kompass)\b/iu;

function hasOpenableUrl(a: QuickAction): boolean {
  const url = a.payload.url?.trim();
  return !!url && /^(https?:\/\/|mailto:)/i.test(url);
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

function mapsUrlIsEstablishedPlace(url: string | undefined): boolean {
  try {
    const { isEstablishedGoogleMapsPlaceUrl } = require('../research/eventInfoUrl') as {
      isEstablishedGoogleMapsPlaceUrl: (u: string | null | undefined) => boolean;
    };
    return isEstablishedGoogleMapsPlaceUrl(url);
  } catch {
    return false;
  }
}

/**
 * Behält nur Actions, die die App wirklich ausführen kann.
 */
export function stripUnbackedActions(
  actions: QuickAction[],
  opts?: {
    userText?: string;
    speechText?: string;
    module1?: boolean | object;
  },
): QuickAction[] {
  return actions.filter((a) => {
    // ActionBoard Pending-Chips (Deep Recharge lädt noch) — behalten
    if (a.payload.pending === true && a.payload.actionBoardId) return true;
    // Müll-Labels aus LLM / Leak
    if (
      /\b(system\.?\s*kurz|system:|findus\.local\/pending)\b/iu.test(a.label) ||
      /^system\b/iu.test(a.label.trim())
    ) {
      return false;
    }
    // WLAN-Maps ohne echten User-WLAN-Intent → raus
    if (
      a.type === 'OPEN_URL' &&
      /wlan|wifi/i.test(a.label) &&
      /maps\.google|google\.[^/]*\/maps/i.test(a.payload.url ?? '')
    ) {
      return false;
    }
    // SHOW_MORE ohne Prompt → tot
    if (
      a.type === 'SHOW_MORE' &&
      !(a.payload.textPrompt ?? '').trim() &&
      !a.payload.module1DeepDive
    ) {
      return false;
    }
    // Expand-„Noch mehr“: nur strippen wenn Kontext übergeben (sonst ActionBoard/presentToUi)
    if (
      a.type === 'SHOW_MORE' &&
      (opts?.userText != null || opts?.module1 != null)
    ) {
      try {
        const {
          isExpandShowMoreAction,
          shouldOfferExpandMore,
        } = require('../actionBoard/opportunityScan') as typeof import('../actionBoard/opportunityScan');
        if (
          isExpandShowMoreAction(a) &&
          !shouldOfferExpandMore({
            userText: opts?.userText,
            speechText: opts?.speechText,
            module1: opts?.module1,
          })
        ) {
          return false;
        }
      } catch {
        /* soft */
      }
    }
    if (a.type === 'OPEN_URL' && !hasOpenableUrl(a)) return false;
    if (
      a.type === 'OPEN_URL' &&
      /maps\.google|google\.[^/]*\/maps|maps\.app\.goo\.gl/i.test(
        a.payload.url ?? '',
      ) &&
      !mapsUrlIsEstablishedPlace(a.payload.url)
    ) {
      return false;
    }
    // Interne Pending-Placeholder nie öffnen lassen → raus wenn nicht pending
    if (
      a.type === 'OPEN_URL' &&
      /findus\.local\/pending/i.test(a.payload.url ?? '') &&
      !a.payload.pending
    ) {
      return false;
    }
    // Alle Partner: Buchungs-Claim + leere Portal-/Such-URL → nie zeigen
    if (rejectHollowPartnerBookAction(a)) {
      return false;
    }
    // Nackte Partner-Homepages (auch ohne „buchen“ im Label) raus
    if (
      a.type === 'OPEN_URL' &&
      a.payload.url &&
      isHollowPartnerUrl(a.payload.url) &&
      !/\b(suchen|mehr\s+bei|touren\s+suchen|mehr\s+unterkunft|preise\s+ansehen)\b/iu.test(
        a.label,
      ) &&
      (a.payload.affiliateMarked === true ||
        looksLikePartnerBookClaim(a.label) ||
        /tiqets|musement|viator|getyourguide|klook|expedia|stay22|awin1|discovercars|bounce/i.test(
          a.payload.url,
        ))
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
      try {
        const {
          isMonthOrDateOnlyNavName,
          isBogusNavDestName,
        } = require('../research/htmlResearchGate') as {
          isMonthOrDateOnlyNavName: (n: string) => boolean;
          isBogusNavDestName: (n: string) => boolean;
        };
        const dest = String(
          a.payload.destName || a.label.replace(/^📍\s*(?:Route:\s*)?/u, ''),
        ).trim();
        if (isMonthOrDateOnlyNavName(dest) || isBogusNavDestName(dest)) {
          return false;
        }
      } catch {
        /* soft */
      }
    }

    if (
      a.type === 'OPEN_URL' &&
      /spielplan|fixtures?|schedule|tickets?/i.test(a.label) &&
      a.payload.url
    ) {
      try {
        const { isClubOrActHomepageUrl } = require('../actionBoard/scheduleDeepLink') as {
          isClubOrActHomepageUrl: (u: string) => boolean;
        };
        if (isClubOrActHomepageUrl(a.payload.url)) return false;
      } catch {
        /* soft */
      }
    }

    return true;
  });
}

/**
 * Entfernt Fake-Claims aus Speech („Tisch reserviert“ / „Nav gestartet“)
 * solange keine echte Action/Execution vorliegt.
 * @param navActuallyStarted — wenn false/undefined und Claim da: strippen
 *   (Button allein reicht nicht — Say–Do).
 */
export function stripFakeReservationClaims(
  speech: string,
  actions: QuickAction[] = [],
  opts?: { navActuallyStarted?: boolean },
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
  if (FAKE_NAV_STARTED_CLAIM.test(t) && opts?.navActuallyStarted !== true) {
    t = t
      .replace(
        FAKE_NAV_STARTED_CLAIM,
        'die Route ist bereit — Navigation startest du per Button oder sag nochmal navigieren',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }
  return t;
}

const ORPHAN_BUTTON_CLAIM =
  /\s*[^.?!]*\b(?:liegt als Button bereit|Button(?:s)?\s+(?:unten|bereit)|tipp(?:en)?\s+unten)\b[^.?!]*[.?!]?\s*/giu;

function hasOpenableAction(actions: QuickAction[]): boolean {
  return actions.some(
    (a) =>
      (a.type === 'OPEN_URL' && /^https?:\/\//i.test(a.payload.url ?? '')) ||
      a.type === 'OPEN_GYG_WIDGET' ||
      a.type.startsWith('BOOK_'),
  );
}

/**
 * Speech behauptet einen Button — ohne echten Chip den Claim streichen.
 */
export function stripOrphanButtonClaims(
  speech: string,
  actions: QuickAction[] = [],
): string {
  if (hasOpenableAction(actions)) return speech;
  const t = speech.replace(ORPHAN_BUTTON_CLAIM, ' ').replace(/\s+/g, ' ').trim();
  return t || speech;
}

/** Speech gibt zu: keine Details / schwarzes Brett → keine Placebo-Buttons erzwingen. */
export function speechAdmitsNoActionableData(speech: string): boolean {
  return /\b(schwarze[sn]?\s+brett|keine\s+details|liegen\s+mir\s+.*nicht\s+vor|nicht\s+abrufbar|kein\s+zugriff|ansetzungen\s+.*abhäng|login|anmelden)\b/iu.test(
    speech,
  );
}
