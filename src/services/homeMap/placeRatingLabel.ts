/**
 * Bewertungs-Wortlaut für Ort-Popup / Stichpunkte — keine Sternzahlen.
 *
 * top ≥ 4.5 · gut ≥ 4.0 · okay ≥ 3.5 · schlechter < 3.5
 */

export type PlaceRatingBucket =
  | 'top'
  | 'gut'
  | 'okay'
  | 'schlechter';

export function placeRatingBucket(
  rating: number | null | undefined,
): PlaceRatingBucket | null {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return null;
  if (rating >= 4.5) return 'top';
  if (rating >= 4.0) return 'gut';
  if (rating >= 3.5) return 'okay';
  return 'schlechter';
}

/** UI/Stichpunkt: „top bewertet“ … — ohne ★ und ohne Rohzahl. */
export function placeRatingLabel(
  rating: number | null | undefined,
  _ratingCount?: number | null,
): string | null {
  const b = placeRatingBucket(rating);
  if (!b) return null;
  switch (b) {
    case 'top':
      return 'top bewertet';
    case 'gut':
      return 'gut bewertet';
    case 'okay':
      return 'okay bewertet';
    case 'schlechter':
      return 'schlechter bewertet';
    default:
      return null;
  }
}
