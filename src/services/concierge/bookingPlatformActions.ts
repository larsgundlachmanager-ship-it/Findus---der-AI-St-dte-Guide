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
  if (!web?.sources?.length) return null;
  for (const s of web.sources) {
    if (s.url && portal.domainRe.test(s.url) && /^https?:\/\//i.test(s.url)) {
      return s.url;
    }
  }
  for (const f of web.facts ?? []) {
    const u = f.sourceUrl?.trim();
    if (u && portal.domainRe.test(u) && /^https?:\/\//i.test(u)) return u;
  }
  return null;
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
    const url =
      preferPortalSourceUrl(portal, opts.webResearch) ?? portal.homeUrl;
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
