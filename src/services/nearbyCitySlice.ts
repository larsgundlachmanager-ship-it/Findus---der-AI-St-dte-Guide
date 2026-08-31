/**
 * Stadt-Picker: ohne Suche nur die nächsten Orte, nicht den ganzen Katalog.
 */

export const CITY_PICKER_NEARBY_LIMIT = 8;

export function sliceNearbyCities<T extends { id: string }>(
  cities: T[],
  opts: {
    excludeId?: string | null;
    limit?: number;
  } = {},
): T[] {
  const excludeId = opts.excludeId ?? null;
  const limit = opts.limit ?? CITY_PICKER_NEARBY_LIMIT;
  const pool = excludeId ? cities.filter((c) => c.id !== excludeId) : cities;
  return pool.slice(0, limit);
}
