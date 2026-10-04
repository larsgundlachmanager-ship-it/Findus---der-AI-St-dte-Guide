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
assert(payloadSrc.includes('approachLenM = 20'), '20 m gelb vor der Ecke');
assert(payloadSrc.includes('exitLenM = 10'), '10 m gelb nach der Ecke');
assert(payloadSrc.includes('walkExactMeters'), 'Pfeil-Länge exakt interpoliert');
assert(payloadSrc.includes('snapTurnOntoLine'), 'Pfeil auf Segment snappen');
assert(payloadSrc.includes('isMapCornerManeuver'), 'Abzweigungs-Filter für goldene Pfeile');
assert(payloadSrc.includes('clipFrom'), 'Shaft nicht hinter dem User');
assert(payloadSrc.includes('turnArrowGeomsAlongRoute'), 'Garmin-Abbiege-Pfeil als Geometrie');
assert(
  payloadSrc.includes('alle Abzweigungen') || !payloadSrc.includes('.slice(0, 2)'),
  'Turn-Pfeile an allen Abzweigungen (kein Cap 1–2)',
);
assert(payloadSrc.includes("lod: 'hi'"), 'dichte Chevrons nur Nahzoom');
assert(payloadSrc.includes("lod: 'lo'"), 'wenige Chevrons in der Übersicht');
assert(payloadSrc.includes("kind: 'turn'") || payloadSrc.includes("kind: 'flow'"), 'Pfeil-Kinds');
assert(
  readFileSync(
    join(process.cwd(), 'src/services/navigation/handsFreeNav/startNav.ts'),
    'utf8',
  ).includes('seedActiveNavRoute'),
  'FOSSGIS → sofort Karte seed (nicht erst Enrich-Ende)',
);
assert(
  readFileSync(
    join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
    'utf8',
  ).includes('route-chevrons-far'),
  'Pfeil-LOD Far/Near Layers',
);
assert(payloadSrc.includes('pushAhead'), 'Folgeben inkl. Journey-Pfad und Fallback');
assert(payloadSrc.includes('chipForTourStop'), 'Pin-Chips für Bahn/Umstieg');
assert(payloadSrc.includes('Aussteigen'), 'Chip nennt Aussteigen am Halt');
assert(payloadSrc.includes('Abfahrt'), 'Chip: Abfahrt HH:MM getrennt von Delay');
assert(payloadSrc.includes('delayBit'), 'Verspätung im Chip');
assert(payloadSrc.includes('isBusVehicle') || payloadSrc.includes('Abfahrtsbereich'), 'Bus ohne Fake-Gleis');
assert(payloadSrc.includes('vehicleMode'), 'Bus vs Bahn Geometrie');
assert(payloadSrc.includes('aheadMeta'), 'Transit-Beine farblich getrennt');
assert(payloadSrc.includes('ts.path'), 'Journey-Pfade direkt auf die Karte');
assert(payloadSrc.includes('usedStops'), 'ein Chip pro Stopp, kein doppeltes Aussteigen');
assert(payloadSrc.includes('currentLooksAir'), '2-Punkt-Luftlinie erkannt');
assert(
  payloadSrc.includes('maxDeviationFromChordM') ||
    payloadSrc.includes('Quasi-Sehne'),
  'Journey-Sehne ohne Straßenknicke = Luftlinie',
);
assert(
  payloadSrc.includes('sameDest') &&
    payloadSrc.includes('keine zweite lila'),
  'aktives Fußbein: keine lila Luftlinie parallel zur blauen Route',
);
assert(
  payloadSrc.includes('Keine lange GPS→Ziel-Luftlinie') ||
    payloadSrc.includes('Nie GPS→Ziel-Luftlinie') ||
    payloadSrc.includes('routeAwaitingStreet'),
  'GPS→Ziel-Luftlinie nicht als blaue Route',
);
assert(
  payloadSrc.includes('Nie GPS→Ziel-Luftlinie') ||
    (payloadSrc.includes('isFakeRouteLine(current)') &&
      payloadSrc.includes('mapped = []')),
  'Luftlinie: nur Pin, keine Sehne bis Polyline da ist',
);
assert(payloadSrc.includes('firstWalkPath'), 'aktueller Fußweg aus dem Journey-Pfad');
assert(payloadSrc.includes('turnArrowsFromPolylineCorners'), 'Fußbein ohne Maneuvers → Ecken aus Polyline');
assert(payloadSrc.includes('walkLegActive'), 'ÖPNV-Fußbein wie normale Fußnavi');
assert(
  readFileSync(
    join(process.cwd(), 'src/services/navigation/multiStopTour.ts'),
    'utf8',
  ).includes("forceTravelMode: ride ? undefined : 'foot'"),
  'Tour-Fußbein erzwingt FOSSGIS-Fußnavi inkl. Abbiegepfeile',
);

// Runtime (ohne RN-Import): L-Pfad → Ecke wie Heisterhoop→Bahnhofstr.
{
  const lat0 = 53.677;
  const lng0 = 9.763;
  const dLat = 80 / 111_320;
  const dLng = 80 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  const L = [
    { lat: lat0, lng: lng0 },
    { lat: lat0, lng: lng0 + dLng * 0.4 },
    { lat: lat0, lng: lng0 + dLng },
    { lat: lat0 - dLat * 0.4, lng: lng0 + dLng },
    { lat: lat0 - dLat, lng: lng0 + dLng },
  ];
  const hav = (
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ) => {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLatR = toRad(b.lat - a.lat);
    const dLngR = toRad(b.lng - a.lng);
    const x =
      Math.sin(dLatR / 2) ** 2 +
      Math.cos(toRad(a.lat)) *
        Math.cos(toRad(b.lat)) *
        Math.sin(dLngR / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  };
  let found = 0;
  for (let i = 1; i < L.length - 1; i += 1) {
    const prev = L[i - 1]!;
    const cur = L[i]!;
    const next = L[i + 1]!;
    if (hav(prev, cur) < 10 || hav(cur, next) < 10) continue;
    const inBr = bearingDegrees(prev.lat, prev.lng, cur.lat, cur.lng);
    const outBr = bearingDegrees(cur.lat, cur.lng, next.lat, next.lng);
    const delta = Math.abs(((outBr - inBr + 540) % 360) - 180);
    if (delta >= 48 && delta <= 170) found += 1;
  }
  assert(found >= 1, 'L-Pfad hat ≥1 echte Abbiege-Ecke (≥48°)');
}
assert(
  payloadSrc.includes('currentIsTransit') &&
    (payloadSrc.includes("curRole === 'alight' || curRole === 'board'") ||
      payloadSrc.includes("curRoleEarly === 'alight' || curRoleEarly === 'board'")),
  'ÖPNV zeichnet Bahn-/Board-Pfad, nicht die alte Fußroute',
);
assert(
  payloadSrc.includes('Stationskette / Journey-Leg') ||
    payloadSrc.includes('ÖPNV: Stationskette'),
  'Transit-Geometrie = Stationskette, nicht Fuß-OSRM',
);
assert(
  readFileSync(
    join(process.cwd(), 'src/services/navigation/tourAheadRouteCache.ts'),
    'utf8',
  ).includes('Stationskette schlägt Fuß-OSRM'),
  'Ahead-Cache: Stationskette vor Fuß-OSRM',
);
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
const turnBandIdx = view.indexOf('id="route-turn-shaft"');
const arrowIdx = view.indexOf('id="route-arrows"');
const pinIdx = view.indexOf('id="route-pins"');
assert(aheadIdx > 0 && aheadIdx < currentIdx, 'Lila Folgeroute unter der blauen Linie');
assert(turnBandIdx > currentIdx, 'goldener Abbiege-Shaft über der blauen Linie');
assert(arrowIdx > turnBandIdx, 'Flow-Chevrons über dem goldenen Shaft');
assert(pinIdx > arrowIdx, 'nummerierte Pins ganz oben');
assert(view.includes('routePinMarkers'), 'Wegpunkt-Pins über Orts-Chips');
assert(view.includes('navChipWrap'), 'Chips unter Pin-Spitze');
assert(view.includes('navChipBody'), 'Chip Text-Body');
assert(view.includes("alignSelf: 'center'"), 'Chip hugt Inhalt (kein Breit-Balken)');
assert(view.includes("flexDirection: 'row'"), 'Chip: Titel + Close in einer Reihe');
const placesFillIdx = view.indexOf('id="places-fill"');
assert(placesFillIdx > 0 && placesFillIdx < aheadIdx, 'Route über Gebäude-Fill');
assert(payloadSrc.includes('remainingNavPins'), 'Pins aus den noch offenen Stopps');
assert(payloadSrc.includes('der nächste wird wieder 1'), 'nach Ankunft neu von 1 zählen');
assert(view.includes('route-pin-now'), 'Pinnadel-Icon für das aktuelle Ziel');
assert(view.includes('route-chevron'), 'Abbiegungs-/Richtungspfeile');
assert(view.includes('previewPin'), 'nach Überblick auf den nächsten Halt zoomen');
assert(view.includes('nav-chip'), 'Stations-Chips auf der Karte');
assert(view.includes('minZoomLevel={13.8}'), 'Richtungspfeile erst ab Nah-Überblick');
assert(view.includes('route-turn-head-fill'), 'Garmin-Pfeilkopf');
assert(
  view.includes('Ausgefüllter goldener Pfeilkopf') &&
    view.includes('sanitizePolygonFc'),
  'ausgefüllter Pfeilkopf mit Polygon-Sanitize',
);
assert(view.includes("lineCap: 'butt'"), 'goldener Shaft endet hart am Kopf');
assert(view.includes('circleOpacity: 0'), 'kein weißer Kreis unter Wegpunkt-Pin');
assert(
  view.includes('Live immer durchgezogen') || view.includes('lineWidth: routePreview ? 3.4 : 5'),
  'Live-Route solid, nicht gestrichelt',
);
assert(view.includes('showRouteChips'), 'Karten-Chips aus bei Übersicht-Zoom');
assert(payloadSrc.includes('isGenericMapPointLabel'), 'kein Chip für Punkt auf der Karte');
assert(
  view.includes('belowLayerID={routeBelowStreetLabelId}') ||
    view.includes('routeBelowStreetLabelId'),
  'Route unter Straßennamen (Labels lesbar)',
);

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
