/**
 * UI/Mic instant + Performance-Lanes — Architektur-Asserts.
 * Run: npx -p tsx@4.19.2 --yes tsx src/services/ui/uiInstant.smoke.test.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const root = process.cwd();
const host = readFileSync(
  join(root, 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
const view = readFileSync(
  join(root, 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
const scene = readFileSync(
  join(root, 'src/services/homeMap/mapSceneController.ts'),
  'utf8',
);
const home = readFileSync(join(root, 'src/screens/HomeScreen.tsx'), 'utf8');
const overlayHost = readFileSync(
  join(root, 'src/screens/HomeOverlayHost.tsx'),
  'utf8',
);
const idle = readFileSync(
  join(root, 'src/services/ui/idlePrefetch.ts'),
  'utf8',
);
const calStore = readFileSync(
  join(root, 'src/module2/timeline/planCalendarUiStore.ts'),
  'utf8',
);
const calendar = readFileSync(
  join(root, 'src/components/PlanCalendarModal.tsx'),
  'utf8',
);
const dock = readFileSync(
  join(root, 'src/components/HomeDockBar.tsx'),
  'utf8',
);
const overlayStore = readFileSync(
  join(root, 'src/store/useHomeOverlayStore.ts'),
  'utf8',
);
const voice = readFileSync(join(root, 'src/hooks/useVoiceInput.ts'), 'utf8');
const settings = readFileSync(
  join(root, 'src/screens/SettingsScreen.tsx'),
  'utf8',
);
const layers = readFileSync(join(root, 'src/constants/uiLayers.ts'), 'utf8');
const popup = readFileSync(
  join(root, 'src/components/homeMap/HomeMapPlacePopup.tsx'),
  'utf8',
);
const ambient = readFileSync(
  join(root, 'src/services/research/ambientEventPitch.ts'),
  'utf8',
);
const venueWalkBy = readFileSync(
  join(root, 'src/services/research/venueWalkByPitch.ts'),
  'utf8',
);
const exploreMod = readFileSync(
  join(root, 'src/runtime/exploreModule.ts'),
  'utf8',
);
const extract = readFileSync(
  join(root, 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
const loader = readFileSync(
  join(root, 'src/services/homeMap/mapExtractLoader.ts'),
  'utf8',
);
const routeEngine = readFileSync(
  join(root, 'src/services/navigation/handsFreeNav/routeEngine.ts'),
  'utf8',
);
const startNav = readFileSync(
  join(root, 'src/services/navigation/handsFreeNav/startNav.ts'),
  'utf8',
);
const payload = readFileSync(
  join(root, 'src/services/navigation/navRouteMapPayload.ts'),
  'utf8',
);
const gate = readFileSync(
  join(root, 'src/services/boot/interactiveBootGate.ts'),
  'utf8',
);

assert(host.includes('getWalkTrackSnapshot'), 'Fog/Explore aus Snapshot');
assert(
  !/setInterval\(\(\)\s*=>\s*\{\s*void loadWalkTrack\(\)\.then\(setWalkTrack\)/.test(
    host,
  ),
  'kein periodisches setWalkTrack',
);
assert(!host.includes('setInterval(tick, 12_000)'), 'kein 12s-WalkTrack-Poll');
assert(!host.includes('setInterval(tick, 8000)'), 'kein 8s-WalkTrack-Poll');
assert(
  host.includes('onMapGpsFog(lat, lng, track)'),
  'Fog bei GPS ohne Map-Prop-Rewrite',
);
assert(host.includes('navRoutePayloadSig'), 'Route-Delta ohne Mega-stringify');

assert(view.includes('memo(') && view.includes('forwardRef(function NativeHomeMapView'), 'NativeHomeMapView memo');
assert(scene.includes('lastNavRouteJson'), 'Nav-Sync nur bei Payload-Delta');
assert(scene.includes('navRoutePayloadSig'), 'Scene Route-Sig billig');
assert(scene.includes('startNavSyncTimer'), 'Nav-Sync nur während Nav');

assert(home.includes('HomeChromeLayer'), 'Mic/Dock eigener Layer');
assert(
  home.includes('HomeChromeLayer = React.memo'),
  'Chrome memoisiert',
);

assert(calStore.includes('calendarMounted'), 'Timeline keep-alive Flag');
assert(
  calendar.includes('Keep-alive wie Settings') ||
    calendar.includes('Warm-Keep wie Settings') ||
    !/if \(!visible\) \{\s*return \(\s*<View\s*style=\{\[styles\.overlay, styles\.overlayHidden\]\}/.test(
      calendar,
    ),
  'Timeline kein Stub-Return bei !visible',
);
assert(dock.includes('onPressIn={handlers[item.action]}'), 'Dock Press-In öffnet Chrome');
assert(settings.includes('keepBodyMounted'), 'Settings Accordion keepBodyMounted');
assert(calStore.includes('premountCalendar'), 'Timeline Premount');
assert(
  calStore.includes('setPlacePopup(null)'),
  'Timeline schließt Place-Popup',
);
assert(
  !overlayHost.includes('setTimeout(() => setMounted(false), 120)'),
  'Timeline unmountet nicht nach Close',
);
assert(overlayStore.includes('premountOverlays'), 'Settings/Orte Premount');
{
  const openIdx = overlayStore.indexOf('openSettings: () => {');
  assert(openIdx >= 0, 'openSettings implementation present');
  const openSettings = overlayStore.slice(openIdx, openIdx + 600);
  assert(
    openSettings.indexOf('holdOverlayBusy()') >= 0 &&
      openSettings.indexOf('holdOverlayBusy()') <
        openSettings.indexOf('dismissPlacePopupForChrome()'),
    'openSettings: holdOverlayBusy before dismissPlacePopupForChrome',
  );
}
{
  const setIdx = calStore.indexOf('setCalendarVisible: (calendarVisible)');
  assert(setIdx >= 0, 'setCalendarVisible implementation present');
  const setCal = calStore.slice(setIdx, setIdx + 900);
  assert(
    setCal.indexOf('noteOverlayBusy(true)') >= 0 &&
      setCal.indexOf('noteOverlayBusy(true)') <
        setCal.indexOf('setPlacePopup(null)'),
    'setCalendarVisible: noteOverlayBusy(true) before setPlacePopup(null)',
  );
}
{
  const propsStart = home.indexOf('type HomeLiveLayerProps');
  const propsEnd = home.indexOf('type HomeChromeLayerProps', propsStart);
  assert(propsStart >= 0 && propsEnd > propsStart, 'HomeLiveLayerProps type present');
  const liveProps = home.slice(propsStart, propsEnd);
  assert(
    !liveProps.includes('isListening'),
    'HomeLiveLayerProps must NOT include isListening',
  );
}
assert(
  settings.includes('unstable_batchedUpdates') &&
    settings.includes('Ein Batch'),
  'settings includes unstable_batchedUpdates and "Ein Batch"',
);
assert(
  settings.includes('Frame 0 = nur Visibility') ||
    settings.includes('Draft/Accordion/Mute erst danach'),
  'settings defers draft hydrate after first chrome frame',
);
assert(
  settings.includes('keepBodyMounted={chromeReady && !!warmedSections'),
  'settings keepBodyMounted only after chromeReady frame',
);
assert(
  settings.includes('setChromeReady(true)') &&
    settings.includes('setChromeReady(false)'),
  'settings chromeReady flips after first paint',
);
{
  const deferredReady = readFileSync(
    join(root, 'src/hooks/useDeferredReady.ts'),
    'utf8',
  );
  assert(
    !/import\s*\{[^}]*InteractionManager/.test(deferredReady) &&
      !deferredReady.includes('runAfterInteractions'),
    'useDeferredReady does not wait on InteractionManager',
  );
}
assert(
  /if\s*\(\s*!visible\s*\|\|\s*!timelineBodyReady/.test(calendar) &&
    calendar.includes('cleanupTimelineDuplicates'),
  'calendar cleanup gated on timelineBodyReady',
);
assert(
  overlayStore.includes('dismissPlacePopupForChrome') ||
    overlayStore.includes('setPlacePopup(null)'),
  'Settings schließt Place-Popup',
);
assert(idle.includes('premountOverlayHosts'), 'Idle Premount');
{
  const appSrc = readFileSync(join(root, 'App.tsx'), 'utf8');
  assert(
    !/handleSplashFinish[\s\S]{0,500}noteInteractiveSettled\(/.test(appSrc),
    'Splash-Finish darf Hydrate nicht sofort freigeben (kein early settle)',
  );
  assert(
    appSrc.includes('onInteractive={handleSplashInteractive}'),
    'Splash-Curtain startet Interactive Window',
  );
}
assert(
  idle.includes('scheduleChromePremountAfterSplash') ||
    idle.includes('splashInteractiveAt'),
  'Chrome-Premount nach Splash-Interactive (nicht unter Map-Boot)',
);
assert(
  idle.includes('CHROME_PREMOUNT_AFTER_SPLASH_MS') &&
    idle.includes('prefetchOverlayBundles') &&
    idle.includes('waitUntilInteractiveSettled'),
  'Bundle früh; Chrome-Premount nach Splash; Heavy nach Settle',
);
{
  const m = idle.match(/CHROME_PREMOUNT_AFTER_SPLASH_MS\s*=\s*([\d_]+)/);
  const ms = m ? Number(String(m[1]).replace(/_/g, '')) : 0;
  assert(
    ms >= 0 && ms <= 160,
    'Chrome-Premount sofort/kurz nach Splash-Interactive (≤160 ms)',
  );
}
assert(
  !/waitUntilInteractiveSettled\(\)\.then\([\s\S]{0,200}premountOverlayHosts/.test(
    idle,
  ),
  'Chrome-Premount nicht hinter Interactive-Settle',
);
assert(
  idle.includes('waitUntilInteractiveSettled') &&
    idle.includes('runHydrateWhenFree'),
  'Heavy Hydrate erst nach Interactive Window',
);
assert(
  settings.includes('kein absoluteFill') ||
    settings.includes('rootWarmKeep'),
  'Settings closed: kein absoluteFill Warm-Keep (Fabric Blackscreen-Fix)',
);
assert(
  settings.includes('rootWarmKeep') &&
    !/if\s*\(\s*!visible\s*\)\s*\{\s*[\s\S]{0,80}return null/.test(settings),
  'Settings !visible → rootWarmKeep (kein Kaltstart-null)',
);
assert(
  calendar.includes('rootWarmKeep') &&
    !/if\s*\(\s*!visible\s*\)\s*\{\s*[\s\S]{0,120}return null/.test(calendar),
  'Timeline !visible → rootWarmKeep (kein Kaltstart-null)',
);
assert(popup.includes('rootWarmKeep'), 'Place-Popup Warm-Keep ohne Fullscreen');

{
  const pressIn = voice.slice(
    voice.indexOf('const onPressIn = useCallback'),
    voice.indexOf('const onPressIn = useCallback') + 2_200,
  );
  assert(pressIn.includes('setIsListening(true)'), 'Listening sync im PressIn');
  assert(pressIn.includes('queueMicrotask'), 'Busy-Cancel deferred');
  assert(
    pressIn.indexOf('setIsListening(true)') <
      pressIn.indexOf('cancelFindusBusy'),
    'Listening vor Busy-Cancel',
  );
}

// Phase 0/1 — Overlay-Stack (Performance Lanes: Chrome > Place-Popup)
assert(layers.includes('placePopup:'), 'UI_LAYER.placePopup');
assert(layers.includes('overlay: 10_000'), 'UI_LAYER.overlay');
assert(popup.includes('UI_LAYER.placePopup'), 'Place-Popup nutzt placePopup-Layer');
assert(
  !popup.includes('UI_LAYER.askSheet'),
  'Place-Popup nicht mehr askSheet (über Settings)',
);
{
  const placeMatch = layers.match(/placePopup:\s*([\d_]+)/);
  const hudMatch = layers.match(/hud:\s*([\d_]+)/);
  const overlayMatch = layers.match(/overlay:\s*([\d_]+)/);
  assert(placeMatch && hudMatch && overlayMatch, 'Layer-Zahlen parsebar');
  const placeZ = Number(placeMatch![1]!.replace(/_/g, ''));
  const hudZ = Number(hudMatch![1]!.replace(/_/g, ''));
  const overlayZ = Number(overlayMatch![1]!.replace(/_/g, ''));
  assert(placeZ < hudZ, 'placePopup unter Chrome (hud)');
  assert(hudZ < overlayZ, 'Chrome unter Settings/Timeline');
  assert(placeZ < overlayZ, 'placePopup unter overlay');
  assert(placeZ >= 150, 'placePopup Elevation gegen MapLibre-TextureView');
}
assert(
  popup.includes('pointerEvents="box-none"'),
  'Place-Popup root lässt Chrome-Taps durch',
);
assert(
  popup.includes('chromeClearance') || popup.includes('bottom: chromeClearance'),
  'Backdrop endet über Dock/Mic',
);
assert(
  host.includes('skeletonMapPlacePopup') &&
    (host.includes('queueMicrotask(runEnrichOnce)') ||
      host.includes('queueMicrotask')) &&
    !/onNativePlaceTap[\s\S]{0,2200}InteractionManager\.runAfterInteractions/.test(
      host,
    ),
  'Ort-Popup: Skeleton zuerst, Enrich ohne InteractionManager',
);
assert(
  view.includes('placeTapQuietUntil') &&
    (view.includes('Reines Drehen: Heading in User-Anker') ||
      view.includes('Heading in Anker')),
  'Ort-Tap quiet + Drehen speichert Heading (kein Snap zurück)',
);
assert(
  !/onPressIn=\{\(\) => \{\s*if \(busyRef\.current\) return/.test(popup),
  'Backdrop-Dismiss nicht hinter busyRef blockiert',
);
{
  const placeIdx = overlayHost.indexOf('<HomePlacePopupLayer');
  const settingsIdx = overlayHost.indexOf('<HomeSettingsLayer');
  assert(placeIdx >= 0 && settingsIdx >= 0, 'Place+Settings im OverlayHost');
  assert(placeIdx < settingsIdx, 'Place-Popup vor Settings gerendert');
}
{
  const overlayIdx = home.indexOf('<HomeOverlayHost');
  const chromeIdx = home.indexOf('<HomeChromeLayer');
  assert(overlayIdx >= 0 && chromeIdx >= 0, 'Overlay+Chrome im HomeScreen');
  assert(
    overlayIdx < chromeIdx,
    'Chrome nach OverlayHost — Dock/Mic über Place-Popup',
  );
}

// Ambient pausiert bei Modul 2
assert(ambient.includes('isConversationBusy'), 'Ambient Busy-Gate');
assert(
  (ambient.match(/if \(isConversationBusy\(\)\)/g) || []).length >= 3,
  'Ambient prüft Busy mehrfach (vor/während Research)',
);
assert(
  venueWalkBy.includes('canEventPitch') &&
    venueWalkBy.includes('eventPitchQuotaExhausted'),
  'Venue-Walk-By: 2-Pitch-Quota',
);
assert(
  exploreMod.includes('tickVenueWalkByPitch'),
  'Explore: Venue-Walk-By vor Stadt-Ambient',
);
assert(
  ambient.includes('tryVenueWalkByPitch'),
  'Ambient: Walk-By vor 5km-Research',
);

// Phase 2 — Extract yields + InteractionManager escape
assert(
  extract.includes('prepareExtractForDisplayAsync'),
  'Async Extract-Clip',
);
assert(extract.includes('yieldToMainThread'), 'Clip Yields');
assert(
  extract.includes('EXTRACT_BUILDING_CLIP_CHUNK') &&
    /EXTRACT_BUILDING_CLIP_CHUNK\s*=\s*[1-9]\d{2}\b/.test(extract),
  'Gebäude-Clip Chunk ≤999',
);
assert(
  extract.includes('pickNearestBuildingsAsync') &&
    extract.includes('chromeBusyNow'),
  'Gebäude-Nearest async + Chrome-Yield',
);
assert(loader.includes('setTimeout(go, 80)'), 'InteractionManager Escape 80ms');

{
  const geojsonSrc = readFileSync(
    join(root, 'src/services/homeMap/cityMapExtractGeojson.ts'),
    'utf8',
  );
  assert(
    geojsonSrc.includes('polygonsFromRingsAsync') &&
      geojsonSrc.includes('EXTRACT_BUILDING_GEOJSON_CHUNK'),
    'Gebäude-GeoJSON gestückelt',
  );
  assert(
    geojsonSrc.includes('yieldGeojsonChrome') ||
      geojsonSrc.includes('chromeBusyForGeojson'),
    'Gebäude-GeoJSON wartet hinter Mic/Chrome',
  );
}

assert(
  extract.includes('parseMapExtractFileNative'),
  'Native Map-Parse bevorzugt',
);

// Route lane (Phase 1b)
assert(routeEngine.includes('inflightProgressive'), 'FOSSGIS Dedup');
assert(
  startNav.includes('Landmark / POI-DB nie'),
  'Landmark async vom kritischen Pfad',
);
assert(payload.includes('navRoutePayloadSig'), 'navRoutePayloadSig export');

// Boot gate lanes
assert(gate.includes("mic: 0"), 'Lane mic höchste Prio');
assert(gate.includes("overlays: 1"), 'Lane overlays vor map');
assert(gate.includes('mapIdle') || gate.includes("mapIdle:"), 'Lane mapIdle');
assert(gate.includes('runMapIdleWhenFree'), 'Idle-Prefetch API');
assert(
  host.includes('runTileFootprintSnap') &&
    host.includes('Nur mapIdle') &&
    host.includes('isInMapPolishTouchGrace'),
  'Footprint-Snap nur mapIdle, nie Polish',
);
assert(
  host.includes('EIN Nah-Nachbar') || host.includes('genau EIN Nah-Nachbar'),
  'Viewport-First: max 1 Nachbar',
);
assert(
  !host.includes('prefetchNext') || !/function prefetchNext/.test(host),
  'keine Prefetch-Kette aller Offline-Städte',
);

const navStart = readFileSync(
  join(root, 'src/services/homeMap/homeMapNavStart.ts'),
  'utf8',
);
assert(
  navStart.includes('setNavRouteLoading(true)') &&
    navStart.includes('setIsGenerating(true)'),
  'Nav Busy-Kreis sofort',
);
assert(
  /onSelectDraft\(/.test(settings) &&
    settings.includes('commitManualCitySelection'),
  'Stadt: Draft tippen, Commit erst bei Speichern',
);
assert(
  !/setInstallingId\(city\.id\)[\s\S]{0,200}onInstalled\(/.test(settings),
  'Stadt-Tap startet kein sofortiges onInstalled/Pack',
);
assert(
  !settings.includes('speakCityWelcomeForCity'),
  'Welcome nicht mehr im City-Tap (erst Speichern)',
);
assert(
  existsSync(join(root, 'src/services/cityWelcomeFacts.ts')),
  'Slim Welcome-Facts Service',
);
assert(
  existsSync(join(root, 'src/services/citySelectionCommit.ts')),
  'City-Commit Service',
);
assert(
  existsSync(join(root, 'src/services/cityCommitProgress.ts')),
  'City-Commit Progress Store',
);
assert(
  existsSync(join(root, 'src/components/CityCommitProgressHost.tsx')),
  'City-Commit Progress HUD',
);
const cityCommit = readFileSync(
  join(root, 'src/services/citySelectionCommit.ts'),
  'utf8',
);
assert(/beginCityCommitProgress/.test(cityCommit), 'Commit startet Progress HUD');
assert(/allowFullPack:\s*false/.test(cityCommit), 'Commit holt nur Slim-Welcome');
assert(
  readFileSync(join(root, 'App.tsx'), 'utf8').includes('CityCommitProgressHost'),
  'Progress HUD in App gemountet',
);
assert(
  /beginCityCommitProgress/.test(
    readFileSync(join(root, 'src/screens/SettingsScreen.tsx'), 'utf8'),
  ),
  'Speichern startet Ladebalken sync',
);

const voiceStore = readFileSync(
  join(root, 'src/store/useVoiceSessionStore.ts'),
  'utf8',
);
assert(voiceStore.includes('useVoiceSessionStore'), 'Voice-Session Store');
assert(
  home.includes('useVoiceSessionStore') ||
    home.includes("from '../store/useVoiceSessionStore'"),
  'Chrome nutzt Voice-Session Store',
);

assert(
  extract.includes('DISPLAY_BOOT_RADIUS_M = 5_000') ||
    extract.includes('DISPLAY_BOOT_RADIUS_M = 5000'),
  'Boot-Clip ~5 km (Splash-Kern)',
);
assert(
  loader.includes('urgent?: boolean') && loader.includes('cityChanged'),
  'Viewport urgent Stadtwechsel',
);

const geojson = readFileSync(
  join(root, 'src/services/homeMap/cityMapExtractGeojson.ts'),
  'utf8',
);
assert(geojson.includes('cityMapExtractToGeojsonAsync'), 'GeoJSON Async+Yields');

assert(
  existsSync(join(root, '.cursor/rules/findus-performance-lanes.mdc')),
  'Performance-Lanes Cursor-Rule',
);

// Bike/motion JS-thread starvation — high-impact contracts
const navSvc = readFileSync(
  join(root, 'src/services/navigation/navigationService.ts'),
  'utf8',
);
const locSvc = readFileSync(
  join(root, 'src/services/locationService.ts'),
  'utf8',
);
const fogEng = readFileSync(
  join(root, 'src/services/homeMap/fogTrackEngine.ts'),
  'utf8',
);
const gpsStore = readFileSync(join(root, 'src/store/useGpsStore.ts'), 'utf8');
const sensorStore = readFileSync(
  join(root, 'src/store/useSensorStore.ts'),
  'utf8',
);
assert(
  locSvc.includes('isForegroundLocationWatchActive') &&
    navSvc.includes('isForegroundLocationWatchActive'),
  'Single GPS watcher: locationService owns foreground',
);
assert(
  view.includes('subscribeDeadReckonPosition') &&
    view.includes('MOVING_HEADING_CAM_MIN_MS'),
  'Map: Dead Reckoning Puck + moving heading throttle',
);
assert(
  gpsStore.includes('ACC_EPS_M') && sensorStore.includes('ACC_EPS_M'),
  'GPS/Sensor stores skip tiny accuracy churn',
);
assert(
  fogEng.includes('FOG_BIKE_FULL_EVERY_MS') &&
    fogEng.includes('GPS_FOG_MIN_BIKE_M'),
  'Fog softer on bike',
);
assert(
  fogEng.includes('runMapIdleWhenFree') && fogEng.includes('FOG_WALK_FULL_EVERY_MS'),
  'Fog full merge lowest priority (mapIdle) + walk tip',
);
assert(
  navSvc.includes('allowDeadEndProbe') &&
    navSvc.includes('DEAD_END_BIKE_MIN_MS'),
  'Dead-end probe not every bike silent recalc',
);

const header = readFileSync(join(root, 'src/components/Header.tsx'), 'utf8');
assert(
  header.includes('hudTickAllowed') &&
    header.includes('isOverlayBusy') &&
    header.includes('AppState'),
  'Header HUD ticks pause when overlay busy / background',
);
assert(
  view.includes('!headingFollowRef.current') &&
    view.includes('MOVING_HEADING_CAM_MIN_MS'),
  'Heading-Follow never skips setCamera under moving throttle',
);
assert(
  host.includes('evictCityMapExtract') &&
    host.includes('speed >= 8.3'),
  'City switch evicts extract; transit speed defers footprint idle',
);
assert(
  navSvc.includes('clearLookAheadRouteCache') &&
    navSvc.includes('clearOsmRoadNetworkCache') &&
    navSvc.includes('clearRoutedEtaCache'),
  'stopNavigation clears session route caches',
);
const lookAhead = readFileSync(
  join(root, 'src/services/navigation/lookAheadRouteCache.ts'),
  'utf8',
);
assert(
  lookAhead.includes('CACHE_MAX') &&
    lookAhead.includes('clearLookAheadRouteCache') &&
    lookAhead.includes('isTransitRole') &&
    lookAhead.includes('isBusMode') &&
    lookAhead.includes('fetchRailLeg'),
  'lookAheadRouteCache: capped + transit/bus/rail paths',
);
const osmRoads = readFileSync(
  join(root, 'src/services/navigation/osmRoadNetwork.ts'),
  'utf8',
);
assert(
  osmRoads.includes('CACHE_MAX') && osmRoads.includes('clearOsmRoadNetworkCache'),
  'osmRoadNetwork cache capped',
);
const deadReckon = readFileSync(
  join(root, 'src/services/navigation/gpsDeadReckoning.ts'),
  'utf8',
);
assert(
  deadReckon.includes('coastCap') && deadReckon.includes('coastSpeed >= 8.3'),
  'Dead reckon longer coast at transit speed',
);

console.log('uiInstant.smoke.test.ts OK');
