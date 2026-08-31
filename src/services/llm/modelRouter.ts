/**
 * LLM Cost Router — Flash-Lite ~99%, Pro nur wenn Flash überfordert ist.
 */

import {
  GEMINI_MODEL,
  GEMINI_MODEL_FALLBACKS,
  GEMINI_MODEL_PRO,
  GEMINI_MODEL_PRO_FALLBACKS,
} from '../../constants/gemini';
import { getCachedUserProfile } from '../userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';

export type GeminiModelTier = 'lite' | 'pro';

export type GeminiTaskKind =
  | 'nav_parse'
  | 'weather'
  | 'local_qa'
  | 'intent'
  | 'teaser'
  | 'concierge'
  | 'story'
  | 'history_deep'
  | 'itinerary'
  | 'research'
  | 'generic';

export type ResolveGeminiTierInput = {
  /** Explicit override — highest priority after forcePro. */
  tier?: GeminiModelTier;
  /** Hard Pro (caller already decided Flash failed / emergency). */
  forcePro?: boolean;
  task?: GeminiTaskKind;
  /** Multi-stop count (informational; does NOT auto-select Pro). */
  stopCount?: number;
  /** Flash already failed / returned thin answer → escalate to Pro once. */
  flashFailed?: boolean;
};

export function isPremiumSubscriber(): boolean {
  try {
    const profile = getCachedUserProfile();
    if (profile?.isPremiumSubscriber === true) return true;
  } catch {
    /* ignore */
  }
  try {
    return useFinnusStore.getState().isPremiumSubscriber === true;
  } catch {
    return false;
  }
}

/**
 * Default: Flash-Lite.
 * Pro ONLY if:
 * 1. forcePro / explicit tier=pro
 * 2. flashFailed === true (Flash thin/empty/overwhelmed → one Pro assist)
 *
 * Premium does NOT force Pro (cost: stay on Flash ~99%).
 */
export function resolveGeminiTier(
  input?: ResolveGeminiTierInput,
): GeminiModelTier {
  if (input?.forcePro === true || input?.tier === 'pro') return 'pro';
  if (input?.tier === 'lite') return 'lite';
  if (input?.flashFailed === true) return 'pro';
  return 'lite';
}

/** Ordered model IDs for the chosen tier. */
export function resolveGeminiModels(
  input?: ResolveGeminiTierInput,
): string[] {
  const tier = resolveGeminiTier(input);
  if (tier === 'pro') {
    return [GEMINI_MODEL_PRO, ...GEMINI_MODEL_PRO_FALLBACKS];
  }
  return [GEMINI_MODEL, ...GEMINI_MODEL_FALLBACKS];
}

/**
 * Flash → Pro when answer volume/quality is insufficient (Flash überfordert).
 */
export function shouldEscalateToProForInsufficientAnswer(
  flashText: string,
  opts?: { minChars?: number; task?: GeminiTaskKind },
): boolean {
  const minChars = opts?.minChars ?? 60;
  const t = flashText.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (t.length < minChars) return true;
  if (
    /^(sorry|entschuldig|weiß nicht|weiss nicht|keine ahnung|kann ich (?:dir )?nicht)/i.test(
      t,
    )
  ) {
    return true;
  }
  // Intent JSON that is empty / useless
  if (opts?.task === 'intent' && t.length < 40) return true;
  return false;
}

/**
 * After Flash looks empty/thin, escalate once to Pro (any task).
 * Stories/teasers are gated in generateGeminiText (allowProEscalate + daily cap).
 */
export function shouldEscalateHistoryToPro(
  flashText: string,
  task?: GeminiTaskKind,
): boolean {
  // history_deep / teaser: never escalate on thin text alone (cost P0)
  if (task === 'history_deep' || task === 'teaser') {
    const t = flashText.replace(/\s+/g, ' ').trim();
    return !t;
  }
  const min =
    task === 'intent' || task === 'nav_parse'
      ? 40
      : task === 'concierge'
        ? 48
        : 80;
  return shouldEscalateToProForInsufficientAnswer(flashText, {
    minChars: min,
    task,
  });
}
