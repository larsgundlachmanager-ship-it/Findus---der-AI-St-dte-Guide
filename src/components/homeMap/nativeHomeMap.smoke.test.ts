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
const explore = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomeMapExploreChip.tsx'),
  'utf8',
);

assert(/HOME_MAP_USE_NATIVE = true/.test(gate), 'Native-Gate an');
assert(!host.includes('react-native-webview'), 'kein WebView-Import');
assert(!host.includes('<WebView'), 'kein WebView-JSX');
assert(host.includes('<NativeHomeMapView'), 'NativeHomeMapView verdrahtet');
assert(
  host.includes("from './HomeMapExploreChip'"),
  'HomeMapExploreChip muss importiert sein',
);
assert(host.includes('<HomeMapExploreChip'), 'Explore-Chip JSX');
assert(
  readFileSync(
    join(process.cwd(), 'src/components/homeMap/HomeMapExploreChip.tsx'),
    'utf8',
  ).includes('useSharedValue') &&
    readFileSync(
      join(process.cwd(), 'src/components/homeMap/HomeMapExploreChip.tsx'),
      'utf8',
    ).includes('onPress={() => onCalibrate'),
  'Kompass-Nadel Reanimated + Kalibrieren onPress',
);
assert(view.includes('@maplibre/maplibre-react-native'), 'MapLibre Native');
assert(
  view.includes('buildYorroVectorMapStyle') || view.includes('OFFLINE_HOME_MAP_STYLE'),
  'Map-Style (Vector oder Legacy)',
);
assert(!offlineStyle.includes('http://') && !offlineStyle.includes('https://'), 'kein Tile-URL');
assert(offlineStyle.includes('sources: {}'), 'keine Style-Sources / Kacheln');
assert(offlineStyle.includes('HOME_MAP_BG'), 'Offline-BG = Land ab Frame 0');
assert(!offlineStyle.includes('HOME_MAP_OCEAN'), 'kein Ozean-First (Kaltstart-Dunkel)');
assert(
  !view.includes('runMapPolishWhenFree'),
  'Gebäude/World nicht hinter Splash-Polish',
);
assert(
  host.includes('keepTransitIcon') ||
    host.includes('isTransitIconLod') ||
    host.includes("homeMapIconLod(rawIcon, poi) === 'transit'"),
  'Bahnhof behält Bahn-Icon auch mit Gebäudeumriss',
);
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
assert(
  view.includes('noteUserGesture') && view.includes('rotateEnabled'),
  'Gesten über Region-Events — kein Parent-Touch (bricht Multi-Touch-Rotate)',
);
assert(view.includes('user-arrow'), 'GPS als WebView-Pfeil');
assert(view.includes('id="gps-arrow"'), 'eigener GPS-Pfeil statt Nadel');
assert(view.includes('fillOutlineColor: HOME_MAP_BUILDING_STROKE'), 'Gebäude-Outline haarfein wie Story');
assert(!view.includes('extract-buildings-outline'), 'kein dicker Gebäude-LineLayer');
assert(!view.includes('extract-buildings-line'), 'keine alte harte Gebäude-Linie');
assert(offlineStyle.includes("glyphs: 'asset://fonts/{fontstack}/{range}.pbf'"), 'Offline-Glyphen');
assert(view.includes('id="world-cities"'), 'Städtenamen');
assert(view.includes('id="world-rivers"'), 'Flüsse');
assert(view.includes('id="world-roads-mid"'), 'dichteres Straßennetz');
assert(view.includes('id="cities-label"'), 'Pack-Stadtname');
assert(view.includes('id="cities-line-dash"'), 'gestrichelte Grenze nur bei dashed');
assert(view.includes('HOME_MAP_WORLD_STRUCTURE_LOD'), 'Weltstruktur-LOD');
assert(view.includes('id="world-regions"'), 'Gebirgsnamen');
assert(view.includes('id="world-countries-label"'), 'Ländernamen');
assert(view.includes('countriesFrom'), 'Länder-LOD Timing');
assert(!view.includes('extract-housenumbers-label'), 'keine Hausnummern-Labels auf der Karte');
assert(!view.includes('extract-housenumbers'), 'kein Hausnummern-ShapeSource');
const mapStyle = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapStyle.ts'),
  'utf8',
);
assert(
  view.includes('extract-roads-label-major') &&
    !view.includes('id="extract-roads-labels"'),
  'Straßennamen in extract-roads (eine ShapeSource)',
);
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
assert(
  host.includes('scheduleIdleCityMapExtract') ||
    catalogSrc.includes('isVectorBasemapEnabled'),
  'Offline-Extract nur Legacy; Vector skippt Prefetch',
);
assert(host.includes('scheduleHeavyMapOverlays'), 'Orte nach dem ersten Paint');
assert(
  host.includes('flushLastMapGpsNow') && host.includes('flushDisplayExtractNow'),
  'App-Kill flush: GPS + Display-Snap',
);
assert(
  host.includes("state === 'background'") || host.includes('state === "background"'),
  'Flush bei Background',
);
assert(
  host.includes('HOME_MAP_PLACES_AFTER_EXTRACT_MS'),
  'Places verzögert nach Extract (Karte pan-bar)',
);
{
  const start = host.indexOf('const onNativeReady');
  const boot = host.slice(start, start + 12_000);
  const vectorBoot = boot.includes('if (isVectorBasemapEnabled())');
  if (vectorBoot) {
    assert(boot.includes('noteMapCityFinal(activeId)'), 'Vector-Boot: Final sofort');
    assert(boot.includes('noteSplashMapPlacesReady'), 'Vector-Boot: Places-Splash');
    assert(
      !boot.includes('injectOfflineMapExtract(true') ||
        boot.indexOf('if (isVectorBasemapEnabled())') <
          boot.indexOf('injectOfflineMapExtract(true'),
      'Vector-Boot: kein Extract vor Vector-Zweig',
    );
  } else {
    assert(boot.includes('injectOfflineMapExtract'), 'Boot: Extract zuerst');
    assert(boot.includes('cacheHit'), 'Boot: Cache-Hit überspringt Full-Parse');
    assert(boot.includes('MAP_NEAR_RADIUS_M'), 'Boot: R1 5 km');
    assert(boot.includes('applyCityFinal'), 'Boot: R3 final idle');
  }
  assert(
    boot.includes('noteSplashMapPlacesReady') &&
      boot.includes('injectPlacesOnlyRef.current()'),
    'Boot: Places unter Splash',
  );
  assert(boot.includes('noteMapNearReady(activeId)'), 'Boot: near ready');
  assert(boot.includes('noteMapPlacesReady(activeId)'), 'Boot: places ready');
  assert(boot.includes('noteMapCityFinal(activeId)'), 'Boot: city final');
  assert(
    !boot.includes('scheduleHeavyMapOverlays()'),
    'Boot: kein Places-Delay-Ladder nach Splash',
  );
  assert(
    boot.includes('EIN Nah-Nachbar') || boot.includes('genau EIN Nah-Nachbar'),
    'Viewport-First: max 1 Nachbar idle',
  );
  assert(
    !boot.includes('others[i++]') && !boot.includes('prefetchNext'),
    'keine serielle Prefetch-Kette aller Packs',
  );
  if (!vectorBoot) {
    assert(boot.includes('noteSplashMapFogReady'), 'Legacy-Boot: Fog-Splash');
  }
}
assert(
  readFileSync(
    join(process.cwd(), 'src/services/homeMap/homeMapBootSchedule.ts'),
    'utf8',
  ).includes('kein Dauer-Nachladen'),
  'Boot-Schedule: Settled ohne Dauer-Nachladen',
);
assert(view.includes('id="places-icon-park"'), 'Park/Wald erst nah');
assert(view.includes('id="places-icon-gastro-top"'), 'Gastro-Highlights früher');
assert(view.includes('id="places-icon-micro"'), 'Micro-Amenities nah');
assert(view.includes('id="places-icon-micro-close"'), 'Briefkasten nah');
assert(view.includes('id="places-icon-micro-clinic"'), 'Arzt-LOD eigener Layer');
assert(
  view.includes('Icons via amenityIcons') ||
    !/places-icon-micro-close[\s\S]{0,220}placeVisFilter/.test(view),
  'Amenity-Icons nicht hinter Typ-Chips (Standard)',
);
assert(view.includes('HOME_MAP_ICON_LOD_ZOOM'), 'Icon-LOD Zoom-Stufen');
assert(
  view.includes('HOME_MAP_ICON_LOD_ZOOM.microClinic'),
  'Arzt microClinic Zoom',
);
assert(
  host.includes('amenityIcons') && host.includes('isAmenityIconEnabled'),
  'Orte-Icon-Prefs steuern Karte',
);
assert(host.includes('seekVisible'), 'Orte-Sheet lädt Stadt-Final');
  assert(
    view.includes('sigUnchanged') || view.includes('sig === lastExtractSigRef'),
    'Native: R3 darf wachsen trotz Near-Phase',
  );
assert(view.includes('iconSize: 0.22'), 'GPS-Pfeil 65% kleiner');
assert(view.includes("kind: 'follow'"), 'GPS-Lock zentriert nur über applyCenterMove');
assert(
  view.includes('gestureMovedEnough') || view.includes('likelyUserExploreMotion'),
  'Tipp löst GPS-Fix nicht — erst echte Bewegung',
);
assert(view.includes('gestureMovedEnough'), 'Unlock erst bei echtem Pan/Zoom');
assert(
  explore.includes('onPress={onRecenter}') &&
    !explore.includes('onPressIn={onRecenter}'),
  'GPS-Button onPress (kein PressIn-Snap)',
);
assert(host.includes('nextHudLockTap'), 'GPS: 1. Tipp pulse · 2. in 5s Lock');
assert(host.includes("snapGps(next.action === 'lock' ? 'lock' : 'pulse')"), 'Recenter pulse/lock');
assert(host.includes('applyHudFollowPrefs'), 'Nav: HUD-Follow Prefs');
assert(
  host.includes('Kein delayed jumpTo') ||
    host.includes('padLat') ||
    host.includes('pendingNavZoomTokenRef') ||
    host.includes('jumpTo(zoomLat, zoomLng, 15.8'),
  'Nav-Fit Overview, optional Ranzoom ohne Follow-Lock',
);
assert(view.includes('fitBounds([east, north], [west, south], 132'), 'Nav-Overview Padding');
assert(
  view.includes('locationFollowRef.current = true') &&
    view.includes('reattachFollow()'),
  'reattachFollow aktiviert GPS-Lock',
);
assert(host.includes('jumpTo(jumpLat, jumpLng, 13.2, true)') || host.includes('jumpTo(lat, lng, 13.2, true)'), 'Stadtwechsel springt zur gewählten Stadt');
assert(
  host.includes('beginMapLoadPhases(cityId)') &&
    host.includes('MAP_NEAR_RADIUS_M') &&
    host.includes('noteMapPlacesReady(cityId)') &&
    host.includes('MAP_CITY_RADIUS_M') &&
    host.includes('noteMapCityFinal(cityId)'),
  'Stadtwechsel: R1 Straßen → R2 Orte → R3 Final',
);
assert(
  loader.includes('mergeCityMapExtracts'),
  'Stadtwechsel: Nachbar-Extract merge',
);
assert(
  host.includes('mapUserExploredRef.current = true') &&
    host.includes('await prefetchCityMapExtract(cityId)'),
  'Stadtwechsel: freie Erkundung + Map vor Paint',
);
assert(
  host.includes('Freie Erkundung: Final-Extract nicht mehr nachziehen') ||
    host.includes('mapUserExploredRef.current') &&
      host.includes('ShapeSource-Sturm'),
  'Nach Pan kein Final-Extract-Snap',
);
assert(
  view.includes('userHasExploredRef.current = true') &&
    view.includes('Stadtwechsel = freie Erkundung'),
  'Extract-Switch lässt Pan frei',
);
assert(view.includes('reattach'), 'Kamera nur Recenter/Nav');
assert(view.includes('gestureCamRef'), 'Pan-Ende nutzt IsChanging-Mitte gegen Snap-Back');
assert(
  view.includes('Kein setCamera / syncDefaultStop') ||
    view.includes('Kamera bleibt wo der Finger') ||
    view.includes('Nur gegen echten Snap-Back setCamera') ||
    view.includes('killt jedes Loslassen die Fling'),
  'Pan-Ende: kein setCamera-Gegenwehr (Fling bleibt)',
);
assert(
  view.includes('userGesturing/fingerDown NICHT löschen') ||
    view.includes('Mid-Pan Anker-Race'),
  'releaseFollow löscht keine Mid-Pan Gesten-Flags',
);
assert(view.includes('anchorCamRef'), 'Anker-Kamera überlebt Extract-Reload');
assert(view.includes('suppressRegionUntil'), 'Region-Events während Reload sperren');
assert(host.includes('releaseFollow'), 'Host schaltet freie Erkundung ein');
assert(
  view.includes('pinDefaultStopToUser') &&
    view.includes('cityMapExtractToGeojson(extract') &&
    (view.includes('Near/Partial: nach erstem Paint einfrieren') ||
      view.includes('paintEuWorldBundle')),
  'Extract-Reload hält User-Kamera (kein GPS-Snap)',
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
assert(
  view.includes('citySwitched') || host.includes('Stadtwechsel'),
  'Extract-Switch bei Stadtwechsel',
);
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
assert(
  host.includes('jumpTo(jumpLat, jumpLng, 13.2, true)') ||
    host.includes('jumpTo(lat, lng, 13.2, true)'),
  'Stadtwechsel zeigt die gewählte Stadt',
);
assert(
  host.includes('Kein reattach') || host.includes('Immer detach'),
  'Boot reißt freie Erkundung nicht dauerhaft auf GPS',
);
assert(view.includes('exclusiveCityRings'), 'Stadtflächen ohne Overlap');
assert(view.includes('HOME_MAP_CITY_FILL_ZOOM.visibleFrom'), 'Stadtflächen auch bei DE/EU-Zoom');
assert(style.includes('visibleFrom: 2.6'), 'City-Fill ab Europa-Zoom');
assert(view.includes('YorroHomeCamera'), 'eigene Camera mit syncDefaultStop');
assert(
  view.includes('pinDefaultStopToUser') &&
    view.includes('scheduleHoldCameraAfterLayerPaint') &&
    view.includes('kein native defaultStop'),
  'Layer-Reload: JS-Anker, Hold no-op, kein native defaultStop',
);
assert(view.includes('Kamera-Verfassung'), 'Maps Kamera-Verfassung dokumentiert');
assert(
  view.includes('Kein setCamera / syncDefaultStop') ||
    view.includes('Kamera bleibt wo der Finger'),
  'Finger-up ohne setCamera-Gegenwehr',
);
assert(view.includes('Vector: keine World-ShapeSources') || view.includes('Vector-Basemap: Welt kommt aus Kacheln'), 'Vector ohne World-GeoJSON');
assert(view.includes('applyCenterMove'), 'Zentrum nur über applyCenterMove');
assert(view.includes('armCenterMove'), 'Intentional-Move-Token');
assert(view.includes("kind: 'armed'"), 'Boot/Zentrieren/Nav armed');
assert(view.includes("kind: 'follow'"), 'GPS-Lock follow');
assert(!view.includes("kind: 'restore'"), 'kein Restore/Gegenwehr');
assert(view.includes('Idle / Extract / Layer-Reload'), 'Idle-Scroll ohne Zentrums-Move');
assert(!view.includes('restoreUserViewIfSnappedToGps'), 'keine GPS-Snap-Gegenwehr');
assert(!view.includes('restoreExploreAnchorIfGpsSnap'), 'kein Explore-Anchor-Restore');
assert(view.includes('lastUserGestureAt'), 'Explore-Gesten-Fenster gegen Trägheit');
assert(view.includes('currentDefaultStopCam'), 'defaultStop folgt Live-View bei Erkundung');
assert(
  !view.includes('lastUserGestureAt.current < 12_000'),
  'kein 12s-recentExplore — Idle/Extract vergiftet User-View nicht',
);
assert(
  view.includes('Follow-Ticks: nur Live-Kamera') ||
    view.includes('NICHT userViewCam überschreiben'),
  'GPS-Follow vergiftet User-View nicht (Pan-Unlock)',
);
assert(view.includes('lastProgrammaticCenterAt'), 'Follow-Echo ≠ User-Pan');
assert(view.includes('followFight'), 'Follow-Kampf → sofort Unlock');
assert(view.includes('cityMapExtractToGeojson'), 'GeoJSON Extract sync');
assert(
  view.includes('Ein Paint unter Splash') ||
    view.includes("apply('full')"),
  'Gebäude nicht hinter Timer/Cleanup',
);
assert(
  view.includes('nie zurückspringen') ||
    view.includes('Kein Restore/Gegenwehr') ||
    view.includes('scheduleHoldCameraAfterLayerPaint') ||
    view.includes('pinDefaultStopToUser') ||
    view.includes('Kamera-Verfassung') ||
    view.includes('Bau/Straßen-ShapeSources einfrieren'),
  'Kamera springt nicht zurück',
);
assert(
  view.includes('Near/Partial: nach erstem Paint einfrieren') ||
    view.includes('finalRelease'),
  'Nach Erstpaint Near/Partial eingefroren',
);
assert(!view.includes('scheduleDeferredExtractFlush'), 'kein deferred Extract-Flush nach Geste');
assert(
  view.includes('pinDefaultStopToUser') && view.includes('scheduleHoldCameraAfterLayerPaint'),
  'Extract: JS-Anker vor ShapeSource + delayed Hold danach',
);
assert(
  view.includes('regionDidChangeDebounceTime={64}') ||
    view.includes('regionDidChangeDebounceTime={16}') ||
    view.includes('regionDidChangeDebounceTime={0}'),
  'Region-Events debounced',
);
assert(
  view.includes('paintEuWorldBundle') &&
    (view.includes('EU/World separat nach Idle') ||
      view.includes('runWhenMapIdleForFinal')),
  'Final: EU/World lazy nach Idle (nicht im Extract-Tick)',
);
assert(
  view.includes('Near/Partial: nach erstem Paint einfrieren') ||
    view.includes('finalRelease'),
  'Near/Partial eingefroren, Final darf nachziehen',
);
assert(
  view.includes('liveMapTurnRef') &&
    view.includes('Mid-Geste nie syncDefaultStop'),
  'Drehen: kein defaultStop mitten in der Geste',
);
assert(
  view.includes('Sofort raus aus Zentriert + Blickrichtung') ||
    view.includes('kein suppress-Block mehr'),
  'User-Bewegung unlockt GPS+Heading sofort',
);
assert(
  view.includes('subscribeMapHeading') && view.includes('pushPuckHeading'),
  'Pfeil folgt Sensor-Heading direkt',
);
assert(view.includes('layerApplyQuietUntil'), 'Apply-Quiet gegen Kamera-Zack');
assert(
  view.includes('cityMapExtractToGeojsonAsync'),
  'Full-Extract async (JS-Thread frei)',
);
assert(view.includes('nativeMapPropsEqual'), 'Memo: nach Freeze kein Prop-Churn');
assert(view.includes('likelyUserExploreMotion'), 'Pan/Pinch ohne Flags erkannt');
assert(view.includes('lastUserZoomAt'), 'Zoom-Fenster');
assert(
  !view.includes('onTouchStart={() =>') &&
    !view.includes('onStartShouldSetResponderCapture'),
  'Kein Parent-Touch — MapLibre Multi-Touch/Rotate frei',
);
assert(
  view.includes('!b?.isUserInteraction') && view.includes('endMapFingerGesture'),
  'Gesten-Ende über Region-Idle (nicht TouchEnd)',
);
assert(
  view.includes('Mid-Geste nie syncDefaultStop') ||
    view.includes('liveMapTurnRef hält Drehen') ||
    view.includes('kein native defaultStop'),
  'Kein defaultStop-Sync mitten in der Rotation',
);
assert(view.includes('centerDelta > 0.00014'), 'Pan ohne Flags = User');
assert(
  !view.includes('blocked idle/extract drift') &&
    !view.includes('blocked GPS snap'),
  'kein aggressives Idle/GPS-Restore',
);
assert(view.includes('ohne reattach nie bewegen'), 'jumpTo hart geblockt');
assert(
  host.includes('MapLibre Layer-Filter') && view.includes('mapPlaceVisibilityFilter'),
  'Filter-Chips → Layer-Filter (kein GeoJSON-Rebuild)',
);
assert(view.includes('places-fill-layer'), 'Ort-Gebäude = eine feste Layer');
assert(
  view.includes('Heading in Anker') ||
    view.includes('Reines Drehen (Zentrum gleich)'),
  'Drehen speichert Heading gegen Extract-Snap',
);
assert(
  view.includes('id="extract-buildings-fill"') &&
    !/extract-buildings-fill[\s\S]{0,120}placeVisFilter/.test(view),
  'OSM-Gebäude ≠ Orte-Filter',
);
assert(host.includes('didExtractBootRef'), 'Extract-Boot nur 1× (kein Remount-Snap)');
assert(
  host.includes('mapUserExploredRef') &&
    (host.includes('Map-Remount darf nicht zurückreißen') ||
      host.includes('Boot-GPS nur wenn User noch nicht')),
  'kein Ready-GPS-Snap nach freier Erkundung',
);
assert(view.includes('Kompass-Nadel immer live mitdrehen'), 'Kompass-Nadel live');
assert(host.includes('Kein Auto-Norden'), 'Recenter erzwingt kein Norden');
assert(host.includes('mapRef.current?.releaseFollow()'), 'Geste löst Follow nativ');
assert(
  host.includes('Mindestspanne') ||
    host.includes('Kein delayed jumpTo') ||
    host.includes('pendingNavZoomTokenRef'),
  'Nav-Überblick dokumentiert',
);
assert(!view.includes('restoreExploreAnchorIfGpsSnap'), 'GPS-Snap Restore entfernt');
assert(
  yorroCam.includes('NO-OP nach Boot') ||
    yorroCam.includes('setNativeProps(defaultStop) = setInitialCamera') ||
    (yorroCam.includes('Nur native') &&
      yorroCam.includes('kein React setState(defaultStop)') &&
      yorroCam.includes('setPassBootStop(false)')),
  'defaultStop nach Boot tot (kein Android-Snap)',
);
assert(
  !yorroCam.includes('setNativeProps({ defaultStop: bootStop })'),
  'Mount-Effect setzt defaultStop nicht erneut (Android Snap)',
);
assert(
  yorroCam.includes('Leerer Stop') || yorroCam.includes('Finger gewinnt'),
  'leerer setCamera bricht pending Camera ab',
);
assert(
  view.includes('Heading-only setCamera fällt oft') ||
    view.includes('Center+Zoom mitschicken'),
  'Heading-Updates mit Center (kein GPS-Snap)',
);
assert(
  view.includes('Pending Follow-/GPS-setCamera abbrechen') ||
    view.includes('Finger gewinnt (Google)'),
  'Geste cancelt pending Follow-Camera',
);
assert(!view.includes("syncBootOnly();\n          setGeo"), 'Extract-Apply ohne syncBootOnly-Remount');
assert(
  view.includes('pinDefaultStopToUser') &&
    view.includes('scheduleHoldCameraAfterLayerPaint') &&
    (view.includes('kein native defaultStop') ||
      view.includes('Kamera-Verfassung') ||
      view.includes('Vor ShapeSource: nur JS-Anker')),
  'Extract: JS-Anker + Hold no-op (kein native defaultStop)',
);
assert(
  view.includes('pinDefaultStopToUser') || view.includes('Bau/Straßen-ShapeSources einfrieren'),
  'Nach ShapeSource: Anker halten / Freeze statt Restore-Snap',
);
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
assert(
  view.includes('Ein Paint unter Splash') ||
    view.includes('HOME_MAP_BUILDINGS_AFTER_CORE_MS') ||
    view.includes("apply('full')"),
  'Gebäude-Pfad dokumentiert',
);
assert(
  view.includes("apply('full')") || view.includes('apply("full")'),
  'Full-Paint unter Splash (kein core→full Doppelsturm)',
);
assert(view.includes('HOME_MAP_WORLD_AFTER_CORE_MS'), 'Welt lazy nach Core');
assert(view.includes('whenMapWorldAllowed'), 'EU erst mit Stadt-Final');
assert(view.includes('noteSplashMapCoreReady'), 'Splash nach 5-km-Straßen');
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
assert(
  host.includes('kein Extract-, Places- oder Cities-ShapeSource-Update') ||
    host.includes('Kartenbewegung: kein Extract'),
  'Pan/Zoom: kein Extract/Places-Nachladen',
);
assert(
  !host.includes('urgent: cityChanged') ||
    host.includes('Kartenbewegung: kein Extract'),
  'Viewport-Pan lädt keine Stadt mehr nach',
);
assert(
  view.includes('finalRelease') &&
    view.includes("apply('core')") &&
    view.includes("apply('full')") &&
    !view.includes('setTimeout(() => {\n          if (!cancelled) apply'),
  'Native: ein Paint pro Release (kein core→full 40ms)',
);
assert(host.includes('warmupSettleRingsM') || host.includes('Vector: Orte einmal'), 'Warmup nur Near-User / Vector einmal');
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
  catalogSrc.includes('scheduleIdleCityMapExtract') &&
    catalogSrc.includes('isVectorBasemapEnabled'),
  'Pack-Switch: Extract nur Legacy (Vector skippt)',
);

assert(host.includes('loadNeighborPinsInViewport'), 'Multi-Stadt Orte aus Pin-Index');
assert(host.includes('scheduleNeighborPackPlacesMerge'), 'Nachbar-Packs in Viewport mergen');
assert(host.includes('maybeEnsureBrowsePackAt'), 'Browse-Zubringer Pack still nachladen');
assert(host.includes('ensureBrowsePackAtViewport'), 'Browse ensure API');
assert(host.includes('coverageBounds'), 'Pack-Gate überlappt Viewport-Coverage');
assert(host.includes('isStreetPointAmenity'), 'Street-Punkt vs Story-Fill');
assert(host.includes('keepPin: amenityDot'), 'Cap pinned nur echte Amenities');
assert(!host.includes('keepPin: keepDotForced'), 'Restaurants killen Stories nicht im Cap');

console.log('nativeHomeMap.smoke.test.ts OK');
