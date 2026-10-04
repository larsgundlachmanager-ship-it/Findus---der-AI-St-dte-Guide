/**
 * Welche Unterkunfts-Lanes der Funnel parallel abklopft
 * (Hotel · Fewo/Airbnb · Villa · Resort/AI).
 */

export type StayLodgingLane =
  | 'hotel'
  | 'apartment'
  | 'villa'
  | 'resort'
  | 'hostel';

export function lodgingLanesForSearch(opts: {
  preferred?: 'hotel' | 'apartment' | 'any' | null;
  preferAllInclusive?: boolean;
  /** mustHaves / wish blob */
  amenityBlob?: string;
  /** Max Lanes (Quota) */
  maxLanes?: number;
}): StayLodgingLane[] {
  const blob = (opts.amenityBlob || '').toLowerCase();
  const out: StayLodgingLane[] = [];
  const push = (l: StayLodgingLane) => {
    if (!out.includes(l)) out.push(l);
  };

  if (opts.preferAllInclusive || /all[\s-]?inclusive|resort|ultra\s*all/.test(blob)) {
    push('resort');
  }
  if (
    opts.preferred === 'apartment' ||
    /apartment|ferienwohnung|fewo|airbnb|appart/.test(blob)
  ) {
    push('apartment');
  }
  if (/villa|ferienhaus|finca|cottage|chalet/.test(blob)) {
    push('villa');
  }
  if (opts.preferred === 'hotel' || !out.length) {
    push('hotel');
  }
  // Immer Hotel + Fewo abdecken, wenn noch Platz
  push('hotel');
  push('apartment');
  if (opts.preferAllInclusive) push('resort');

  const max = opts.maxLanes ?? 3;
  return out.slice(0, max);
}

export function lodgingLanePromptHint(lane: StayLodgingLane): string {
  switch (lane) {
    case 'apartment':
      return 'Prefer apartments, holiday flats, Airbnb/VRBO-style rentals, aparthotels.';
    case 'villa':
      return 'Prefer villas, holiday houses, fincas with private pool when priced.';
    case 'resort':
      return 'Prefer all-inclusive resorts / club hotels with pool when priced.';
    case 'hostel':
      return 'Prefer hostels / budget dorms or private hostel rooms.';
    default:
      return 'Prefer hotels (and aparthotels) with live OTA prices.';
  }
}
