/**
 * Multi-Lane Pitch: parallele Recherche-Lanes → kombinierte Top-Optionen.
 * or_either → Top1 je Lane; fetch_then_spot → Fetch nah am Spot + followOnStop.
 */

import { haversineMeters } from '../../db/database';
import { collectCandidates } from './candidatePool';
import { filterAndRankPool } from './wishFilterRank';
import { verifyHardMatches } from './hardMatchVerify';
import { mixLiveResearchSeed } from './liveFoodResearch';
import { generatePitchSpeech } from './pitchSpeech';
import { buildPitchActions } from './pitchActions';
import { publishPitchResult } from './publishPitchUi';
import { pitchHeadlineFromContext } from './pitchHeadline';
import { humanizeBullets } from '../speech/draftToHumanSpeech';
import { enqueueSpeech } from '../speech/speechQueue';
import type {
  MultiLaneLane,
  MultiLanePlan,
} from '../router/call1MultiLane';
import {
  multiLaneAuthorIntent,
  multiLaneSpeechRailBlock,
} from '../router/call1MultiLane';
import type {
  PitchCandidate,
  PitchOptionCard,
  PitchRequest,
  PitchResult,
  PitchWish,
} from './types';

function walkMinHint(meters: number): string {
  const m = Math.max(0, Math.round(meters));
  if (m < 80) return 'unter 1 Min zu Fuß';
  const min = Math.max(1, Math.round(m / 80));
  if (min < 60) return `ca. ${min} Min zu Fuß`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `ca. ${h} Std ${r} Min` : `ca. ${h} Std`;
}

function wishesFromLane(lane: MultiLaneLane, shared: string[]): PitchWish[] {
  const labels = [...new Set([...shared, ...lane.mustLabels])];
  return labels.map((text) => ({
    text,
    hardness: 'must' as const,
    kind:
      /komödie|comedy|thriller|action|drama|horror|kino|theater|eis|to_go|hafen|aussicht/i.test(
        text,
      )
        ? (/eis|to_go|pizza|imbiss/i.test(text)
            ? ('dish' as const)
            : /komödie|comedy|thriller|kino|theater/i.test(text)
              ? ('theme' as const)
              : ('amenity' as const))
        : ('generic' as const),
    weight: 28,
  }));
}

function subRequest(
  base: PitchRequest,
  lane: MultiLaneLane,
  plan: MultiLanePlan,
): PitchRequest {
  const wishes = wishesFromLane(lane, plan.sharedMust);
  return {
    ...base,
    kind: lane.pitchKind,
    title: lane.queryBoost.slice(0, 80),
    context: `${base.context} | ${lane.queryBoost}`.slice(0, 400),
    wishes: wishes.length ? wishes : base.wishes,
    authorIntent: multiLaneAuthorIntent(plan),
    call1MustHaves: [...plan.sharedMust, ...lane.mustLabels],
    forbidSoftFill: true,
    orderNeed: {
      ...(base.orderNeed || {}),
      menuUrl: lane.pitchKind === 'food',
      openHours: plan.implyOpenNow || lane.pitchKind === 'food',
      eta: true,
      maps: true,
    },
  };
}

async function rankLane(
  activeReq: PitchRequest,
): Promise<{ top: PitchCandidate[]; softFail: boolean }> {
  // Kein runCinemaPitch hier — der published UI; Multi-Lane published einmal am Ende.
  const pool = await collectCandidates(activeReq);
  const pre = filterAndRankPool(activeReq, pool, 8);
  const seed = mixLiveResearchSeed(activeReq, pool, pre.top, 12);
  const verified = await verifyHardMatches({
    req: activeReq,
    candidates: seed.length ? seed : pre.top,
  });
  let top = verified.top.length ? verified.top : pre.top;
  // Genre/Theme soft-boost wenn in Musts
  const genreKeys = (activeReq.call1MustHaves ?? [])
    .concat(activeReq.wishes.filter((w) => w.hardness === 'must').map((w) => w.text))
    .map((s) => s.toLowerCase())
    .filter((s) =>
      /komödie|comedy|thriller|action|drama|horror|kino|theater|eis|hafen|aussicht/i.test(
        s,
      ),
    );
  if (genreKeys.length) {
    top = [...top].sort((a, b) => {
      const blobA = `${a.name} ${(a.softTags ?? []).join(' ')} ${(a.hardEvidence ?? []).join(' ')} ${(a.hookNotes ?? []).join(' ')}`.toLowerCase();
      const blobB = `${b.name} ${(b.softTags ?? []).join(' ')} ${(b.hardEvidence ?? []).join(' ')} ${(b.hookNotes ?? []).join(' ')}`.toLowerCase();
      const hit = (blob: string) =>
        genreKeys.reduce((n, g) => n + (blob.includes(g.slice(0, 5)) ? 1 : 0), 0);
      const d = hit(blobB) - hit(blobA);
      if (d !== 0) return d;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
  }
  if (activeReq.orderNeed?.openHours) {
    const open = top.filter((c) => c.openNow !== false);
    if (open.length) top = open;
  }
  return {
    top: top.slice(0, 5),
    softFail: verified.softFail || !top.length,
  };
}

function scoreNearFollowOn(
  fetch: PitchCandidate,
  spot: PitchCandidate,
): number {
  const d = haversineMeters(fetch.lat, fetch.lng, spot.lat, spot.lng);
  const rating = (fetch.rating ?? 3.5) * 12;
  const openBonus = fetch.openNow === true ? 8 : fetch.openNow === false ? -20 : 0;
  // Nähe zum Spot schlägt GPS-Nähe (die steckt schon im Pool)
  const near = Math.max(0, 40 - d / 80);
  return rating + openBonus + near;
}

export async function runMultiLanePitch(
  req: PitchRequest,
  plan: MultiLanePlan,
): Promise<PitchResult> {
  if (plan.kind === 'outdoor_program_weather') {
    const { runOutdoorProgramWeatherPitch } = await import(
      './runOutdoorProgramPitch'
    );
    return runOutdoorProgramWeatherPitch(req, plan);
  }

  const laneResults = await Promise.all(
    plan.lanes.map(async (lane) => {
      const sub = subRequest(req, lane, plan);
      const ranked = await rankLane(sub);
      return { lane, ranked };
    }),
  );

  let followSpot: PitchCandidate | null = null;
  if (plan.followOn) {
    const spotLane: MultiLaneLane = {
      id: 'follow_on',
      label: plan.followOn.enjoyHint,
      pitchKind: plan.followOn.pitchKind,
      mustLabels: plan.followOn.mustLabels,
      queryBoost: plan.followOn.queryBoost,
    };
    const spotRank = await rankLane(subRequest(req, spotLane, plan));
    followSpot = spotRank.top[0] ?? null;
  }

  let picks: Array<{
    cand: PitchCandidate;
    laneLabel: string;
    follow?: PitchCandidate | null;
  }> = [];

  if (plan.kind === 'or_either') {
    for (const lr of laneResults) {
      const top = lr.ranked.top[0];
      if (top) {
        picks.push({ cand: top, laneLabel: lr.lane.label, follow: null });
      }
    }
  } else {
    // fetch_then_spot: 2 Fetch-Optionen, nah am Spot
    const fetchPool = laneResults[0]?.ranked.top ?? [];
    let sorted = [...fetchPool];
    if (followSpot && plan.followOn?.preferNearFollowOn) {
      sorted = [...fetchPool].sort(
        (a, b) =>
          scoreNearFollowOn(b, followSpot!) - scoreNearFollowOn(a, followSpot!),
      );
    } else {
      sorted = [...fetchPool].sort(
        (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      );
    }
    for (const c of sorted.slice(0, 2)) {
      picks.push({
        cand: c,
        laneLabel: laneResults[0]?.lane.label ?? 'Fetch',
        follow: followSpot,
      });
    }
  }

  // Dedup by name
  const seen = new Set<string>();
  picks = picks.filter((p) => {
    const k = p.cand.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const softFail = picks.length < 1;
  const speechReq: PitchRequest = {
    ...req,
    authorIntent: [
      multiLaneAuthorIntent(plan),
      multiLaneSpeechRailBlock(plan),
      followSpot
        ? `Spot nach Fetch: ${followSpot.name} (${plan.followOn?.enjoyHint ?? 'Aussicht'})`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
    kind: plan.kind === 'fetch_then_spot' ? 'food' : req.kind,
  };

  const speech = await generatePitchSpeech({
    req: speechReq,
    top: picks.map((p) => p.cand),
    softFail,
    outOfBox: null,
  });

  const options: PitchOptionCard[] = picks.slice(0, 2).map((p, i) => {
    const cardSpeech = speech.cards[i];
    const follow = p.follow;
    const distHint =
      follow && Number.isFinite(follow.lat)
        ? walkMinHint(
            haversineMeters(p.cand.lat, p.cand.lng, follow.lat, follow.lng),
          )
        : null;
    const bullets = humanizeBullets(
      [
        ...(cardSpeech?.bullets ?? []),
        distHint && follow
          ? `${distHint} weiter zum ${plan.followOn?.enjoyHint ?? 'Spot'}`
          : null,
        p.laneLabel && plan.kind === 'or_either' ? p.laneLabel : null,
      ].filter(Boolean) as string[],
      3,
    );
    const followOnStop =
      follow && Number.isFinite(follow.lat) && Number.isFinite(follow.lng)
        ? {
            name: follow.name,
            lat: follow.lat,
            lng: follow.lng,
            placeId: follow.placeId ?? null,
            enjoyHint: plan.followOn?.enjoyHint ?? null,
          }
        : undefined;
    const candX = p.cand as PitchCandidate & {
      _menuUrl?: string;
      _ticketUrl?: string;
    };
    const actions = buildPitchActions({
      kind:
        plan.kind === 'fetch_then_spot'
          ? 'food'
          : picks[i]?.laneLabel === 'Kino'
            ? 'cinema'
            : req.kind,
      name: p.cand.name,
      lat: p.cand.lat,
      lng: p.cand.lng,
      mapsUrl: p.cand.mapsUrl,
      menuUrl: candX._menuUrl ?? null,
      websiteUrl: p.cand.websiteUrl,
      ticketUrl: candX._ticketUrl ?? null,
      bookingUrl: p.cand.bookingUrl,
      role: i === 0 ? 'favorite' : 'alternative',
      multiStop: followOnStop
        ? [
            {
              name: p.cand.name,
              lat: p.cand.lat,
              lng: p.cand.lng,
            },
            {
              name: followOnStop.name,
              lat: followOnStop.lat,
              lng: followOnStop.lng,
            },
          ]
        : undefined,
    });
    return {
      id: `ml_${i}_${(p.cand.placeId || p.cand.name).slice(0, 24)}`,
      name: p.cand.name,
      lat: p.cand.lat,
      lng: p.cand.lng,
      placeId: p.cand.placeId,
      role: i === 0 ? 'favorite' : 'alternative',
      speechPitch: cardSpeech?.speechPitch ?? p.cand.name,
      bullets,
      mapsUrl: p.cand.mapsUrl,
      menuUrl: candX._menuUrl ?? null,
      bookingUrl: p.cand.bookingUrl,
      ticketUrl: candX._ticketUrl ?? null,
      websiteUrl: p.cand.websiteUrl,
      rating: p.cand.rating,
      actions,
      whyChosen: [
        plan.kind === 'or_either' ? `Top ${p.laneLabel}` : 'Fetch nah am Spot',
        ...(p.cand.hardEvidence ?? []).slice(0, 2),
        distHint ? `Dann ${plan.followOn?.enjoyHint}: ${distHint}` : '',
      ].filter(Boolean),
      followOnStop,
    };
  });

  let spoken = speech.spokenText || speech.summary || '';
  if (plan.kind === 'fetch_then_spot' && followSpot && options.length) {
    const d0 = options[0]?.followOnStop
      ? walkMinHint(
          haversineMeters(
            options[0].lat,
            options[0].lng,
            options[0].followOnStop.lat,
            options[0].followOnStop.lng,
          ),
        )
      : null;
    const spotBit = `${followSpot.name} — ${plan.followOn?.enjoyHint ?? 'schöner Platz'}${d0 ? `, ${d0} vom Laden` : ''}.`;
    if (!spoken.toLowerCase().includes(followSpot.name.toLowerCase().slice(0, 6))) {
      spoken = `${spoken} Danach: ${spotBit}`.replace(/\s+/g, ' ').trim();
    }
  }

  const result: PitchResult = {
    requestId: req.requestId,
    softFail,
    spokenText: spoken,
    summary: speech.summary,
    options,
    outOfBoxHint: null,
    uiLayout: req.uiLayout,
  };

  const headline = pitchHeadlineFromContext({
    userText: req.context,
    city: req.cityHint,
    fallback: plan.kind === 'or_either' ? 'Zwei Optionen' : 'Eis & Aussicht',
  });
  publishPitchResult(result, {
    stepKey: `ml_${req.requestId}`,
    headline,
    anchorTimeMs: req.visitAtMs,
    pitchKind: plan.kind === 'fetch_then_spot' ? 'food' : req.kind,
    pitchContext: req.context,
  });

  if (spoken) {
    enqueueSpeech({
      kind: 'main',
      text: spoken.slice(0, 900),
      turnId: `ml_pitch_${req.requestId}`,
    });
  }

  return result;
}
