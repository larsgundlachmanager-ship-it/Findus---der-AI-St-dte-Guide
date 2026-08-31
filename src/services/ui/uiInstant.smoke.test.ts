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
assert(
  overlayStore.includes('dismissPlacePopupForChrome') ||
    overlayStore.includes('setPlacePopup(null)'),
  'Settings schließt Place-Popup',
);
assert(idle.includes('premountOverlayHosts'), 'Idle Premount');
assert(settings.includes('Tree bleibt mounted'), 'Settings Tree keep-alive');

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

// Phase 2 — Extract yields + InteractionManager escape
assert(
  extract.includes('prepareExtractForDisplayAsync'),
  'Async Extract-Clip',
);
assert(extract.includes('yieldToMainThread'), 'Clip Yields');
assert(loader.includes('setTimeout(go, 80)'), 'InteractionManager Escape 80ms');
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

assert(
  existsSync(join(root, '.cursor/rules/findus-performance-lanes.mdc')),
  'Performance-Lanes Cursor-Rule',
);

console.log('uiInstant.smoke.test.ts OK');
