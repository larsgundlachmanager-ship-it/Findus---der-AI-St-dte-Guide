/** Reine Fit-Helfer für Stadt-Übersicht (ohne Expo/RN). */

export type CityFitBounds = {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  polygon?: Array<[number, number]>;
};

/** Viewport für Pins — gleiche BBox wie die Stadt-Übersicht. */
export function viewBoxFromCoverageBounds(bounds: CityFitBounds): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  return {
    south: bounds.latMin,
    west: bounds.lngMin,
    north: bounds.latMax,
    east: bounds.lngMax,
  };
}

/** Ring für `fitCity`: echtes Polygon, sonst BBox. */
export function ringForCityOverview(
  bounds: CityFitBounds,
): Array<[number, number]> {
  if (bounds.polygon && bounds.polygon.length >= 3) return bounds.polygon;
  return [
    [bounds.latMin, bounds.lngMin],
    [bounds.latMin, bounds.lngMax],
    [bounds.latMax, bounds.lngMax],
    [bounds.latMax, bounds.lngMin],
    [bounds.latMin, bounds.lngMin],
  ];
}
