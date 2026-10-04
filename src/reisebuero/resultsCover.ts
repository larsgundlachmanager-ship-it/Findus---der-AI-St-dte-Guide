/** Results-Grid: max. 4 Covers, Top-Favorit automatisch offen. */

export const RESULTS_COVER_MAX = 4;

export function buildResultsCoverState<T extends { id: string }>(opts: T[]): {
  options: T[];
  selectedOptionId: string | null;
  phase: 'results' | 'detail';
} {
  const options = opts.slice(0, RESULTS_COVER_MAX);
  const fav = options[0]?.id ?? null;
  return {
    options,
    selectedOptionId: fav,
    phase: fav ? 'detail' : 'results',
  };
}
