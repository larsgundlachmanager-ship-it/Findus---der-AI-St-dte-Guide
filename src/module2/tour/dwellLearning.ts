/**
 * Gelernte Dwell-Kategorien (lokal, File-frei — Session + Soft-Persist über Memory-Entities).
 */

const learnedCat = new Map<string, number>();

export function getLearnedCategoryDwell(category: string): number | null {
  const v = learnedCat.get(category.toLowerCase());
  return v != null && v > 0 ? v : null;
}

export function setLearnedCategoryDwell(category: string, min: number): void {
  const key = category.toLowerCase();
  const prev = learnedCat.get(key);
  const next =
    prev == null ? min : Math.round(prev * 0.6 + Math.max(2, min) * 0.4);
  learnedCat.set(key, Math.min(90, Math.max(2, next)));
}
