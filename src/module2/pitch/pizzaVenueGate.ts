/**
 * Pizza-/Takeaway-Venue-Gate — Strandbad/Beach-Bar nie als Pizzeria verkaufen.
 * Stadt-agnostisch: nur Typ-/Name-Signale, keine Ort-Hardcodes.
 */

export function isBeachLeisureWithoutPizza(blob: string): boolean {
  const b = blob.toLowerCase();
  const leisure =
    /\b(strandbad|beach\s*bar|beachclub|strandbar|freibad|schwimmbad|baden\b|beach\s*club)\b/.test(
      b,
    ) || /\bstrand\b/.test(b) && /\b(bar|club|bad)\b/.test(b);
  if (!leisure) return false;
  return !/\b(pizza|pizzeria)\b/.test(b);
}

/** Pension/Hotel ohne echtes Gastro-Signal — nie als Pizzeria. */
export function isLodgingOnlyVenue(name: string, blob: string): boolean {
  const n = String(name || '').toLowerCase();
  const b = String(blob || '').toLowerCase();
  const lodgingName =
    /\b(pension|hotel|hostel|gasthof|gastehaus|gästehaus|apartment|ferienwohnung|airbnb)\b/.test(
      n,
    );
  if (!lodgingName && !/\b(pension|hostel|hotel|lodging)\b/.test(b)) return false;
  // Name ist klar Pizzeria/Restaurant → behalten
  if (/\b(pizzeria|pizza|restaurant|trattoria|osteria|ristorante)\b/.test(n)) {
    return false;
  }
  // Blob hat starkes Pizza-Signal im Angebot → behalten
  if (/\b(pizzeria|pizza\s+oven|steinofen|pizza\s+napoletana)\b/.test(b)) {
    return false;
  }
  return true;
}

/** Echtes Pizza-/Italien-Signal im Venue-Blob (Name, Types, Reviews). */
export function hasPizzaVenueSignal(blob: string): boolean {
  return /\b(pizza|pizzeria|trattoria|osteria|italiener|italienisch)\b/.test(
    blob.toLowerCase(),
  );
}

export function isCrediblePizzaVenue(blob: string, name?: string): boolean {
  if (isBeachLeisureWithoutPizza(blob)) return false;
  if (isLodgingOnlyVenue(name || '', blob)) return false;
  return hasPizzaVenueSignal(blob);
}

export function hasTakeawaySignal(blob: string): boolean {
  const b = blob.toLowerCase();
  if (
    /\b(takeaway|take[-\s]?away|to[-\s]?go|mitnehmen|zum\s+mitnehmen|meal_takeaway|delivery|abholen)\b/.test(
      b,
    )
  ) {
    return true;
  }
  // Pizzeria/Imbiss oft Takeaway-fähig ohne explizites Tag
  return /\b(pizzeria|imbiss)\b/.test(b);
}
