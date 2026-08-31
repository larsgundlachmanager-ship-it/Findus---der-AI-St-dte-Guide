/**
 * Homescreen-Karte: Native MapLibre, kein WebView, kein HTTP-Basemap.
 * Run: npx -p tsx@4.19.2 --yes tsx src/components/homeMap/nativeHomeMap.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
const yorroCam = readFileSync(
  join(process.cwd(), 'src/components/homeMap/YorroHomeCamera.tsx'),
  'utf8',
);
const loader = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapExtractLoader.ts'),
  'utf8',
);
const style = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapStyle.ts'),
  'utf8',
);
const offlineStyle = readFileSync(
  join(process.cwd(), 'src/services/homeMap/offlineHomeMapStyle.ts'),
  'utf8',
);
const amenity = readFileSync(
  join(process.cwd(), 'src/components/homeMap/homeMapAmenityImages.ts'),
  'utf8',
);
const gate = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapNativeGate.ts'),
  'utf8',
);
const appJson = readFileSync(join(process.cwd(), 'app.json'), 'utf8');

assert(/HOME_MAP_USE_NATIVE = true/.test(gate), 'Native-Gate an');
assert(!host.includes('react-native-webview'), 'kein WebView-Import');
assert(!host.includes('<WebView'), 'kein WebView-JSX');
assert(host.includes('<NativeHomeMapView'), 'NativeHomeMapView verdrahtet');
assert(
  host.includes("from './HomeMapExploreChip'"),
  'HomeMapExploreChip muss importiert sein',
);
assert(host.includes('<HomeMapExploreChip'), 'Explore-Chip JSX');
assert(view.includes('@maplibre/maplibre-react-native'), 'MapLibre Native');
assert(view.includes('OFFLINE_HOME_MAP_STYLE'), 'Offline-Style');
assert(!offlineStyle.includes('http://') && !offlineStyle.includes('https://'), 'kein Tile-URL');
assert(offlineStyle.includes('sources: {}'), 'keine Style-Sources / Kacheln');
assert(yorroCam.includes('syncDefaultStop'), 'YorroCamera syncDefaultStop');
assert(
  !/requireNativeComponent\s*\(/.test(yorroCam),
  'kein 2. MLRNCamera-Register (Barrel lädt Camera schon)',
);
assert(yorroCam.includes("'MLRNCamera'"), 'nutzt registrierten Native-Namen');
assert(!view.includes('followUserLocation={true}'), 'Kamera folgt GPS nicht von allein');
assert(view.includes('onLongPress'), 'Long-Press Drop-Pin');
assert(view.includes('id="world-land"'), 'Welt-Fallback Land');
assert(view.includes('id="world-borders"'), 'Ländergrenzen');
assert(view.includes('id="world-admin1"'), 'Bundesländer');
assert(view.includes('onRegionWillChange'), 'Geste bricht Follow sofort');
assert(view.includes('onStartShouldSetResponderCapture'), 'Finger löst Follow, bevor GPS die Geste frisst');
assert(view.includes('user-arrow'), 'GPS als WebView-Pfeil');
assert(view.includes('id="gps-arrow"'), 'eigener GPS-Pfeil statt Nadel');
assert(!view.includes('extract-buildings-line'), 'keine harte Gebäude-Linie');
assert(offlineStyle.includes("glyphs: 'asset://fonts/{fontstack}/{range}.pbf'"), 'Offline-Glyphen');
assert(view.includes('id="world-cities"'), 'Städtenamen');
assert(view.includes('id="world-rivers"'), 'Flüsse');
assert(view.includes('id="world-roads-mid"'), 'dichteres Straßennetz');
assert(view.includes('id="cities-label"'), 'Pack-Stadtname');
assert(view.includes('id="cities-line-dash"'), 'gestrichelte Grenze nur bei dashed');
assert(view.includes('HOME_MAP_WORLD_STRUCTURE_LOD'), 'Weltstruktur-LOD');
assert(view.includes('id="world-regions"'), 'Gebirgsnamen');
assert(view.includes('extract-housenumbers-label'), 'Hausnummern als Zahlen');
const mapStyle = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapStyle.ts'),
  'utf8',
);
assert(view.includes('extract-roads-labels'), 'Straßennamen über Gebäuden/Orten');
assert(view.includes('extract-roads-label'), 'Straßennamen auf der Linie');
assert(view.includes("symbolPlacement: 'line'"), 'Straßennamen folgen der Straßenlinie');
assert(view.includes('HOME_MAP_STREET_LABEL_LOD'), 'Straßenlabel-LOD (erst bei dicker Linie)');
assert(!view.includes('extract-streets-label'), 'keine schwebenden Straßennamen-Punkte');
assert(mapStyle.includes('maxAngleDeg: 48'), 'Straßenlabel-Winkel nicht zu streng');
assert(!view.includes('extract-housenumbers-circle'), 'keine weißen Hausnummer-Punkte');
assert(view.includes('id="route-pins-icon"'), 'Nav-Wegpunkte als Pinnadel-Icon');
assert(view.includes('MarkerView'), 'Nav-Wegpunkt-Chips als MarkerView-Buttons');
assert(view.includes('navChipSub'), 'Gleis/Steig-Subzeile auf Native-Chips');
assert(view.includes("backgroundColor: '#0C100E'"), 'Nav-Chip als schwarzer Button');
assert(
  readFileSync(
    join(process.cwd(), 'src/services/navigation/navRouteMapPayload.ts'),
    'utf8',
  ).includes('Linie immer User → Ziel'),
  'Route-Orientierung User→Ziel für Pfeile',
);
assert(view.includes('haversineRouteM'), '2-Punkt-Luftlinie nicht zeichnen');
assert(view.includes('!routePreview'), 'Chevrons nicht auf Preview/Air');
assert(amenity.includes('route-pin-now'), 'Routen-Pinnadel-Assets registriert');
assert(view.includes('minZoomLevel={10.4}'), 'Gebäude als Fläche ab Zoom 10.4');
assert(host.includes('smallestCityIdContainingPoint(lat, lng, known)'), 'Extract folgt der Stadt unter der Kamera');
assert(host.includes('peekCityMapExtract'), 'Vollextract nur aus RAM, kein Parse auf dem Karten-Pfad');
assert(!host.includes('loadCachedCityMapExtract'), 'kein JSON.parse des Vollextracts beim Map-Inject');
assert(host.includes('scheduleIdleCityMapExtract'), 'Vollextract erst nach Idle');
assert(host.includes('scheduleHeavyMapOverlays'), 'Orte nach dem ersten Paint');
assert(
  host.includes('HOME_MAP_PLACES_AFTER_EXTRACT_MS'),
  'Places verzögert nach Extract (Karte pan-bar)',
);
{
  const start = host.indexOf('const onNativeReady');
  const boot = host.slice(start, start + 9_000);
  assert(boot.includes('injectOfflineMapExtract'), 'Boot: Extract zuerst');
  assert(boot.includes('scheduleHeavyMapOverlays'), 'Boot: Places über Delay');
  assert(boot.includes('prefetchCityMapExtract'), 'Boot: aktive Stadt Extract');
  assert(
    boot.includes('EIN Nah-Nachbar') || boot.includes('genau EIN Nah-Nachbar'),
    'Viewport-First: max 1 Nachbar idle',
  );
  assert(
    !boot.includes('others[i++]') && !boot.includes('prefetchNext'),
    'keine serielle Prefetch-Kette aller Packs',
  );
  assert(
    !boot.includes('injectPlacesOnlyRef.current()'),
    'Boot: Places nicht synchron auf Ready',
  );
}
assert(
  readFileSync(
    join(process.cwd(), 'src/services/homeMap/homeMapBootSchedule.ts'),
    'utf8',
  ).includes('kein Dauer-Nachladen'),
  'Boot-Schedule: Settled ohne Dauer-Nachladen',
);
assert(view.includes('id="places-icon-park"'), 'Park/Wald erst nah');
assert(view.includes('id="places-icon-micro"'), 'Briefkasten/Arzt erst sehr nah');
assert(view.includes('id="places-icon-gastro-top"'), 'Gastro-Highlights früher');
assert(view.includes('HOME_MAP_ICON_LOD_ZOOM'), 'Icon-LOD Zoom-Stufen');
assert(view.includes('iconSize: 0.22'), 'GPS-Pfeil 65% kleiner');
assert(view.includes("kind: 'follow'"), 'GPS-Lock zentriert nur über applyCenterMove');
assert(view.includes('Finger down allein unlockt nicht'), 'Tipp löst GPS-Fix nicht');
assert(view.includes('gestureMovedEnough'), 'Unlock erst bei echtem Pan/Zoom');
assert(host.includes('nextHudLockTap'), 'GPS: 1. Tipp pulse · 2. in 5s Lock');
assert(host.includes("snapGps(next.action === 'lock' ? 'lock' : 'pulse')"), 'Recenter pulse/lock');
assert(host.includes('jumpTo(lat, lng, 13.2, true)'), 'Stadtwechsel springt zur gewählten Stadt');
assert(host.includes('injectOfflineMapExtract(true, { lat, lng }, undefined, cityId, true)'), 'Stadtwechsel lädt Stadt-Extract');
assert(view.includes('reattach'), 'Kamera nur Recenter/Nav');
assert(view.includes('releaseFollow'), 'Freie Erkundung nach Boot/Geste');
assert(view.includes('anchorCamRef'), 'Anker-Kamera überlebt Extract-Reload');
assert(view.includes('suppressRegionUntil'), 'Region-Events während Reload sperren');
assert(host.includes('releaseFollow'), 'Host schaltet freie Erkundung ein');
assert(
  view.includes('camLiveRef.current') &&
    view.includes('cityMapExtractToGeojson(extract'),
  'Extract-Reload stellt Kamera aus Anker wieder her',
);
assert(view.includes('HOME_MAP_FOG_MASK_ENABLED'), 'Fog-Maske abschaltbar');
assert(view.includes('HOME_MAP_AMENITY_IMAGES'), 'Amenity-Piktogramme');
assert(!view.includes('animationDuration={0}'), 'Camera-Prop setzt Zoom nicht zurück');
assert(host.includes('snapMapLongPress'), 'Long-Press snappt an Ort/Adresse');
assert(host.includes('resetNativeMapCompass'), 'Kalibrieren setzt Sensor frisch');
{
  const live = host.slice(
    host.indexOf('applyLiveGps'),
    host.indexOf('applyLiveGps') + 900,
  );
  assert(!live.includes('jumpTo'), 'Live-GPS setzt die Kamera nicht');
}
assert(
  view.includes('zoomDelta >= 0.08') ||
    view.includes('Date.now() >= ignorePanUntil.current'),
  'Finger/Zoom bricht Follow auch während ignorePanUntil',
);
assert(
  !view.includes('now - lastCamHeadingAt.current >= 90') &&
    !view.includes('now - lastCamHeadingAt.current >= 90'),
  'Heading-Follow nicht alle 90 ms',
);
assert(view.includes('userDetached = useRef(true)'), 'Freie Erkundung ab Frame 0');
assert(view.includes('ohne reattach nie bewegen'), 'jumpTo-Gate dokumentiert');
assert(host.includes('prefetchCityMapExtract'), 'lokale Packs: Map-Extract prefetch');
assert(host.includes('invalidateLocalMapIndex'), 'Map-Index nach Boot neu');
assert(loader.includes('hasMap || r.hasPack') || loader.includes('hasPack'), 'Pack ohne Map zählt');
assert(loader.includes('NEAR_CITY_EXTRACT_M'), 'Umland-Gürtel Extract');
assert(
  readFileSync(join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'), 'utf8').includes(
    'DISPLAY_WIDE_RADIUS_M = 10_000',
  ),
  'Display-Clip 10 km Umland',
);
assert(
  readFileSync(join(process.cwd(), 'scripts/cityPack/buildCityOfflineMap.mjs'), 'utf8').includes(
    'UMLAND_DETAIL_PAD_M = 10_000',
  ),
  'Offline-Build: 10 km Gebäude-Umland',
);
assert(
  readFileSync(join(process.cwd(), 'scripts/cityPack/buildCityOfflineMap.mjs'), 'utf8').includes(
    'expandBbox(fullBbox, UMLAND_DETAIL_PAD_M)',
  ),
  'Klein/mittel: Gebäude = Admin+10km',
);
assert(loader.includes('resolveViewportCityIdForView'), 'Viewport-Overlap Stadt-Switch');
assert(loader.includes('VIEWPORT_SWITCH_RATIO'), 'Overlap-Schwelle');
assert(loader.includes('opts?.cityId'), 'Explizite Viewport-Stadt');
assert(host.includes('radiusM != null ? { radiusM }'), 'Pan nutzt Wide-Radius');
assert(host.includes('cityChanged'), 'Extract-Switch bei Stadtwechsel');
assert(host.includes('Modul-1-Stadtwechsel'), 'Modul-1 steuert Kartenextract nicht');
assert(host.includes('prefetchCityMapExtract(cityId)'), 'Modul-1 holt nur Map-Datei');
assert(
  readFileSync(join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'), 'utf8').includes(
    'prefetchCityMapExtract(id)',
  ),
  'Pack-Install prefetcht Offline-Karte',
);
assert(host.includes('Immer detach'), 'Boot detach auch ohne GPS');
assert(view.includes('Detached: höchstens Kompass-Rotation'), 'Detached zentriert nie auf GPS');
assert(view.includes('userDetached bleibt true'), 'Kompass lässt freie Erkundung');
assert(!/tourPlaceDemo[\s\S]{0,400}jumpTo\(pick/.test(host), 'Tour springt Kamera nicht');
assert(host.includes('fitBounds.latMin'), 'Stadtwechsel nutzt Coverage-Mitte');
assert(host.includes('jumpTo(lat, lng, 13.2, true)'), 'Stadtwechsel zeigt die gewählte Stadt');
assert(
  host.includes('Kein reattach') || host.includes('Immer detach'),
  'Boot reißt freie Erkundung nicht dauerhaft auf GPS',
);
assert(view.includes('exclusiveCityRings'), 'Stadtflächen ohne Overlap');
assert(view.includes('HOME_MAP_CITY_FILL_ZOOM.visibleFrom'), 'Stadtflächen auch bei DE/EU-Zoom');
assert(style.includes('visibleFrom: 2.6'), 'City-Fill ab Europa-Zoom');
assert(view.includes('YorroHomeCamera'), 'eigene Camera mit syncDefaultStop');
assert(view.includes('syncDefaultStop'), 'native defaultStop folgt User-View');
assert(view.includes('applyCenterMove'), 'Zentrum nur über applyCenterMove');
assert(view.includes('armCenterMove'), 'Intentional-Move-Token');
assert(view.includes("kind: 'armed'"), 'Boot/Zentrieren/Nav armed');
assert(view.includes("kind: 'follow'"), 'GPS-Lock follow');
assert(view.includes("kind: 'restore'"), 'Restore nur weg vom GPS');
assert(view.includes('Idle / Extract / 30'), 'Idle-Scroll ohne Zentrums-Move');
assert(view.includes('restoreUserViewIfSnappedToGps'), 'Safety bei GPS-Snap');
assert(view.includes('lastUserGestureAt'), 'Explore-Gesten-Fenster gegen Trägheit');
assert(view.includes('currentDefaultStopCam'), 'defaultStop folgt Live-View bei Erkundung');
assert(
  !view.includes('lastUserGestureAt.current < 12_000'),
  'kein 12s-recentExplore — Idle/Extract vergiftet User-View nicht',
);
assert(view.includes('followMode'), 'followMode gps|explore|nav');
assert(view.includes('cityMapExtractToGeojsonAsync'), 'GeoJSON full mit Yields');
assert(
  view.includes('blocked GPS snap') ||
    view.includes('nur gegen echten MapLibre-GPS-Snap'),
  'Restore nur GPS-Snap',
);
assert(view.includes('Extract nie an die Kamera'), 'kein Camera-Restore nach Extract');
assert(
  view.includes('regionDidChangeDebounceTime={80}') ||
    view.includes('regionDidChangeDebounceTime={50}'),
  'Region-Events debounced',
);
assert(view.includes('layerApplyQuietUntil'), 'Apply-Quiet gegen Kamera-Zack');
assert(view.includes('likelyUserExploreMotion'), 'Pan/Pinch ohne Flags erkannt');
assert(view.includes('lastUserZoomAt'), 'Zoom-Fenster gegen Restore');
assert(view.includes('onTouchStart'), 'Multi-Touch fingerDown');
assert(view.includes('centerDelta > 0.00014'), 'Pan ohne Flags = User');
assert(
  !view.includes('blocked idle/extract drift') ||
    view.includes('blocked GPS snap'),
  'kein aggressives Idle-Restore mehr',
);
assert(view.includes('ohne reattach nie bewegen'), 'jumpTo hart geblockt');
assert(host.includes('didBootJumpRef'), 'Boot-Jump nur 1× pro Session');
assert(host.includes('Map-Remount darf nicht zurückreißen'), 'kein Ready-GPS-Snap');
assert(host.includes('kurz ganze Route, dann zur aktuellen Position'), 'Nav: Fit → GPS → frei');
assert(view.includes('restoreExploreAnchorIfGpsSnap'), 'GPS-Snap Restore zentral');
assert(yorroCam.includes('setDefaultStop(native)'), 'defaultStop React-State ohne Throttle');
assert(!view.includes('followUserLocation={true}'), 'Kamera folgt GPS nicht von allein');
assert(!/maybeFollowCamera[\s\S]{0,200}setCamera\(\{\s*centerCoordinate/.test(view), 'Follow geht nur über applyCenterMove');
assert(view.includes('setNativeProps'), 'Puck/Heading per setNativeProps, kein 60Hz setState');
assert(!view.includes('setNeedleDeg'), 'kein Nadel-useState');
assert(
  view.includes('fogTrackCacheKey') || view.includes('fogTrackCacheKey'),
  'Fog nur bei Track-Delta',
);
assert(appJson.includes('@maplibre/maplibre-react-native'), 'Expo-Plugin');

const stt = readFileSync(join(process.cwd(), 'src/services/sttService.ts'), 'utf8');
assert(stt.includes('warmMicrophonePipeline'), 'Mic-Pipeline Boot-Prewarm');
assert(stt.includes('com.google.android.googlequicksearchbox'), 'STT: Quick Search Box bevorzugt wenn installiert');
assert(stt.includes('com.google.android.tts'), 'STT: Google TTS als Engine wenn QSB fehlt');
assert(stt.includes('available.has(p)'), 'STT: nur installierte Recognition-Packages');
assert(stt.includes('failedAndroidPackages'), 'STT: tote Engines blacklisten');
assert(stt.includes('prepareAudioForMicrophone'), 'STT gibt TTS-Fokus vor dem Mikrofon ab');
const nav = readFileSync(
  join(process.cwd(), 'src/services/navigation/navigationService.ts'),
  'utf8',
);
assert(nav.includes('>= 0.45'), 'Keine stillen Reroutes im Stand');
assert(view.includes('runAfterInteractions'), 'Extract-GeoJSON nach dem ersten Paint');
assert(view.includes('EMPTY_PUCK_FC'), 'GPS-Puck nicht bei jedem Render neu');
assert(view.includes('emptyExtractGeojson'), 'erste Karte ohne Gebäude-Parse');
assert(view.includes('HOME_MAP_BUILDINGS_AFTER_CORE_MS'), 'Zwei-Phasen Gebäude-Delay');
assert(view.includes("apply('core')") || view.includes('apply("core")'), 'Core-Paint zuerst');
assert(view.includes('HOME_MAP_WORLD_AFTER_CORE_MS'), 'Welt lazy nach Core');
assert(view.includes('EMPTY_WORLD'), 'Welt startet leer');
assert(view.includes('markHomeMapBoot'), 'Boot-Messpunkte');
assert(host.includes('markHomeMapBoot'), 'Host markiert Places');
assert(
  readFileSync(
    join(process.cwd(), 'src/services/homeMap/homeMapBootSchedule.ts'),
    'utf8',
  ).includes('HOME_MAP_REGIONAL_AFTER_MS'),
  'Regional nach Kern-Boot',
);
assert(
  readFileSync(
    join(process.cwd(), 'src/services/homeMap/mapSceneController.ts'),
    'utf8',
  ).includes('regionalBootAllowed'),
  'Regional gated bis nach Delay',
);

const extractSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
assert(extractSrc.includes('coerceExtract'), 'Display-Hydrate ohne stringify-Roundtrip');
assert(!extractSrc.includes('JSON.stringify(j.extract)'), 'kein doppeltes Serialize beim Hydrate');
assert(
  extractSrc.includes('Download *.map.json im Idle') &&
    extractSrc.includes('Parse erst wenn Viewport'),
  'Idle: nur Map-Download, kein Riesen-Parse',
);
assert(extractSrc.includes('parseInFlight'), 'JSON.parse nicht doppelt');
assert(host.includes('HOME_MAP_PLACES_REINJECT_MIN_M'), 'Places nur bei Pan');
assert(loader.includes('warmLocalMapIndex'), 'Boot: lokale Map-IDs für Viewport');
assert(loader.includes('urgent'), 'Stadtwechsel ohne Geste-Defer');
assert(host.includes('urgent: cityChanged'), 'Pan über andere Offline-Stadt sofort');
assert(view.includes('citySwitched'), 'Extract-Geo sofort bei Stadtwechsel');
assert(host.includes('warmupSettleRingsM'), 'Warmup nur Near-User');
assert(
  readFileSync(
    join(process.cwd(), 'src/services/homeMap/mapSceneController.ts'),
    'utf8',
  ).includes('kein Dual-Path') ||
    readFileSync(
      join(process.cwd(), 'src/services/homeMap/mapSceneController.ts'),
      'utf8',
    ).includes('queueViewportExtract'),
  'Scene-Controller ohne Dual-Extract-Load',
);
assert(
  readFileSync(
    join(process.cwd(), 'src/services/homeMap/mapSceneController.ts'),
    'utf8',
  ).includes('startNavSyncTimer'),
  'Nav-Sync nur während Navigation',
);

const warmupSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/warmupHomeMap.ts'),
  'utf8',
);
assert(warmupSrc.includes('peekDisplayExtract'), 'Splash nutzt Display-Snapshot');
assert(
  warmupSrc.includes('Kein Vollextract') || warmupSrc.includes('Kein Vollextract'),
  'Splash parst nicht 10–28 MB',
);
assert(
  warmupSrc.includes('pushSnapToMapStore') || warmupSrc.includes('setExtract'),
  'Warmup legt Display-Snapshot in Map-Store',
);

const catalogSrc = readFileSync(
  join(process.cwd(), 'src/services/cityCatalogService.ts'),
  'utf8',
);
assert(
  catalogSrc.includes('scheduleIdleCityMapExtract'),
  'Pack-Switch parst die Karte nicht synchron',
);

console.log('nativeHomeMap.smoke.test.ts OK');

assert(host.includes('isStreetPointAmenity'), 'Street-Punkt vs Story-Fill');
assert(host.includes('keepPin: amenityDot'), 'Cap pinned nur echte Amenities');
assert(!host.includes('keepPin: keepDotForced'), 'Restaurants killen Stories nicht im Cap');
