/**
 * Nav speed / route-lock / fog / map UX contract.
 * Run: npx --yes tsx src/services/navigation/navSpeedStability.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const payload = read('src/services/navigation/navRouteMapPayload.ts');
assert(
  payload.includes('getRemainingRouteCoords') &&
    payload.includes('never unshift GPS'),
  'Remaining-Trim statt GPS-unshift',
);
assert(payload.includes('farFromPuck'), 'Flow-Chevrons nicht am GPS-Puck');

const navSvc = read('src/services/navigation/navigationService.ts');
assert(navSvc.includes('Route-Lock'), 'kein Shortcut-Dauer-Recalc');
assert(!navSvc.includes('ich nehme die Radwege'), 'kein Bike-Switch-Speak');
assert(
  navSvc.includes('offPathMinM: offRouteThresholdM'),
  'Bike Off-Path-Schwelle',
);
assert(navSvc.includes('Dual-watcher Dedupe'), 'GPS-Tick Dedupe');
assert(
  navSvc.includes('isForegroundLocationWatchActive') &&
    navSvc.includes('no duplicate watch'),
  'Single GPS watcher prefers locationService',
);
assert(
  navSvc.includes('DEAD_END_BIKE_MIN_MS') &&
    navSvc.includes('allowDeadEndProbe'),
  'Dead-end probe throttled on bike',
);

const ww = read('src/services/navigation/wrongWayMonitor.ts');
assert(ww.includes('AFTER_WARN_BEFORE_REROUTE_M'), 'Warn dann ~10 m -> Recalc');
assert(ww.includes('walkedAfterWarnM'), 'Meter nach Warnung');

const fog = read('src/services/homeMap/fogTrackEngine.ts');
assert(fog.includes('FOG_CONNECT_MAX_BIKE_M'), 'Fog Connect bei Tempo');
assert(fog.includes('TRANSIT_FOG_SPEED_MS'), 'Transit-Lane ab ~30 km/h');
assert(fog.includes('commitFogSurface'), 'Bus: eine Fläche, kein Tip-Stapel');
assert(!fog.includes('base.slice'), 'Fog schneidet die Spur nicht ab');
assert(fog.includes('runDeferredFullCompute'), 'Full-Fog deferred');
assert(fog.includes('isMicActive'), 'Fog wartet auf Mic');
assert(fog.includes('pushInstantGpsBlob'), 'Fog folgt sofort am GPS');
assert(
  !fog.includes('FOG_DEBOUNCE_BIKE_MS = 450'),
  'Bike-Debounce nicht aggressiver als Walk',
);
assert(
  fog.includes('FOG_DEBOUNCE_BIKE_MS = 3_200') ||
    fog.includes('FOG_DEBOUNCE_BIKE_MS = 3200'),
  'Bike-Debounce soft (≥3.2s)',
);
assert(fog.includes('FOG_BIKE_FULL_EVERY_MS'), 'Bike Full-Merge gedrosselt');
assert(fog.includes('GPS_FOG_MIN_BIKE_M'), 'Bike Fog min move');

const walkTrack = read('src/services/discovery/walkTrackService.ts');
assert(
  walkTrack.includes('TRANSIT_SKIP_GAP_MS'),
  'kein Gap-Fill-Sturm bei Bus-Tempo',
);

const mapView = read('src/components/homeMap/NativeHomeMapView.tsx');
assert(mapView.includes('route-turn-shaft'), 'goldener Garmin-Turn-Shaft');
assert(mapView.includes('route-turn-head-fill'), 'goldener Turn-Kopf');
assert(!mapView.includes('gps-arrow-halo'), 'kein GPS-Kreis-Halo (nur Pfeil)');
assert(mapView.includes('lastFollowCamAt'), 'Follow-Throttle');
assert(mapView.includes('MOVING_HEADING_CAM_MIN_MS'), 'Heading setCamera throttle while moving');
assert(mapView.includes('POS_EPS_DEG'), 'Accuracy-only no map churn');

const header = read('src/components/Header.tsx');
assert(header.includes('navTurnHint'), 'Abbiege-Banner im Header');

const match = read('src/services/navigation/mapMatchEngine.ts');
assert(match.includes('getRemainingRouteCoords'), 'Remaining SSOT');
assert(match.includes('lastAlongM'), 'Along tracking');

const amenity = read('src/components/homeMap/homeMapAmenityImages.ts');
assert(amenity.includes('route-chevron'), 'Flow-Chevron Asset');

const cue = read('src/services/navigation/handsFreeNav/cueTiming.smoke.test.ts');
assert(cue.includes("transportMode: 'bicycle'"), 'Bike cue timing smoke');

const hint = read('src/services/navigation/navTurnHint.ts');
assert(hint.includes("return 'jetzt'"), 'Jetzt-Stufe im Banner');
assert(hint.includes("return '150 m'"), '150 m Stufe');

const gate = read('src/services/boot/interactiveBootGate.ts');
assert(gate.includes('export function isMicActive'), 'isMicActive export');

console.log('navSpeedStability.smoke.test.ts OK');
