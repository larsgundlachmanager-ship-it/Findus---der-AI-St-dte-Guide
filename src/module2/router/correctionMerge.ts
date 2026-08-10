/**
 * Correction merge — pure, no RN imports (harness-safe).
 */

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
  if (!prev || !next) {
    return { mergedUserText: next, isCorrection: false };
  }
  const correctionCue =
    /\b(ich\s+meine|nein\s+doch|stattdessen|nicht\s+\w+\s+sondern|übermorgen|uebermorgen|anders|korrektur)\b/iu.test(
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
