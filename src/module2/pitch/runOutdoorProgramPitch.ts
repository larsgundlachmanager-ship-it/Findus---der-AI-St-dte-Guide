/**
 * Outdoor-Aktivität + Wetter-Gate Pitch.
 * Kino/Theater mit Programm ODER Minigolf/Golf/Sport — Hard outdoor, Regen-Defer, Jacke.
 */

import {
  researchCinemaAndShowtimes,
  venueCharacterHint,
  type CinemaFilmPick,
  type CinemaVenue,
} from '../../services/research/cinemaShowtimeResearch';
import { preferCinemaTicketUrl } from '../../services/research/cinemaTicketUrl';
import { collectCandidates } from './candidatePool';
import { filterAndRankPool } from './wishFilterRank';
import { verifyHardMatches } from './hardMatchVerify';
import { mixLiveResearchSeed } from './liveFoodResearch';
import { buildPitchActions } from './pitchActions';
import { pitchHeadlineFromContext } from './pitchHeadline';
import { publishPitchResult } from './publishPitchUi';
import { enqueueSpeech } from '../speech/speechQueue';
import { humanizeBullets } from '../speech/draftToHumanSpeech';
import type { MultiLanePlan } from '../router/call1MultiLane';
import {
  multiLaneAuthorIntent,
  multiLaneSpeechRailBlock,
} from '../router/call1MultiLane';
import {
  evaluateOutdoorEveningWeather,
  inventOutdoorActivityFromText,
  looksLikeOpenAirVenue,
  venueMatchesOutdoorActivity,
} from '../router/outdoorWeatherGate';
import type {
  PitchCandidate,
  PitchOptionCard,
  PitchRequest,
  PitchResult,
} from './types';

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `rund ${Math.max(1, Math.round(m / 1000))} km`;
}

function mapsUrlFor(name: string, lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${name} @${lat},${lng}`,
  )}`;
}

function pickFilmForVenue(
  films: CinemaFilmPick[],
  v: CinemaVenue,
): CinemaFilmPick | null {
  return (
    films.find((f) =>
      f.cinemaNames.some((n) =>
        v.name.toLowerCase().includes(n.toLowerCase().slice(0, 10)),
      ),
    ) ??
    films[0] ??
    null
  );
}

async function loadWeather(req: PitchRequest) {
  let snap: import('../../services/weatherService').WeatherSnapshot | null =
    null;
  try {
    const weather = require('../../services/weatherService') as {
      getCachedWeatherSnapshot: () => import('../../services/weatherService').WeatherSnapshot | null;
      ensureWeatherFresh: (
        reason: 'open' | 'tick' | 'force',
        o?: { lat?: number; lng?: number },
      ) => Promise<import('../../services/weatherService').WeatherSnapshot | null>;
    };
    snap = weather.getCachedWeatherSnapshot();
    if (!snap) {
      snap = await weather.ensureWeatherFresh('force', {
        lat: req.anchor.lat,
        lng: req.anchor.lng,
      });
    }
  } catch {
    snap = null;
  }
  return snap;
}

function weatherSpeechBits(
  gate: ReturnType<typeof evaluateOutdoorEveningWeather>,
  snap: import('../../services/weatherService').WeatherSnapshot | null,
): string[] {
  const parts: string[] = [];
  if (gate.preferDay === 'tonight' && gate.tonightOk) {
    parts.push(
      gate.factBits[0]
        ? `Wetter passt heute${gate.jacketHint ? ` — ${gate.jacketHint}` : '.'}`
        : `Wetter sieht heute machbar aus${gate.jacketHint ? ` — ${gate.jacketHint}` : '.'}`,
    );
  } else if (gate.preferDay === 'tomorrow') {
    parts.push('Heute eher Regenrisiko — lieber nicht draußen sitzen/spielen.');
    if (gate.tomorrowBetter !== false && snap?.tomorrowSummary) {
      parts.push(`Morgen sieht besser aus: ${snap.tomorrowSummary.slice(0, 90)}.`);
    } else if (gate.tomorrowBetter === true) {
      parts.push('Morgen Abend sollte es trockener werden.');
    } else {
      parts.push('Morgen prüfe ich Angebot und Prognose nochmal.');
    }
    if (gate.jacketHint && gate.tomorrowBetter !== false) {
      parts.push(gate.jacketHint);
    }
  } else {
    parts.push(
      gate.factBits[0] ||
        'Wetter heute unsicher — schau kurz, ob du’s riskieren willst.',
    );
    if (gate.jacketHint) parts.push(gate.jacketHint);
  }
  return parts;
}

async function runCinemaOutdoorPath(
  req: PitchRequest,
  plan: MultiLanePlan,
  label: string,
): Promise<PitchResult> {
  const boost = plan.lanes[0]?.queryBoost ?? 'Open Air Kino Freiluftkino';
  const userText = `${req.context} ${boost}`.trim();
  const researchP = researchCinemaAndShowtimes({
    userText,
    lat: req.anchor.lat,
    lng: req.anchor.lng,
    signal: req.signal,
  });
  const snap = await loadWeather(req);
  const research = await researchP;
  const musts = plan.sharedMust.length
    ? plan.sharedMust
    : plan.lanes[0]?.mustLabels ?? ['open_air'];
  const outdoorVenues = research.venues.filter((v) =>
    venueMatchesOutdoorActivity(v.name, musts, v.websiteUri),
  );
  const gate = evaluateOutdoorEveningWeather(snap);
  const options: PitchOptionCard[] = [];
  const spokenParts: string[] = [];

  if (!outdoorVenues.length) {
    spokenParts.push(
      `Für ${label} in der Nähe hab ich gerade keinen belegten Outdoor-Treffer — Indoor lasse ich weg.`,
    );
  } else {
    const top = outdoorVenues.slice(0, 2);
    for (let i = 0; i < top.length; i++) {
      const v = top[i]!;
      const film = pickFilmForVenue(research.filmPicks, v);
      const showHere = research.showtimes
        .filter((s) =>
          s.cinemaName.toLowerCase().includes(v.name.toLowerCase().slice(0, 10)),
        )
        .slice(0, 3);
      const ticket =
        preferCinemaTicketUrl(...showHere.map((s) => s.ticketUrl)) ?? null;
      const mapsUrl = mapsUrlFor(v.name, v.lat, v.lng);
      const filmLine =
        film?.title ??
        showHere[0]?.filmTitle ??
        (research.filmPicks[0]?.title || null);
      const whenLine = showHere[0]?.whenLabel ?? null;
      options.push({
        id: `ml_oa_${i}_${v.name.slice(0, 20).replace(/\s+/g, '_')}`,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        role: i === 0 ? 'favorite' : 'alternative',
        speechPitch: [v.name, filmLine ? `läuft ${filmLine}` : null, whenLine]
          .filter(Boolean)
          .join(' — '),
        bullets: humanizeBullets(
          [
            filmLine
              ? whenLine
                ? `${filmLine} · ${whenLine}`
                : filmLine
              : 'Programm prüfen',
            `${formatDist(v.distanceM)}${
              venueCharacterHint(v.name) ? ` · ${venueCharacterHint(v.name)}` : ''
            }`,
            gate.preferDay === 'tomorrow'
              ? 'Wetter: eher morgen'
              : gate.tonightOk
                ? 'Wetter heute ok'
                : 'Wetter heute riskant',
            gate.jacketHint,
          ].filter(Boolean) as string[],
          3,
        ),
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
        whyChosen: [
          'Outdoor-Beleg',
          filmLine ? `Film: ${filmLine}` : '',
          ...gate.factBits.slice(0, 2),
        ].filter(Boolean),
      });
    }
    const v0 = top[0]!;
    const film0 = pickFilmForVenue(research.filmPicks, v0);
    const filmTitle =
      film0?.title ?? research.filmPicks[0]?.title ?? 'das aktuelle Programm';
    spokenParts.push(`${v0.name} (${formatDist(v0.distanceM)}) — ${label}.`);
    spokenParts.push(`Heute: ${filmTitle}.`);
    spokenParts.push(...weatherSpeechBits(gate, snap));
  }

  return finishOutdoorPitch({
    req,
    plan,
    options,
    spokenParts,
    softFail: !options.length,
    label,
    category: 'cinema',
    tags: ['open_air', 'cinema', 'pitch_verified', 'seasonal_outdoor'],
  });
}

async function runPlaceOutdoorPath(
  req: PitchRequest,
  plan: MultiLanePlan,
  label: string,
): Promise<PitchResult> {
  const lane = plan.lanes[0]!;
  const sub: PitchRequest = {
    ...req,
    kind: lane.pitchKind === 'cinema' ? 'cinema' : 'sight',
    title: lane.queryBoost.slice(0, 80),
    context: `${req.context} | ${lane.queryBoost}`.slice(0, 400),
    wishes: lane.mustLabels.map((text) => ({
      text,
      hardness: 'must' as const,
      kind: 'amenity' as const,
      weight: 28,
    })),
    call1MustHaves: [...plan.sharedMust, ...lane.mustLabels],
    forbidSoftFill: true,
    authorIntent: multiLaneAuthorIntent(plan),
  };

  const snapP = loadWeather(req);
  const pool = await collectCandidates(sub);
  const pre = filterAndRankPool(sub, pool, 8);
  const seed = mixLiveResearchSeed(sub, pool, pre.top, 12);
  const verified = await verifyHardMatches({
    req: sub,
    candidates: seed.length ? seed : pre.top,
  });
  let top = (verified.top.length ? verified.top : pre.top).filter((c) =>
    venueMatchesOutdoorActivity(
      c.name,
      lane.mustLabels,
      [...(c.softTags ?? []), ...(c.hardEvidence ?? [])].join(' '),
    ),
  );
  if (!top.length) {
    top = (verified.top.length ? verified.top : pre.top).filter((c) =>
      looksLikeOpenAirVenue(
        c.name,
        [...(c.softTags ?? []), ...(c.hardEvidence ?? [])].join(' '),
      ),
    );
  }
  const snap = await snapP;
  const gate = evaluateOutdoorEveningWeather(snap);
  const options: PitchOptionCard[] = top.slice(0, 2).map((c, i) => {
    const mapsUrl = c.mapsUrl || mapsUrlFor(c.name, c.lat, c.lng);
    const dist =
      c.distFromAnchorM != null ? formatDist(c.distFromAnchorM) : null;
    return {
      id: `ml_oa_place_${i}_${c.name.slice(0, 18).replace(/\s+/g, '_')}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId,
      role: i === 0 ? 'favorite' : 'alternative',
      speechPitch: [c.name, dist, (c.hookNotes ?? [])[0]]
        .filter(Boolean)
        .join(' — '),
      bullets: humanizeBullets(
        [
          dist,
          (c.hardEvidence ?? [])[0] ?? (c.softTags ?? []).slice(0, 2).join(' · '),
          gate.preferDay === 'tomorrow'
            ? 'Wetter: eher morgen'
            : gate.tonightOk
              ? 'Wetter heute ok'
              : 'Wetter heute riskant',
          gate.jacketHint,
        ].filter(Boolean) as string[],
        3,
      ),
      mapsUrl,
      websiteUrl: c.websiteUrl,
      rating: c.rating,
      actions: buildPitchActions({
        kind: 'sight',
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        mapsUrl,
        websiteUrl: c.websiteUrl,
        role: i === 0 ? 'favorite' : 'alternative',
      }),
      whyChosen: [
        `${label}-Beleg`,
        ...gate.factBits.slice(0, 2),
      ].filter(Boolean),
    };
  });

  const spokenParts: string[] = [];
  if (!options.length) {
    spokenParts.push(
      `Für ${label} draußen in der Nähe hab ich gerade keinen belegten Treffer.`,
    );
  } else {
    const o0 = options[0]!;
    spokenParts.push(
      `${o0.name}${o0.bullets[0] ? ` (${o0.bullets[0]})` : ''} — ${label}.`,
    );
    if (options[1]) {
      spokenParts.push(`Oder ${options[1].name}.`);
    }
    spokenParts.push(...weatherSpeechBits(gate, snap));
  }

  return finishOutdoorPitch({
    req,
    plan,
    options,
    spokenParts,
    softFail: !options.length,
    label,
    category: 'outdoor',
    tags: [
      ...lane.mustLabels,
      'outdoor',
      'pitch_verified',
      'seasonal_outdoor',
    ],
  });
}

async function finishOutdoorPitch(opts: {
  req: PitchRequest;
  plan: MultiLanePlan;
  options: PitchOptionCard[];
  spokenParts: string[];
  softFail: boolean;
  label: string;
  category: string;
  tags: string[];
}): Promise<PitchResult> {
  const spokenText = opts.spokenParts.join(' ').replace(/\s+/g, ' ').trim();
  const result: PitchResult = {
    requestId: opts.req.requestId,
    softFail: opts.softFail,
    spokenText,
    summary: opts.softFail ? `Kein ${opts.label}-Treffer` : `${opts.label} + Wetter`,
    options: opts.options,
    outOfBoxHint: null,
    uiLayout: opts.req.uiLayout,
  };

  publishPitchResult(result, {
    stepKey: `ml_oa_${opts.req.requestId}`,
    headline: pitchHeadlineFromContext({
      userText: opts.req.context,
      city: opts.req.cityHint,
      fallback: opts.label,
    }),
    anchorTimeMs: opts.req.visitAtMs,
    pitchKind: opts.plan.lanes[0]?.pitchKind ?? 'sight',
    pitchContext: [
      opts.req.context,
      multiLaneAuthorIntent(opts.plan),
      multiLaneSpeechRailBlock(opts.plan),
    ].join('\n'),
  });

  if (spokenText) {
    enqueueSpeech({
      kind: 'main',
      text: spokenText.slice(0, 900),
      turnId: `ml_oa_${opts.req.requestId}`,
    });
  }

  if (opts.options.length) {
    void (async () => {
      try {
        const { persistDiscoveredPoiIntoDataset } = await import(
          '../../services/research/persistDiscoveredPoi'
        );
        for (const o of opts.options.slice(0, 2)) {
          await persistDiscoveredPoiIntoDataset(
            {
              name: o.name,
              lat: o.lat,
              lng: o.lng,
              category: opts.category,
              cityId: opts.req.cityHint ?? null,
              facts: (o.bullets ?? []).slice(0, 3).map((t) => ({
                text: t,
                sourceUrl: o.websiteUrl ?? null,
                confidence: 'medium' as const,
              })),
              promptBlock: '',
            },
            {
              skipWiki: true,
              tags: opts.tags,
              userText: opts.req.context,
            },
          );
        }
      } catch {
        /* soft */
      }
    })();
  }

  return result;
}

export async function runOutdoorProgramWeatherPitch(
  req: PitchRequest,
  plan: MultiLanePlan,
): Promise<PitchResult> {
  const act =
    inventOutdoorActivityFromText(`${req.title} ${req.context}`) ??
    inventOutdoorActivityFromText(plan.lanes[0]?.queryBoost ?? '');
  const label = act?.label ?? plan.lanes[0]?.label ?? 'Outdoor';
  const cinemaPath =
    act?.kind === 'open_air_cinema' ||
    plan.lanes[0]?.pitchKind === 'cinema' ||
    /kino|film/i.test(label);

  if (cinemaPath) {
    return runCinemaOutdoorPath(req, plan, label);
  }
  return runPlaceOutdoorPath(req, plan, label);
}
