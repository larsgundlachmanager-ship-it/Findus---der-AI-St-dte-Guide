# -*- coding: utf-8 -*-
from pathlib import Path

p = Path("src/services/navigation/navRouteMapPayload.smoke.test.ts")
t = p.read_text(encoding="utf-8")
marker = "console.log('navRouteMapPayload.smoke.test.ts OK');"
if "getRemainingRouteCoords" in t and "Route-Lock" in t:
    print("already patched")
else:
    insert = r"""
assert(
  payloadSrc.includes('getRemainingRouteCoords') &&
    payloadSrc.includes('never unshift GPS'),
  'Remaining-Trim statt GPS-unshift (kein Fork zum Start)',
);
assert(payloadSrc.includes('farFromPuck'), 'Flow-Chevrons nicht am GPS-Puck');

const navSvc = readFileSync(
  join(process.cwd(), 'src/services/navigation/navigationService.ts'),
  'utf8',
);
assert(navSvc.includes('Route-Lock'), 'kein Shortcut-Dauer-Recalc');
assert(
  !navSvc.includes('ich nehme die Radwege'),
  'kein Bike-Switch-Speak',
);
assert(navSvc.includes('offPathMinM: offRouteThresholdM'), 'Bike Off-Path-Schwelle');

const ww = readFileSync(
  join(process.cwd(), 'src/services/navigation/wrongWayMonitor.ts'),
  'utf8',
);
assert(ww.includes('AFTER_WARN_BEFORE_REROUTE_M'), 'Warn dann ~10 m -> Recalc');
assert(ww.includes('walkedAfterWarnM'), 'Meter nach Warnung zaehlen');

const fog = readFileSync(
  join(process.cwd(), 'src/services/homeMap/fogTrackEngine.ts'),
  'utf8',
);
assert(fog.includes('FOG_CONNECT_MAX_BIKE_M'), 'Fog Connect bei Tempo');
assert(fog.includes('isMicActive'), 'Fog wartet auf Mic');
assert(fog.includes('pushInstantGpsBlob'), 'Fog folgt sofort am GPS');

const mapView = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(mapView.includes('route-turn-chevron'), 'gelbe Turn-Pfeile');
assert(mapView.includes('gps-arrow-halo'), 'GPS-Halo ueber Route');
assert(mapView.includes('lastFollowCamAt'), 'Follow-Throttle');

const header = readFileSync(
  join(process.cwd(), 'src/components/Header.tsx'),
  'utf8',
);
assert(header.includes('navTurnHint'), 'Abbiege-Banner im Header');

const match = readFileSync(
  join(process.cwd(), 'src/services/navigation/mapMatchEngine.ts'),
  'utf8',
);
assert(match.includes('getRemainingRouteCoords'), 'Remaining-Geometrie SSOT');

"""
    if marker not in t:
        raise SystemExit("marker missing")
    t = t.replace(marker, insert + marker, 1)
    p.write_text(t, encoding="utf-8")
    print("patched smoke")
