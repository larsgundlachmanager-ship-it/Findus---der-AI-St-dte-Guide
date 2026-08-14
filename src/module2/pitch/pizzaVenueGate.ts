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

/** Echtes Pizza-/Italien-Signal im Venue-Blob (Name, Types, Reviews). */
export function hasPizzaVenueSignal(blob: string): boolean {
  return /\b(pizza|pizzeria|trattoria|osteria|italiener|italienisch)\b/.test(
    blob.toLowerCase(),
  );
}

export function isCrediblePizzaVenue(blob: string): boolean {
  if (isBeachLeisureWithoutPizza(blob)) return false;
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
