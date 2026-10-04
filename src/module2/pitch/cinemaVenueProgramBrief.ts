/**
 * Nach Kino-Wahl: blauer Ladezustand + heutiges Programm (Preise/Tickets),
 * kein Timing-Fork und kein neuer Pitch.
 */

import {
  researchCinemaAndShowtimes,
  venueCharacterHint,
} from '../../services/research/cinemaShowtimeResearch';
import { preferCinemaTicketUrl } from '../../services/research/cinemaTicketUrl';
import {
  MAX_PROGRAM_LIST_BULLETS,
  rewriteBulletToFit,
  BULLET_SURFACE_MAX_CHARS,
} from '../../services/concierge/visualBullets';
import { buildPitchActions } from './pitchActions';
import type { PitchOptionCard } from './types';

function venueNeedle(name: string): string {
  return name.toLowerCase().replace(/[^a-zäöüß0-9]/giu, '').slice(0, 10);
}

function matchesVenue(label: string, venueName: string): boolean {
  const a = venueNeedle(label);
  const b = venueNeedle(venueName);
  if (!a || !b) return false;
  return a.includes(b.slice(0, 6)) || b.includes(a.slice(0, 6));
}

const PROGRAM_BULLET_CHARS = BULLET_SURFACE_MAX_CHARS.program;

export async function briefCinemaVenueAfterChoice(opts: {
  venue: PitchOptionCard;
  userContext?: string | null;
  signal?: AbortSignal;
}): Promise<{
  speech: string;
  bullets: string[];
  actions: PitchOptionCard['actions'];
  headline: string;
  ticketUrl: string | null;
  websiteUrl: string | null;
}> {
  const v = opts.venue;
  const research = await researchCinemaAndShowtimes({
    userText: `Kinoprogramm und Spielzeiten heute und morgen im ${v.name}. ${opts.userContext || ''}`.trim(),
    lat: v.lat,
    lng: v.lng,
    signal: opts.signal,
    venuesOnly: false,
    phase: 'showtimes',
    showtimeBudgetMs: 12_000,
  });

  const shows = research.showtimes.filter((s) =>
    matchesVenue(s.cinemaName, v.name),
  );
  const films = research.filmPicks.filter((f) =>
    f.cinemaNames.some((n) => matchesVenue(n, v.name)),
  );
  const todayish = shows.filter((s) => /heute/i.test(s.whenLabel));
  const useShows = todayish.length ? todayish : shows;
  const char = venueCharacterHint(v.name);

  const bullets: string[] = [];
  if (char) {
    const fitted = rewriteBulletToFit(char, PROGRAM_BULLET_CHARS);
    if (fitted) bullets.push(fitted);
  }
  for (const s of useShows.slice(0, MAX_PROGRAM_LIST_BULLETS)) {
    if (bullets.length >= MAX_PROGRAM_LIST_BULLETS) break;
    const price =
      s.priceEur != null && Number.isFinite(s.priceEur)
        ? ` · ab ${Math.round(s.priceEur)} €`
        : '';
    const fitted = rewriteBulletToFit(
      `${s.filmTitle}: ${s.whenLabel}${price}`,
      PROGRAM_BULLET_CHARS,
    );
    if (fitted) bullets.push(fitted);
  }
  if (!useShows.length && films.length) {
    for (const f of films.slice(0, MAX_PROGRAM_LIST_BULLETS)) {
      if (bullets.length >= MAX_PROGRAM_LIST_BULLETS) break;
      const fitted = rewriteBulletToFit(
        f.oneLiner ? `${f.title} — ${f.oneLiner}` : f.title,
        PROGRAM_BULLET_CHARS,
      );
      if (fitted) bullets.push(fitted);
    }
  }
  if (!bullets.length) {
    bullets.push(
      research.notes.includes('pending') || research.showtimesPending
        ? 'Programm wird noch geladen'
        : 'Heute dünn — Website/Programm prüfen',
    );
  }

  const ticket =
    preferCinemaTicketUrl(
      ...useShows.map((s) => s.ticketUrl),
      ...shows.map((s) => s.ticketUrl),
      v.ticketUrl,
    ) ?? null;
  const programUrl = cinemaProgramPrefer(
    ...useShows.map((s) => s.infoUrl),
    ...shows.map((s) => s.infoUrl),
    v.websiteUrl,
  );

  let speech = '';
  if (useShows.length) {
    const bits = useShows
      .slice(0, MAX_PROGRAM_LIST_BULLETS)
      .map((s) => {
        const p =
          s.priceEur != null ? ` (ab etwa ${Math.round(s.priceEur)} €)` : '';
        return `${s.filmTitle} ${s.whenLabel}${p}`;
      })
      .join('; ');
    const dayLabel = todayish.length ? 'Heute' : 'Als Nächstes';
    speech = `${v.name} — ${dayLabel} u. a.: ${bits}. Welcher Film soll es sein? Ticket-Link liegt bereit.`;
  } else if (films.length) {
    speech = `${v.name}: im Programm u. a. ${films
      .slice(0, MAX_PROGRAM_LIST_BULLETS)
      .map((f) => f.title)
      .join(', ')}. Konkrete Uhrzeiten und Tickets über Programm/Ticket-Button.`;
  } else {
    speech = `${v.name}: gerade kein belegtes Heute-Programm in der Schnellsuche — über Programm/Website findest du die aktuellen Filme; sag einen Titel, dann hole ich die Vorstellung.`;
  }

  const actions = buildPitchActions({
    kind: 'cinema',
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    mapsUrl: v.mapsUrl,
    websiteUrl: programUrl || v.websiteUrl,
    websiteLabel: 'Programm',
    ticketUrl: ticket,
    role: v.role === 'out_of_box' ? 'alternative' : v.role,
  });

  return {
    speech: speech.slice(0, 1200),
    bullets: bullets.slice(0, MAX_PROGRAM_LIST_BULLETS),
    actions,
    headline: `Programm — ${v.name}`.slice(0, 56),
    ticketUrl: ticket,
    websiteUrl: programUrl || v.websiteUrl || null,
  };
}

function cinemaProgramPrefer(
  ...urls: Array<string | null | undefined>
): string | null {
  const list = urls
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));
  if (!list.length) return null;
  // Programmseite bevorzugen, Ticket-Deep-Links nicht als „Programm“
  const scored = list.map((u) => {
    const low = u.toLowerCase();
    let s = 0;
    if (/programm|program|spielplan/i.test(low)) s += 40;
    if (/[?&]showid=/i.test(low)) s -= 20;
    return { u, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]!.u;
}
