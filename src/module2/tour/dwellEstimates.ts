/**
 * Dwell-Schätzungen — Defaults + gelernte Kategorie-Zeiten.
 */

import { getLearnedCategoryDwell, setLearnedCategoryDwell } from './dwellLearning';
import type { TourCandidate } from './types';

const DEFAULTS: Array<{ re: RegExp; min: number; cat: string }> = [
  { re: /kirche|dom|kapelle/i, min: 12, cat: 'kirche' },
  { re: /museum|galerie/i, min: 25, cat: 'museum' },
  { re: /denkmal|statue/i, min: 4, cat: 'denkmal' },
  { re: /park|garten/i, min: 8, cat: 'park' },
  { re: /aussicht|turm|warte/i, min: 6, cat: 'aussicht' },
  { re: /hafen|promenade|strand/i, min: 8, cat: 'hafen' },
  { re: /platz|markt/i, min: 5, cat: 'platz' },
];

const FALLBACK_DWELL = 4;

function matchCat(blob: string): { min: number; cat: string } | null {
  for (const d of DEFAULTS) {
    if (d.re.test(blob)) return { min: d.min, cat: d.cat };
  }
  return null;
}

export function estimateDwellMin(c: {
  name: string;
  category?: string;
  tags?: string[];
}): number {
  const blob = `${c.name} ${c.category ?? ''} ${(c.tags ?? []).join(' ')}`;
  const hit = matchCat(blob);
  if (hit) {
    const learned = getLearnedCategoryDwell(hit.cat);
    return learned ?? hit.min;
  }
  const cat = (c.category || 'sight').toLowerCase();
  return getLearnedCategoryDwell(cat) ?? FALLBACK_DWELL;
}

export function estimateDwellForCandidate(c: TourCandidate): number {
  return estimateDwellMin({
    name: c.name,
    category: c.category,
    tags: c.tags,
  });
}

export function noteObservedDwell(opts: {
  name: string;
  category: string;
  dwellMin: number;
}): void {
  const blob = `${opts.name} ${opts.category}`;
  const hit = matchCat(blob);
  setLearnedCategoryDwell(hit?.cat ?? (opts.category || 'sight'), opts.dwellMin);
  try {
    const { useUserMemoryStore } = require('../../store/useUserMemoryStore') as {
      useUserMemoryStore: {
        getState: () => {
          upsertEntity?: (e: {
            type: string;
            name: string;
            dwellTimeMinutes: number;
            isConfirmed: boolean;
          }) => void;
        };
      };
    };
    useUserMemoryStore.getState().upsertEntity?.({
      type: 'attraction',
      name: opts.name,
      dwellTimeMinutes: opts.dwellMin,
      isConfirmed: false,
    });
  } catch {
    /* soft */
  }
}
