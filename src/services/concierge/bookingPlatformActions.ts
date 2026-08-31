/**
 * Named booking portals (Mietrad, …) — Hard-Match + OPEN_URL.
 * Struktur: User nennt Portal → erklären → nur belegte Partner → Buchungs-Button.
 * Keine ortsspezifischen Scripts.
 */

import type { QuickAction } from '../../types/concierge';
import type { WebResearchResult } from '../research/webResearchService';
import { shortenActionLabel } from './actionLabelShorten';

export type NamedBookingPortal = {
  id: string;
  /** Match User-Text / Speech / Source-URL */
  re: RegExp;
  /** Fallback-Portal-URL wenn Recherche keinen spezifischeren Link hat */
  homeUrl: string;
  label: string;
  /** Ein-Satz-Erklärung (Fakt, kein Script-Zwang für die Speech) */
  explainHint: string;
  domainRe: RegExp;
};

/** Bekannte Buchungsportale — erweiterbar, nie ortsspezifisch. */
export const NAMED_BOOKING_PORTALS: NamedBookingPortal[] = [
  {
    id: 'mietrad',
    re: /\bmiet\s*-?\s*rad\b/iu,
    homeUrl: 'https://www.mietrad.de/',
    label: '🚲 Mietrad',
    explainHint:
      'Mietrad (mietrad.de) ist eine Buchungsplattform für Fahrradverleihe — selbst kein Verleiher; lokale Partner listen dort Räder zur Online-Reservierung.',
    domainRe: /mietrad\.de/i,
  },
  {
    id: 'getyourguide',
    re: /\b(get\s*your\s*guide|gyg)\b/iu,
    homeUrl: 'https://www.getyourguide.com/',
    label: '🎟 GetYourGuide',
    explainHint:
      'GetYourGuide ist eine Buchungsplattform für Touren und Tickets — lokale Anbieter listen dort buchbare Erlebnisse.',
    domainRe: /getyourguide\.com/i,
  },
  {
    id: 'viator',
    re: /\bviator\b/iu,
    homeUrl: 'https://www.viator.com/',
    label: '🎟 Viator',
    explainHint:
      'Viator ist eine Buchungsplattform für Touren und Aktivitäten.',
    domainRe: /viator\.com/i,
  },
  {
    id: 'eventim',
    re: /\beventim\b/iu,
    homeUrl: 'https://www.eventim.de/',
    label: '🎟 Eventim',
    explainHint:
      'Eventim ist ein Ticketportal für Konzerte, Theater und Events.',
    domainRe: /eventim\.de/i,
  },
  {
    id: 'ticketmaster',
    re: /\bticket\s*master\b/iu,
    homeUrl: 'https://www.ticketmaster.de/',
    label: '🎟 Ticketmaster',
    explainHint:
      'Ticketmaster ist ein Ticketportal für Konzerte und Veranstaltungen.',
    domainRe: /ticketmaster\./i,
  },
  {
    id: 'booking',
    re: /\bbooking(?:\.com)?\b/iu,
    homeUrl: 'https://www.booking.com/',
    label: '🏨 Booking.com',
    explainHint:
      'Booking.com ist eine Hotel-Buchungsplattform mit Live-Verfügbarkeit.',
    domainRe: /booking\.com/i,
  },
  {
    id: 'konfetti',
    re: /\b(konfetti|confetti|go\s*konfetti|gokonfetti)\b/iu,
    homeUrl: 'https://www.gokonfetti.com/de-de/',
    label: '🎫 Konfetti',
    explainHint:
      'Konfetti (gokonfetti) ist eine Buchungsplattform für Workshops, Weinproben und Erlebnisse — Anbieter listen dort buchbare Termine.',
    domainRe: /gokonfetti\.com|konfetti\.|confetti\./i,
  },
];

export function detectNamedBookingPortals(text: string): NamedBookingPortal[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  return NAMED_BOOKING_PORTALS.filter((p) => p.re.test(t));
}

/** User verlangt ausdrücklich dieses Portal als Voraussetzung. */
export function userRequiresNamedBookingPortal(userText: string): NamedBookingPortal[] {
  return detectNamedBookingPortals(userText);
}

function preferPortalSourceUrl(
  portal: NamedBookingPortal,
  web?: WebResearchResult | null,
): string | null {
  const pool: string[] = [];
  for (const s of web?.sources ?? []) {
    if (s.url && portal.domainRe.test(s.url) && /^https?:\/\//i.test(s.url)) {
      pool.push(s.url);
    }
  }
  for (const f of web?.facts ?? []) {
    const u = f.sourceUrl?.trim();
    if (u && portal.domainRe.test(u) && /^https?:\/\//i.test(u)) pool.push(u);
  }
  if (!pool.length) return null;
  try {
    const { pickBestScoredUrl } = require('../research/liveDeepLink') as {
      pickBestScoredUrl: (
        urls: string[],
        opts: { intent: 'booking' | 'ticket' },
      ) => string | null;
    };
    const intent = /ticket|eventim|ticketmaster|konfetti/i.test(portal.id)
      ? 'ticket'
      : 'booking';
    return pickBestScoredUrl(pool, { intent }) ?? pool[0] ?? null;
  } catch {
    return pool[0] ?? null;
  }
}

/**
 * OPEN_URL zum genannten Buchungsportal — Recherche-URL vor Home-URL.
 * Nie behaupten, ein lokaler Verleiher sei Partner, nur weil der Button da ist.
 */
export function buildNamedBookingPortalActions(opts: {
  userText?: string | null;
  speech?: string | null;
  webResearch?: WebResearchResult | null;
  existing?: QuickAction[];
}): QuickAction[] {
  const blob = `${opts.userText ?? ''} ${opts.speech ?? ''}`.trim();
  const portals = detectNamedBookingPortals(blob);
  if (!portals.length) return [];

  const existing = opts.existing ?? [];
  const out: QuickAction[] = [];

  for (const portal of portals) {
    const already = existing.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        portal.domainRe.test(a.payload.url ?? ''),
    );
    if (already || out.some((a) => portal.domainRe.test(a.payload.url ?? ''))) {
      continue;
    }
    const rawUrl =
      preferPortalSourceUrl(portal, opts.webResearch) ?? portal.homeUrl;
    let url = rawUrl;
    if (portal.id === 'konfetti') {
      try {
        const { preferKonfettiAffiliateUrl } = require('../affiliate/konfettiAffiliate') as {
          preferKonfettiAffiliateUrl: (u: string) => string;
        };
        url = preferKonfettiAffiliateUrl(rawUrl);
      } catch {
        url = rawUrl;
      }
    }
    out.push({
      type: 'OPEN_URL',
      label: shortenActionLabel(portal.label),
      payload: { url },
    });
  }
  return out;
}

/** Prompt-Hints für Concierge/Research — Struktur, kein Orts-Script. */
export function namedBookingPortalPromptHints(userText: string): string[] {
  const portals = userRequiresNamedBookingPortal(userText);
  if (!portals.length) return [];
  return portals.map(
    (p) =>
      `BUCHUNGSPORTAL-HARD-MATCH „${p.id}“: ${p.explainHint} ` +
      `Nur Verleiher/Orte nennen, deren Partnerschaft auf ${p.id}/Recherche belegt ist — nie erfinden. ` +
      `Kein Treffer → ehrlich sagen + OPEN_URL zum Portal (${p.homeUrl}) zum selbst Suchen. ` +
      `Adresse nur aussprechen/in Stichpunkten wenn User danach fragt — dann VOLL (Straße + Nr. + Ort). ` +
      `Buchungsseite → OPEN_URL-Button in derselben Antwort.`,
  );
}
