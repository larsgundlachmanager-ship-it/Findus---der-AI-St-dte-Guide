/**
 * Distanz-SSOT für Speech: nur committed Routenmeter (OSRM/Store), nie LLM/Luftlinie.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { formatDistanceKmOrM, formatDurationMinutesDe } from './travelEta';

/** „1,2 km“ / „800 m“ plus optionales „· ca. 12 Min“ direkt dahinter. */
const DIST_WITH_OPTIONAL_ETA_RE =
  /\b\d{1,3}(?:[.,]\d{1,2})?\s*(?:km|kilometer|kilometern)\b(?:\s*[·•,]\s*(?:ca\.?\s*)?\d{1,3}\s*Min(?:uten)?)?|\b\d{1,5}\s*(?:m|meter|metern)\b(?:\s*[·•,]\s*(?:ca\.?\s*)?\d{1,3}\s*Min(?:uten)?)?/giu;

export type CommittedRoutePhrase = {
  distanceM: number;
  etaMin: number | null;
  distanceLabel: string;
  etaLabel: string;
};

function collapseWs(s: string): string {
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

function looksLikeNavDistanceSpeech(speech: string): boolean {
  DIST_WITH_OPTIONAL_ETA_RE.lastIndex = 0;
  return (
    DIST_WITH_OPTIONAL_ETA_RE.test(speech) ||
    /\b(führ|fuehr|route|kompass|laufen|gehzeit|kilometer)\b/iu.test(speech)
  );
}

/**
 * Nur Meter, die nach Route-Enrich im Store/Meta stehen — nicht während Loading.
 */
export function getCommittedRoutePhrase(): CommittedRoutePhrase | null {
  try {
    const store = useFinnusStore.getState();
    if (store.navRouteLoading) return null;
    let meta: { distanceM: number; etaMin: number } | null = null;
    try {
      const { getLastProgressiveStartMeta } = require('./handsFreeNav/startNav') as {
        getLastProgressiveStartMeta: () => {
          distanceM: number;
          etaMin: number;
        } | null;
      };
      meta = getLastProgressiveStartMeta();
    } catch {
      meta = null;
    }
    const metersRaw =
      meta?.distanceM ?? store.navTotalDistanceM ?? store.navDistanceM;
    if (typeof metersRaw !== 'number' || !Number.isFinite(metersRaw) || metersRaw <= 0) {
      return null;
    }
    const distanceM = Math.round(metersRaw);
    const etaMin =
      meta?.etaMin != null && Number.isFinite(meta.etaMin)
        ? Math.max(1, Math.round(meta.etaMin))
        : store.navEtaMin != null && Number.isFinite(store.navEtaMin)
          ? Math.max(1, Math.round(store.navEtaMin))
          : null;
    return {
      distanceM,
      etaMin,
      distanceLabel: formatDistanceKmOrM(distanceM),
      etaLabel: etaMin != null ? formatDurationMinutesDe(etaMin, 'short') : '',
    };
  } catch {
    return null;
  }
}

function stripDistanceGuesses(speech: string): string {
  DIST_WITH_OPTIONAL_ETA_RE.lastIndex = 0;
  return collapseWs(speech.replace(DIST_WITH_OPTIONAL_ETA_RE, ''));
}

/**
 * Nav-Speech an committed Route binden.
 * Keine Route-Meter → Distanz-Rate aus der Speech streichen (nicht raten).
 */
export function bindSpeechToCommittedRoute(
  speech: string,
  opts?: { appendIfMissing?: boolean },
): string {
  const raw = (speech ?? '').trim();
  if (!raw) return raw;
  let navActive = false;
  try {
    navActive = useFinnusStore.getState().navActive === true;
  } catch {
    navActive = false;
  }
  if (!navActive) return raw;

  DIST_WITH_OPTIONAL_ETA_RE.lastIndex = 0;
  const hasDist = DIST_WITH_OPTIONAL_ETA_RE.test(raw);
  DIST_WITH_OPTIONAL_ETA_RE.lastIndex = 0;
  if (!hasDist && !opts?.appendIfMissing && !looksLikeNavDistanceSpeech(raw)) {
    return raw;
  }

  const phrase = getCommittedRoutePhrase();
  if (!phrase) {
    return hasDist ? stripDistanceGuesses(raw) : raw;
  }

  const replacement = phrase.etaLabel
    ? `${phrase.distanceLabel} · ${phrase.etaLabel}`
    : phrase.distanceLabel;

  if (hasDist) {
    let first = true;
    const out = raw.replace(DIST_WITH_OPTIONAL_ETA_RE, () => {
      if (!first) return '';
      first = false;
      return replacement;
    });
    return collapseWs(out);
  }

  if (opts?.appendIfMissing && looksLikeNavDistanceSpeech(raw)) {
    return collapseWs(`${raw.replace(/\.\s*$/, '')} — ${replacement}.`);
  }
  return raw;
}
