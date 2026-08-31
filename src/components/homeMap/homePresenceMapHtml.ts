/**
 * Homescreen-Karte — ein fester Layer-Stack, kein moveLayer-Pingpong.
 *
 * Start: sichtbare Ansicht vollständig und sofort schiebbar. Off-Screen
 * lädt im Hintergrund (Overscan + HTTP-Prefetch), Kamera bleibt stehen.
 *
 * Unten → oben:
 *   Liberty (lädt nach) + Stadt-Extract darüber → Fog → Stadtflächen → Orte → Route → GPS
 *
 * GPS liegt über Pins, damit der Standort nicht unter Gebäuden verschwindet.
 */

import {
  HOME_MAP_STREET_AMENITY_ICONS,
  HOME_MAP_TRANSIT_ICONS,
} from '../../services/homeMap/homeMapPlaceType';
import {
  HOME_MAP_BG,
  HOME_MAP_BUILDING_FILL,
  HOME_MAP_BUILDING_STROKE,
  HOME_MAP_CHROME_DIM,
  HOME_MAP_FOG_FILL,
  HOME_MAP_FOG_REVEAL,
  HOME_MAP_FOG_ENABLED,
  HOME_MAP_LAND_MUTED,
  HOME_MAP_PARK,
  HOME_MAP_RAIL,
  HOME_MAP_ROAD_COLORS,
  HOME_MAP_ROUTE_LINE,
  HOME_MAP_ROUTE_LINE_CASING,
  HOME_MAP_ROUTE_AHEAD,
  HOME_MAP_ROUTE_AHEAD_CASING,
  HOME_MAP_COUNTRY_BORDER,
  HOME_MAP_BASE_LOD,
  HOME_MAP_CITY_FILL_ZOOM,
  HOME_MAP_DETAIL_FADE,
  HOME_MAP_STREET_AMENITY_ZOOM,
  HOME_MAP_VECTOR_STYLE,
  HOME_MAP_WATER,
  HOME_MAP_WOOD,
} from '../../services/homeMap/homeMapStyle';
import {
  FOG_SEGMENT_BREAK_M,
  FOG_SEGMENT_BREAK_MS,
} from '../../services/discovery/walkTrackService';
import {
  FOG_MERGE_GAP_M,
  FOG_CELL_M as FOG_CELL_M_SSOT,
  FOG_SMOOTH_ITERS,
  FOG_COMPACT_SPAN_M,
  FOG_MAX_GRID,
  FOG_CELL_CAP_M,
  FOG_TILE_SPAN_M,
} from '../../services/discovery/fogCoverage';
import {
  MAPLIBRE_CSS_URL,
  MAPLIBRE_JS_URL,
  peekMapLibreHtmlAssets,
} from '../../services/homeMap/mapLibreDiskCache';

/** WebView neu mounten, wenn der Renderer wechselt. */
export const HOME_MAP_RENDERER_REV = 129;

export function buildHomePresenceMapHtml(opts: {
  revealRadiusM: number;
  initialLat: number;
  initialLng: number;
  initialZoom: number;
  hasUserGps?: boolean;
}): string {
  const { revealRadiusM, initialLat, initialLng, initialZoom } = opts;
  const hasUserGps = opts.hasUserGps === true;
  const assets = peekMapLibreHtmlAssets();
  const cssTag = assets?.cssInline
    ? `<style>${assets.cssInline.replace(/<\/style/gi, '<\\/style')}</style>`
    : `<link href="${MAPLIBRE_CSS_URL}" rel="stylesheet"/>`;
  const jsTag = assets?.jsInline
    ? `<script>${assets.jsInline.replace(/<\/script/gi, '<\\/script')}</script>`
    : `<script src="${MAPLIBRE_JS_URL}"></script>`;
  const styleBoot = assets?.styleJson
    ? `Promise.resolve(${assets.styleJson})`
    : `fetch(${JSON.stringify(HOME_MAP_VECTOR_STYLE)}).then(function(r) { return r.json(); })`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
${cssTag}
${jsTag}
<style>
  html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden;background:${HOME_MAP_BG};}
  #mapClip{position:absolute;inset:0;overflow:hidden;}
  #map{position:absolute;top:-12%;left:-12%;width:124%;height:124%;background:${HOME_MAP_BG};}
  .maplibregl-canvas-container,.maplibregl-canvas{background:${HOME_MAP_BG}!important;}
  .maplibregl-ctrl-attrib,.maplibregl-ctrl-logo{display:none!important;}
  .chrome-dim{position:absolute;inset:0;background:rgba(0,0,0,${HOME_MAP_CHROME_DIM});pointer-events:none;z-index:2;opacity:0;transition:opacity .2s;}
  .chrome-dim.on{opacity:1;}
  .nav-chip{width:max-content;max-width:min(82vw,340px);min-width:0;background:rgba(12,22,20,.92);color:#F2F5F3;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:6px 22px 6px 8px;font:12px/1.25 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:auto;white-space:normal;}
  .nav-chip .t{font-weight:650;white-space:normal;word-break:break-word;}
  .nav-chip .s{opacity:.82;margin-top:2px;font-size:11px;white-space:normal;word-break:break-word;}
  .nav-chip .x{position:absolute;top:2px;right:4px;width:18px;height:18px;border:0;background:transparent;color:#F2F5F3;font-size:14px;line-height:18px;padding:0;opacity:.7;}
  .nav-chip.hidden{display:none;}
</style>
</head>
<body>
<div id="mapClip"><div id="map"></div></div>
<div id="chromeDim" class="chrome-dim"></div>
<div id="dbg" style="display:none"></div>
<script>
(function(){
  var REVEAL_M = ${revealRadiusM};
  var FOG_BREAK_MS = ${FOG_SEGMENT_BREAK_MS};
  var FOG_BREAK_M = ${FOG_SEGMENT_BREAK_M};
  var FOG_MERGE_GAP_M = ${FOG_MERGE_GAP_M};
  var FOG_CELL_M = ${FOG_CELL_M_SSOT};
  var FOG_MAX_GRID = ${FOG_MAX_GRID};
  var FOG_CELL_CAP_M = ${FOG_CELL_CAP_M};
  var FOG_GRID_CAP = 1600;
  var FOG_TILE_SPAN_M = ${FOG_TILE_SPAN_M};
  var FOG_COMPACT_SPAN_M = ${FOG_COMPACT_SPAN_M};
  var FOG_SMOOTH_ITERS = ${FOG_SMOOTH_ITERS};
  var FOG_MASK_NEAR_PAD_M = 700;
  var FOG_MASK_FAR_PAD_M = 2500;
  var fogEnabled = ${HOME_MAP_FOG_ENABLED ? 'true' : 'false'};
  var walkTrack = [];
  var fogExploredCache = null;
  var fogExploredKey = '';
  var fogRevealKey = '';
  var fogMaskKey = '';
  var fogMaskOuter = null;
  var userLat = ${hasUserGps && Number.isFinite(initialLat) ? initialLat : 'null'};
  var userLng = ${hasUserGps && Number.isFinite(initialLng) ? initialLng : 'null'};
  var userHeading = null;
  var targetHeading = null;
  var headingRaf = 0;
  var headingFollow = false;
  var centerLock = false;
  var gpsFixLat = userLat;
  var gpsFixLng = userLng;
  var gpsFixAt = 0;
  var gpsSpeedMs = 0;
  var deadReckonRaf = 0;
  var puckHoldTimer = 0;
  var puckGesturesBound = false;
  var ignoreCameraUntil = 0;
  var userAccuracyM = null;
  var fogRaf = null;
  var basemapExtractOnly = false;
  var lastExtract = null;
  var extractHasRoads = false;
  var pendingLibertyStyle = null;
  var libertyApplied = false;
  /** Voller Fog (Maske + Reveal unter Straßen). Keine Minz-Stempel über den Orten. */
  var fogLightMode = false;
  var fogMaskDisabled = false;
  var fogStampFeatures = [];
  var fogLastStampKey = '';
  var styleReady = false;
  var postedInteractive = false;
  var postedReady = false;
  var heavyOverlayTimer = 0;
  var warmupCameraOk = true;
  var lastPlacePayload = [];
  var routeChipMarkers = [];
  var routeChipDismissed = {};
  var routeChipsForceHidden = false;
  function boxesOverlap(a, b, pad) {
    return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
  }
  function layoutNavChips() {
    if (!map || routeChipsForceHidden) return;
    if (!routeChipMarkers.length) return;
    var zoom = 12;
    try { zoom = map.getZoom(); } catch (eZ) {}
    var kept = [];
    var ordered = routeChipMarkers.slice();
    ordered.sort(function(a, b) {
      return (a._findusPri || 9) - (b._findusPri || 9);
    });
    for (var i = 0; i < ordered.length; i++) {
      var mk = ordered[i];
      var el = mk && mk.getElement && mk.getElement();
      if (!el || !el.classList) continue;
      if (routeChipDismissed[mk._findusKey]) {
        el.classList.add('hidden');
        continue;
      }
      el.classList.remove('hidden');
      var pri = mk._findusPri || 9;
      if (zoom < 11 && pri >= 2) {
        el.classList.add('hidden');
        continue;
      }
      var ll = mk.getLngLat && mk.getLngLat();
      if (!ll) continue;
      var pt = map.project(ll);
      var w = Math.max(40, el.offsetWidth || 160);
      var h = Math.max(24, el.offsetHeight || 36);
      var box = { x: pt.x - w / 2, y: pt.y - h - 28, w: w, h: h };
      var clash = false;
      for (var k = 0; k < kept.length; k++) {
        if (boxesOverlap(box, kept[k], 8)) { clash = true; break; }
      }
      if (clash && pri > 0) {
        el.classList.add('hidden');
      } else {
        kept.push(box);
      }
    }
  }
  var lastRouteFitKey = '';
  var previewTimer = null;
  var BG = '${HOME_MAP_BG}';
  var LAND = '${HOME_MAP_LAND_MUTED}';
  var WOOD = '${HOME_MAP_WOOD}';
  var PARK = '${HOME_MAP_PARK}';
  var WATER = '${HOME_MAP_WATER}';
  var BLD = '${HOME_MAP_BUILDING_FILL}';
  var BLD_STROKE = '${HOME_MAP_BUILDING_STROKE}';
  var RAIL = '${HOME_MAP_RAIL}';
  var ROAD_MAJOR = '${HOME_MAP_ROAD_COLORS.major}';
  var ROAD_STREET = '${HOME_MAP_ROAD_COLORS.street}';
  var ROAD_PATH = '${HOME_MAP_ROAD_COLORS.path}';
  var COUNTRY_BORDER = '${HOME_MAP_COUNTRY_BORDER}';
  var RIVER = '#3D6F66';
  var Z_MOTORWAY = ${HOME_MAP_BASE_LOD.motorwayFrom};
  var Z_PRIMARY = ${HOME_MAP_BASE_LOD.primaryFrom};
  var Z_SECONDARY = ${HOME_MAP_BASE_LOD.secondaryFrom};
  var Z_MINOR = ${HOME_MAP_BASE_LOD.minorFrom};
  var Z_WOODS_GONE = ${HOME_MAP_BASE_LOD.woodsGoneBelow};
  var Z_WOODS_ALMOST = ${HOME_MAP_BASE_LOD.woodsAlmostGone};
  var Z_WOODS_REDUCE = ${HOME_MAP_BASE_LOD.woodsReduceFrom};
  var Z_CITY_NONE = ${HOME_MAP_CITY_FILL_ZOOM.noneAt};
  var Z_CITY_12 = ${HOME_MAP_CITY_FILL_ZOOM.at12};
  var Z_CITY_10 = ${HOME_MAP_CITY_FILL_ZOOM.at10};
  var Z_CITY_85 = ${HOME_MAP_CITY_FILL_ZOOM.at85};
  var Z_CITY_57 = ${HOME_MAP_CITY_FILL_ZOOM.at57};
  var CITY_OP_NONE = ${HOME_MAP_CITY_FILL_ZOOM.opacityNone};
  var CITY_OP_12 = ${HOME_MAP_CITY_FILL_ZOOM.opacity12};
  var CITY_OP_10 = ${HOME_MAP_CITY_FILL_ZOOM.opacity10};
  var CITY_OP_85 = ${HOME_MAP_CITY_FILL_ZOOM.opacity85};
  var CITY_OP_57 = ${HOME_MAP_CITY_FILL_ZOOM.opacity57};
  var Z_DETAIL_GONE = ${HOME_MAP_DETAIL_FADE.goneAt};
  var Z_DETAIL_FULL = ${HOME_MAP_DETAIL_FADE.fullAt};
  var Z_AMENITY_GONE = ${HOME_MAP_STREET_AMENITY_ZOOM.goneAt};
  var Z_AMENITY_FULL = ${HOME_MAP_STREET_AMENITY_ZOOM.fullAt};
  var FADE_OP = ['interpolate', ['linear'], ['zoom'], Z_DETAIL_GONE, 0, Z_DETAIL_FULL, 1];
  var FADE_BLD = ['interpolate', ['linear'], ['zoom'], Z_DETAIL_GONE, 0, Z_DETAIL_FULL, 0.92];
  var FADE_PLACE = ['interpolate', ['linear'], ['zoom'], Z_DETAIL_GONE, 0, Z_DETAIL_FULL, 0.92];
  var FADE_HALO = ['interpolate', ['linear'], ['zoom'], Z_DETAIL_GONE, 0, Z_DETAIL_FULL, 0.95];

  /**
   * Feste Reihenfolge. addLayerStacked fügt vor der nächsten existierenden
   * höheren Schicht ein — nie moveLayer.
   */
  var LAYER_STACK = [
    'extract-land-fill', 'extract-woods-fill', 'extract-parks-fill', 'extract-water-fill',
    'fog-reveal-base', 'fog-mask-fill', 'fog-mask-line',
    'extract-buildings-fill', 'extract-rails-line', 'extract-rails-dash', 'extract-roads-line', 'extract-housenumbers',
    'cities-fill', 'cities-line', 'cities-line-dash',
    'places-fill', 'places-line',
    'route-ahead-casing', 'route-ahead-line',
    'route-casing', 'route-line',
    'places-icon-street', 'places-icon-transit',
    'places-halo', 'places-dot', 'places-label',
    'route-arrows',
    'route-pins',
    'drop-pin',
    'user-accuracy', 'user-arrow',
  ];

  function dbg(t) {
    var el = document.getElementById('dbg');
    if (el) el.textContent = t;
  }

  function post(msg) {
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
  }

  function isClutterLandcover(id, paint) {
    if (/^extract-/.test(id || '')) return false;
    if (/^poi_/i.test(id || '')) return true;
    if (paint && (paint['fill-pattern'] || paint['background-pattern'] || paint['line-pattern'])) {
      return /wetland|ice|park_outline|road_area_pattern|aeroway/i.test(id || '');
    }
    return /hillshade|park_outline|road_area_pattern|aeroway|landcover_wetland|landcover_ice|landcover_wood|^park$|boundary_3/i.test(id || '');
  }

  function hideClutterLandcoverLayers() {
    if (!map.getStyle || !map.getStyle()) return;
    var layers = map.getStyle().layers || [];
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L || !L.id || !isClutterLandcover(L.id, L.paint)) continue;
      try { map.setLayoutProperty(L.id, 'visibility', 'none'); } catch (eH) {}
    }
  }

  function darkenLibertyStyle(style) {
    if (!style || !style.layers) return style;
    style.layers.forEach(function(layer) {
      var id = layer.id || '';
      var type = layer.type;
      var paint = layer.paint || (layer.paint = {});
      var layout = layer.layout || (layer.layout = {});
      try {
        if (type === 'background') { paint['background-color'] = BG; return; }
        if (paint['fill-pattern'] && /landuse|landcover|farm|grass|meadow|scrub|sand/i.test(id)) {
          delete paint['fill-pattern'];
          paint['fill-color'] = LAND;
          paint['fill-opacity'] = 1;
          layout.visibility = 'visible';
          return;
        }
        if (type === 'raster' || isClutterLandcover(id, paint)) {
          layout.visibility = 'none';
          if (paint['fill-pattern']) delete paint['fill-pattern'];
          return;
        }
        if (/^poi_/i.test(id)) { layout.visibility = 'none'; return; }
        if (/boundary_disputed|disputed/i.test(id) && type === 'line') {
          layout.visibility = 'none';
          return;
        }
        if (/boundary_3/i.test(id) && type === 'line') {
          layout.visibility = 'none';
          return;
        }
        if (/boundary_2/i.test(id) && type === 'line') {
          layout.visibility = 'visible';
          paint['line-color'] = COUNTRY_BORDER;
          paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 2, 1.15, 4, 2.1, 6, 1.6, 9, 1.05];
          paint['line-opacity'] = 0.94;
          paint['line-dasharray'] = undefined;
          delete paint['line-dasharray'];
          layer.minzoom = 0;
          return;
        }
        if (/boundary_|admin_/i.test(id) && type === 'line') {
          layout.visibility = 'none';
          return;
        }
        if (type === 'fill' || type === 'fill-extrusion') {
          if (/natural_earth|ne2|landcover/i.test(id) && !/wood|forest/i.test(id)) {
            paint['fill-color'] = LAND;
            paint['fill-opacity'] = 1;
            layout.visibility = 'visible';
            layer.minzoom = Math.max(layer.minzoom || 0, Z_MINOR);
            return;
          }
          if (/water|ocean|river|lake|wetland/i.test(id) && !/waterway/i.test(id)) {
            paint['fill-color'] = WATER; return;
          }
          if (/building/i.test(id)) {
            if (type === 'fill-extrusion') { layout.visibility = 'none'; return; }
            paint['fill-color'] = BLD;
            paint['fill-opacity'] = FADE_BLD;
            paint['fill-outline-color'] = BLD_STROKE;
            delete layer.maxzoom;
            if (layer.minzoom == null || layer.minzoom > Z_DETAIL_GONE) layer.minzoom = Z_DETAIL_GONE;
            layout.visibility = 'visible';
            return;
          }
          if (/wood|forest|garden|pitch|cemetery/i.test(id)) {
            paint['fill-color'] = /garden|pitch|cemetery/i.test(id) ? PARK : WOOD;
            paint['fill-opacity'] = [
              'interpolate', ['linear'], ['zoom'],
              Z_WOODS_GONE, 0,
              Z_WOODS_ALMOST, 0.04,
              Z_WOODS_REDUCE, 0.12,
              13.5, 0.72
            ];
            layer.minzoom = Z_WOODS_GONE;
            return;
          }
          if (/landuse|landcover|residential|industrial|commercial|hospital|school|grass|scrub|wetland/i.test(id)) {
            paint['fill-color'] = LAND;
            paint['fill-opacity'] = 1;
            if (paint['fill-pattern']) delete paint['fill-pattern'];
            layer.minzoom = Math.max(layer.minzoom || 0, Z_MINOR);
          }
          return;
        }
        if (type === 'line' && !/name|label/i.test(id)) {
          if (/rail|subway|transit/i.test(id)) {
          paint['line-color'] = RAIL;
          paint['line-blur'] = 0.5;
          layout['line-cap'] = 'round';
          layout['line-join'] = 'round';
          return;
        }
          if (/waterway_river|waterway_tunnel/i.test(id) || (/waterway|river|canal/i.test(id) && !/other|stream/i.test(id))) {
            paint['line-color'] = RIVER;
            paint['line-opacity'] = 0.85;
            paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 3, 0.7, 6, 1.2, 10, 1.8];
            layer.minzoom = Z_MOTORWAY;
            layout.visibility = 'visible';
            return;
          }
          if (/waterway_other|stream/i.test(id)) {
            layer.minzoom = 10;
            paint['line-color'] = WATER;
            return;
          }
          if (/road|street|highway|bridge|tunnel|path|track|motorway|trunk|primary|secondary|tertiary|residential|service|pedestrian|cycle|transport|link|minor/i.test(id)) {
            var isPath = /path_pedestrian|path_footway|road_path|bridge_path|tunnel_path|service_track|footway|cycleway/i.test(id);
            var isLink = /link/i.test(id);
            var isMotorway = /motorway/i.test(id) && !isLink;
            var isMinor = /minor|street|service/i.test(id) && !isMotorway && !isLink;
            var isSecondary = /secondary|tertiary/i.test(id);
            var isPrimary = /trunk_primary|trunk|primary/i.test(id) && !isMotorway;
            var col = isMotorway || /motorway|trunk|primary/i.test(id) ? ROAD_MAJOR :
              (isPath || /service|casing|minor|link/i.test(id) ? ROAD_PATH : ROAD_STREET);
            if (/casing/i.test(id)) col = ROAD_PATH;
            paint['line-color'] = col;
            delete paint['line-dasharray'];
            layout.visibility = 'visible';
            if (isPath) layer.minzoom = 14;
            else if (isLink) layer.minzoom = Math.max(layer.minzoom || 0, 12);
            else if (isMinor) layer.minzoom = Z_MINOR;
            else if (isSecondary) layer.minzoom = Z_SECONDARY;
            else if (isPrimary) layer.minzoom = Z_PRIMARY;
            else if (isMotorway) layer.minzoom = Z_MOTORWAY;
          }
          return;
        }
        if (type === 'symbol') {
          paint['text-color'] = '#A8B5AE';
          paint['text-halo-color'] = BG;
        }
      } catch (err) {}
    });
    return style;
  }

  var map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': BG } }]
    },
    center: [${initialLng}, ${initialLat}],
    zoom: ${initialZoom},
    minZoom: 2,
    maxZoom: 19,
    attributionControl: false,
    pitchWithRotate: false,
    trackResize: true,
    fadeDuration: 0,
    maxTileCacheSize: 192,
    refreshExpiredTiles: false,
    renderWorldCopies: false,
    antialias: false
  });

  var tileTemplates = [];
  var prefetchQueue = [];
  var prefetchSeen = {};
  var prefetchInflight = 0;
  var prefetchPaused = false;
  var neighborTimer = 0;
  var PREFETCH_MAX_INFLIGHT = 4;
  var mapPaused = false;
  var keepAliveTimer = 0;
  var userGesture = false;
  var userGestureUntil = 0;
  var programmaticMove = 0;
  var pendingPlacesWhileGesture = null;
  var lastUserPanPost = 0;
  function userIsDragging() {
    if (userGesture) return true;
    if (Date.now() < userGestureUntil) return true;
    try {
      if (map.dragPan && map.dragPan.isActive && map.dragPan.isActive()) return true;
      if (map.touchZoomRotate && map.touchZoomRotate.isActive && map.touchZoomRotate.isActive()) return true;
    } catch (eA) {}
    return false;
  }
  function ensureMapGestures() {
    try {
      if (map.dragPan && map.dragPan.enable) map.dragPan.enable();
      if (map.scrollZoom && map.scrollZoom.enable) map.scrollZoom.enable();
      if (map.touchZoomRotate && map.touchZoomRotate.enable) map.touchZoomRotate.enable();
      if (map.dragRotate && map.dragRotate.enable) map.dragRotate.enable();
      if (map.doubleClickZoom && map.doubleClickZoom.enable) map.doubleClickZoom.enable();
    } catch (eG) {}
  }
  function postUserPanOnce() {
    var t = Date.now();
    if (t - lastUserPanPost < 180) return;
    lastUserPanPost = t;
    post({ type: 'userPan' });
  }
  function beginUserGesture() {
    userGesture = true;
    userGestureUntil = Date.now() + 900;
    headingFollow = false;
    centerLock = false;
    prefetchPaused = true;
    warmupCameraOk = false;
    if (fogRaf) { cancelAnimationFrame(fogRaf); fogRaf = null; }
    if (fogFollowHold) { clearTimeout(fogFollowHold); fogFollowHold = 0; }
    if (headingRaf) { cancelAnimationFrame(headingRaf); headingRaf = 0; }
    if (deadReckonRaf) { cancelAnimationFrame(deadReckonRaf); deadReckonRaf = 0; }
    postUserPanOnce();
  }
  function flushDeferredOverlays() {
    if (!pendingPlacesWhileGesture) return;
    var p = pendingPlacesWhileGesture;
    pendingPlacesWhileGesture = null;
    try { applyPlacesPayload(p); } catch (eF) {}
  }
  function endUserGesture() {
    userGesture = false;
    userGestureUntil = Date.now() + 180;
    ensureMapGestures();
    flushDeferredOverlays();
    layoutNavChips();
    applyLodVisibility();
    startDeadReckon();
    queueHeadingTick();
  }
  function bindUserGestureCapture() {
    try {
      var el = map.getCanvas && map.getCanvas();
      if (!el || el._findusGesture) return;
      el._findusGesture = 1;
      el.addEventListener('touchstart', beginUserGesture, { passive: true, capture: true });
      el.addEventListener('mousedown', beginUserGesture, { capture: true });
      function up() { setTimeout(endUserGesture, 50); }
      el.addEventListener('touchend', up, { passive: true });
      el.addEventListener('touchcancel', up, { passive: true });
      el.addEventListener('mouseup', up);
    } catch (eB) {}
  }
  setInterval(function() {
    if (mapPaused || userGesture) return;
    ensureMapGestures();
  }, 1800);
  var TILE_MAX_Z = 14;
  function clampTileZ(z) {
    z = Math.floor(Number(z) || 0);
    if (z < 0) return 0;
    if (z > TILE_MAX_Z) return TILE_MAX_Z;
    return z;
  }
  function lngLatToTile(lng, lat, z) {
    z = clampTileZ(z);
    var n = Math.pow(2, z);
    var x = Math.floor((lng + 180) / 360 * n);
    var latRad = lat * Math.PI / 180;
    var y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    if (x < 0) x = 0; if (x > n - 1) x = n - 1;
    if (y < 0) y = 0; if (y > n - 1) y = n - 1;
    return { x: x, y: y };
  }
  function tilesCoveringRadius(lat, lng, radiusM, z) {
    z = clampTileZ(z);
    var dLat = radiusM / 111320;
    var cos = Math.cos(lat * Math.PI / 180);
    var dLng = radiusM / (111320 * Math.max(0.2, cos));
    var nw = lngLatToTile(lng - dLng, lat + dLat, z);
    var se = lngLatToTile(lng + dLng, lat - dLat, z);
    var x0 = Math.min(nw.x, se.x), x1 = Math.max(nw.x, se.x);
    var y0 = Math.min(nw.y, se.y), y1 = Math.max(nw.y, se.y);
    var n = Math.pow(2, z);
    var out = [], x, y;
    for (x = x0; x <= x1; x++) {
      for (y = y0; y <= y1; y++) {
        out.push({ z: z, x: ((x % n) + n) % n, y: y });
      }
    }
    return out;
  }
  function refreshTileTemplates() {
    try {
      var found = [];
      var srcs = map.getStyle() && map.getStyle().sources;
      if (srcs) {
        for (var id in srcs) {
          var s = srcs[id];
          if (s && s.tiles) {
            for (var i = 0; i < s.tiles.length; i++) found.push(s.tiles[i]);
          }
        }
      }
      var om = map.getSource && map.getSource('openmaptiles');
      if (om && om.tiles && om.tiles.length) found = om.tiles.slice();
      var pbf = found.filter(function(u) { return /\{z\}/.test(u) && !/\.png/i.test(u); });
      if (pbf.length) tileTemplates = pbf;
      else if (found.length) tileTemplates = found;
    } catch (eT) {}
  }
  function enqueueTile(z, x, y) {
    z = clampTileZ(z);
    var key = z + '/' + x + '/' + y;
    if (prefetchSeen[key]) return;
    prefetchSeen[key] = 1;
    prefetchQueue.push({ z: z, x: x, y: y });
  }
  function pumpPrefetch() {
    if (prefetchPaused) return;
    if (!tileTemplates.length) refreshTileTemplates();
    if (!tileTemplates.length) return;
    while (prefetchInflight < PREFETCH_MAX_INFLIGHT && prefetchQueue.length) {
      var t = prefetchQueue.shift();
      var tmpl = tileTemplates[0];
      if (!tmpl || !t) return;
      var url = tmpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
      prefetchInflight++;
      fetch(url, { cache: 'force-cache' }).catch(function() {}).then(function() {
        prefetchInflight--;
        pumpPrefetch();
      });
    }
  }
  function enqueueRadius(lat, lng, radiusM) {
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(radiusM) || radiusM <= 0) return;
    refreshTileTemplates();
    var viewZ = 14;
    try { viewZ = clampTileZ(map.getZoom()); } catch (eZ) {}
    var zooms = [];
    if (radiusM >= 8000) zooms.push(11, 12);
    else zooms.push(viewZ);
    if (radiusM >= 500) zooms.push(Math.max(0, viewZ - 2));
    if (radiusM >= 2000) zooms.push(Math.max(0, viewZ - 3));
    if (radiusM >= 10000) zooms.push(Math.max(0, viewZ - 4));
    var added = 0;
    var cap = radiusM >= 8000 ? 48 : 80;
    for (var i = 0; i < zooms.length && added < cap; i++) {
      var zUse = zooms[i];
      var tiles = tilesCoveringRadius(lat, lng, radiusM, zUse);
      while (tiles.length > 64 && zUse > 8) {
        zUse -= 1;
        tiles = tilesCoveringRadius(lat, lng, radiusM, zUse);
      }
      for (var k = 0; k < tiles.length && added < cap; k++) {
        enqueueTile(tiles[k].z, tiles[k].x, tiles[k].y);
        added++;
      }
    }
    pumpPrefetch();
  }
  function enqueueNeighbors() {
    if (prefetchPaused) return;
    refreshTileTemplates();
    var z = 14, c, pad = 2, n, t, dx, dy;
    try { z = clampTileZ(map.getZoom()); c = map.getCenter(); } catch (eC) { return; }
    if (!c) return;
    t = lngLatToTile(c.lng, c.lat, z);
    n = Math.pow(2, z);
    for (dx = -pad; dx <= pad; dx++) {
      for (dy = -pad; dy <= pad; dy++) {
        enqueueTile(z, ((t.x + dx) % n + n) % n, Math.max(0, Math.min(n - 1, t.y + dy)));
      }
    }
    pumpPrefetch();
  }
  function scheduleNeighborPrefetch() {
    if (neighborTimer) return;
    neighborTimer = setTimeout(function() {
      neighborTimer = 0;
      enqueueNeighbors();
    }, 280);
  }
  function prefetchStyleExtras(style) {
    try {
      if (style && style.sprite) {
        ['', '@2x'].forEach(function(suf) {
          fetch(style.sprite + suf + '.json', { cache: 'force-cache' }).catch(function() {});
          fetch(style.sprite + suf + '.png', { cache: 'force-cache' }).catch(function() {});
        });
      }
      var srcs = style && style.sources;
      if (srcs) {
        for (var sid in srcs) {
          if (srcs[sid] && srcs[sid].url) {
            fetch(srcs[sid].url, { cache: 'force-cache' }).then(function(r) {
              return r.json();
            }).then(function(tj) {
              if (!tj || !tj.tiles || !tj.tiles.length) return;
              var pbf = tj.tiles.filter(function(u) {
                return /\{z\}/.test(u) && !/\.png/i.test(u);
              });
              if (pbf.length) tileTemplates = pbf;
              else tileTemplates = tj.tiles.slice();
              scheduleNeighborPrefetch();
            }).catch(function() {});
          }
        }
      }
    } catch (eS) {}
  }

  map.on('style.load', function() {
    bootOverlays();
  });
  if (map.loaded && map.loaded()) bootOverlays();
  try {
    if (map.isStyleLoaded && map.isStyleLoaded()) bootOverlays();
  } catch (eBoot) {}
  postInteractive();
  setTimeout(function() { if (!postedReady) postReady(); }, 2800);

  function addGeoSource(id) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }

  function ensureUserOverlay() {
    addGeoSource('user-loc');
    ensureArrowImage();
    addLayerStacked({
      id: 'user-accuracy', type: 'fill', source: 'user-loc',
      filter: ['==', ['get', 'kind'], 'accuracy'],
      paint: { 'fill-color': '#4285F4', 'fill-opacity': 0.14 }
    });
    addLayerStacked({
      id: 'user-arrow', type: 'symbol', source: 'user-loc',
      filter: ['==', ['get', 'kind'], 'arrow'],
      layout: {
        'icon-image': 'user-arrow',
        'icon-size': 0.72,
        'icon-rotate': ['to-number', ['coalesce', ['get', 'heading'], 0]],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'viewport',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center'
      }
    });
    bindPuckGestures();
    startDeadReckon();
  }

  function hasLibertyStyle() {
    try {
      var s = map.getStyle();
      if (!s || !s.sources) return false;
      for (var k in s.sources) {
        if (s.sources[k] && s.sources[k].type === 'vector') return true;
      }
    } catch (e) {}
    return false;
  }

  function addLayerStacked(layer) {
    if (map.getLayer(layer.id)) return;
    var idx = LAYER_STACK.indexOf(layer.id);
    var beforeId = undefined;
    if (idx >= 0) {
      for (var i = idx + 1; i < LAYER_STACK.length; i++) {
        if (map.getLayer(LAYER_STACK[i])) { beforeId = LAYER_STACK[i]; break; }
      }
    }
    try {
      if (beforeId) map.addLayer(layer, beforeId);
      else map.addLayer(layer);
    } catch (e) {
      try { map.addLayer(layer); } catch (e2) {}
    }
  }

  function restackLayers() {
    for (var i = 0; i < LAYER_STACK.length; i++) {
      var id = LAYER_STACK[i];
      if (!map.getLayer(id)) continue;
      try { map.moveLayer(id); } catch (e) {}
    }
    liftBasemapLabels();
  }

  function liftBasemapLabels() {
    if (!map.getStyle || !map.getStyle()) return;
    var layers = map.getStyle().layers || [];
    var beforeId = map.getLayer('places-fill')
      ? 'places-fill'
      : (map.getLayer('cities-fill') ? 'cities-fill' : null);
    if (!beforeId) return;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L || !L.id || L.type !== 'symbol') continue;
      if (/^(extract-|places-|route-|user-|fog-|cities-)/.test(L.id)) continue;
      try { map.moveLayer(L.id, beforeId); } catch (eL) {}
    }
  }

  function destPoint(lat, lng, bearingDeg, distM) {
    var R = 6378137;
    var br = bearingDeg * Math.PI / 180;
    var lat1 = lat * Math.PI / 180;
    var lng1 = lng * Math.PI / 180;
    var ang = distM / R;
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br));
    var lng2 = lng1 + Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
    );
    return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
  }

  var lastFollowBearing = null;
  var lastFollowLat = null;
  var lastFollowLng = null;
  function followBearingDeg() {
    if (typeof targetHeading === 'number' && isFinite(targetHeading)) return targetHeading;
    if (typeof userHeading === 'number' && isFinite(userHeading)) return userHeading;
    return null;
  }
  function applyFollowCamera() {
    if (!map) return;
    if (userIsDragging()) return;
    var jump = {};
    var br = headingFollow ? followBearingDeg() : null;
    if (typeof br === 'number' && isFinite(br)) jump.bearing = br;
    if (centerLock && userLat != null && userLng != null) {
      jump.center = [userLng, userLat];
    }
    if (jump.bearing == null && !jump.center) return;
    var sameBr = jump.bearing == null || (
      lastFollowBearing != null &&
      Math.abs(shortestSignedBearing(lastFollowBearing, jump.bearing)) < 0.12
    );
    var sameCtr = !jump.center || (
      lastFollowLat != null && lastFollowLng != null &&
      Math.abs(lastFollowLat - userLat) < 1e-7 &&
      Math.abs(lastFollowLng - userLng) < 1e-7
    );
    if (sameBr && sameCtr) return;
    programmaticMove += 1;
    try {
      map.jumpTo(jump);
    } catch (eC) {}
    setTimeout(function() {
      programmaticMove = Math.max(0, programmaticMove - 1);
    }, 0);
    if (jump.bearing != null) lastFollowBearing = jump.bearing;
    if (jump.center) {
      lastFollowLat = userLat;
      lastFollowLng = userLng;
    }
  }
  function applyCenterLock() {
    applyFollowCamera();
  }

  function tickDeadReckon() {
    deadReckonRaf = 0;
    if (mapPaused) return;
    if (gpsFixAt <= 0 || gpsFixLat == null || gpsFixLng == null) return;
    if (typeof gpsSpeedMs !== 'number' || gpsSpeedMs < 0.2) return;
    if (typeof userHeading !== 'number' || !isFinite(userHeading)) return;
    var dt = (Date.now() - gpsFixAt) / 1000;
    if (dt < 0.05 || dt > 16) return;
    var dist = Math.min(gpsSpeedMs * dt, 90);
    var p = destPoint(gpsFixLat, gpsFixLng, userHeading, dist);
    userLng = p[0];
    userLat = p[1];
    if (styleReady && !userIsDragging()) paintUserLocation({ skipFog: true });
    if (!userIsDragging()) applyCenterLock();
    deadReckonRaf = requestAnimationFrame(tickDeadReckon);
  }

  function startDeadReckon() {
    if (mapPaused || userIsDragging()) return;
    if (deadReckonRaf) return;
    if (typeof gpsSpeedMs !== 'number' || gpsSpeedMs < 0.2) return;
    deadReckonRaf = requestAnimationFrame(tickDeadReckon);
  }

  function bindPuckGestures() {
    if (puckGesturesBound) return;
    puckGesturesBound = true;
    function clearPuckHold() {
      if (puckHoldTimer) {
        clearTimeout(puckHoldTimer);
        puckHoldTimer = 0;
      }
    }
    function armPuckHold() {
      clearPuckHold();
      puckHoldTimer = setTimeout(function() {
        puckHoldTimer = 0;
        centerLock = true;
        applyCenterLock();
        post({ type: 'centerLock', on: true });
      }, 450);
    }
    ['user-arrow', 'user-accuracy'].forEach(function(id) {
      try {
        map.on('mousedown', id, armPuckHold);
        map.on('touchstart', id, armPuckHold);
      } catch (eB) {}
    });
    map.on('mouseup', clearPuckHold);
    map.on('touchend', clearPuckHold);
    map.on('dragstart', clearPuckHold);
  }

  function accuracyRingCoords(lat, lng, rM) {
    var n = 48;
    var ring = [];
    for (var i = 0; i <= n; i++) ring.push(destPoint(lat, lng, (i / n) * 360, rM));
    return ring;
  }

  function ensureArrowImage() {
    if (map.hasImage('user-arrow')) return;
    var s = 160;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var g = c.getContext('2d');
    if (!g) return;
    g.translate(s / 2, s / 2);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -40);
    g.lineTo(32, 36);
    g.lineTo(0, 18);
    g.lineTo(-32, 36);
    g.closePath();
    g.fillStyle = '#1A73E8';
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = '#ffffff';
    g.stroke();
    try { map.addImage('user-arrow', g.getImageData(0, 0, s, s), { pixelRatio: 2 }); }
    catch (e) { try { map.addImage('user-arrow', c, { pixelRatio: 2 }); } catch (e2) {} }
  }

  function ensurePlaceAmenityImages() {
    function badge(id, bg, draw) {
      if (map.hasImage(id)) return;
      var s = 96;
      var c = document.createElement('canvas');
      c.width = s; c.height = s;
      var g = c.getContext('2d');
      if (!g) return;
      g.fillStyle = bg;
      g.beginPath();
      if (g.roundRect) g.roundRect(4, 4, s - 8, s - 8, 16);
      else g.rect(4, 4, s - 8, s - 8);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.stroke();
      draw(g, s);
      try { map.addImage(id, g.getImageData(0, 0, s, s), { pixelRatio: 2 }); }
      catch (eI) { try { map.addImage(id, c, { pixelRatio: 2 }); } catch (e2) {} }
    }
    badge('place-rail', '#2C3A42', function(g, s) {
      var bg = '#2C3A42';
      g.fillStyle = '#ffffff';
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.20, s * 0.12, s * 0.60, s * 0.58, s * 0.13);
        g.fill();
      } else {
        g.fillRect(s * 0.20, s * 0.12, s * 0.60, s * 0.58);
      }
      g.fillStyle = bg;
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.36, s * 0.18, s * 0.28, s * 0.07, 4);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.28, s * 0.30, s * 0.44, s * 0.18, 6);
        g.fill();
      } else {
        g.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.07);
        g.fillRect(s * 0.28, s * 0.30, s * 0.44, s * 0.18);
      }
      g.beginPath();
      g.arc(s * 0.34, s * 0.58, s * 0.055, 0, Math.PI * 2);
      g.arc(s * 0.66, s * 0.58, s * 0.055, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(s * 0.30, s * 0.70);
      g.lineTo(s * 0.16, s * 0.86);
      g.lineTo(s * 0.84, s * 0.86);
      g.lineTo(s * 0.70, s * 0.70);
      g.stroke();
    });
    badge('place-parking', '#1A73E8', function(g, s) {
      g.fillStyle = '#ffffff';
      g.font = 'bold 56px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('P', s / 2, s / 2 + 2);
    });
    badge('place-post', '#F5C400', function(g, s) {
      var bg = '#F5C400';
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(s * 0.50, s * 0.10);
      g.lineTo(s * 0.90, s * 0.42);
      g.lineTo(s * 0.90, s * 0.86);
      g.lineTo(s * 0.10, s * 0.86);
      g.lineTo(s * 0.10, s * 0.42);
      g.closePath();
      g.fill();
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(s * 0.14, s * 0.44);
      g.lineTo(s * 0.50, s * 0.70);
      g.lineTo(s * 0.86, s * 0.44);
      g.closePath();
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(s * 0.10, s * 0.42);
      g.lineTo(s * 0.50, s * 0.10);
      g.lineTo(s * 0.90, s * 0.42);
      g.stroke();
    });
    badge('place-bus', '#D4782A', function(g, s) {
      var bg = '#D4782A';
      g.fillStyle = '#ffffff';
      g.beginPath();
      if (g.roundRect) {
        g.roundRect(s * 0.10, s * 0.26, s * 0.80, s * 0.40, [s * 0.18, 8, 8, s * 0.12]);
      } else {
        g.rect(s * 0.10, s * 0.26, s * 0.80, s * 0.40);
      }
      g.fill();
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(s * 0.12, s * 0.32);
      g.lineTo(s * 0.30, s * 0.32);
      g.lineTo(s * 0.26, s * 0.50);
      g.lineTo(s * 0.12, s * 0.50);
      g.closePath();
      g.fill();
      var i, wx = s * 0.34, ww = s * 0.12, gap = s * 0.035;
      for (i = 0; i < 3; i++) {
        if (g.roundRect) {
          g.beginPath();
          g.roundRect(wx + i * (ww + gap), s * 0.32, ww, s * 0.16, 3);
          g.fill();
        } else {
          g.fillRect(wx + i * (ww + gap), s * 0.32, ww, s * 0.16);
        }
      }
      g.beginPath();
      g.arc(s * 0.30, s * 0.68, s * 0.09, 0, Math.PI * 2);
      g.arc(s * 0.70, s * 0.68, s * 0.09, 0, Math.PI * 2);
      g.fill();
    });
    badge('place-fuel', '#C4783A', function(g, s) {
      g.fillStyle = '#ffffff';
      g.fillRect(s * 0.28, s * 0.24, s * 0.26, s * 0.50);
      g.fillRect(s * 0.28, s * 0.20, s * 0.26, s * 0.10);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s * 0.56, s * 0.30);
      g.lineTo(s * 0.70, s * 0.40);
      g.lineTo(s * 0.70, s * 0.64);
      g.stroke();
    });
    badge('place-pharmacy', '#2E8B57', function(g, s) {
      g.strokeStyle = '#ffffff';
      g.fillStyle = '#ffffff';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.34, 0, Math.PI * 2);
      g.stroke();
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.44, s * 0.26, s * 0.12, s * 0.48, 5);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.26, s * 0.44, s * 0.48, s * 0.12, 5);
        g.fill();
      } else {
        g.fillRect(s * 0.44, s * 0.26, s * 0.12, s * 0.48);
        g.fillRect(s * 0.26, s * 0.44, s * 0.48, s * 0.12);
      }
    });
    badge('place-supermarket', '#C47A32', function(g, s) {
      g.strokeStyle = '#ffffff';
      g.fillStyle = '#ffffff';
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(s * 0.16, s * 0.28);
      g.lineTo(s * 0.28, s * 0.28);
      g.lineTo(s * 0.34, s * 0.42);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.30, s * 0.42);
      g.lineTo(s * 0.78, s * 0.42);
      g.lineTo(s * 0.72, s * 0.68);
      g.lineTo(s * 0.36, s * 0.68);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.40, s * 0.42);
      g.lineTo(s * 0.38, s * 0.68);
      g.moveTo(s * 0.52, s * 0.42);
      g.lineTo(s * 0.50, s * 0.68);
      g.moveTo(s * 0.64, s * 0.42);
      g.lineTo(s * 0.62, s * 0.68);
      g.stroke();
      g.beginPath();
      g.arc(s * 0.42, s * 0.78, s * 0.06, 0, Math.PI * 2);
      g.arc(s * 0.66, s * 0.78, s * 0.06, 0, Math.PI * 2);
      g.fill();
    });
    badge('place-kiosk', '#6A5A48', function(g, s) {
      var bg = '#6A5A48';
      g.fillStyle = '#ffffff';
      g.fillRect(s * 0.14, s * 0.14, s * 0.72, s * 0.16);
      g.beginPath();
      g.moveTo(s * 0.14, s * 0.30);
      var sc;
      for (sc = 0; sc < 6; sc++) {
        var x0 = s * 0.14 + sc * (s * 0.12);
        g.quadraticCurveTo(x0 + s * 0.06, s * 0.38, x0 + s * 0.12, s * 0.30);
      }
      g.closePath();
      g.fill();
      g.fillRect(s * 0.16, s * 0.30, s * 0.08, s * 0.34);
      g.fillRect(s * 0.76, s * 0.30, s * 0.08, s * 0.34);
      g.fillRect(s * 0.30, s * 0.40, s * 0.055, s * 0.16);
      g.fillRect(s * 0.38, s * 0.38, s * 0.055, s * 0.18);
      g.beginPath();
      g.arc(s * 0.327, s * 0.40, s * 0.028, 0, Math.PI * 2);
      g.arc(s * 0.407, s * 0.38, s * 0.028, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(s * 0.62, s * 0.40, s * 0.065, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      if (g.ellipse) g.ellipse(s * 0.62, s * 0.54, s * 0.10, s * 0.08, 0, 0, Math.PI * 2);
      else g.arc(s * 0.62, s * 0.54, s * 0.09, 0, Math.PI * 2);
      g.fill();
      g.fillRect(s * 0.14, s * 0.62, s * 0.72, s * 0.22);
      g.fillStyle = bg;
      var sl;
      for (sl = 0; sl < 7; sl++) {
        g.fillRect(s * 0.20 + sl * s * 0.08, s * 0.66, s * 0.018, s * 0.14);
      }
    });
    badge('place-bar', '#5A2C3C', function(g, s) {
      var bg = '#5A2C3C';
      g.fillStyle = '#ffffff';
      function bottle(x) {
        g.beginPath();
        g.moveTo(x - s * 0.04, s * 0.38);
        g.lineTo(x - s * 0.038, s * 0.24);
        g.lineTo(x - s * 0.016, s * 0.16);
        g.lineTo(x + s * 0.016, s * 0.16);
        g.lineTo(x + s * 0.038, s * 0.24);
        g.lineTo(x + s * 0.04, s * 0.38);
        g.closePath();
        g.fill();
      }
      bottle(s * 0.38);
      bottle(s * 0.62);
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.36, s * 0.68, s * 0.08, 4);
        g.fill();
      } else {
        g.fillRect(s * 0.16, s * 0.36, s * 0.68, s * 0.08);
      }
      g.fillRect(s * 0.20, s * 0.44, s * 0.60, s * 0.40);
      g.fillStyle = bg;
      function stool(x) {
        if (g.roundRect) {
          g.beginPath();
          g.roundRect(x - s * 0.09, s * 0.52, s * 0.18, s * 0.055, 3);
          g.fill();
        } else {
          g.fillRect(x - s * 0.09, s * 0.52, s * 0.18, s * 0.055);
        }
        g.fillRect(x - s * 0.018, s * 0.57, s * 0.036, s * 0.16);
        g.beginPath();
        g.arc(x, s * 0.76, s * 0.07, Math.PI, 0);
        g.closePath();
        g.fill();
      }
      stool(s * 0.36);
      stool(s * 0.64);
    });
    badge('place-restaurant', '#B8876A', function(g, s) {
      g.strokeStyle = '#ffffff';
      g.fillStyle = '#ffffff';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      var fx = s * 0.34;
      g.beginPath();
      g.moveTo(fx, s * 0.78);
      g.lineTo(fx, s * 0.46);
      g.stroke();
      g.beginPath();
      g.moveTo(fx - s * 0.08, s * 0.22);
      g.lineTo(fx - s * 0.08, s * 0.42);
      g.moveTo(fx, s * 0.22);
      g.lineTo(fx, s * 0.42);
      g.moveTo(fx + s * 0.08, s * 0.22);
      g.lineTo(fx + s * 0.08, s * 0.42);
      g.stroke();
      g.beginPath();
      g.moveTo(fx - s * 0.08, s * 0.42);
      g.lineTo(fx, s * 0.46);
      g.lineTo(fx + s * 0.08, s * 0.42);
      g.stroke();
      var kx = s * 0.66;
      g.beginPath();
      g.moveTo(kx, s * 0.78);
      g.lineTo(kx, s * 0.48);
      g.stroke();
      g.beginPath();
      g.moveTo(kx - s * 0.018, s * 0.48);
      g.lineTo(kx - s * 0.018, s * 0.22);
      g.lineTo(kx + s * 0.10, s * 0.28);
      g.lineTo(kx + s * 0.04, s * 0.48);
      g.closePath();
      g.fill();
    });
    badge('place-doctor', '#8B4A52', function(g, s) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      if (g.ellipse) g.ellipse(s * 0.50, s * 0.32, s * 0.15, s * 0.17, 0, 0, Math.PI * 2);
      else g.arc(s * 0.50, s * 0.32, s * 0.16, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(s * 0.38, s * 0.26, s * 0.08, Math.PI * 0.15, Math.PI * 1.15);
      g.stroke();
      g.beginPath();
      g.arc(s * 0.62, s * 0.26, s * 0.08, -Math.PI * 0.15, Math.PI * 0.85, true);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.22, s * 0.86);
      g.quadraticCurveTo(s * 0.20, s * 0.54, s * 0.38, s * 0.50);
      g.moveTo(s * 0.78, s * 0.86);
      g.quadraticCurveTo(s * 0.80, s * 0.54, s * 0.62, s * 0.50);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.38, s * 0.52);
      g.lineTo(s * 0.50, s * 0.64);
      g.lineTo(s * 0.62, s * 0.52);
      g.moveTo(s * 0.50, s * 0.64);
      g.lineTo(s * 0.50, s * 0.86);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.40, s * 0.54);
      g.quadraticCurveTo(s * 0.26, s * 0.62, s * 0.30, s * 0.74);
      g.stroke();
      g.beginPath();
      g.arc(s * 0.30, s * 0.78, s * 0.055, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.60, s * 0.54);
      g.quadraticCurveTo(s * 0.74, s * 0.62, s * 0.70, s * 0.72);
      g.stroke();
      g.beginPath();
      g.arc(s * 0.70, s * 0.76, s * 0.045, Math.PI * 0.15, Math.PI * 1.55);
      g.stroke();
    });
    badge('place-toilet', '#6A8A7A', function(g, s) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(s * 0.32, s * 0.24, s * 0.075, 0, Math.PI * 2);
      g.fill();
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.21, s * 0.34, s * 0.22, s * 0.32, 7);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.22, s * 0.64, s * 0.08, s * 0.18, 4);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.34, s * 0.64, s * 0.08, s * 0.18, 4);
        g.fill();
      } else {
        g.fillRect(s * 0.21, s * 0.34, s * 0.22, s * 0.32);
        g.fillRect(s * 0.22, s * 0.64, s * 0.08, s * 0.18);
        g.fillRect(s * 0.34, s * 0.64, s * 0.08, s * 0.18);
      }
      g.beginPath();
      g.arc(s * 0.68, s * 0.24, s * 0.075, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(s * 0.60, s * 0.36);
      g.lineTo(s * 0.76, s * 0.36);
      g.lineTo(s * 0.84, s * 0.66);
      g.lineTo(s * 0.52, s * 0.66);
      g.closePath();
      g.fill();
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.58, s * 0.64, s * 0.08, s * 0.18, 4);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.70, s * 0.64, s * 0.08, s * 0.18, 4);
        g.fill();
      } else {
        g.fillRect(s * 0.58, s * 0.64, s * 0.08, s * 0.18);
        g.fillRect(s * 0.70, s * 0.64, s * 0.08, s * 0.18);
      }
    });
    badge('place-info', '#C4A35A', function(g, s) {
      g.fillStyle = '#1A1814';
      g.beginPath();
      g.arc(s / 2, s * 0.30, 6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(s * 0.44, s * 0.40, s * 0.12, s * 0.36);
    });
    badge('place-viewpoint', '#6B9B7A', function(g, s) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(s * 0.50, s * 0.18);
      g.lineTo(s * 0.78, s * 0.72);
      g.lineTo(s * 0.22, s * 0.72);
      g.closePath();
      g.fill();
      g.fillStyle = '#6B9B7A';
      g.beginPath();
      g.moveTo(s * 0.50, s * 0.36);
      g.lineTo(s * 0.64, s * 0.66);
      g.lineTo(s * 0.36, s * 0.66);
      g.closePath();
      g.fill();
    });
    badge('place-park', '#3D7A4A', function(g, s) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(s * 0.70, s * 0.30, s * 0.18, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(s * 0.58, s * 0.36, s * 0.12, 0, Math.PI * 2);
      g.arc(s * 0.80, s * 0.36, s * 0.11, 0, Math.PI * 2);
      g.fill();
      g.fillRect(s * 0.66, s * 0.42, s * 0.08, s * 0.40);
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.12, s * 0.46, s * 0.44, s * 0.08, 3);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.12, s * 0.60, s * 0.44, s * 0.08, 3);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.68, s * 0.07, s * 0.16, 2);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.45, s * 0.68, s * 0.07, s * 0.16, 2);
        g.fill();
      } else {
        g.fillRect(s * 0.12, s * 0.46, s * 0.44, s * 0.08);
        g.fillRect(s * 0.12, s * 0.60, s * 0.44, s * 0.08);
        g.fillRect(s * 0.16, s * 0.68, s * 0.07, s * 0.16);
        g.fillRect(s * 0.45, s * 0.68, s * 0.07, s * 0.16);
      }
    });
    badge('place-nature', '#6B9B7A', function(g, s) {
      g.fillStyle = '#ffffff';
      g.fillRect(s * 0.08, s * 0.86, s * 0.84, s * 0.08);
      g.beginPath();
      g.arc(s * 0.30, s * 0.30, s * 0.16, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(s * 0.70, s * 0.26, s * 0.18, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(s * 0.22, s * 0.48, s * 0.13, 0, Math.PI * 2);
      g.arc(s * 0.50, s * 0.40, s * 0.14, 0, Math.PI * 2);
      g.arc(s * 0.78, s * 0.46, s * 0.14, 0, Math.PI * 2);
      g.fill();
      g.fillRect(s * 0.26, s * 0.44, s * 0.08, s * 0.42);
      g.fillRect(s * 0.46, s * 0.50, s * 0.08, s * 0.36);
      g.fillRect(s * 0.66, s * 0.42, s * 0.08, s * 0.44);
    });
    badge('place-historic', '#7A6248', function(g, s) {
      var bg = '#7A6248';
      g.fillStyle = '#ffffff';
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.22, s * 0.46, s * 0.60, 6);
        g.fill();
      } else {
        g.fillRect(s * 0.16, s * 0.22, s * 0.46, s * 0.60);
      }
      g.beginPath();
      if (g.ellipse) {
        g.ellipse(s * 0.39, s * 0.22, s * 0.23, s * 0.09, 0, 0, Math.PI * 2);
      } else {
        g.arc(s * 0.39, s * 0.22, s * 0.16, 0, Math.PI * 2);
      }
      g.fill();
      g.beginPath();
      if (g.ellipse) {
        g.ellipse(s * 0.39, s * 0.82, s * 0.23, s * 0.09, 0, 0, Math.PI * 2);
      } else {
        g.arc(s * 0.39, s * 0.82, s * 0.16, 0, Math.PI * 2);
      }
      g.fill();
      g.fillStyle = bg;
      var i, y0 = s * 0.36;
      for (i = 0; i < 5; i++) {
        g.fillRect(s * 0.24, y0 + i * s * 0.08, s * (0.22 + (i % 2) * 0.06), s * 0.035);
      }
      g.strokeStyle = '#ffffff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(s * 0.58, s * 0.78);
      g.lineTo(s * 0.84, s * 0.22);
      g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(s * 0.78, s * 0.12);
      g.lineTo(s * 0.92, s * 0.28);
      g.lineTo(s * 0.70, s * 0.36);
      g.closePath();
      g.fill();
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(s * 0.80, s * 0.18);
      g.lineTo(s * 0.88, s * 0.26);
      g.moveTo(s * 0.74, s * 0.22);
      g.lineTo(s * 0.84, s * 0.32);
      g.stroke();
    });
    badge('place-activity', '#5E8F8A', function(g, s) {
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#ffffff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.arc(s * 0.58, s * 0.22, s * 0.10, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(s * 0.52, s * 0.34);
      g.lineTo(s * 0.40, s * 0.56);
      g.lineTo(s * 0.28, s * 0.82);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.40, s * 0.56);
      g.lineTo(s * 0.62, s * 0.84);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.50, s * 0.38);
      g.lineTo(s * 0.72, s * 0.50);
      g.stroke();
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(s * 0.70, s * 0.36);
      g.lineTo(s * 0.82, s * 0.78);
      g.stroke();
    });
    badge('place-camping', '#5A6B3A', function(g, s) {
      var bg = '#5A6B3A';
      g.fillStyle = '#ffffff';
      g.fillRect(s * 0.10, s * 0.80, s * 0.80, s * 0.06);
      g.beginPath();
      g.moveTo(s * 0.50, s * 0.20);
      g.lineTo(s * 0.84, s * 0.80);
      g.lineTo(s * 0.16, s * 0.80);
      g.closePath();
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s * 0.42, s * 0.16);
      g.lineTo(s * 0.50, s * 0.08);
      g.lineTo(s * 0.58, s * 0.16);
      g.stroke();
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(s * 0.50, s * 0.44);
      g.lineTo(s * 0.64, s * 0.80);
      g.lineTo(s * 0.36, s * 0.80);
      g.closePath();
      g.fill();
    });
    badge('place-hotel', '#9A8496', function(g, s) {
      var bg = '#9A8496';
      g.fillStyle = '#ffffff';
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.10, s * 0.42, s * 0.14, s * 0.40, 7);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.76, s * 0.52, s * 0.14, s * 0.30, 6);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.62, s * 0.68, s * 0.14, 5);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.38, s * 0.50, s * 0.40, s * 0.22, 8);
        g.fill();
      } else {
        g.fillRect(s * 0.10, s * 0.42, s * 0.14, s * 0.40);
        g.fillRect(s * 0.76, s * 0.52, s * 0.14, s * 0.30);
        g.fillRect(s * 0.16, s * 0.62, s * 0.68, s * 0.14);
        g.fillRect(s * 0.38, s * 0.50, s * 0.40, s * 0.22);
      }
      g.fillStyle = bg;
      g.fillRect(s * 0.33, s * 0.48, s * 0.06, s * 0.16);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(s * 0.30, s * 0.48, s * 0.09, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineCap = 'butt';
      g.lineJoin = 'miter';
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(s * 0.42, s * 0.30);
      g.lineTo(s * 0.54, s * 0.30);
      g.lineTo(s * 0.42, s * 0.42);
      g.lineTo(s * 0.54, s * 0.42);
      g.stroke();
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(s * 0.56, s * 0.14);
      g.lineTo(s * 0.74, s * 0.14);
      g.lineTo(s * 0.56, s * 0.32);
      g.lineTo(s * 0.74, s * 0.32);
      g.stroke();
    });
    badge('place-hostel', '#5A6B82', function(g, s) {
      var frame = '#ffffff';
      var sleeper = '#4A9BE8';
      g.fillStyle = frame;
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.12, s * 0.10, s * 0.76, 6);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.74, s * 0.12, s * 0.10, s * 0.76, 6);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.30, s * 0.68, s * 0.10, 4);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.66, s * 0.68, s * 0.10, 4);
        g.fill();
      } else {
        g.fillRect(s * 0.16, s * 0.12, s * 0.10, s * 0.76);
        g.fillRect(s * 0.74, s * 0.12, s * 0.10, s * 0.76);
        g.fillRect(s * 0.16, s * 0.30, s * 0.68, s * 0.10);
        g.fillRect(s * 0.16, s * 0.66, s * 0.68, s * 0.10);
      }
      function bunk(y) {
        g.fillStyle = sleeper;
        g.beginPath();
        g.arc(s * 0.36, y, s * 0.07, 0, Math.PI * 2);
        g.fill();
        if (g.roundRect) {
          g.beginPath();
          g.roundRect(s * 0.42, y - s * 0.06, s * 0.28, s * 0.12, [2, 8, 8, 2]);
          g.fill();
        } else {
          g.fillRect(s * 0.42, y - s * 0.06, s * 0.28, s * 0.12);
        }
      }
      bunk(s * 0.26);
      bunk(s * 0.62);
    });
    badge('place-attraction', '#7A6EA8', function(g, s) {
      var bg = '#7A6EA8';
      g.fillStyle = '#ffffff';
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.40, s * 0.10, s * 0.20, s * 0.12, 4);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.10, s * 0.50, s * 0.80, s * 0.36, 14);
        g.fill();
      } else {
        g.fillRect(s * 0.40, s * 0.10, s * 0.20, s * 0.12);
        g.fillRect(s * 0.10, s * 0.50, s * 0.80, s * 0.36);
      }
      g.beginPath();
      g.arc(s * 0.50, s * 0.42, s * 0.30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = bg;
      g.beginPath();
      g.arc(s * 0.50, s * 0.44, s * 0.16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(s * 0.50, s * 0.44, s * 0.09, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = bg;
      g.beginPath();
      g.arc(s * 0.50, s * 0.44, s * 0.04, 0, Math.PI * 2);
      g.fill();
    });
    badge('place-museum', '#7A6EA8', function(g, s) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(s * 0.50, s * 0.12);
      g.lineTo(s * 0.90, s * 0.34);
      g.lineTo(s * 0.10, s * 0.34);
      g.closePath();
      g.fill();
      g.fillRect(s * 0.12, s * 0.32, s * 0.76, s * 0.10);
      g.fillRect(s * 0.10, s * 0.78, s * 0.80, s * 0.10);
      var i, x0 = s * 0.18, gap = s * 0.18, cw = s * 0.10;
      for (i = 0; i < 4; i++) {
        var x = x0 + i * gap;
        g.beginPath();
        g.arc(x + cw / 2, s * 0.48, cw / 2, Math.PI, 0);
        g.fill();
        g.fillRect(x, s * 0.48, cw, s * 0.30);
      }
    });
    badge('place-cinema', '#8B3A4A', function(g, s) {
      var bg = '#8B3A4A';
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(s * 0.16, s * 0.30);
      g.lineTo(s * 0.78, s * 0.12);
      g.lineTo(s * 0.84, s * 0.26);
      g.lineTo(s * 0.22, s * 0.44);
      g.closePath();
      g.fill();
      g.strokeStyle = bg;
      g.lineWidth = 5;
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(s * 0.32, s * 0.34);
      g.lineTo(s * 0.40, s * 0.16);
      g.moveTo(s * 0.48, s * 0.30);
      g.lineTo(s * 0.56, s * 0.14);
      g.moveTo(s * 0.64, s * 0.26);
      g.lineTo(s * 0.72, s * 0.14);
      g.stroke();
      g.fillStyle = '#ffffff';
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.16, s * 0.40, s * 0.68, s * 0.48, 4);
        g.fill();
      } else {
        g.fillRect(s * 0.16, s * 0.40, s * 0.68, s * 0.48);
      }
      g.fillStyle = bg;
      g.fillRect(s * 0.16, s * 0.40, s * 0.68, s * 0.10);
      g.fillStyle = '#ffffff';
      var i, hx = s * 0.22, hw = s * 0.07, hgap = s * 0.05;
      for (i = 0; i < 5; i++) {
        g.fillRect(hx + i * (hw + hgap), s * 0.42, hw, s * 0.06);
      }
      g.fillStyle = bg;
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.30, s * 0.58, s * 0.40, s * 0.18, 3);
        g.fill();
      } else {
        g.fillRect(s * 0.30, s * 0.58, s * 0.40, s * 0.18);
      }
    });
    badge('place-theater', '#6A4A7A', function(g, s) {
      var bg = '#6A4A7A';
      function face(cx, cy, smile) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        if (g.ellipse) {
          g.ellipse(cx, cy, s * 0.20, s * 0.26, 0, 0, Math.PI * 2);
        } else {
          g.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
        }
        g.fill();
        g.fillStyle = bg;
        g.beginPath();
        if (g.ellipse) {
          g.ellipse(cx - s * 0.07, cy - s * 0.04, s * 0.045, s * 0.055, 0, 0, Math.PI * 2);
          g.ellipse(cx + s * 0.07, cy - s * 0.04, s * 0.045, s * 0.055, 0, 0, Math.PI * 2);
        } else {
          g.arc(cx - s * 0.07, cy - s * 0.04, s * 0.045, 0, Math.PI * 2);
          g.arc(cx + s * 0.07, cy - s * 0.04, s * 0.045, 0, Math.PI * 2);
        }
        g.fill();
        g.strokeStyle = bg;
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.beginPath();
        if (smile) {
          g.arc(cx, cy + s * 0.02, s * 0.10, 0.2, Math.PI - 0.2, false);
        } else {
          g.arc(cx, cy + s * 0.16, s * 0.10, Math.PI + 0.2, -0.2, false);
        }
        g.stroke();
      }
      face(s * 0.36, s * 0.46, false);
      face(s * 0.64, s * 0.54, true);
    });
    badge('place-cafe', '#C4A06A', function(g, s) {
      var bg = '#C4A06A';
      g.strokeStyle = '#ffffff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = 5;
      function steam(x) {
        g.beginPath();
        g.moveTo(x, s * 0.28);
        g.quadraticCurveTo(x + s * 0.05, s * 0.20, x, s * 0.14);
        g.quadraticCurveTo(x - s * 0.05, s * 0.08, x, s * 0.04);
        g.stroke();
      }
      steam(s * 0.36);
      steam(s * 0.48);
      steam(s * 0.60);
      g.fillStyle = '#ffffff';
      g.beginPath();
      if (g.roundRect) {
        g.roundRect(s * 0.22, s * 0.34, s * 0.46, s * 0.42, [3, 3, 16, 16]);
      } else {
        g.rect(s * 0.22, s * 0.34, s * 0.46, s * 0.42);
      }
      g.fill();
      g.fillStyle = bg;
      g.beginPath();
      if (g.roundRect) {
        g.roundRect(s * 0.30, s * 0.42, s * 0.30, s * 0.26, [2, 2, 10, 10]);
      } else {
        g.rect(s * 0.30, s * 0.42, s * 0.30, s * 0.26);
      }
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 7;
      g.beginPath();
      g.arc(s * 0.72, s * 0.52, s * 0.11, -1.15, 1.15);
      g.stroke();
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(s * 0.16, s * 0.84);
      g.lineTo(s * 0.78, s * 0.84);
      g.stroke();
    });
    badge('place-water', '#2F6F88', function(g, s) {
      g.fillStyle = '#8FDBEA';
      g.beginPath();
      g.moveTo(s * 0.30, s * 0.34);
      g.lineTo(s * 0.70, s * 0.34);
      g.lineTo(s * 0.64, s * 0.80);
      g.lineTo(s * 0.36, s * 0.80);
      g.closePath();
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s * 0.26, s * 0.22);
      g.lineTo(s * 0.34, s * 0.82);
      g.lineTo(s * 0.66, s * 0.82);
      g.lineTo(s * 0.74, s * 0.22);
      g.stroke();
      g.beginPath();
      if (g.ellipse) {
        g.ellipse(s * 0.50, s * 0.22, s * 0.24, s * 0.07, 0, 0, Math.PI * 2);
      } else {
        g.arc(s * 0.50, s * 0.22, s * 0.24, 0, Math.PI * 2);
      }
      g.stroke();
      g.lineWidth = 3;
      g.beginPath();
      if (g.ellipse) {
        g.ellipse(s * 0.50, s * 0.34, s * 0.20, s * 0.05, 0, 0, Math.PI);
      } else {
        g.moveTo(s * 0.30, s * 0.34);
        g.lineTo(s * 0.70, s * 0.34);
      }
      g.stroke();
      g.fillStyle = '#ffffff';
      var drops = [
        [0.42, 0.48, 0.028],
        [0.56, 0.52, 0.020],
        [0.48, 0.62, 0.032],
        [0.58, 0.68, 0.016],
        [0.40, 0.70, 0.022],
        [0.52, 0.56, 0.014],
        [0.46, 0.72, 0.018],
      ];
      var d;
      for (d = 0; d < drops.length; d++) {
        g.beginPath();
        g.arc(s * drops[d][0], s * drops[d][1], s * drops[d][2], 0, Math.PI * 2);
        g.fill();
      }
    });
    badge('place-bike', '#6A9A86', function(g, s) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(s * 0.32, s * 0.62, 12, 0, Math.PI * 2);
      g.arc(s * 0.68, s * 0.62, 12, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.32, s * 0.62);
      g.lineTo(s * 0.48, s * 0.38);
      g.lineTo(s * 0.68, s * 0.62);
      g.moveTo(s * 0.48, s * 0.38);
      g.lineTo(s * 0.58, s * 0.28);
      g.stroke();
    });
    badge('place-ferry', '#4A6A8A', function(g, s) {
      var bg = '#4A6A8A';
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(s * 0.18, s * 0.58);
      g.lineTo(s * 0.28, s * 0.78);
      g.lineTo(s * 0.72, s * 0.78);
      g.lineTo(s * 0.82, s * 0.58);
      g.lineTo(s * 0.50, s * 0.50);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(s * 0.34, s * 0.50);
      g.lineTo(s * 0.38, s * 0.32);
      g.lineTo(s * 0.62, s * 0.32);
      g.lineTo(s * 0.66, s * 0.50);
      g.closePath();
      g.fill();
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.46, s * 0.16, s * 0.08, s * 0.16, 4);
        g.fill();
      } else {
        g.fillRect(s * 0.46, s * 0.16, s * 0.08, s * 0.16);
      }
      g.fillStyle = bg;
      if (g.roundRect) {
        g.beginPath();
        g.roundRect(s * 0.40, s * 0.36, s * 0.08, s * 0.08, 2);
        g.fill();
        g.beginPath();
        g.roundRect(s * 0.52, s * 0.36, s * 0.08, s * 0.08, 2);
        g.fill();
      } else {
        g.fillRect(s * 0.40, s * 0.36, s * 0.08, s * 0.08);
        g.fillRect(s * 0.52, s * 0.36, s * 0.08, s * 0.08);
      }
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s * 0.16, s * 0.86);
      g.quadraticCurveTo(s * 0.28, s * 0.78, s * 0.40, s * 0.86);
      g.quadraticCurveTo(s * 0.52, s * 0.94, s * 0.64, s * 0.86);
      g.quadraticCurveTo(s * 0.76, s * 0.78, s * 0.86, s * 0.86);
      g.stroke();
    });
  }

  function ensureRouteChevronImage() {
    if (map.hasImage('route-chevron')) return;
    var s = 64;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var g = c.getContext('2d');
    if (!g) return;
    g.translate(s / 2, s / 2);
    g.beginPath();
    g.moveTo(0, -16);
    g.lineTo(11, 8);
    g.lineTo(0, 2);
    g.lineTo(-11, 8);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 2.2;
    g.strokeStyle = '${HOME_MAP_ROUTE_LINE}';
    g.stroke();
    try { map.addImage('route-chevron', g.getImageData(0, 0, s, s), { pixelRatio: 2 }); }
    catch (e) { try { map.addImage('route-chevron', c, { pixelRatio: 2 }); } catch (e2) {} }
  }

  function ensureRoutePinImages() {
    function drawPin(id, fill, label) {
      if (map.hasImage(id)) return;
      var w = 128, h = 176;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g = c.getContext('2d');
      if (!g) return;
      var x = w / 2, headCy = 52, headR = 38, tipY = h - 8;
      g.beginPath();
      g.ellipse(x, h - 7, 18, 5, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fill();
      g.beginPath();
      g.moveTo(x, tipY);
      g.lineTo(x + headR * 0.78, headCy + headR * 0.52);
      g.arc(x, headCy, headR, 0.32, Math.PI - 0.32, true);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.lineJoin = 'round';
      g.lineWidth = 7;
      g.strokeStyle = '#ffffff';
      g.stroke();
      if (label) {
        g.fillStyle = '#ffffff';
        g.font = 'bold 44px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(label), x, headCy + 1);
      } else {
        g.beginPath();
        g.arc(x, headCy, 13, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
      }
      try { map.addImage(id, g.getImageData(0, 0, w, h), { pixelRatio: 2 }); }
      catch (ePin) { try { map.addImage(id, c, { pixelRatio: 2 }); } catch (e2) {} }
    }
    var nowFill = '${HOME_MAP_ROUTE_LINE}';
    var nextFill = '${HOME_MAP_ROUTE_AHEAD}';
    drawPin('route-pin-now', nowFill, '');
    var n;
    for (n = 1; n <= 9; n++) {
      drawPin('route-pin-now-' + n, nowFill, String(n));
      drawPin('route-pin-next-' + n, nextFill, String(n));
    }
  }

  function distM(a, b) {
    return Math.hypot(
      (b.lat - a.lat) * 111320,
      (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
    );
  }

  function shouldConnectFog(a, b) {
    if (!a || !b) return false;
    var dt = (typeof b.at === 'number' && typeof a.at === 'number') ? (b.at - a.at) : 0;
    if (dt < 0 || dt > FOG_BREAK_MS) return false;
    return distM(a, b) <= FOG_BREAK_M;
  }

  function fogTrackPoints() {
    var raw = [];
    for (var j = 0; j < walkTrack.length; j++) {
      var q = walkTrack[j];
      if (!q || typeof q.lat !== 'number' || typeof q.lng !== 'number') continue;
      raw.push(q);
    }
    if (userLat != null && userLng != null) {
      raw.push({
        lat: Math.round(userLat * 2500) / 2500,
        lng: Math.round(userLng * 2500) / 2500,
        at: Date.now()
      });
    }
    var segs = [];
    var cur = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (!cur.length) { cur = [p]; continue; }
      if (shouldConnectFog(cur[cur.length - 1], p)) cur.push(p);
      else { segs.push(cur); cur = [p]; }
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  /** Vereinigte Erkundungsfläche — SSOT src/services/discovery/fogCoverage.ts */
  function fogSignedArea(ring) {
    var a = 0;
    for (var i = 0, n = ring.length - 1; i < n; i++) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return a;
  }
  function fogAsOuter(ring) {
    return fogSignedArea(ring) < 0 ? ring.slice().reverse() : ring;
  }
  function fogAsHole(ring) {
    return fogSignedArea(ring) > 0 ? ring.slice().reverse() : ring;
  }
  function fogPointInRing(lng, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }
  function fogCloseRing(ring) {
    if (ring.length < 3) return ring;
    var a = ring[0], b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) return ring.concat([a]);
    return ring;
  }
  function fogPerpDist(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var len2 = vx * vx + vy * vy;
    if (len2 < 1e-24) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  }
  function fogSimplifyOpen(pts, eps) {
    if (pts.length <= 2) return pts;
    var maxD = 0, idx = 0;
    var a = pts[0], b = pts[pts.length - 1];
    for (var i = 1; i < pts.length - 1; i++) {
      var d = fogPerpDist(pts[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= eps) return [a, b];
    var left = fogSimplifyOpen(pts.slice(0, idx + 1), eps);
    var right = fogSimplifyOpen(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  function fogSimplifyClosed(ring, eps) {
    var closed = fogCloseRing(ring);
    if (closed.length <= 5) return closed;
    var open = closed.slice(0, -1);
    var simple = fogSimplifyOpen(open, eps);
    return fogCloseRing(simple.length >= 3 ? simple : open.slice(0, 4));
  }
  function fogChaikinOnce(ring) {
    var closed = fogCloseRing(ring);
    var pts = closed.length >= 2 ? closed.slice(0, -1) : closed;
    if (pts.length < 4) return closed;
    var out = [];
    var n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    return fogCloseRing(out);
  }
  function fogSmoothClosed(ring, iters) {
    var cur = fogCloseRing(ring);
    var n = typeof iters === 'number' ? iters : FOG_SMOOTH_ITERS;
    for (var k = 0; k < n; k++) cur = fogChaikinOnce(cur);
    return fogCloseRing(cur);
  }
  function fogCircleRing(lng, lat, radiusM, steps) {
    var mLng = Math.max(1, 111320 * Math.cos(lat * Math.PI / 180));
    var ring = [];
    var n = steps || 72;
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      ring.push([
        lng + (Math.sin(a) * radiusM) / mLng,
        lat + (Math.cos(a) * radiusM) / 111320
      ]);
    }
    return ring;
  }
  function fogRoundIfCompact(ring) {
    var closed = fogCloseRing(ring);
    var pts = closed.length >= 2 ? closed.slice(0, -1) : closed;
    if (pts.length < 6) return ring;
    var cx = 0, cy = 0, i;
    var west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (i = 0; i < pts.length; i++) {
      cx += pts[i][0]; cy += pts[i][1];
      if (pts[i][0] < west) west = pts[i][0];
      if (pts[i][0] > east) east = pts[i][0];
      if (pts[i][1] < south) south = pts[i][1];
      if (pts[i][1] > north) north = pts[i][1];
    }
    cx /= pts.length; cy /= pts.length;
    var mLng = Math.max(1, 111320 * Math.cos(cy * Math.PI / 180));
    var widthM = (east - west) * mLng;
    var heightM = (north - south) * 111320;
    var span = Math.max(widthM, heightM);
    var short = Math.max(1, Math.min(widthM, heightM));
    if (span > REVEAL_M * 2.2) return ring;
    if (span / short > 1.28) return ring;
    var radii = [];
    for (i = 0; i < pts.length; i++) {
      radii.push(Math.hypot((pts[i][1] - cy) * 111320, (pts[i][0] - cx) * mLng));
    }
    var mean = 0, min = Infinity, max = 0;
    for (i = 0; i < radii.length; i++) {
      mean += radii[i];
      if (radii[i] < min) min = radii[i];
      if (radii[i] > max) max = radii[i];
    }
    mean /= radii.length;
    if (!(mean > 8) || min < 4) return ring;
    if (mean > REVEAL_M * 1.15 || max > REVEAL_M * 1.35) return ring;
    return fogCircleRing(cx, cy, Math.min(mean, REVEAL_M), 72);
  }
  function fogPaintDisk(grid, nx, ny, cx, cy, r) {
    var r2 = r * r;
    var x0 = Math.max(0, Math.floor(cx - r));
    var x1 = Math.min(nx - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r));
    var y1 = Math.min(ny - 1, Math.ceil(cy + r));
    for (var y = y0; y <= y1; y++) {
      var dy = y + 0.5 - cy;
      for (var x = x0; x <= x1; x++) {
        var dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) grid[y * nx + x] = 1;
      }
    }
  }
  function fogPaintCapsule(grid, nx, ny, x0, y0, x1, y1, r) {
    var steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      fogPaintDisk(grid, nx, ny, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r);
    }
  }
  function fogMorphClose(src, nx, ny, radiusCells) {
    if (radiusCells < 1) return src;
    var r2 = radiusCells * radiusCells;
    var dilate = new Uint8Array(nx * ny);
    var x, y, xx, yy, x0, x1, y0, y1, dx, dy;
    for (y = 0; y < ny; y++) {
      for (x = 0; x < nx; x++) {
        if (!src[y * nx + x]) continue;
        x0 = Math.max(0, x - radiusCells);
        x1 = Math.min(nx - 1, x + radiusCells);
        y0 = Math.max(0, y - radiusCells);
        y1 = Math.min(ny - 1, y + radiusCells);
        for (yy = y0; yy <= y1; yy++) {
          dy = yy - y;
          for (xx = x0; xx <= x1; xx++) {
            dx = xx - x;
            if (dx * dx + dy * dy <= r2) dilate[yy * nx + xx] = 1;
          }
        }
      }
    }
    var out = new Uint8Array(nx * ny);
    for (y = 0; y < ny; y++) {
      for (x = 0; x < nx; x++) {
        var keep = 1;
        x0 = Math.max(0, x - radiusCells);
        x1 = Math.min(nx - 1, x + radiusCells);
        y0 = Math.max(0, y - radiusCells);
        y1 = Math.min(ny - 1, y + radiusCells);
        scan: for (yy = y0; yy <= y1; yy++) {
          dy = yy - y;
          for (xx = x0; xx <= x1; xx++) {
            dx = xx - x;
            if (dx * dx + dy * dy > r2) continue;
            if (!dilate[yy * nx + xx]) { keep = 0; break scan; }
          }
        }
        out[y * nx + x] = keep;
      }
    }
    return out;
  }
  function fogIsCell(grid, nx, ny, x, y) {
    if (x < 0 || y < 0 || x >= nx || y >= ny) return false;
    return grid[y * nx + x] === 1;
  }
  function fogTraceRings(grid, nx, ny) {
    var adj = {};
    function ek(ax, ay, bx, by) { return ax + ',' + ay + '>' + bx + ',' + by; }
    function add(ax, ay, bx, by) {
      var key = ax + ',' + ay;
      if (!adj[key]) adj[key] = [];
      adj[key].push([bx, by]);
    }
    for (var y = 0; y < ny; y++) {
      for (var x = 0; x < nx; x++) {
        if (!fogIsCell(grid, nx, ny, x, y)) continue;
        if (!fogIsCell(grid, nx, ny, x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!fogIsCell(grid, nx, ny, x, y - 1)) add(x, y, x + 1, y);
        if (!fogIsCell(grid, nx, ny, x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!fogIsCell(grid, nx, ny, x - 1, y)) add(x, y + 1, x, y);
      }
    }
    var used = {};
    var rings = [];
    Object.keys(adj).forEach(function(fromKey) {
      var tos = adj[fromKey];
      var parts = fromKey.split(',');
      var sx = +parts[0], sy = +parts[1];
      for (var t = 0; t < tos.length; t++) {
        var to = tos[t];
        if (used[ek(sx, sy, to[0], to[1])]) continue;
        var ring = [[sx, sy]];
        var curX = sx, curY = sy, nxtX = to[0], nxtY = to[1];
        for (var guard = 0; guard < nx * ny * 4; guard++) {
          used[ek(curX, curY, nxtX, nxtY)] = 1;
          ring.push([nxtX, nxtY]);
          var options = adj[nxtX + ',' + nxtY] || [];
          var found = null;
          for (var c = 0; c < options.length; c++) {
            if (!used[ek(nxtX, nxtY, options[c][0], options[c][1])]) { found = options[c]; break; }
          }
          if (!found) break;
          curX = nxtX; curY = nxtY; nxtX = found[0]; nxtY = found[1];
          if (nxtX === sx && nxtY === sy) { ring.push([sx, sy]); break; }
        }
        if (ring.length >= 4) rings.push(ring);
      }
    });
    return rings;
  }
  function fogNestPolygons(rings) {
    var n = rings.length;
    if (!n) return [];
    var parent = [];
    var areas = [];
    var i, j;
    for (i = 0; i < n; i++) {
      parent[i] = -1;
      areas[i] = Math.abs(fogSignedArea(rings[i]));
    }
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if (i === j) continue;
        var p = rings[j][0];
        if (!p || !fogPointInRing(rings[i][0][0], rings[i][0][1], rings[j])) continue;
        if (parent[i] < 0 || areas[j] < areas[parent[i]]) parent[i] = j;
      }
    }
    var depth = [];
    for (i = 0; i < n; i++) {
      var d = 0, pidx = parent[i], seen = {};
      while (pidx >= 0 && !seen[pidx] && d < n) { seen[pidx] = 1; d++; pidx = parent[pidx]; }
      depth[i] = d;
    }
    var holesOf = {};
    for (i = 0; i < n; i++) {
      if (depth[i] % 2 === 0) continue;
      var par = parent[i];
      if (par < 0) continue;
      if (!holesOf[par]) holesOf[par] = [];
      holesOf[par].push(i);
    }
    var polygons = [];
    for (i = 0; i < n; i++) {
      if (depth[i] % 2 !== 0) continue;
      var poly = [fogAsOuter(rings[i])];
      var hs = holesOf[i] || [];
      for (j = 0; j < hs.length; j++) poly.push(fogAsHole(rings[hs[j]]));
      polygons.push(poly);
    }
    return polygons;
  }
  function fogQuantizedCell(widthM, heightM) {
    var span = Math.max(widthM, heightM);
    var need = span / FOG_MAX_GRID;
    var cell = Math.max(FOG_CELL_M, need);
    if (cell > FOG_CELL_CAP_M && span / FOG_CELL_CAP_M <= FOG_GRID_CAP) cell = FOG_CELL_CAP_M;
    var q = FOG_CELL_M;
    while (q + 1e-9 < cell) q *= 2;
    return q;
  }
  function fogMinDistSegs(a, b) {
    var best = Infinity, i, j, d;
    for (i = 0; i < a.length; i++) {
      for (j = 0; j < b.length; j++) {
        d = distM(a[i], b[j]);
        if (d < best) best = d;
      }
    }
    return best;
  }
  function fogClusterSegments(segments, joinM) {
    var items = [];
    var s;
    for (s = 0; s < segments.length; s++) {
      if (segments[s] && segments[s].length) items.push(segments[s]);
    }
    var n = items.length;
    if (!n) return [];
    var parent = [];
    for (s = 0; s < n; s++) parent[s] = s;
    function find(i) {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    }
    var i, j, a, b;
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        if (fogMinDistSegs(items[i], items[j]) <= joinM) {
          a = find(i); b = find(j);
          if (a !== b) parent[b] = a;
        }
      }
    }
    var buckets = {};
    for (i = 0; i < n; i++) {
      var root = find(i);
      if (!buckets[root]) buckets[root] = [];
      buckets[root].push(items[i]);
    }
    var out = [];
    for (var k in buckets) if (Object.prototype.hasOwnProperty.call(buckets, k)) out.push(buckets[k]);
    return out;
  }
  function fogCompactCenter(segments) {
    var pts = [];
    var s, i;
    for (s = 0; s < segments.length; s++) {
      for (i = 0; i < segments[s].length; i++) pts.push(segments[s][i]);
    }
    if (!pts.length) return null;
    var lat = 0, lng = 0;
    for (i = 0; i < pts.length; i++) { lat += pts[i].lat; lng += pts[i].lng; }
    lat /= pts.length; lng /= pts.length;
    var c = { lat: lat, lng: lng };
    for (i = 0; i < pts.length; i++) {
      if (distM(pts[i], c) > FOG_COMPACT_SPAN_M) return null;
    }
    return c;
  }
  function fogBoundsFromSegments(segments, padM) {
    var west = 180, east = -180, south = 90, north = -90, any = false;
    var s, i, p;
    for (s = 0; s < segments.length; s++) {
      for (i = 0; i < segments[s].length; i++) {
        p = segments[s][i];
        any = true;
        if (p.lng < west) west = p.lng;
        if (p.lng > east) east = p.lng;
        if (p.lat < south) south = p.lat;
        if (p.lat > north) north = p.lat;
      }
    }
    if (!any) return null;
    var mLng = Math.max(1, 111320 * Math.cos(((south + north) / 2) * Math.PI / 180));
    return {
      west: west - padM / mLng,
      east: east + padM / mLng,
      south: south - padM / 111320,
      north: north + padM / 111320
    };
  }
  function fogPadBoundsBox(bounds, padM) {
    var midLat = (bounds.south + bounds.north) / 2;
    var mLng = Math.max(1, 111320 * Math.cos(midLat * Math.PI / 180));
    return {
      west: bounds.west - padM / mLng,
      east: bounds.east + padM / mLng,
      south: bounds.south - padM / 111320,
      north: bounds.north + padM / 111320
    };
  }
  function fogBoundsSizeM(bounds) {
    var mLng = Math.max(1, 111320 * Math.cos(((bounds.south + bounds.north) / 2) * Math.PI / 180));
    return {
      widthM: Math.max(0, (bounds.east - bounds.west) * mLng),
      heightM: Math.max(0, (bounds.north - bounds.south) * 111320)
    };
  }
  function fogSegsInBounds(segments, bounds) {
    var out = [];
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s], hit = false, i;
      for (i = 0; i < seg.length; i++) {
        var p = seg[i];
        if (p.lng >= bounds.west && p.lng <= bounds.east && p.lat >= bounds.south && p.lat <= bounds.north) {
          hit = true;
          break;
        }
      }
      if (hit) out.push(seg);
    }
    return out;
  }
  function fogSplitTiles(bounds, tileM) {
    var size = fogBoundsSizeM(bounds);
    if (size.widthM <= tileM && size.heightM <= tileM) return [bounds];
    var cols = Math.max(1, Math.ceil(size.widthM / tileM));
    var rows = Math.max(1, Math.ceil(size.heightM / tileM));
    var dLng = (bounds.east - bounds.west) / cols;
    var dLat = (bounds.north - bounds.south) / rows;
    var tiles = [], r, c;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        tiles.push({
          west: bounds.west + c * dLng,
          east: c === cols - 1 ? bounds.east : bounds.west + (c + 1) * dLng,
          south: bounds.south + r * dLat,
          north: r === rows - 1 ? bounds.north : bounds.south + (r + 1) * dLat
        });
      }
    }
    return tiles;
  }
  function fogBoundsRect(bounds) {
    return [
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
      [bounds.west, bounds.north],
      [bounds.west, bounds.south]
    ];
  }
  function fogRasterExplored(bounds, segments, revealM, mergeGapM, keep) {
    var mLat = 111320;
    var midLat = (bounds.south + bounds.north) / 2;
    var mLng = Math.max(1, mLat * Math.cos(midLat * Math.PI / 180));
    var widthM0 = Math.max(FOG_CELL_M * 4, (bounds.east - bounds.west) * mLng);
    var heightM0 = Math.max(FOG_CELL_M * 4, (bounds.north - bounds.south) * mLat);
    var cell = fogQuantizedCell(widthM0, heightM0);
    var cellLng = cell / mLng;
    var cellLat = cell / mLat;
    var west = Math.floor(bounds.west / cellLng) * cellLng;
    var south = Math.floor(bounds.south / cellLat) * cellLat;
    var east = Math.ceil(bounds.east / cellLng) * cellLng;
    var north = Math.ceil(bounds.north / cellLat) * cellLat;
    var widthM = Math.max(FOG_CELL_M * 4, (east - west) * mLng);
    var heightM = Math.max(FOG_CELL_M * 4, (north - south) * mLat);
    var nx = Math.max(4, Math.ceil(widthM / cell));
    var ny = Math.max(4, Math.ceil(heightM / cell));
    var explored = new Uint8Array(nx * ny);
    var rCells = revealM / cell;
    function toCell(pt) {
      return [((pt.lng - west) * mLng) / cell, ((pt.lat - south) * mLat) / cell];
    }
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      if (!seg.length) continue;
      var first = toCell(seg[0]);
      fogPaintDisk(explored, nx, ny, first[0], first[1], rCells);
      for (var i = 1; i < seg.length; i++) {
        var a = toCell(seg[i - 1]);
        var b = toCell(seg[i]);
        fogPaintCapsule(explored, nx, ny, a[0], a[1], b[0], b[1], rCells);
      }
    }
    var closed = fogMorphClose(explored, nx, ny, Math.max(1, Math.round(mergeGapM / 2 / cell)));
    if (keep) {
      var y, x, lat, lng;
      for (y = 0; y < ny; y++) {
        lat = south + (y + 0.5) * cellLat;
        if (lat < keep.south || lat >= keep.north) {
          for (x = 0; x < nx; x++) closed[y * nx + x] = 0;
          continue;
        }
        for (x = 0; x < nx; x++) {
          lng = west + (x + 0.5) * cellLng;
          if (lng < keep.west || lng >= keep.east) closed[y * nx + x] = 0;
        }
      }
    }
    var raw = fogTraceRings(closed, nx, ny);
    var epsDeg = (cell * 0.1) / mLat;
    var minArea = (cell / mLat) * (cell / mLat);
    var rings = [];
    for (var r = 0; r < raw.length; r++) {
      var geo = [];
      for (var g = 0; g < raw[r].length; g++) {
        geo.push([
          west + (raw[r][g][0] * cell) / mLng,
          south + (raw[r][g][1] * cell) / mLat
        ]);
      }
      var simple = fogRoundIfCompact(fogSimplifyClosed(fogSmoothClosed(geo, FOG_SMOOTH_ITERS), epsDeg));
      if (simple.length >= 4 && Math.abs(fogSignedArea(simple)) > minArea) rings.push(simple);
    }
    return fogNestPolygons(rings);
  }
  function fogExploredCluster(segments, revealM, mergeGapM) {
    var compact = fogCompactCenter(segments);
    if (compact) return [[fogAsOuter(fogCircleRing(compact.lng, compact.lat, revealM, 72))]];
    var padM = revealM + mergeGapM / 2 + Math.max(8, FOG_CELL_M * 4);
    var bounds = fogBoundsFromSegments(segments, padM);
    if (!bounds) return [];
    return fogRasterExplored(bounds, segments, revealM, mergeGapM);
  }
  function buildExploredPolygonsJs(segments, revealM, mergeGapM) {
    var clusters = fogClusterSegments(segments, revealM * 2 + mergeGapM);
    if (!clusters.length) return [];
    if (clusters.length === 1) return fogExploredCluster(clusters[0], revealM, mergeGapM);
    var out = [];
    for (var c = 0; c < clusters.length; c++) {
      var part = fogExploredCluster(clusters[c], revealM, mergeGapM);
      for (var p = 0; p < part.length; p++) out.push(part[p]);
    }
    return out;
  }
  function fogMaskFromExploredJs(bounds, explored) {
    var outer = fogAsOuter(fogBoundsRect(bounds));
    if (!explored.length) return [[outer]];
    var poly = [outer];
    var islands = [];
    for (var i = 0; i < explored.length; i++) {
      if (!explored[i][0]) continue;
      poly.push(fogAsHole(explored[i][0]));
      for (var h = 1; h < explored[i].length; h++) islands.push([fogAsOuter(explored[i][h])]);
    }
    return [poly].concat(islands);
  }
  function buildFogPolygonsJs(bounds, segments, revealM, mergeGapM) {
    return fogMaskFromExploredJs(bounds, buildExploredPolygonsJs(segments, revealM, mergeGapM));
  }
  function fogTrackKey(segments) {
    var bits = [];
    for (var s = 0; s < segments.length; s++) {
      for (var i = 0; i < segments[s].length; i++) {
        var p = segments[s][i];
        bits.push(Math.round(p.lat * 50000) + ',' + Math.round(p.lng * 50000));
      }
    }
    return bits.join('|');
  }
  function fogViewRaw() {
    var b = map.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }
  /** Bei Heading-Follow muss die Maske die gedrehte AABB decken — sonst steht Fog, Karte dreht. */
  function fogMaskPadM(view, z) {
    var base = z >= 15.5 ? FOG_MASK_NEAR_PAD_M : FOG_MASK_FAR_PAD_M;
    if (!headingFollow && !centerLock) return base;
    var midLat = (view.south + view.north) / 2;
    var mLng = Math.max(1, 111320 * Math.cos(midLat * Math.PI / 180));
    var w = Math.abs(view.east - view.west) * mLng;
    var h = Math.abs(view.north - view.south) * 111320;
    return Math.max(base, Math.ceil(Math.sqrt(w * w + h * h) * 0.55));
  }
  function fogPadBounds(view, padM) {
    var midLat = (view.south + view.north) / 2;
    var mLng = Math.max(1, 111320 * Math.cos(midLat * Math.PI / 180));
    return {
      west: view.west - padM / mLng,
      south: view.south - padM / 111320,
      east: view.east + padM / mLng,
      north: view.north + padM / 111320
    };
  }
  function fogOuterContains(outer, view, marginM) {
    if (!outer) return false;
    var midLat = (view.south + view.north) / 2;
    var mLng = Math.max(1, 111320 * Math.cos(midLat * Math.PI / 180));
    var ml = marginM / mLng;
    var ma = marginM / 111320;
    return view.west - ml >= outer.west &&
      view.south - ma >= outer.south &&
      view.east + ml <= outer.east &&
      view.north + ma <= outer.north;
  }
  function fogOuterTooWide(outer, view, z) {
    if (!outer || z < 15.5) return false;
    var midLat = (view.south + view.north) / 2;
    var mLng = Math.max(1, 111320 * Math.cos(midLat * Math.PI / 180));
    var outerW = (outer.east - outer.west) * mLng;
    var viewW = Math.max(80, (view.east - view.west) * mLng);
    return outerW > viewW * 5 && outerW > 1400;
  }

  var fogMaskCleared = false;
  function drawFog() {
    if (!map.getSource('fog-mask')) return;
    var empty = { type: 'FeatureCollection', features: [] };
    if (!fogBasemapReady()) {
      map.getSource('fog-mask').setData(empty);
      if (map.getSource('fog-reveal')) map.getSource('fog-reveal').setData(empty);
      if (map.getSource('fog-edge')) map.getSource('fog-edge').setData(empty);
      return;
    }
    if (!fogEnabled) {
      map.getSource('fog-mask').setData(empty);
      if (map.getSource('fog-reveal')) map.getSource('fog-reveal').setData(empty);
      if (map.getSource('fog-edge')) map.getSource('fog-edge').setData(empty);
      fogExploredKey = '';
      fogRevealKey = '';
      fogMaskKey = '';
      fogMaskOuter = null;
      fogExploredCache = null;
      fogMaskCleared = false;
      return;
    }
    var segs = fogTrackPoints();
    var key = fogTrackKey(segs);
    if (key !== fogExploredKey || !fogExploredCache) {
      fogExploredKey = key;
      fogExploredCache = buildExploredPolygonsJs(segs, REVEAL_M, FOG_MERGE_GAP_M);
    }
    var explored = fogExploredCache;
    if (key !== fogRevealKey) {
      fogRevealKey = key;
      var reveals = [];
      for (var e = 0; e < explored.length; e++) {
        if (!explored[e] || !explored[e][0]) continue;
        reveals.push({
          type: 'Feature', properties: {},
          geometry: { type: 'Polygon', coordinates: explored[e] }
        });
      }
      if (map.getSource('fog-reveal')) {
        map.getSource('fog-reveal').setData({ type: 'FeatureCollection', features: reveals });
      }
      var edges = [];
      for (var er = 0; er < explored.length; er++) {
        var ring = explored[er] && explored[er][0];
        if (!ring || ring.length < 2) continue;
        edges.push({
          type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: ring }
        });
      }
      if (map.getSource('fog-edge')) {
        map.getSource('fog-edge').setData({ type: 'FeatureCollection', features: edges });
      }
    }
    if (fogMaskDisabled) {
      if (!fogMaskCleared && map.getSource('fog-mask')) {
        map.getSource('fog-mask').setData({ type: 'FeatureCollection', features: [] });
        fogMaskCleared = true;
      }
      return;
    }
    var view = fogViewRaw();
    var z = map.getZoom();
    var maskStale = key !== fogMaskKey ||
      !fogOuterContains(fogMaskOuter, view, 120) ||
      fogOuterTooWide(fogMaskOuter, view, z);
    if (!maskStale) return;
    fogMaskKey = key;
    fogMaskOuter = fogPadBounds(view, fogMaskPadM(view, z));
    var polygons = fogMaskFromExploredJs(fogMaskOuter, explored);
    var features = [];
    for (var i = 0; i < polygons.length; i++) {
      features.push({
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: polygons[i] }
      });
    }
    map.getSource('fog-mask').setData({ type: 'FeatureCollection', features: features });
  }

  function stampFogAt(lat, lng) {
    if (!map.getSource('fog-reveal')) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    var ring = fogCircleRing(lng, lat, REVEAL_M, 40);
    fogStampFeatures.push({
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] }
    });
    if (fogStampFeatures.length > 360) {
      fogStampFeatures = fogStampFeatures.slice(-240);
    }
    map.getSource('fog-reveal').setData({
      type: 'FeatureCollection', features: fogStampFeatures
    });
    if (map.getSource('fog-edge')) {
      map.getSource('fog-edge').setData({ type: 'FeatureCollection', features: [] });
    }
    if (fogMaskDisabled && !fogMaskCleared && map.getSource('fog-mask')) {
      map.getSource('fog-mask').setData({ type: 'FeatureCollection', features: [] });
      fogMaskCleared = true;
    }
  }

  function scheduleFog() {
    if (mapPaused || userIsDragging()) return;
    if (fogRaf) return;
    fogRaf = requestAnimationFrame(function() {
      fogRaf = null;
      if (mapPaused || userIsDragging()) return;
      drawFog();
    });
  }

  var fogFollowHold = 0;
  function scheduleFogFromCamera() {
    if (fogLightMode && fogMaskDisabled) return;
    if (userIsDragging()) return;
    if (headingFollow || centerLock) {
      if (fogFollowHold) return;
      fogFollowHold = setTimeout(function() {
        fogFollowHold = 0;
        scheduleFog();
      }, 280);
      return;
    }
    scheduleFog();
  }

  function scheduleFogIfTrackChanged() {
    if (!fogEnabled) return;
    if (fogLightMode) {
      if (userLat == null || userLng == null) return;
      // ~40 m Raster — neuer Stempel nur bei spürbarer Bewegung
      var tipKey = Math.round(userLat * 2500) + ',' + Math.round(userLng * 2500);
      if (tipKey === fogLastStampKey) return;
      fogLastStampKey = tipKey;
      if (fogRaf) return;
      fogRaf = requestAnimationFrame(function() {
        fogRaf = null;
        stampFogAt(userLat, userLng);
      });
      return;
    }
    if (fogTrackKey(fogTrackPoints()) === fogExploredKey && fogExploredCache) return;
    scheduleFog();
  }

  function ringsToFeatures(rings) {
    var feats = [];
    if (!Array.isArray(rings)) return feats;
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];
      if (!ring || ring.length < 3) continue;
      var coords = ring.map(function(ll) { return [ll[1], ll[0]]; });
      if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
        coords.push(coords[0]);
      }
      feats.push({
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] }
      });
    }
    return feats;
  }

  function linesToFeatures(roads) {
    var feats = [];
    if (!Array.isArray(roads)) return feats;
    for (var i = 0; i < roads.length; i++) {
      var r = roads[i];
      var pts = r && r.c ? r.c : r;
      var kind = r && typeof r.k === 'number' ? r.k : (r && r.kind === 'major' ? 0 : r && r.kind === 'path' ? 2 : 1);
      if (!pts || pts.length < 2) continue;
      feats.push({
        type: 'Feature',
        properties: { k: kind },
        geometry: { type: 'LineString', coordinates: pts.map(function(ll) { return [ll[1], ll[0]]; }) }
      });
    }
    return feats;
  }

  function ensureOverlays() {
    lodVisState = {};
    [
      'extract-land','extract-woods','extract-parks','extract-water','extract-buildings',
      'extract-rails','extract-roads','extract-housenumbers','fog-mask','fog-reveal','fog-edge',
      'cities','places','place-points','route-ahead','route','route-arrows','route-pins','drop-pin','user-loc'
    ].forEach(addGeoSource);

    addLayerStacked({
      id: 'extract-land-fill', type: 'fill', source: 'extract-land',
      paint: { 'fill-color': LAND, 'fill-opacity': 1 }
    });
    addLayerStacked({
      id: 'extract-woods-fill', type: 'fill', source: 'extract-woods',
      paint: { 'fill-color': WOOD, 'fill-opacity': 0.88 }
    });
    addLayerStacked({
      id: 'extract-parks-fill', type: 'fill', source: 'extract-parks',
      paint: { 'fill-color': PARK, 'fill-opacity': 0.7 }
    });
    addLayerStacked({
      id: 'extract-water-fill', type: 'fill', source: 'extract-water',
      paint: { 'fill-color': WATER, 'fill-opacity': 1 }
    });
    addLayerStacked({
      id: 'fog-reveal-base', type: 'fill', source: 'fog-reveal',
      paint: {
        'fill-color': '${HOME_MAP_FOG_REVEAL}',
        'fill-opacity': 0.34,
        'fill-antialias': true
      }
    });
    addLayerStacked({
      id: 'extract-buildings-fill', type: 'fill', source: 'extract-buildings',
      minzoom: Z_DETAIL_GONE,
      paint: { 'fill-color': BLD, 'fill-opacity': FADE_BLD, 'fill-outline-color': BLD_STROKE }
    });
    addLayerStacked({
      id: 'extract-rails-line', type: 'line', source: 'extract-rails',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': RAIL,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 16, 4.4],
        'line-opacity': 0.92
      }
    });
    addLayerStacked({
      id: 'extract-rails-dash', type: 'line', source: 'extract-rails',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#E8E0D4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.05, 16, 2.2],
        'line-dasharray': [0.18, 0.72],
        'line-opacity': 0.95
      }
    });
    addLayerStacked({
      id: 'extract-roads-line', type: 'line', source: 'extract-roads',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'k'], 0, ROAD_MAJOR, 2, ROAD_PATH, ROAD_STREET],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          11, ['match', ['get', 'k'], 0, 2.2, 2, 1.05, 1.55],
          16, ['match', ['get', 'k'], 0, 5.6, 2, 2.3, 3.5]
        ]
      }
    });
    addLayerStacked({
      id: 'extract-housenumbers', type: 'symbol', source: 'extract-housenumbers',
      minzoom: 17,
      layout: { 'text-field': ['get', 'n'], 'text-size': 11, 'text-allow-overlap': false },
      paint: { 'text-color': '#C5D0CA', 'text-halo-color': BG, 'text-halo-width': 1.1 }
    });
    addLayerStacked({
      id: 'fog-mask-fill', type: 'fill', source: 'fog-mask',
      minzoom: Z_DETAIL_GONE,
      paint: {
        'fill-color': '${HOME_MAP_FOG_FILL}',
        'fill-opacity': FADE_OP,
        'fill-antialias': true
      }
    });
    addLayerStacked({
      id: 'fog-mask-line', type: 'line', source: 'fog-edge',
      minzoom: 13.2,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '${HOME_MAP_BG}',
        'line-opacity': 0.62,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13.2, 1.05, 16, 1.35, 18.5, 1.6],
        'line-blur': 0
      }
    });
    addLayerStacked({
      id: 'cities-fill', type: 'fill', source: 'cities',
      paint: {
        'fill-color': ['get', 'fill'],
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          2, CITY_OP_57,
          Z_CITY_57, CITY_OP_57,
          Z_CITY_85, CITY_OP_85,
          Z_CITY_10, CITY_OP_10,
          Z_CITY_12, CITY_OP_12,
          Z_CITY_NONE, CITY_OP_NONE
        ],
        'fill-antialias': true
      }
    });
    addLayerStacked({
      id: 'cities-line', type: 'line', source: 'cities',
      filter: ['!=', ['get', 'dashed'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'stroke'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 7, 2.2, 13, 2.6],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          Z_CITY_57, 0.96,
          Z_CITY_12, 0.88,
          Z_CITY_NONE, 0
        ],
        'line-blur': 0.15
      }
    });
    addLayerStacked({
      id: 'cities-line-dash', type: 'line', source: 'cities',
      filter: ['==', ['get', 'dashed'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'stroke'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 9, 1.2, 13, 1.8],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          Z_CITY_57, 0.78,
          Z_CITY_NONE, 0
        ],
        'line-dasharray': [1.8, 1.1],
        'line-blur': 0.2
      }
    });
    addLayerStacked({
      id: 'route-ahead-casing', type: 'line', source: 'route-ahead',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '${HOME_MAP_ROUTE_AHEAD_CASING}',
        'line-width': 6,
        'line-opacity': 0.82
      }
    });
    addLayerStacked({
      id: 'route-ahead-line', type: 'line', source: 'route-ahead',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '${HOME_MAP_ROUTE_AHEAD}',
        'line-width': 3.8,
        'line-opacity': 0.92
      }
    });
    addLayerStacked({
      id: 'route-casing', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '${HOME_MAP_ROUTE_LINE_CASING}', 'line-width': 7, 'line-opacity': 0.85 }
    });
    addLayerStacked({
      id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '${HOME_MAP_ROUTE_LINE}', 'line-width': 4.5, 'line-opacity': 0.95 }
    });

    ensureArrowImage();
    ensurePlaceAmenityImages();
    addLayerStacked({
      id: 'user-accuracy', type: 'fill', source: 'user-loc',
      filter: ['==', ['get', 'kind'], 'accuracy'],
      paint: { 'fill-color': '#4285F4', 'fill-opacity': 0.14 }
    });
    addLayerStacked({
      id: 'user-arrow', type: 'symbol', source: 'user-loc',
      filter: ['==', ['get', 'kind'], 'arrow'],
      layout: {
        'icon-image': 'user-arrow',
        'icon-size': 0.72,
        'icon-rotate': ['to-number', ['coalesce', ['get', 'heading'], 0]],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'viewport',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center'
      }
    });

    addLayerStacked({
      id: 'places-fill', type: 'fill', source: 'places',
      minzoom: Z_DETAIL_GONE,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': FADE_PLACE, 'fill-antialias': true }
    });
    addLayerStacked({
      id: 'places-line', type: 'line', source: 'places',
      minzoom: Z_DETAIL_GONE,
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.4, 'line-opacity': FADE_OP }
    });
    addLayerStacked({
      id: 'places-icon-street', type: 'symbol', source: 'place-points',
      minzoom: Z_AMENITY_GONE,
      filter: ['in', ['get', 'icon'], ['literal', ${JSON.stringify(HOME_MAP_STREET_AMENITY_ICONS)}]],
      layout: {
        'icon-image': ['concat', 'place-', ['get', 'icon']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.32, 16, 0.40, 18, 0.52],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center'
      },
      paint: {
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], Z_AMENITY_GONE, 0, Z_AMENITY_FULL, 1]
      }
    });
    addLayerStacked({
      id: 'places-icon-transit', type: 'symbol', source: 'place-points',
      minzoom: Z_DETAIL_GONE,
      filter: ['in', ['get', 'icon'], ['literal', ${JSON.stringify(HOME_MAP_TRANSIT_ICONS)}]],
      layout: {
        'icon-image': ['concat', 'place-', ['get', 'icon']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.42, 16, 0.62, 18, 0.72],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center'
      }
    });
    var fat = ['any', ['==', ['get', 'story'], 1], ['==', ['to-number', ['coalesce', ['get', 'keepDot'], 0]], 1]];
    var streetDotFilter = [
      'all',
      ['==', ['to-string', ['coalesce', ['get', 'icon'], '']], ''],
      [
        'any',
        ['==', ['to-number', ['coalesce', ['get', 'keepDot'], 0]], 1],
        ['!=', ['to-number', ['coalesce', ['get', 'building'], 0]], 1]
      ]
    ];
    addLayerStacked({
      id: 'places-halo', type: 'circle', source: 'place-points',
      minzoom: Z_DETAIL_GONE,
      filter: streetDotFilter,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          Z_DETAIL_GONE, ['case', fat, 1.6, 1.2],
          Z_DETAIL_FULL, ['case', fat, 2.2, 1.6],
          12.5, ['case', fat, 5.5, 4],
          14, ['case', fat, 11, 8.5],
          15.5, ['case', fat, 14, 11],
          16.5, ['case', fat, 17, 13],
          18, ['case', fat, 20, 16]
        ],
        'circle-color': '#ffffff',
        'circle-opacity': FADE_HALO
      }
    });
    addLayerStacked({
      id: 'places-dot', type: 'circle', source: 'place-points',
      minzoom: Z_DETAIL_GONE,
      filter: streetDotFilter,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          Z_DETAIL_GONE, ['case', fat, 1, 0.7],
          Z_DETAIL_FULL, ['case', fat, 1.4, 1],
          12.5, ['case', fat, 3.6, 2.6],
          14, ['case', fat, 8, 6],
          15.5, ['case', fat, 11, 8.5],
          16.5, ['case', fat, 13.5, 10.5],
          18, ['case', fat, 16, 13]
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': FADE_OP,
        'circle-stroke-width': [
          'interpolate', ['linear'], ['zoom'],
          Z_DETAIL_FULL, 0.4,
          14, ['case', fat, 1.8, 1.3],
          16, ['case', fat, 2.4, 1.8]
        ],
        'circle-stroke-color': '#0A1F18',
        'circle-stroke-opacity': FADE_OP
      }
    });
    addLayerStacked({
      id: 'places-label', type: 'symbol', source: 'place-points',
      minzoom: 14.8,
      filter: [
        'any',
        ['==', ['to-number', ['coalesce', ['get', 'keepDot'], 0]], 1],
        ['==', ['get', 'story'], 1]
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14],
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-max-width': 10,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {
        'text-color': '#F2F5F3',
        'text-halo-color': '#0A1F18',
        'text-halo-width': 1.8
      }
    });
    ensureRouteChevronImage();
    ensureRoutePinImages();
    addLayerStacked({
      id: 'route-arrows', type: 'symbol', source: 'route-arrows',
      layout: {
        'icon-image': 'route-chevron',
        'icon-size': ['case', ['==', ['get', 'kind'], 'turn'], 1.05, 0.72],
        'icon-rotate': ['to-number', ['coalesce', ['get', 'bearing'], 0]],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center'
      }
    });
    addLayerStacked({
      id: 'route-pins', type: 'symbol', source: 'route-pins',
      layout: {
        'icon-image': ['coalesce', ['get', 'icon'], 'route-pin-now'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.52, 15, 0.78, 17, 0.96, 18.5, 1.08],
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-padding': 0,
        'symbol-sort-key': ['to-number', ['coalesce', ['get', 'current'], 0]]
      }
    });
    addLayerStacked({
      id: 'drop-pin', type: 'circle', source: 'drop-pin',
      paint: {
        'circle-radius': 8,
        'circle-color': '#E24B4A',
        'circle-stroke-width': 2.2,
        'circle-stroke-color': '#FFFFFF'
      }
    });
    restackLayers();
  }

  function vis(ids, on) {
    var want = on ? 'visible' : 'none';
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!map.getLayer(id)) continue;
      if (lodVisState[id] === want) continue;
      lodVisState[id] = want;
      try { map.setLayoutProperty(id, 'visibility', want); } catch (e) {}
    }
  }

  var lodVisState = {};
  function fogBasemapReady() {
    if (extractHasRoads) return true;
    if (!basemapExtractOnly && styleReady) return true;
    return false;
  }

  function applyLodVisibility() {
    var z = map.getZoom();
    vis([
      'extract-land-fill','extract-woods-fill','extract-parks-fill','extract-water-fill',
      'extract-rails-line','extract-rails-dash','extract-roads-line','extract-housenumbers'
    ], z >= 8.5);
    vis([
      'extract-buildings-fill',
      'fog-reveal-base', 'fog-mask-fill', 'fog-mask-line',
      'places-fill','places-line','places-icon-transit','places-halo','places-dot'
    ], z >= Z_DETAIL_GONE);
    vis(['places-icon-street'], z >= Z_AMENITY_GONE);
    vis(['cities-fill', 'cities-line', 'cities-line-dash'], z < Z_CITY_NONE + 0.05);
    vis(['places-label'], z >= 14.8);
    vis(['route-pins','route-arrows','drop-pin'], true);
  }

  function setBasemapExtractOnly(on) {
    basemapExtractOnly = !!on;
    if (!map.getStyle || !map.getStyle()) return;
    var layers = map.getStyle().layers || [];
    var keep = {
      'extract-land-fill':1,'extract-woods-fill':1,'extract-parks-fill':1,'extract-water-fill':1,
      'extract-buildings-fill':1,'extract-rails-line':1,'extract-rails-dash':1,'extract-roads-line':1,'extract-housenumbers':1,
      'fog-reveal-base':1,'fog-mask-fill':1,'fog-mask-line':1,
      'cities-fill':1,'cities-line':1,'cities-line-dash':1,
      'places-fill':1,'places-line':1,'places-icon-street':1,'places-icon-transit':1,'places-halo':1,'places-dot':1,'places-label':1,
      'route-ahead':1,'route':1,'route-arrows':1,'route-pins':1,
      'user-accuracy':1,'user-arrow':1
    };
    // Extract bleibt Overlay. Liberty-Tiles bleiben — sonst leere Flächen neben der Stadt.
    for (var j = 0; j < layers.length; j++) {
      var L = layers[j];
      if (!L || !L.id) continue;
      if (keep[L.id] || L.id.indexOf('extract-') === 0) continue;
      if (isClutterLandcover(L.id, L.paint)) {
        try { map.setLayoutProperty(L.id, 'visibility', 'none'); } catch (eClutter) {}
        continue;
      }
      if (on && /building/i.test(L.id)) {
        try { map.setLayoutProperty(L.id, 'visibility', 'none'); } catch (eBld) {}
        continue;
      }
      if (on && L.type === 'line' && /road|street|highway|path|bridge|tunnel|motorway|trunk|primary|secondary|tertiary|residential|service|pedestrian|cycle|transport|link|minor/i.test(L.id) && !/name|label|rail|water|boundar/i.test(L.id)) {
        try { map.setLayoutProperty(L.id, 'visibility', 'none'); } catch (eRd) {}
        continue;
      }
      try {
        map.setLayoutProperty(L.id, 'visibility', 'visible');
      } catch (eHide) {}
    }
    hideClutterLandcoverLayers();
    restackLayers();
  }

  function markIgnoreCamera(ms) {
    ignoreCameraUntil = Date.now() + (ms || 80);
  }
  function cameraFromUser() {
    return Date.now() > ignoreCameraUntil;
  }
  function isUserCameraGesture(e) {
    return !!(e && e.originalEvent);
  }
  function shortestBearingDelta(a, b) {
    return Math.abs(((b - a + 540) % 360) - 180);
  }
  function shortestSignedBearing(a, b) {
    var d = ((b - a + 540) % 360) - 180;
    if (d <= -180) d += 360;
    return d;
  }
  function queueHeadingTick() {
    if (mapPaused) return;
    if (headingRaf) return;
    headingRaf = requestAnimationFrame(tickDisplayedHeading);
  }
  function tickDisplayedHeading() {
    headingRaf = 0;
    if (mapPaused) return;
    if (userIsDragging()) return;
    if (targetHeading == null) return;
    if (userHeading == null) {
      userHeading = targetHeading;
    } else {
      var d = shortestSignedBearing(userHeading, targetHeading);
      var ad = Math.abs(d);
      if (ad < 0.12) {
        userHeading = targetHeading;
      } else {
        var k = ad > 8 ? 0.92 : 0.82;
        userHeading = (userHeading + d * k + 360) % 360;
      }
    }
    if (styleReady) {
      paintUserLocation({ skipFog: true });
      applyFollowCamera();
    }
    if (userHeading != null && targetHeading != null &&
        Math.abs(shortestSignedBearing(userHeading, targetHeading)) >= 0.12) {
      queueHeadingTick();
    }
  }
  function setTargetHeading(heading) {
    if (typeof heading !== 'number' || !isFinite(heading)) return;
    targetHeading = ((heading % 360) + 360) % 360;
    queueHeadingTick();
  }

  function paintUserLocation(opts) {
    ensureUserOverlay();
    var src = map.getSource('user-loc');
    if (!src || userLat == null || userLng == null) return;
    if (!isFinite(userLat) || !isFinite(userLng)) return;
    var features = [];
    var acc = typeof userAccuracyM === 'number' && isFinite(userAccuracyM) ? userAccuracyM : 0;
    if (acc >= 10 && acc <= 80) {
      features.push({
        type: 'Feature',
        properties: { kind: 'accuracy' },
        geometry: { type: 'Polygon', coordinates: [accuracyRingCoords(userLat, userLng, acc)] }
      });
    }
    var hasHeading = typeof userHeading === 'number' && isFinite(userHeading);
    features.push({
      type: 'Feature',
      properties: { kind: 'arrow', heading: hasHeading ? userHeading : 0 },
      geometry: { type: 'Point', coordinates: [userLng, userLat] }
    });
    src.setData({ type: 'FeatureCollection', features: features });
    if (!opts || !opts.skipFog) scheduleFogIfTrackChanged();
  }

  function ringToLngLat(ring) {
    var coords = ring.map(function(ll) { return [ll[1], ll[0]]; });
    if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
      coords.push(coords[0]);
    }
    return coords;
  }

  function pointInLngLatRing(lng, lat, coords) {
    var inside = false;
    for (var i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      var xi = coords[i][0], yi = coords[i][1];
      var xj = coords[j][0], yj = coords[j][1];
      var hit = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  function applyPlacesPayload(places) {
    var features = [];
    var points = [];
    var storyCount = 0;
    var buildingRings = [];
    var pendingPoints = [];
    if (Array.isArray(places)) {
      for (var i = 0; i < places.length; i++) {
        var p = places[i];
        if (!p || p.id == null) continue;
        var lat = Number(p.lat);
        var lng = Number(p.lng);
        if (!isFinite(lat) || !isFinite(lng)) continue;
        var col = p.color || '#C45B5B';
        var isStory = p.story === 1 || p.story === true;
        if (isStory) storyCount++;
        var ring = p.ring;
        var icon = typeof p.icon === 'string' ? p.icon : '';
        var amenityDot = p.amenityDot === true;
        var keepDot = amenityDot || p.pointOnly === true || p.keepDot === true || !!icon;
        var hasBuilding = !amenityDot && !icon && !keepDot && ring && ring.length >= 3;
        var props = { id: p.id, color: col, name: p.name || '', category: p.category || '', lat: lat, lng: lng, story: isStory ? 1 : 0, building: 0, keepDot: keepDot ? 1 : 0, amenityDot: amenityDot ? 1 : 0, icon: icon };
        if (hasBuilding) {
          try {
            var coords = ringToLngLat(ring);
            features.push({
              type: 'Feature',
              properties: {
                id: props.id, color: props.color, name: props.name,
                category: props.category, lat: props.lat, lng: props.lng,
                story: props.story
              },
              geometry: { type: 'Polygon', coordinates: [coords] }
            });
            buildingRings.push(coords);
          } catch (ePoly) {}
        } else {
        pendingPoints.push({
          lat: lat,
          lng: lng,
          props: {
            id: props.id,
            color: props.color,
            name: props.name,
            category: props.category,
            lat: props.lat,
            lng: props.lng,
            story: props.story,
            building: props.building,
            keepDot: props.keepDot,
            amenityDot: props.amenityDot,
            icon: icon
          }
        });
        }
      }
    }
    for (var k = 0; k < pendingPoints.length; k++) {
      var pt = pendingPoints[k];
      var covered = false;
      for (var b = 0; b < features.length; b++) {
        var poly = features[b].geometry && features[b].geometry.coordinates && features[b].geometry.coordinates[0];
        if (!poly) continue;
        if (!pointInLngLatRing(pt.lng, pt.lat, poly)) continue;
        covered = true;
        var prFill = features[b].properties || {};
        var rank = function(c) {
          c = String(c || '').toUpperCase();
          if (c === '#5FA88A') return 4;
          if (c === '#3B7DD8') return 3;
          if (c === '#7A4FBF') return 2;
          return 1;
        };
        if (rank(pt.props.color) > rank(prFill.color)) {
          features[b].properties.color = pt.props.color;
        }
        break;
      }
      if (covered) continue;
      points.push({
        type: 'Feature',
        properties: pt.props,
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] }
      });
    }
    ensureOverlays();
    var src = map.getSource('places');
    if (src) src.setData({ type: 'FeatureCollection', features: features });
    var pts = map.getSource('place-points');
    if (pts) pts.setData({ type: 'FeatureCollection', features: points });
    applyLodVisibility();
    dbg('Orte ' + points.length + ' · Story ' + storyCount + ' · Zoom ' + map.getZoom().toFixed(1));
    post({ type: 'placesApplied', total: points.length, story: storyCount, fills: features.length, zoom: map.getZoom() });
  }

  var overlayBooted = false;

  function postInteractive() {
    if (postedInteractive) return;
    postedInteractive = true;
    post({ type: 'interactive', lat: userLat, lng: userLng, rev: ${HOME_MAP_RENDERER_REV} });
  }

  function postReady() {
    if (postedReady) return;
    postedReady = true;
    post({ type: 'ready', lat: userLat, lng: userLng, rev: ${HOME_MAP_RENDERER_REV} });
    post({ type: 'needPlaces' });
    post({ type: 'bearing', bearing: map.getBearing() });
  }

  function scheduleHeavyOverlays() {
    if (heavyOverlayTimer) return;
    heavyOverlayTimer = setTimeout(function() {
      heavyOverlayTimer = 0;
      try { ensureOverlays(); } catch (eO) {}
      if (lastPlacePayload.length) applyPlacesPayload(lastPlacePayload);
      scheduleFog();
    }, 80);
  }

  function bootOverlays() {
    if (overlayBooted && map.getSource('user-loc')) {
      bindUserGestureCapture();
      ensureMapGestures();
      paintUserLocation();
      if (lastPlacePayload.length) applyPlacesPayload(lastPlacePayload);
      postReady();
      return;
    }
    overlayBooted = true;
    try { map.resize(); } catch (e) {}
    bindUserGestureCapture();
    ensureMapGestures();
    ensureUserOverlay();
    try { ensureOverlays(); } catch (eO) {}
    styleReady = true;
    paintUserLocation();
    postInteractive();
    if (lastPlacePayload.length) {
      applyPlacesPayload(lastPlacePayload);
    } else {
      dbg('Karte bereit');
    }
    hideClutterLandcoverLayers();
    postReady();
    scheduleHeavyOverlays();
    if (lastExtract) {
      try { window.setMapExtract(lastExtract); } catch (eX) {}
    }
  }

  function onMapReady() {
    bootOverlays();
  }

  if (typeof ResizeObserver !== 'undefined') {
    try {
      new ResizeObserver(function() {
        try { map.resize(); } catch (e) {}
        scheduleFog();
      }).observe(map.getContainer());
    } catch (e) {}
  }
  setTimeout(function() { try { map.resize(); } catch (e) {} }, 80);
  setTimeout(function() { try { map.resize(); paintUserLocation(); } catch (e) {} }, 400);
  var askN = 0;
  setInterval(function() {
    if (lastPlacePayload.length || askN > 10) return;
    askN += 1;
    post({ type: 'needPlaces' });
  }, 1600);

  map.on('error', function(e) {
    try {
      var m = String((e && e.error && e.error.message) || e || 'map error');
      dbg('Fehler: ' + m);
      post({ type: 'mapError', message: m });
    } catch (err) {}
  });

  function applyPendingLiberty() {
    if (libertyApplied || !pendingLibertyStyle) return;
    libertyApplied = true;
    prefetchStyleExtras(pendingLibertyStyle);
    darkenLibertyStyle(pendingLibertyStyle);
    if (heavyOverlayTimer) { clearTimeout(heavyOverlayTimer); heavyOverlayTimer = 0; }
    overlayBooted = false;
    styleReady = false;
    map.setStyle(pendingLibertyStyle);
  }

  ${styleBoot}
    .then(function(style) {
      pendingLibertyStyle = style;
      applyPendingLiberty();
    })
    .catch(function(err) {
      post({ type: 'mapError', message: 'style fetch: ' + String(err) });
      bootOverlays();
    });

  var lastPostedBearing = map.getBearing();
  var lastPostedBearingAt = 0;
  function postBearing() {
    var b = map.getBearing();
    var now = Date.now();
    if (Math.abs(b - lastPostedBearing) < 2.8 && now - lastPostedBearingAt < 120) return;
    lastPostedBearing = b;
    lastPostedBearingAt = now;
    post({ type: 'bearing', bearing: b });
  }
  map.on('resize', function() {
    if (userIsDragging()) return;
    scheduleFog();
  });
  map.on('move', function() {
    if (userIsDragging()) return;
    postBearing();
    scheduleFogFromCamera();
  });
  map.on('zoom', function() {
    if (userIsDragging()) return;
    applyLodVisibility();
    scheduleFogFromCamera();
  });
  map.on('rotate', function() {
    if (userIsDragging()) return;
    postBearing();
  });
  map.on('zoomend', applyLodVisibility);
  map.on('moveend', function() {
    postBearing();
    if (headingFollow || centerLock) return;
    applyLodVisibility();
    prefetchPaused = false;
    scheduleNeighborPrefetch();
    layoutNavChips();
    var b = map.getBounds();
    post({
      type: 'viewport',
      zoom: map.getZoom(),
      south: b.getSouth(), west: b.getWest(),
      north: b.getNorth(), east: b.getEast(),
      bearing: map.getBearing()
    });
  });
  map.on('idle', scheduleNeighborPrefetch);
  map.on('dragstart', function() {
    if (programmaticMove) return;
    beginUserGesture();
  });
  map.on('dragend', function() {
    setTimeout(endUserGesture, 40);
  });
  map.on('rotatestart', function() {
    if (programmaticMove) return;
    beginUserGesture();
  });

  map.on('click', function(e) {
    if (Date.now() < ignoreClickUntil) return;
    var ids = [
      'drop-pin',
      'route-pins',
      'places-fill', 'places-line', 'places-icon-street', 'places-icon-transit',
      'places-dot', 'places-halo', 'places-label'
    ].filter(function(id) {
      return !!map.getLayer(id);
    });
    var feats = map.queryRenderedFeatures(e.point, { layers: ids });
    if (feats && feats[0] && feats[0].layer && feats[0].layer.id === 'drop-pin') {
      var dp = feats[0].properties || {};
      var dLat = Number(dp.lat);
      var dLng = Number(dp.lng);
      try {
        var dg = feats[0].geometry;
        if (dg && dg.type === 'Point' && dg.coordinates && dg.coordinates.length >= 2) {
          dLng = Number(dg.coordinates[0]);
          dLat = Number(dg.coordinates[1]);
        }
      } catch (eDp) {}
      post({ type: 'dropPin', lat: dLat, lng: dLng });
      return;
    }
    if (feats && feats[0] && feats[0].layer && feats[0].layer.id === 'route-pins') {
      var prPin = feats[0].properties || {};
      var key = String(prPin.n || '') + ':' + String(prPin.name || '');
      routeChipsForceHidden = false;
      if (routeChipDismissed[key]) delete routeChipDismissed[key];
      else routeChipDismissed[key] = 1;
      for (var ci = 0; ci < routeChipMarkers.length; ci++) {
        var mk = routeChipMarkers[ci];
        if (!mk || !mk._findusKey) continue;
        var el = mk.getElement && mk.getElement();
        if (!el || !el.classList) continue;
        if (routeChipsForceHidden || routeChipDismissed[mk._findusKey]) el.classList.add('hidden');
        else el.classList.remove('hidden');
      }
      layoutNavChips();
      return;
    }
    if (feats && feats[0] && feats[0].properties && feats[0].properties.id != null) {
      var pr = feats[0].properties;
      var geomLat = Number(pr.lat);
      var geomLng = Number(pr.lng);
      try {
        var g = feats[0].geometry;
        if (g && g.type === 'Point' && g.coordinates && g.coordinates.length >= 2) {
          geomLng = Number(g.coordinates[0]);
          geomLat = Number(g.coordinates[1]);
        } else if (e && e.lngLat) {
          if (!isFinite(geomLat) || !isFinite(geomLng)) {
            geomLat = Number(e.lngLat.lat);
            geomLng = Number(e.lngLat.lng);
          }
        }
      } catch (eGeom) {}
      post({
        type: 'placeTap',
        id: Number(pr.id),
        name: String(pr.name || ''),
        category: String(pr.category || ''),
        lat: isFinite(Number(pr.lat)) ? Number(pr.lat) : geomLat,
        lng: isFinite(Number(pr.lng)) ? Number(pr.lng) : geomLng,
        gLat: geomLat,
        gLng: geomLng
      });
      return;
    }
      post({ type: 'mapBlank' });
  });

  var lpTimer = 0;
  var lpStart = null;
  var ignoreClickUntil = 0;
  function cancelLongPress() {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = 0;
    }
    lpStart = null;
  }
  function fireDropPin(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!isFinite(lat) || !isFinite(lng)) return;
    ignoreClickUntil = Date.now() + 450;
    window.setDropPin(lat, lng);
    post({ type: 'dropPin', lat: lat, lng: lng });
  }
  map.on('touchstart', function(e) {
    if (!e || !e.lngLat || !e.point) return;
    if (e.points && e.points.length > 1) {
      cancelLongPress();
      return;
    }
    cancelLongPress();
    lpStart = { x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lng: e.lngLat.lng };
    lpTimer = setTimeout(function() {
      lpTimer = 0;
      var start = lpStart;
      lpStart = null;
      if (!start) return;
      var hitIds = [
        'places-fill', 'places-line', 'places-icon-street', 'places-icon-transit',
        'places-dot', 'places-halo', 'route-pins'
      ].filter(function(id) { return !!map.getLayer(id); });
      try {
        var hit = map.queryRenderedFeatures({ x: start.x, y: start.y }, { layers: hitIds });
        if (hit && hit[0] && hit[0].properties && hit[0].properties.id != null) return;
      } catch (eHit) {}
      fireDropPin(start.lat, start.lng);
    }, 520);
  });
  map.on('touchmove', function(e) {
    if (!lpStart || !e || !e.point) return;
    var dx = e.point.x - lpStart.x;
    var dy = e.point.y - lpStart.y;
    if (dx * dx + dy * dy > 160) cancelLongPress();
  });
  map.on('touchend', cancelLongPress);
  map.on('touchcancel', cancelLongPress);
  map.on('dragstart', cancelLongPress);
  map.on('contextmenu', function(e) {
    try { if (e && e.preventDefault) e.preventDefault(); } catch (eC) {}
    if (!e || !e.lngLat) return;
    fireDropPin(e.lngLat.lat, e.lngLat.lng);
  });

  window.setLodMode = function() {
    applyLodVisibility();
  };

  window.setChromeDim = function(on) {
    var el = document.getElementById('chromeDim');
    if (!el) return;
    if (on) el.classList.add('on'); else el.classList.remove('on');
  };

  window.setWalkTrack = function(pts) {
    walkTrack = Array.isArray(pts) ? pts : [];
    if (fogLightMode) {
      fogStampFeatures = [];
      fogLastStampKey = '';
      var list = Array.isArray(pts) ? pts : [];
      var step = Math.max(1, Math.floor(list.length / 80));
      for (var i = 0; i < list.length; i += step) {
        var q = list[i];
        if (q && typeof q.lat === 'number' && typeof q.lng === 'number') {
          stampFogAt(q.lat, q.lng);
        }
      }
      if (fogMaskDisabled && map.getSource('fog-mask')) {
        map.getSource('fog-mask').setData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }
    var nextKey = fogTrackKey(fogTrackPoints());
    if (nextKey !== fogExploredKey) {
      fogExploredKey = '';
      fogRevealKey = '';
      fogMaskKey = '';
      fogMaskOuter = null;
      fogExploredCache = null;
    }
    scheduleFogIfTrackChanged();
  };

  window.setRoads = function(roads) {
    ensureOverlays();
    var src = map.getSource('extract-roads');
    if (!src) return;
    var list = [];
    if (Array.isArray(roads)) {
      for (var i = 0; i < roads.length; i++) {
        var r = roads[i];
        if (!r || !r.latlngs) continue;
        list.push({
          k: r.kind === 'major' ? 0 : r.kind === 'path' ? 2 : 1,
          c: r.latlngs
        });
      }
    }
    extractHasRoads = list.length > 0;
    src.setData({ type: 'FeatureCollection', features: linesToFeatures(list) });
  };

  window.setBasemapMode = function(mode) {
    if (mode === 'extract') {
      setBasemapExtractOnly(true);
    } else {
      setBasemapExtractOnly(false);
      applyPendingLiberty();
    }
    applyLodVisibility();
  };

  window.setMapExtract = function(extract) {
    ensureOverlays();
    if (!extract) return;
    lastExtract = extract;
    extractHasRoads = Array.isArray(extract.roads) && extract.roads.length > 0;
    setBasemapExtractOnly(true);
    var set = function(id, feats) {
      var s = map.getSource(id);
      if (s) s.setData({ type: 'FeatureCollection', features: feats || [] });
    };
    set('extract-land', ringsToFeatures(extract.land || []));
    set('extract-woods', ringsToFeatures(extract.woods || []));
    set('extract-parks', ringsToFeatures(extract.parks || []));
    set('extract-water', ringsToFeatures(extract.water || []));
    set('extract-buildings', ringsToFeatures(extract.buildings || []));
    set('extract-rails', linesToFeatures(extract.rails || []));
    set('extract-roads', linesToFeatures(extract.roads || []));
    var hn = [];
    var nums = extract.housenumbers || [];
    for (var h = 0; h < nums.length; h++) {
      var n = nums[h];
      if (!n || typeof n.lat !== 'number') continue;
      hn.push({
        type: 'Feature',
        properties: { n: String(n.n || '') },
        geometry: { type: 'Point', coordinates: [n.lng, n.lat] }
      });
    }
    set('extract-housenumbers', hn);
    applyLodVisibility();
    scheduleFog();
  };

  window.setDropPin = function(lat, lng) {
    ensureOverlays();
    var src = map.getSource('drop-pin');
    if (!src) return;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          id: -2,
          name: 'Punkt auf der Karte',
          category: 'Ort',
          lat: lat,
          lng: lng
        },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      }]
    });
  };

  window.setRoute = function(payload) {
    ensureOverlays();
    function toLine(list) {
      var line = [];
      if (!Array.isArray(list)) return line;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c) continue;
        var lat = typeof c.lat === 'number' ? c.lat : Number(c.lat != null ? c.lat : c[0]);
        var lng = typeof c.lng === 'number' ? c.lng : Number(c.lng != null ? c.lng : c[1]);
        if (isFinite(lat) && isFinite(lng)) line.push([lng, lat]);
      }
      if (line.length === 2) {
        var dlat = line[0][1] - line[1][1];
        var dlng = line[0][0] - line[1][0];
        var m = Math.sqrt(dlat * dlat + dlng * dlng) * 111000;
        if (m > 80) return [];
      }
      return line;
    }
    function toLines(raw) {
      if (!Array.isArray(raw) || !raw.length) return [];
      var first = raw[0];
      if (Array.isArray(first) && first.length && (first[0] == null || typeof first[0] === 'object' || Array.isArray(first[0]))) {
        var lines = [];
        for (var li = 0; li < raw.length; li++) {
          var ln = toLine(raw[li]);
          if (ln.length >= 2) lines.push(ln);
        }
        return lines;
      }
      var one = toLine(raw);
      return one.length >= 2 ? [one] : [];
    }
    var current = [];
    var aheadLines = [];
    var aheadMeta = [];
    var pins = [];
    var arrows = [];
    var fitKey = '';
    if (Array.isArray(payload)) {
      current = toLine(payload);
    } else if (payload && typeof payload === 'object') {
      current = toLine(payload.current);
      aheadLines = toLines(payload.ahead);
      aheadMeta = Array.isArray(payload.aheadMeta) ? payload.aheadMeta : [];
      if (!aheadLines.length && Array.isArray(payload.lines)) {
        for (var li = 0; li < payload.lines.length; li++) {
          var L = payload.lines[li];
          if (!L) continue;
          var extra = toLine(L.coords || L);
          if (extra.length >= 2) {
            aheadLines.push(extra);
            aheadMeta.push(L.kind === 'transit' ? 'transit' : 'walk');
          }
        }
      }
      pins = Array.isArray(payload.pins) ? payload.pins : [];
      arrows = Array.isArray(payload.arrows) ? payload.arrows : [];
      fitKey = typeof payload.fitKey === 'string' ? payload.fitKey : '';
      if (payload.fitWide) fitKey = 'w|' + fitKey;
    }
    var src = map.getSource('route');
    if (src) {
      src.setData(current.length < 2
        ? { type: 'FeatureCollection', features: [] }
        : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: current } }] });
    }
    var aheadSrc = map.getSource('route-ahead');
    if (aheadSrc) {
      var aheadFeats = [];
      for (var ai = 0; ai < aheadLines.length; ai++) {
        aheadFeats.push({
          type: 'Feature',
          properties: { kind: aheadMeta[ai] === 'transit' ? 'transit' : 'walk' },
          geometry: { type: 'LineString', coordinates: aheadLines[ai] }
        });
      }
      aheadSrc.setData({ type: 'FeatureCollection', features: aheadFeats });
    }
    var pinSrc = map.getSource('route-pins');
    if (pinSrc) {
      ensureRoutePinImages();
      var feats = [];
      for (var p = 0; p < pins.length; p++) {
        var pin = pins[p];
        if (!pin) continue;
        var plat = Number(pin.lat);
        var plng = Number(pin.lng);
        if (!isFinite(plat) || !isFinite(plng)) continue;
        var num = Number(pin.n);
        if (!isFinite(num) || num < 0) num = p + 1;
        var isNow = pin.current === true || pin.current === 1 || p === 0;
        var icon = typeof pin.icon === 'string' && pin.icon
          ? pin.icon
          : (isNow
            ? (num > 0 ? 'route-pin-now-' + Math.min(9, num) : 'route-pin-now')
            : 'route-pin-next-' + Math.min(9, Math.max(1, num)));
        feats.push({
          type: 'Feature',
          properties: {
            n: num,
            name: pin.name || '',
            current: isNow ? 1 : 0,
            icon: icon
          },
          geometry: { type: 'Point', coordinates: [plng, plat] }
        });
      }
      pinSrc.setData({ type: 'FeatureCollection', features: feats });
      try { if (map.getLayer('route-pins')) map.moveLayer('route-pins'); } catch (ePinTop) {}
    }
    var arrowSrc = map.getSource('route-arrows');
    if (arrowSrc) {
      var afeats = [];
      for (var a = 0; a < arrows.length; a++) {
        var ar = arrows[a];
        if (!ar) continue;
        var alat = Number(ar.lat);
        var alng = Number(ar.lng);
        var br = Number(ar.bearing);
        if (!isFinite(alat) || !isFinite(alng) || !isFinite(br)) continue;
        afeats.push({
          type: 'Feature',
          properties: { bearing: br, kind: ar.kind === 'turn' ? 'turn' : 'flow' },
          geometry: { type: 'Point', coordinates: [alng, alat] }
        });
      }
      arrowSrc.setData({ type: 'FeatureCollection', features: afeats });
    }
    try {
      for (var rm = 0; rm < routeChipMarkers.length; rm++) {
        try { routeChipMarkers[rm].remove(); } catch (eRm) {}
      }
    } catch (eClear) {}
    routeChipMarkers = [];
    if (pins.length && typeof maplibregl !== 'undefined') {
      var seenChipGeo = {};
      for (var pc = 0; pc < pins.length; pc++) {
        var pinC = pins[pc];
        if (!pinC || !pinC.chip || !pinC.chip.title) continue;
        var plat = Number(pinC.lat);
        var plng = Number(pinC.lng);
        if (!isFinite(plat) || !isFinite(plng)) continue;
        var geoKey = plat.toFixed(5) + ',' + plng.toFixed(5);
        if (seenChipGeo[geoKey]) continue;
        seenChipGeo[geoKey] = 1;
        var key = String(pinC.n || '') + ':' + String(pinC.name || '');
        var wrap = document.createElement('div');
        wrap.className = 'nav-chip';
        wrap.style.position = 'relative';
        if (routeChipsForceHidden || routeChipDismissed[key]) wrap.classList.add('hidden');
        var t = document.createElement('div');
        t.className = 't';
        t.textContent = String(pinC.chip.title);
        wrap.appendChild(t);
        if (pinC.chip.sub) {
          var sEl = document.createElement('div');
          sEl.className = 's';
          sEl.textContent = String(pinC.chip.sub);
          wrap.appendChild(sEl);
        }
        var x = document.createElement('button');
        x.className = 'x';
        x.type = 'button';
        x.setAttribute('aria-label', 'Schließen');
        x.textContent = '×';
        x.onclick = (function(k, el) {
          return function(ev) {
            try { ev.stopPropagation(); } catch (eS) {}
            routeChipDismissed[k] = 1;
            if (el && el.classList) el.classList.add('hidden');
          };
        })(key, wrap);
        wrap.appendChild(x);
        try {
          var marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom', offset: [0, -28] })
            .setLngLat([plng, plat])
            .addTo(map);
          marker._findusKey = key;
          var isNow = !!pinC.current;
          var isDest = pc === pins.length - 1;
          marker._findusPri = isNow ? 0 : (isDest ? 1 : 2);
          routeChipMarkers.push(marker);
        } catch (eMk) {}
      }
      try {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(layoutNavChips);
        else layoutNavChips();
      } catch (eLay) { layoutNavChips(); }
    }
    if (fitKey && fitKey !== lastRouteFitKey) {
      lastRouteFitKey = fitKey;
      try {
        var b = new maplibregl.LngLatBounds();
        var nFit = 0;
        function ext(lnglat) {
          if (!lnglat || lnglat.length < 2) return;
          b.extend(lnglat);
          nFit += 1;
        }
        for (var fi = 0; fi < current.length; fi++) ext(current[fi]);
        for (var fj = 0; fj < aheadLines.length; fj++) {
          var ln = aheadLines[fj];
          if (!ln) continue;
          for (var fk = 0; fk < ln.length; fk++) ext(ln[fk]);
        }
        for (var fp = 0; fp < pins.length; fp++) {
          var pp = pins[fp];
          if (!pp) continue;
          ext([Number(pp.lng), Number(pp.lat)]);
        }
        if (nFit >= 2) {
          var maxZ = 13;
          try {
            var ne = b.getNorthEast();
            var sw = b.getSouthWest();
            var span = Math.max(Math.abs(ne.lat - sw.lat), Math.abs(ne.lng - sw.lng));
            if (payload.fitWide || span > 0.08) maxZ = 10;
            else if (span > 0.03) maxZ = 11;
          } catch (eZ) {}
          map.fitBounds(b, { padding: 52, duration: 900, maxZoom: maxZ });
          if (payload.fitWide && payload.previewPin) {
            var pvLat = Number(payload.previewPin.lat);
            var pvLng = Number(payload.previewPin.lng);
            if (isFinite(pvLat) && isFinite(pvLng)) {
              if (previewTimer) clearTimeout(previewTimer);
              previewTimer = setTimeout(function() {
                try {
                  map.easeTo({ center: [pvLng, pvLat], zoom: 15.4, duration: 1400 });
                } catch (ePv) {}
              }, 3500);
            }
          }
        }
      } catch (eFit) {}
    }
    if (!pins.length) lastRouteFitKey = '';
  };

  window.setRouteChipsHidden = function(on) {
    routeChipsForceHidden = !!on;
    for (var i = 0; i < routeChipMarkers.length; i++) {
      var mk = routeChipMarkers[i];
      var el = mk && mk.getElement && mk.getElement();
      if (!el || !el.classList) continue;
      var key = mk._findusKey;
      if (routeChipsForceHidden || routeChipDismissed[key]) el.classList.add('hidden');
      else el.classList.remove('hidden');
    }
    layoutNavChips();
  };

  window.setPlaces = function(places) {
    lastPlacePayload = Array.isArray(places) ? places : [];
    var loaded = false;
    try { loaded = map.isStyleLoaded && map.isStyleLoaded(); } catch (eL) {}
    if (loaded) styleReady = true;
    dbg('setPlaces ' + lastPlacePayload.length + (styleReady ? '' : ' (wartet)'));
    if (!styleReady) return;
    if (userIsDragging()) {
      pendingPlacesWhileGesture = lastPlacePayload;
      return;
    }
    applyPlacesPayload(lastPlacePayload);
  };

  window.setPlaceRings = function(items) {
    if (!Array.isArray(items) || !items.length) return;
    var byId = {};
    for (var i = 0; i < lastPlacePayload.length; i++) {
      var cur = lastPlacePayload[i];
      if (cur && cur.id != null) byId[cur.id] = cur;
    }
    for (var j = 0; j < items.length; j++) {
      var next = items[j];
      if (!next || next.id == null || !next.ring || next.ring.length < 3) continue;
      var prev = byId[next.id] || {};
      if (prev.amenityDot === true || prev.icon) continue;
      byId[next.id] = Object.assign({}, prev, next, { keepDot: false, pointOnly: false });
    }
    lastPlacePayload = [];
    for (var id in byId) {
      if (Object.prototype.hasOwnProperty.call(byId, id)) lastPlacePayload.push(byId[id]);
    }
    if (!styleReady) return;
    if (userIsDragging()) {
      pendingPlacesWhileGesture = lastPlacePayload;
      return;
    }
    applyPlacesPayload(lastPlacePayload);
  };

  window.setCities = function(cities) {
    var features = [];
    if (Array.isArray(cities)) {
      for (var i = 0; i < cities.length; i++) {
        var c = cities[i];
        if (!c || !c.ring || c.ring.length < 3) continue;
        var coords = c.ring.map(function(ll) { return [ll[1], ll[0]]; });
        if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
          coords.push(coords[0]);
        }
        features.push({
          type: 'Feature',
          properties: {
            id: c.id,
            fill: c.fill,
            stroke: c.stroke,
            fillOpacity: typeof c.fillOpacity === 'number' ? c.fillOpacity : 0,
            dashed: !!c.dashed
          },
          geometry: { type: 'Polygon', coordinates: [coords] }
        });
      }
    }
    ensureOverlays();
    var src = map.getSource('cities');
    if (src) src.setData({ type: 'FeatureCollection', features: features });
    applyLodVisibility();
  };

  window.updateUser = function(lat, lng, heading, accuracyM, speedMs) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!isFinite(lat) || !isFinite(lng)) return;
    userLat = lat;
    userLng = lng;
    gpsFixLat = lat;
    gpsFixLng = lng;
    gpsFixAt = Date.now();
    if (typeof speedMs === 'number' && isFinite(speedMs) && speedMs >= 0) {
      gpsSpeedMs = speedMs;
    }
    if (typeof heading === 'number' && isFinite(heading)) {
      setTargetHeading(heading);
    }
    if (typeof accuracyM === 'number' && isFinite(accuracyM) && accuracyM > 0) {
      userAccuracyM = accuracyM;
    }
    if (styleReady && !userIsDragging()) paintUserLocation({ skipFog: true });
    if (!userIsDragging()) applyCenterLock();
    startDeadReckon();
    if (!userIsDragging()) scheduleFogIfTrackChanged();
  };

  window.setCenterLock = function(on) {
    centerLock = !!on;
    if (centerLock) applyCenterLock();
  };

  window.setUserHeading = function(heading) {
    setTargetHeading(heading);
  };

  window.setHeadingFollow = function(on, heading) {
    headingFollow = !!on;
    lastFollowBearing = null;
    if (typeof heading === 'number' && isFinite(heading)) {
      setTargetHeading(heading);
      if (styleReady) paintUserLocation({ skipFog: true });
    }
    if (headingFollow) applyFollowCamera();
    scheduleFog();
  };

  window.resizeMap = function() {
    try { map.resize(); } catch (e) {}
  };

  function recoverMap() {
    try { map.resize(); } catch (e0) {}
    try { if (map.triggerRepaint) map.triggerRepaint(); } catch (e1) {}
    try {
      var c = map.getCenter();
      var z = map.getZoom();
      map.jumpTo({ center: c, zoom: z });
    } catch (e2) {}
    if (lastExtract) {
      try { window.setMapExtract(lastExtract); } catch (eX) {}
    }
    if (lastPlacePayload.length) applyPlacesPayload(lastPlacePayload);
    if (userLat != null && userLng != null) paintUserLocation({ skipFog: true });
    restackLayers();
    post({ type: 'mapAlive' });
  }
  window.recoverMap = recoverMap;

  window.setMapPaused = function(on) {
    prefetchPaused = !!on;
    mapPaused = false;
    ensureMapGestures();
    bindUserGestureCapture();
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = 0;
    }
    startDeadReckon();
    queueHeadingTick();
    try { map.resize(); } catch (eR) {}
    try { if (map.triggerRepaint) map.triggerRepaint(); } catch (eT) {}
    post({ type: 'mapAlive' });
  };

  window.warmupRing = function(lat, lng, radiusM) {
    radiusM = Number(radiusM);
    enqueueRadius(lat, lng, radiusM);
    post({ type: 'ringReady', radiusM: radiusM || 0, skippedCamera: true });
  };

  window.jumpTo = function(lat, lng, zoom) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    var z = typeof zoom === 'number' ? zoom : Math.max(map.getZoom(), 16);
    markIgnoreCamera(40);
    try { map.jumpTo({ center: [lng, lat], zoom: z }); } catch (eJ) {}
  };

  window.recenter = function(lat, lng, zoom) {
    window.jumpTo(lat, lng, zoom);
  };

  window.setNorthUp = function() {
    headingFollow = false;
    lastFollowBearing = null;
    markIgnoreCamera(240);
    map.setBearing(0);
    lastPostedBearing = 0;
    post({ type: 'bearing', bearing: 0 });
    scheduleFog();
  };

  window.setHeadingUp = function(heading) {
    var h = typeof heading === 'number' && isFinite(heading) ? heading : 0;
    markIgnoreCamera(80);
    try {
      if (map.isEasing && map.isEasing()) map.stop();
      map.jumpTo({ bearing: h });
    } catch (eH) {}
  };

  window.fitCity = function(ring) {
    if (!Array.isArray(ring) || ring.length < 2) return;
    try {
      var b = new maplibregl.LngLatBounds();
      for (var i = 0; i < ring.length; i++) {
        var ll = ring[i];
        if (!ll || ll.length < 2) continue;
        b.extend([ll[1], ll[0]]);
      }
      map.fitBounds(b, { padding: 48, duration: 0, maxZoom: 12.4 });
    } catch (e) {}
  };
})();
</script>
</body>
</html>`;
}
