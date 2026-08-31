/**
 * Kino-Pitch — Programm zuerst (Filme), Kinos als Träger.
 * Nutzt cinemaShowtimeResearch statt nackter „Kino in der Nähe“-Venue-Suche.
 */

import {
  detectCinemaPhase,
  researchCinemaAndShowtimes,
  venueCharacterHint,
  type CinemaFilmPick,
  type CinemaResearchResult,
  type CinemaVenue,
} from '../../services/research/cinemaShowtimeResearch';
import { buildPitchActions } from './pitchActions';
import { pitchHeadlineFromContext } from './pitchHeadline';
import { publishPitchResult } from './publishPitchUi';
import type { PitchOptionCard, PitchRequest, PitchResult } from './types';

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
}

function mapsUrlFor(v: CinemaVenue): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${v.name} @${v.lat},${v.lng}`,
  )}`;
}

function filmOption(
  req: PitchRequest,
  film: CinemaFilmPick,
  i: number,
  venues: CinemaVenue[],
): PitchOptionCard {
  const carrier =
    venues.find((v) =>
      film.cinemaNames.some((n) =>
        v.name.toLowerCase().includes(n.toLowerCase().slice(0, 12)),
      ),
    ) ?? venues[Math.min(i, Math.max(0, venues.length - 1))];
  const lat = carrier?.lat ?? req.anchor.lat;
  const lng = carrier?.lng ?? req.anchor.lng;
  const mapsUrl = carrier ? mapsUrlFor(carrier) : '';
  const programUrl = carrier?.websiteUri ?? null;
  const where =
    film.cinemaNames.slice(0, 2).join(' · ') ||
    (carrier ? `${carrier.name} · ${formatDist(carrier.distanceM)}` : 'in der Nähe');
  const bullets = [
    film.genreHint ? `${film.title} · ${film.genreHint}` : film.title,
    where,
    film.oneLiner ? film.oneLiner.slice(0, 80) : 'Aktuell im Programm',
  ].filter(Boolean);
  const speechPitch = [
    film.oneLiner
      ? `${film.title}${film.genreHint ? ` (${film.genreHint})` : ''}: ${film.oneLiner}`
      : `${film.title}${film.genreHint ? ` — ${film.genreHint}` : ''} läuft aktuell.`,
    carrier
      ? `Träger: ${carrier.name} (${formatDist(carrier.distanceM)}${
          venueCharacterHint(carrier.name) ? `, ${venueCharacterHint(carrier.name)}` : ''
        }).`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: `pitch_${req.requestId}_film_${i}`,
    name: film.title,
    lat,
    lng,
    role: i === 0 ? 'favorite' : 'alternative',
    speechPitch,
    bullets: bullets.slice(0, 3),
    mapsUrl,
    websiteUrl: programUrl,
    actions: buildPitchActions({
      kind: 'cinema',
      name: film.title,
      lat,
      lng,
      mapsUrl,
      websiteUrl: programUrl,
      websiteLabel: 'Programm',
      role: i === 0 ? 'favorite' : 'alternative',
      suppressNav: true,
    }),
  };
}

function venueOption(
  req: PitchRequest,
  v: CinemaVenue,
  i: number,
  research: CinemaResearchResult,
): PitchOptionCard {
  const filmsHere = research.filmPicks
    .filter((f) =>
      f.cinemaNames.some((n) =>
        v.name.toLowerCase().includes(n.toLowerCase().slice(0, 10)),
      ),
    )
    .slice(0, 2);
  const showHere = research.showtimes
    .filter((s) => s.cinemaName.toLowerCase().includes(v.name.toLowerCase().slice(0, 10)))
    .slice(0, 2);
  const mapsUrl = mapsUrlFor(v);
  const bullets = [
    `${formatDist(v.distanceM)} · ${venueCharacterHint(v.name)}`,
    filmsHere[0]
      ? filmsHere.map((f) => f.title).join(' · ')
      : showHere[0]
        ? showHere.map((s) => `${s.filmTitle}: ${s.whenLabel}`).join(' · ')
        : 'Programm über Website',
    v.openNow === false ? 'Gerade geschlossen' : 'Kino in Reichweite',
  ];
  const ticket = showHere.find((s) => s.ticketUrl)?.ticketUrl ?? null;
  return {
    id: `pitch_${req.requestId}_cin_${i}`,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    role: i === 0 ? 'favorite' : 'alternative',
    speechPitch: `${v.name} (${formatDist(v.distanceM)}) — ${venueCharacterHint(v.name)}.`,
    bullets: bullets.slice(0, 3),
    mapsUrl,
    websiteUrl: v.websiteUri,
    ticketUrl: ticket,
    actions: buildPitchActions({
      kind: 'cinema',
      name: v.name,
      lat: v.lat,
      lng: v.lng,
      mapsUrl,
      websiteUrl: v.websiteUri,
      websiteLabel: 'Programm',
      ticketUrl: ticket,
      role: i === 0 ? 'favorite' : 'alternative',
    }),
  };
}

/**
 * Orient: Programmvorschau (Filme) zuerst.
 * Showtimes: Kinos + Zeiten für gewählten Film.
 */
export async function runCinemaPitch(req: PitchRequest): Promise<PitchResult> {
  const phase = detectCinemaPhase(`${req.title} ${req.context}`);
  const research = await researchCinemaAndShowtimes({
    userText: `${req.title} ${req.context}`.trim(),
    lat: req.anchor.lat,
    lng: req.anchor.lng,
    signal: req.signal,
    venuesOnly: false,
    phase,
    showtimeBudgetMs: phase === 'orient' ? 9_000 : 8_000,
  });

  let options: PitchOptionCard[] = [];
  let spokenText = '';
  let summary = '';

  if (phase === 'orient') {
    if (research.filmPicks.length) {
      options = research.filmPicks
        .slice(0, 2)
        .map((f, i) => filmOption(req, f, i, research.venues));
      const bits = research.filmPicks.slice(0, 2).map((f) => {
        const g = f.genreHint ? ` (${f.genreHint})` : '';
        return `${f.title}${g}`;
      });
      spokenText = `Aktuell im Programm: ${bits.join(' und ')}. Welcher Film spricht dich an? Spielzeiten und das passende Kino kommen danach.`;
      summary = 'Programmvorschau';
    } else if (research.venues.length) {
      options = research.venues
        .slice(0, 2)
        .map((v, i) => venueOption(req, v, i, research));
      spokenText =
        `Nahe Kinos: ${research.venues
          .slice(0, 2)
          .map((v) => `${v.name} (${formatDist(v.distanceM)})`)
          .join(' und ')}. Programm-Links sind auf den Buttons — sag Genre oder Film, dann hole ich konkrete Zeiten.`;
      summary = 'Kinos in Reichweite';
    } else {
      spokenText =
        'Gerade kein Kino mit belegtem Programm in Reichweite — sag eine Stadt oder Richtung, dann erweitere ich die Suche.';
      summary = 'Kein Kino-Treffer';
    }
  } else {
    // Showtimes: best carriers with times
    const withTimes = research.venues.filter((v) =>
      research.showtimes.some((s) =>
        s.cinemaName.toLowerCase().includes(v.name.toLowerCase().slice(0, 8)),
      ),
    );
    const ordered = (withTimes.length ? withTimes : research.venues).slice(0, 2);
    options = ordered.map((v, i) => venueOption(req, v, i, research));
    const film =
      research.filmHint ||
      research.showtimes[0]?.filmTitle ||
      research.filmPicks[0]?.title ||
      'Dein Film';
    const timeBits = research.showtimes
      .slice(0, 2)
      .map((s) => `${s.cinemaName}: ${s.whenLabel}`);
    spokenText = timeBits.length
      ? `${film} — nächste Zeiten: ${timeBits.join('; ')}. Welches Kino passt?`
      : `${film}: passende Kinos in Reichweite. Zeiten und Tickets liegen auf den Buttons.`;
    summary = research.showtimes.length ? 'Spielzeiten' : 'Kino-Auswahl';
  }

  // Extra Programm-/Ticket-Buttons aus Research an erste Option hängen
  if (options[0] && research.deferredButtons.length) {
    const extra = research.deferredButtons.slice(0, 2).map((b) => ({
      type: 'OPEN_URL' as const,
      label: b.label,
      payload: {
        url: String((b.payload as { url?: string })?.url ?? ''),
        destName: options[0]!.name,
      },
    }));
    options[0] = {
      ...options[0],
      actions: [...(options[0].actions ?? []), ...extra].slice(0, 5),
    };
  }

  const result: PitchResult = {
    requestId: req.requestId,
    softFail: options.length === 0 || (phase === 'orient' && !research.filmPicks.length),
    spokenText,
    summary,
    options,
    outOfBoxHint: null,
    uiLayout: req.uiLayout,
  };

  publishPitchResult(result, {
    stepKey: req.requestId,
    headline: pitchHeadlineFromContext({
      city: req.cityHint,
      userText: req.title,
      fallback: phase === 'orient' ? 'Kino-Programm' : 'Spielzeiten',
    }),
    anchorTimeMs: req.visitAtMs,
    pitchKind: 'cinema',
    pitchContext: `${req.title} ${req.context}`.trim(),
  });

  return result;
}
