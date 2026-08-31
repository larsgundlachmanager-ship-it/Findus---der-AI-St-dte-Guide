/**
 * Correction merge — pure, no RN imports (harness-safe).
 */

import { extractStreetAddressFromUtterance } from '../../services/navigation/streetAddressQuery';
import { resolveNavDestCorrection } from '../../services/navigation/navDestCityCorrection';

export type CorrectionMerge = {
  mergedUserText: string;
  isCorrection: boolean;
};

/** Merge barge-in correction into previous intent (morgen → übermorgen). */
export function mergeCorrectionUtterance(opts: {
  previousUserText: string | null | undefined;
  newUserText: string;
}): CorrectionMerge {
  const prev = (opts.previousUserText || '').trim();
  const next = (opts.newUserText || '').trim();
  if (!next) {
    return { mergedUserText: next, isCorrection: false };
  }
  const streetFromPrev =
    extractStreetAddressFromUtterance(prev) || prev || null;
  const destCorr = resolveNavDestCorrection({
    userText: next,
    lastStreetQuery: streetFromPrev,
    currentDestName: prev || null,
  });
  if (destCorr) {
    const hasAddr = Boolean(extractStreetAddressFromUtterance(next));
    const cue =
      /\b(nein|nicht|sondern|ich\s+meinte?|es\s+ist|falsch|stattdessen|in)\b/iu.test(
        next,
      );
    if (hasAddr || (prev && cue)) {
      return { mergedUserText: destCorr, isCorrection: true };
    }
  }
  if (!prev) {
    return { mergedUserText: next, isCorrection: false };
  }
  const correctionCue =
    /\b(ich\s+meine|ich\s+meinte|nein\s+doch|stattdessen|nicht\s+\w+\s+sondern|übermorgen|uebermorgen|anders|korrektur|nein[,.]?\s+(?:es\s+ist|in)|es\s+ist)\b/iu.test(
      next,
    ) ||
    (next.length < 48 &&
      /\b(morgen|heute|übermorgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu.test(
        next,
      ) &&
      prev.length > 20);
  if (!correctionCue) {
    return { mergedUserText: next, isCorrection: false };
  }
  return {
    mergedUserText: `${prev}\n[Korrektur/Update des Users]: ${next}`,
    isCorrection: true,
  };
}
