/**
 * Ordered Stay22 lodging attempts — prefer first, widen before empty UI.
 */

export type StayLodgingType = 'hotel' | 'apartment' | 'any';

export function stayLodgingSearchOrder(opts: {
  preferred: StayLodgingType;
  /** from ledger.lodgingFallback */
  fallback?: StayLodgingType | null;
  researchPath?: 'stay_first' | 'flight_first' | 'route_tour' | string;
  /** All-Inclusive = Hotel-Erstspur, Fewo parallel als Zweit. */
  preferAllInclusive?: boolean;
}): StayLodgingType[] {
  const { preferred, fallback = null, researchPath, preferAllInclusive } = opts;

  if (preferAllInclusive) {
    return ['hotel', 'apartment', 'any'];
  }

  if (preferred === 'any') {
    // stay_first leans apartment; else hotel-first. No trailing 'any'.
    return researchPath === 'stay_first'
      ? ['apartment', 'hotel']
      : ['hotel', 'apartment'];
  }

  const out: StayLodgingType[] = [];
  const push = (t: StayLodgingType) => {
    if (!out.includes(t) && out.length < 4) out.push(t);
  };

  push(preferred);

  if (
    (fallback === 'hotel' || fallback === 'apartment') &&
    fallback !== preferred
  ) {
    push(fallback);
  }

  // Append the other of hotel|apartment
  push(preferred === 'hotel' ? 'apartment' : 'hotel');
  push('any');

  return out;
}
