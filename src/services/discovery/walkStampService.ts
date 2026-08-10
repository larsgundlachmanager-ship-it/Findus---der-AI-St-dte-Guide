/**
 * Früher: Soft-Stempel bei bloßem Vorbeilaufen (GPS-Nähe).
 * Deaktiviert — Stempelkarte & Zeitachse nur bei:
 *   • Verweilen ≥ 2 Minuten am Ort (locationTracker), oder
 *   • Modul 1 startet (narrationPipeline → addVisitedPlace + stampModule1Visit)
 *
 * Fog-of-War nutzt den Walk-Track separat (walkTrackService), nicht die Stempelkarte.
 */

export function stampNearbyPoisFromWalk(_lat: number, _lng: number): void {
  // no-op — siehe Dateikommentar
}
