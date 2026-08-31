/**
 * Zoom-LOD: Detail (Orte) ↔ Stadtflächen ↔ Regional/DE.
 * Visibility-only — keine Layer-Rebuilds.
 */

export type HomeMapLodMode = 'detail' | 'city' | 'region';

/** Stadtgrenze füllt Viewport → city; noch weiter raus → region. */
export function resolveHomeMapLod(opts: {
  zoom: number;
  /** true wenn aktuelle Stadtgrenze vollständig im Viewport liegt */
  cityFullyVisible: boolean;
}): HomeMapLodMode {
  const z = opts.zoom;
  if (z <= 7.5) return 'region';
  // Orte ab ~13 (Gebäude-Zoom). cityFullyVisible darf Street-Zoom nicht blockieren.
  if (z >= 13) return 'detail';
  if (opts.cityFullyVisible || z < 13) return 'city';
  return 'detail';
}

/** Hysterese gegen Flackern Detail↔City. */
export function resolveHomeMapLodStable(
  prev: HomeMapLodMode,
  next: HomeMapLodMode,
): HomeMapLodMode {
  if (prev === next) return next;
  // detail → city nur wenn klar city; city → detail nur wenn klar detail
  if (prev === 'detail' && next === 'city') return 'city';
  if (prev === 'city' && next === 'detail') return 'detail';
  if (prev === 'city' && next === 'region') return 'region';
  if (prev === 'region' && next === 'city') return 'city';
  if (prev === 'detail' && next === 'region') return 'region';
  if (prev === 'region' && next === 'detail') return 'city';
  return next;
}

export function cityFullyVisibleInBounds(opts: {
  viewSouth: number;
  viewWest: number;
  viewNorth: number;
  viewEast: number;
  cityLatMin: number;
  cityLngMin: number;
  cityLatMax: number;
  cityLngMax: number;
  /** Extra Pad — Stadt muss klar „drin“ sein */
  padRatio?: number;
}): boolean {
  const pad = opts.padRatio ?? 0.04;
  const dLat = (opts.cityLatMax - opts.cityLatMin) * pad;
  const dLng = (opts.cityLngMax - opts.cityLngMin) * pad;
  return (
    opts.viewSouth <= opts.cityLatMin - dLat &&
    opts.viewWest <= opts.cityLngMin - dLng &&
    opts.viewNorth >= opts.cityLatMax + dLat &&
    opts.viewEast >= opts.cityLngMax + dLng
  );
}
