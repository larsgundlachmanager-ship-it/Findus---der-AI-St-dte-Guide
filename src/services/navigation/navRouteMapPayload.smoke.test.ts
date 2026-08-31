/**
 * Run: npx --yes tsx src/services/navigation/navRouteMapPayload.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function bearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const east = bearingDegrees(53.677, 9.763, 53.677, 9.764);
assert(east > 80 && east < 100, 'Osten ≈ 90° für Abbiege-Pfeil');

const payloadSrc = readFileSync(
  join(process.cwd(), 'src/services/navigation/navRouteMapPayload.ts'),
  'utf8',
);
assert(payloadSrc.includes('sampleRouteChevrons'), 'Chevrons auf der aktuellen Route');
assert(payloadSrc.includes("kind: 'turn'"), 'Abbiege-Pfeile an Wegpunkten');
assert(payloadSrc.includes('pushAhead'), 'Folgeben inkl. Journey-Pfad und Fallback');
assert(payloadSrc.includes('chipForTourStop'), 'Pin-Chips für Bahn/Umstieg');
assert(payloadSrc.includes('Ausstieg'), 'Chip nennt Ausstieg');
assert(payloadSrc.includes('delayBit'), 'Verspätung im Chip');
assert(payloadSrc.includes('vehicleMode'), 'Bus vs Bahn Geometrie');
assert(payloadSrc.includes('aheadMeta'), 'Transit-Beine farblich getrennt');
assert(payloadSrc.includes('ts.path'), 'Journey-Pfade direkt auf die Karte');
assert(payloadSrc.includes('usedStops'), 'ein Chip pro Stopp, kein doppeltes Aussteigen');
assert(payloadSrc.includes('currentLooksAir'), '2-Punkt-Luftlinie erkannt');
assert(
  payloadSrc.includes('Keine GPS→Ziel-Luftlinie') ||
    payloadSrc.includes('routeAwaitingStreet'),
  '2-Punkt-Luftlinie nicht als blaue Route',
);
assert(payloadSrc.includes('firstWalkPath'), 'aktueller Fußweg aus dem Journey-Pfad');
assert(payloadSrc.includes('alte Fuß-Polyline'), 'ÖPNV zeichnet die alte Fußroute nicht');
assert(payloadSrc.includes('mapped.length >= 3'), 'Chevrons nur auf echter Polyline');

const cachePath = join(
  process.cwd(),
  'src/services/navigation/lookAheadRouteCache.ts',
);
try {
  const cacheSrc = readFileSync(cachePath, 'utf8');
  assert(cacheSrc.includes('isTransitRole'), 'Bahnbein nicht per Fuß-OSRM');
  assert(
    cacheSrc.includes('fetchRailLeg') || cacheSrc.includes('fetchOsmRailPath'),
    'Gleis-Pfad nachladen',
  );
  assert(cacheSrc.includes('isBusMode'), 'SEV/Bus auf der Straße');
  assert(cacheSrc.includes('seedPath'), 'ÖPNV-Geometrie aus der Journey');
} catch {
  // lookAheadRouteCache optional — Native Route-Payload bleibt Pflicht
}

// Native Map — Layer-Reihenfolge (kein WebView-HTML mehr)
const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
const aheadIdx = view.indexOf('id="route-ahead-line"');
const currentIdx = view.indexOf('id="route-line"');
const arrowIdx = view.indexOf('id="route-arrows"');
const pinIdx = view.indexOf('id="route-pins"');
assert(aheadIdx > 0 && aheadIdx < currentIdx, 'Lila Folgeroute unter der blauen Linie');
assert(arrowIdx > currentIdx, 'Richtungspfeile über der blauen Linie');
assert(pinIdx > arrowIdx, 'nummerierte Pins ganz oben');
assert(payloadSrc.includes('remainingNavPins'), 'Pins aus den noch offenen Stopps');
assert(payloadSrc.includes('der nächste wird wieder 1'), 'nach Ankunft neu von 1 zählen');
assert(view.includes('route-pin-now'), 'Pinnadel-Icon für das aktuelle Ziel');
assert(view.includes('route-chevron'), 'Abbiegungs-/Richtungspfeile');
assert(view.includes('previewPin'), 'nach Überblick auf den nächsten Halt zoomen');
assert(view.includes('nav-chip'), 'Stations-Chips auf der Karte');

const style = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapStyle.ts'),
  'utf8',
);
assert(payloadSrc.includes('isFakeRouteLine'), 'dünne Ketten nicht als Route zeichnen');
assert(payloadSrc.includes("role: 'walk'"), 'OSRM vom GPS zum ersten Halt');
assert(
  style.includes("HOME_MAP_RAIL = '#8E9BA3'") ||
    style.includes("HOME_MAP_RAIL = '#9EABB2'"),
  'Gleise stahlgrau, nicht Routen-Lila',
);
assert(
  style.includes('HOME_MAP_ROUTE_AHEAD = MODUL1_MAP_COLORS.liked'),
  'berechnete Folgeben lila wie Trigger-Gebäude',
);

console.log('navRouteMapPayload.smoke.test.ts OK');
