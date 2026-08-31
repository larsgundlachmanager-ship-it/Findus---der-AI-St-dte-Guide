/**
 * Completeness-Judge — fehlt Pflicht-Fakt/Button für den Job?
 * Fast-Lane-Musts müssen sitzen; Slow darf pending sein.
 */

import type { Module2ActionButton, LogicNodeOutput } from '../types';
import type {
  CompletenessIssue,
  CompletenessReport,
  JobActionKey,
  JobClassification,
  JobFactKey,
} from './types';

export type CompletenessInput = {
  classification: JobClassification;
  speech: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  /** Agent-Meta (cinema, venues, emergencyHandled, …) */
  meta?: Record<string, unknown> | null;
  logic?: LogicNodeOutput | null;
};

function blobOf(input: CompletenessInput): string {
  const meta = input.meta ? JSON.stringify(input.meta) : '';
  return `${input.speech}\n${input.bullets.join('\n')}\n${meta}`.toLowerCase();
}

function buttonKinds(buttons: Module2ActionButton[]): Set<string> {
  const s = new Set<string>();
  for (const b of buttons) {
    const k = b.payload?.kind;
    if (k === 'deep_link') s.add('OPEN_URL');
    if (k === 'navigate') s.add('START_NAVIGATION');
    if (k === 'dial') s.add('DIAL_PHONE');
    if (k === 'book_uber') s.add('BOOK_UBER');
    if (k === 'ui') {
      const action = String(
        (b.payload as { action?: string }).action ?? '',
      ).toLowerCase();
      if (action.includes('stay22') || action.includes('hotel')) {
        s.add('BOOK_STAY22');
      }
      s.add('SHOW_MORE');
    }
    // Labels als Fallback
    if (/🎫|ticket|buch|web|🎟/i.test(b.label)) s.add('OPEN_URL');
    if (/route|nav|führ|fuehr/i.test(b.label)) s.add('START_NAVIGATION');
    if (/call|anruf|📞/i.test(b.label)) s.add('DIAL_PHONE');
  }
  return s;
}

function hasFact(key: JobFactKey, input: CompletenessInput): boolean {
  const blob = blobOf(input);
  const meta = input.meta ?? {};
  const kinds = buttonKinds(input.buttons);

  switch (key) {
    case 'concrete_place':
      return (
        /\b([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})/.test(input.speech) ||
        Boolean(meta.subject) ||
        (Array.isArray(meta.venues) && meta.venues.length > 0) ||
        kinds.has('START_NAVIGATION')
      );
    case 'venue_options':
      return (
        (Array.isArray(meta.venues) && meta.venues.length > 0) ||
        /\b(oder|zwei|option|🥇|🥈|erstens)\b/u.test(blob) ||
        (meta.cinema === true && /\b(kino|film|vorstellung)\b/u.test(blob))
      );
    case 'hard_match_evidence':
      return (
        Boolean(meta.hardMatch) ||
        Boolean(meta.hard_match) ||
        input.classification.mustHaves.some((m) =>
          blob.includes(m.toLowerCase()),
        ) ||
        /\b(belegt|speisekarte|elbblick|pannfisch|pool|sauna)\b/u.test(blob)
      );
    case 'showtimes_future':
      // Orient-Turn: noch keine Uhrzeiten nötig — Kinos/Filme reichen.
      if (meta.cinemaPhase === 'orient') return true;
      return (
        Boolean(meta.cinema) ||
        (Array.isArray(meta.showtimes) && meta.showtimes.length > 0) ||
        /\b(\d{1,2}[:.]\d{2}|uhr|heute|vorstellung|spielt)\b/u.test(blob)
      );
    case 'film_or_genre_picks':
      return (
        meta.cinemaPhase === 'orient' ||
        (Array.isArray(meta.filmPicks) && meta.filmPicks.length > 0) ||
        (Array.isArray(meta.showtimes) && meta.showtimes.length > 0) ||
        /\b(komödie|comedy|action|drama|thriller|film|streifen)\b/u.test(blob) ||
        Boolean(meta.cinema)
      );
    case 'price_eur':
      return (
        /\b\d+[\.,]?\d*\s*(€|euro)\b/u.test(blob) ||
        (Array.isArray(input.logic?.moneyEur) &&
          input.logic!.moneyEur.length > 0) ||
        Boolean(meta.priceEur)
      );
    case 'ticket_or_info_url':
      return (
        kinds.has('OPEN_URL') ||
        Boolean(meta.hasTicketBtn) ||
        Boolean(meta.ticketUrl) ||
        /https?:\/\//i.test(JSON.stringify(meta))
      );
    case 'route_or_nav':
      return kinds.has('START_NAVIGATION') || /\b(minute|min\.|route|geh)\b/u.test(blob);
    case 'transit_connection':
      return (
        /\b(linie|u\d|s\d|bus|bahn|abfahrt|gleis|umstieg|fähre|faehre|ferry|fährticket|verbindung|fahrplan|ticket|talstation|bergstation|auffahrt)\b/u.test(
          blob,
        ) ||
        Boolean(meta.transit)
      );
    case 'open_now_or_hours':
      return (
        /\b(geöffnet|geoeffnet|offen|notdienst|bis\s+\d|uhr)\b/u.test(blob) ||
        Boolean(meta.openNow) ||
        Boolean(meta.hoursChecked)
      );
    case 'phone_or_nav':
      return kinds.has('DIAL_PHONE') || kinds.has('START_NAVIGATION');
    case 'emergency_right_facility':
      return (
        Boolean(meta.emergencyHandled) ||
        /\b(notaufnahme|zahnarzt|apotheke|unfall|orthopäd|arzt|klinik|krankenhaus)\b/u.test(
          blob,
        )
      );
    case 'number_answer':
      return (
        /\b\d+([.,]\d+)?\b/.test(input.speech) ||
        input.bullets.some((b) => /\d/.test(b))
      );
    case 'weather_or_outfit':
      return /\b(grad|regen|sonne|jacke|pulli|wind|wetter|anziehen|kühl|kuehl|warm)\b/u.test(
        blob,
      );
    case 'booking_deep_link':
      return (
        kinds.has('BOOK_STAY22') ||
        kinds.has('OPEN_URL') ||
        Boolean(meta.stay22) ||
        /stay22|booking/i.test(JSON.stringify(meta))
      );
    case 'activity_fit':
      return (
        Boolean(meta.activityFit) ||
        /\b(strand|fläche|platz|halle|bucht|spikeball|parken)\b/u.test(blob)
      );
    case 'alternative_offered':
      return (
        Boolean(meta.alternative) ||
        /\b(alternativ|stattdessen|oder\s+besser|lieber)\b/u.test(blob)
      );
    default:
      return true;
  }
}

function hasAction(key: JobActionKey, input: CompletenessInput): boolean {
  return buttonKinds(input.buttons).has(key);
}

/**
 * Prüft Job-Contract gegen aktuelle Antwort.
 */
export function judgeJobCompleteness(
  input: CompletenessInput,
): CompletenessReport {
  const { classification } = input;
  const { contract, commitment } = classification;
  const missing: CompletenessIssue[] = [];

  for (const fact of contract.fastFacts) {
    if (!hasFact(fact, input)) {
      missing.push({
        key: fact,
        lane: 'fast',
        severity: 'must',
        note: `Fast-Fakt fehlt: ${fact}`,
      });
    }
  }

  for (const fact of contract.slowFacts) {
    if (!hasFact(fact, input)) {
      missing.push({
        key: fact,
        lane: 'slow',
        severity: commitment === 'urgent' ? 'must' : 'should',
        note: `Slow-Fakt fehlt: ${fact}`,
      });
    }
  }

  for (const action of contract.requiredActions) {
    if (!hasAction(action, input)) {
      const slowish =
        action === 'OPEN_URL' ||
        action === 'BOOK_STAY22' ||
        action === 'BOOK_UBER';
      missing.push({
        key: action,
        lane: slowish ? 'slow' : 'fast',
        severity: slowish ? 'should' : 'must',
        note: `Action fehlt: ${action}`,
      });
    }
  }

  // Committed visit: keine Pflicht auf lange Historie — schon durch Budget woanders
  const pendingActionHints = missing
    .filter((m) => m.lane === 'slow' && typeof m.key === 'string')
    .map((m) => m.key)
    .filter((k): k is JobActionKey =>
      ['OPEN_URL', 'BOOK_STAY22', 'BOOK_UBER', 'START_NAVIGATION', 'DIAL_PHONE', 'SHOW_MORE'].includes(
        k,
      ),
    );

  const mustMissing = missing.filter((m) => m.severity === 'must' && m.lane === 'fast');

  return {
    jobId: classification.jobId,
    ok: mustMissing.length === 0,
    missing,
    pendingActionHints: [...new Set(pendingActionHints)],
  };
}

/** Pending-Placeholder-Buttons für UI (Slow-Lane lädt noch — Rad/…). */
export function pendingButtonsFromReport(
  report: CompletenessReport,
): Module2ActionButton[] {
  const out: Module2ActionButton[] = [];
  for (const a of report.pendingActionHints.slice(0, 2)) {
    if (a === 'OPEN_URL') {
      const menuish =
        report.jobId === 'dining_open' ||
        report.jobId === 'dining_hard_match';
      out.push({
        id: 'pending_url',
        label: menuish ? '🍽 Karte…' : '🎫 Link…',
        payload: {
          kind: 'deep_link',
          url: 'https://findus.local/pending',
          destName: 'pending',
        },
      });
    } else if (a === 'BOOK_STAY22') {
      // Sofort echter Partner-Link — kein findus.local-Pending (sonst Tap-Fail)
      let url = 'https://findus.local/pending';
      let dest = 'Germany';
      try {
        const {
          getCachedUserProfile,
        } = require('../../services/userProfileService') as {
          getCachedUserProfile: () => { cityName?: string } | null;
        };
        const {
          getExpediaAccommodationUrl,
          getStay22AccommodationUrl,
          getExpediaCamref,
        } = require('../../services/affiliate/affiliateService') as {
          getExpediaAccommodationUrl: (d: string) => string;
          getStay22AccommodationUrl: (d: string) => string;
          getExpediaCamref: () => string;
        };
        dest =
          getCachedUserProfile()?.cityName?.trim() || dest;
        url = getExpediaCamref()
          ? getExpediaAccommodationUrl(dest)
          : getStay22AccommodationUrl(dest);
      } catch {
        /* soft */
      }
      out.push({
        id: 'pending_stay',
        label: '🏨 Buchen',
        payload: {
          kind: 'deep_link',
          url,
          destName: dest,
        },
      });
    }
  }
  return out;
}
