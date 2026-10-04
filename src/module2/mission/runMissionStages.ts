/**
 * Mission Stage-Runner — Phase 2.
 *
 * Hartnäckig: Pack/Places → Broaden → Harvest → Radius-Ringe → 2. Harvest → Verify.
 * Kind-agnostisch (food|bar|sight|hotel|generic). Cinema bleibt eigener Pfad.
 * Ask-Back bleibt Call-1; hier nur Suche bis Evidenz oder ehrlich leer.
 */

import type { PitchCandidate, PitchKind, PitchRequest } from '../pitch/types';
import {
  broadenDiningPitchRequest,
  diningExpandRingsFor,
  withLiveExpandRadius,
} from '../pitch/searchBrief';
import type { MissionChecklist } from './missionContract';

export type MissionRanked = {
  top: PitchCandidate[];
  shortlist?: PitchCandidate[];
  softFail: boolean;
  outOfBox?: PitchCandidate | null;
  reason?: string | null;
  criteriaChecklist?: Array<{
    key: string;
    status: string;
    label?: string;
  }>;
};

export type MissionRankResult = {
  ranked: MissionRanked;
  pool: PitchCandidate[];
};

export type RunMissionStagesResult = {
  req: PitchRequest;
  ranked: MissionRanked;
  pool: PitchCandidate[];
  harvestNearMisses: PitchCandidate[];
  stagesRun: string[];
};

/** Welche Pitch-Kinds den stubborn Expand/Harvest-Loop bekommen. */
export function missionKindsUseStubbornLoop(kind: PitchKind): boolean {
  return (
    kind === 'food' ||
    kind === 'bar' ||
    kind === 'sight' ||
    kind === 'hotel' ||
    kind === 'generic'
  );
}

export function shouldRunMissionExpand(opts: {
  kind: PitchKind;
  softFail: boolean;
  topLen: number;
  checklist?: Array<{ status: string; key: string }>;
}): boolean {
  if (!missionKindsUseStubbornLoop(opts.kind)) return false;
  if (opts.softFail || opts.topLen < 2) return true;
  return (opts.checklist ?? []).some(
    (s) => s.status === 'soft_miss' || s.status === 'only_one',
  );
}

function hasHardSoftMiss(
  checklist?: Array<{ status: string; key: string }>,
): boolean {
  return (checklist ?? []).some(
    (s) =>
      (s.status === 'soft_miss' || s.status === 'only_one') &&
      !/^(open_at_visit|rating_floor|budget)$/i.test(s.key),
  );
}

function isBetterRank(
  next: MissionRanked,
  prev: MissionRanked,
  nextPoolLen: number,
  prevPoolLen: number,
): boolean {
  const betterTop =
    next.top.length > prev.top.length ||
    (next.top.length >= 2 && prev.top.length < 2) ||
    (next.top.length >= 1 && !prev.top.length);
  const fewerMisses =
    (next.criteriaChecklist ?? []).filter((s) => s.status === 'soft_miss')
      .length <
    (prev.criteriaChecklist ?? []).filter((s) => s.status === 'soft_miss')
      .length;
  return betterTop || fewerMisses || nextPoolLen > prevPoolLen;
}

/**
 * Führt Broaden → Harvest → Rings → Harvest2 aus, wenn der erste Rank dünn ist.
 * `rank` = bestehende collect+verify Pipeline (z. B. rankDiningPool).
 */
export async function runMissionStages(opts: {
  req: PitchRequest;
  ranked: MissionRanked;
  pool: PitchCandidate[];
  rank: (req: PitchRequest) => Promise<MissionRankResult>;
  mission?: MissionChecklist | null;
}): Promise<RunMissionStagesResult> {
  let req = opts.req;
  let ranked = opts.ranked;
  let pool = opts.pool;
  const stagesRun: string[] = ['pack'];
  let harvestNearMisses: PitchCandidate[] = [];

  if (!missionKindsUseStubbornLoop(req.kind)) {
    return { req, ranked, pool, harvestNearMisses, stagesRun };
  }

  const stagesWanted = req.searchStages?.length
    ? req.searchStages
    : opts.mission?.stages?.map((s) =>
        s === 'places' || s === 'osm' || s === 'stay22' || s === 'events' || s === 'transit'
          ? 'web'
          : (s as 'pack' | 'neighbor' | 'metro' | 'web' | 'verify'),
      ) ?? ['pack', 'neighbor', 'metro', 'web', 'verify'];

  const allowWeb =
    !stagesWanted.length ||
    stagesWanted.includes('web') ||
    stagesWanted.includes('verify');

  // 1) Broaden (vibe→nice, city_best) wenn leer
  if (!ranked.top.length) {
    try {
      const retryReq = broadenDiningPitchRequest(req);
      const second = await opts.rank(retryReq);
      stagesRun.push('broaden');
      if (second.ranked.top.length) {
        ranked = {
          ...second.ranked,
          softFail: true,
          reason:
            second.ranked.reason ||
            'Zweite Suche (breitere Query) — harte Musts behalten.',
        };
        pool = second.pool;
        req = retryReq;
      } else if (second.pool.length > pool.length) {
        pool = second.pool;
        ranked = second.ranked;
        req = retryReq;
      }
    } catch {
      /* soft */
    }
  }

  // 2) Discovery Harvest vor Radius-Expand
  try {
    const {
      shouldRunDiscoveryHarvest,
      discoveryHarvest,
      harvestClaimsToSeedCandidates,
      filterHarvestClaims,
    } = await import('../pitch/discoveryHarvest');
    const packPerfect =
      pool.filter((c) => c.source === 'pack' || c.source === 'soft_seed').length >=
        2 &&
      ranked.top.length >= 2 &&
      !ranked.softFail &&
      !hasHardSoftMiss(ranked.criteriaChecklist);
    if (
      allowWeb &&
      !packPerfect &&
      shouldRunDiscoveryHarvest({
        kind: req.kind,
        topLen: ranked.top.length,
        softFail: ranked.softFail,
        checklist: ranked.criteriaChecklist,
      })
    ) {
      const harvested = await discoveryHarvest(req);
      stagesRun.push('web_harvest');
      const kept = filterHarvestClaims(harvested.claims, req);
      harvestNearMisses = harvestClaimsToSeedCandidates(
        kept.filter((c) => c.constraintFit === 'near_miss'),
        {
          lat: req.anchor?.lat ?? ranked.top[0]?.lat ?? 0,
          lng: req.anchor?.lng ?? ranked.top[0]?.lng ?? 0,
        },
        req,
      );
      const nameBoost = kept.map((c) => c.name).slice(0, 6).join(' ');
      if (nameBoost) {
        const harvestReq: PitchRequest = {
          ...req,
          title: `${req.title} ${nameBoost}`.slice(0, 160),
          context: `${req.context} harvest:${nameBoost}`.slice(0, 400),
        };
        const next = await opts.rank(harvestReq);
        if (isBetterRank(next.ranked, ranked, next.pool.length, pool.length)) {
          ranked = {
            ...next.ranked,
            softFail: next.ranked.softFail || ranked.softFail,
            reason:
              next.ranked.reason ||
              'Web-Guides/Harvest — Hard-Musts erneut geprüft.',
          };
          pool = next.pool;
          req = harvestReq;
        }
      }
    }
  } catch {
    /* soft */
  }

  // 3) Radius-Ringe (neighbor/metro)
  if (
    shouldRunMissionExpand({
      kind: req.kind,
      softFail: ranked.softFail,
      topLen: ranked.top.length,
      checklist: ranked.criteriaChecklist,
    })
  ) {
    const already = req.liveExpandRadiusM ?? 0;
    const rings = diningExpandRingsFor(req);
    for (const ring of rings) {
      if (ring <= already) continue;
      try {
        const expandReq = withLiveExpandRadius(
          broadenDiningPitchRequest(req),
          ring,
        );
        const next = await opts.rank(expandReq);
        stagesRun.push(`expand_${Math.round(ring / 1000)}km`);
        if (!isBetterRank(next.ranked, ranked, next.pool.length, pool.length)) {
          continue;
        }
        ranked = {
          ...next.ranked,
          softFail: next.ranked.softFail,
          reason: next.ranked.reason,
        };
        pool = next.pool;
        req = expandReq;
        const stillSoft = hasHardSoftMiss(next.ranked.criteriaChecklist);
        // Dual-Pitch: erst stoppen wenn ≥2 Must-Fit — ein Perfect reicht nicht
        if (next.ranked.top.length >= 2 && !stillSoft) break;
        if (next.ranked.top.length >= 2) break;
      } catch {
        /* soft — nächsten Ring */
      }
    }
    // Order.forbidSoftFill: nach Expand kein Soft-Pool behalten
    if (req.forbidSoftFill && ranked.softFail) {
      ranked = {
        ...ranked,
        top: [],
        softFail: true,
        reason: ranked.reason || 'order_forbid_soft_fill_empty',
      };
      stagesRun.push('forbid_soft_fill');
    }
  }

  // 4) Zweiter Web-Harvest wenn noch thin (until_evidence)
  if (
    allowWeb &&
    (ranked.softFail || ranked.top.length < 2) &&
    missionKindsUseStubbornLoop(req.kind)
  ) {
    try {
      const {
        shouldRunDiscoveryHarvest,
        discoveryHarvest,
        harvestClaimsToSeedCandidates,
      } = await import('../pitch/discoveryHarvest');
      if (
        shouldRunDiscoveryHarvest({
          kind: req.kind,
          topLen: ranked.top.length,
          softFail: true,
          checklist: ranked.criteriaChecklist,
        })
      ) {
        const harvested = await discoveryHarvest(req);
        stagesRun.push('web_harvest2');
        const seeds = harvestClaimsToSeedCandidates(
          harvested.claims.filter((c) => c.constraintFit !== 'rejected'),
          {
            lat: req.anchor?.lat ?? 53.55,
            lng: req.anchor?.lng ?? 9.99,
          },
        );
        const nameBoost = [
          ...harvested.rawNames.slice(0, 6),
          ...seeds.map((c) => c.name).slice(0, 4),
        ]
          .filter(Boolean)
          .join(' ');
        if (nameBoost) {
          const harvestReq: PitchRequest = {
            ...req,
            title: `${req.title} ${nameBoost}`.slice(0, 160),
            context: `${req.context} harvest2:${nameBoost}`.slice(0, 400),
            liveExpandRadiusM: Math.max(req.liveExpandRadiusM ?? 0, 100_000),
          };
          const next = await opts.rank(harvestReq);
          if (
            next.ranked.top.length > ranked.top.length ||
            (next.ranked.top.length >= 1 && ranked.top.length === 0)
          ) {
            ranked = next.ranked;
            pool = next.pool;
            req = harvestReq;
          }
        }
      }
    } catch {
      /* soft */
    }
  }

  stagesRun.push('verify');
  return { req, ranked, pool, harvestNearMisses, stagesRun };
}
