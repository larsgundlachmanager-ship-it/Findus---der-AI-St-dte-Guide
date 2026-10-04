/**
 * Call-1 Latency / Research Bridge-Tiers — härten, kein Rewrite.
 * SSOT: docs/rfc/agent-harden-contract.md · Bridge parallel = kickCall1ParallelWork.
 */

import type { Call1JobShape } from './call1JobShape';
import { inferCall1JobShape } from './call1JobShape';

export type Call1ResearchTier = 'instant' | 'standard' | 'cover';

export type Call1ResearchTierPlan = {
  tier: Call1ResearchTier;
  /** Bridge word budget hint for Call-1 JSON */
  bridgeMaxWords: number;
  /** Recherche/Pitch/Nav startet parallel zur Bridge-TTS */
  parallelWorkExpected: boolean;
  /** Grobe Call-2-Ziel-Latenz (Sekunden) für spoken_slow */
  latencyHintSec: number | null;
};

const TIER_WORDS: Record<Call1ResearchTier, number> = {
  instant: 22,
  standard: 36,
  cover: 52,
};

function instantFactAsk(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(wie\s+alt|alter\s+von|rechnung|hauptstadt|einwohner|wer\s+ist|was\s+ist\s+(?:das|ein)|quiz|trivia)\b/iu.test(
      t,
    ) && !/\b(restaurant|essen|hotel|flug|navig|wetter)\b/iu.test(t)
  );
}

function coverResearchAsk(text: string, shape: Call1JobShape): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (
    shape === 'place_dining' ||
    shape === 'trip_package' ||
    shape === 'arrival_home' ||
    shape === 'logistics_multi'
  ) {
    return true;
  }
  try {
    const { looksLikeSpecialtyFoodAsk } = require('../pitch/specializedFoodMatch') as {
      looksLikeSpecialtyFoodAsk: (s: string) => boolean;
    };
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    if (looksLikeSpecialtyFoodAsk(t) || looksLikeAyceQuery(t)) return true;
  } catch {
    /* soft */
  }
  if (
    /\b(hotel|zimmer|speisekarte|programm|kino|karten|specialty|all[\s-]?you[\s-]?can)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Tier aus JobShape + Satz — Call-1 JSON (pace/latencyHintSec) darf überschreiben. */
export function inferCall1ResearchTier(opts: {
  userText: string;
  jobShape?: Call1JobShape | null;
  pace?: string | null;
  latencyHintSec?: number | null;
}): Call1ResearchTierPlan {
  const text = String(opts.userText || '').replace(/\s+/g, ' ').trim();
  const shape =
    opts.jobShape && opts.jobShape !== 'unknown'
      ? opts.jobShape
      : inferCall1JobShape(text);
  const pace = String(opts.pace || '').toLowerCase();

  let tier: Call1ResearchTier = 'standard';
  if (instantFactAsk(text) || shape === 'fact_lookup') {
    tier = 'instant';
  } else if (
    coverResearchAsk(text, shape) ||
    pace === 'spoken_slow' ||
    (typeof opts.latencyHintSec === 'number' && opts.latencyHintSec >= 8)
  ) {
    tier = 'cover';
  } else if (
    shape === 'weather_info' ||
    shape === 'weather_rain' ||
    shape === 'weather_outfit' ||
    shape === 'logistics' ||
    shape === 'schedule_write'
  ) {
    tier = 'standard';
  }

  const latencyHintSec =
    typeof opts.latencyHintSec === 'number' && Number.isFinite(opts.latencyHintSec)
      ? Math.min(30, Math.max(5, Math.round(opts.latencyHintSec)))
      : tier === 'cover'
        ? 12
        : tier === 'instant'
          ? null
          : 8;

  return {
    tier,
    bridgeMaxWords: TIER_WORDS[tier],
    parallelWorkExpected: tier !== 'instant' || shape === 'place_dining',
    latencyHintSec,
  };
}

export function formatResearchTierHint(plan: Call1ResearchTierPlan): string {
  return `researchTier=${plan.tier} bridgeMaxWords≈${plan.bridgeMaxWords} parallelWork=${plan.parallelWorkExpected ? 'yes' : 'peek_only'}`;
}
