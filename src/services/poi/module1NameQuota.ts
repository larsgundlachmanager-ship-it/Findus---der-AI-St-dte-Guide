/**
 * Modul-1: User-Vorname sparsam — 1 Ort mit Name, dann 5 Orte ohne.
 */

let activePoiId: number | null = null;
/** Nach einem Namen: so viele weitere Orte ohne Name. */
let placesUntilNameAllowed = 0;
let allowNameForActivePoi = false;

const SKIP_PLACES_AFTER_NAME = 5;

/** Approach/Sub → Parent-ID, damit Wegweiser + Ankunft dieselbe Quote teilen. */
export function module1QuotaPoiId(poi: {
  id: number;
  parent_poi_id?: number | null;
  kind?: string | null;
}): number {
  const kind = poi.kind ?? 'legacy';
  if (
    (kind === 'approach' || kind === 'sub') &&
    poi.parent_poi_id != null &&
    Number.isFinite(poi.parent_poi_id)
  ) {
    return poi.parent_poi_id;
  }
  return poi.id;
}

/**
 * Pro Modul-1-Ort (Approach + Arrival = dieselbe Entscheidung).
 * @returns true → Vorname im Prompt/Offline-Hook erlaubt (max. 1× in diesem Spot).
 */
export function beginModule1PlaceNameQuota(poiId: number): boolean {
  if (!Number.isFinite(poiId)) return false;
  if (activePoiId === poiId) return allowNameForActivePoi;

  activePoiId = poiId;
  if (placesUntilNameAllowed > 0) {
    placesUntilNameAllowed -= 1;
    allowNameForActivePoi = false;
  } else {
    allowNameForActivePoi = true;
    placesUntilNameAllowed = SKIP_PLACES_AFTER_NAME;
  }
  return allowNameForActivePoi;
}

export function beginModule1PlaceNameQuotaForPoi(poi: {
  id: number;
  parent_poi_id?: number | null;
  kind?: string | null;
}): boolean {
  return beginModule1PlaceNameQuota(module1QuotaPoiId(poi));
}

export function peekModule1PlaceNameAllowed(poiId?: number | null): boolean {
  if (poiId != null && activePoiId === poiId) return allowNameForActivePoi;
  return placesUntilNameAllowed <= 0;
}

export function peekModule1PlaceNameAllowedForPoi(poi: {
  id: number;
  parent_poi_id?: number | null;
  kind?: string | null;
}): boolean {
  return peekModule1PlaceNameAllowed(module1QuotaPoiId(poi));
}

/** Nach erstem Aussprechen im Spot: kein zweites „Lars“ bei Ankunft nach Wegweiser. */
export function markModule1UserNameSpoken(): void {
  allowNameForActivePoi = false;
}

/** Tests / Session-Reset. */
export function resetModule1NameQuota(): void {
  activePoiId = null;
  placesUntilNameAllowed = 0;
  allowNameForActivePoi = false;
}

export function module1NameQuotaDebug(): {
  activePoiId: number | null;
  placesUntilNameAllowed: number;
  allowNameForActivePoi: boolean;
} {
  return {
    activePoiId,
    placesUntilNameAllowed,
    allowNameForActivePoi,
  };
}
