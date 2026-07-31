/**
 * Interaktive Stadt-Karte in der Stempelkarte (Leaflet/OSM in WebView).
 * Fog-of-War: Reveal in echten Metern (zoom-invariant geografisch).
 * Segmente nur wenn Fixes ≤ 5 Min / ≤ ~250 m — keine Fernreise-Striche.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebView as WebViewInstance } from 'react-native-webview';
import { colors, spacing } from '../constants/theme';
import {
  colorForStampCategory,
  resolveStampMapCategory,
  type StampMapCategory,
} from '../services/navigation/stampMapCategories';
import {
  sampleWalkTrackForMap,
  sampleWalkTrackForDay,
  WALK_REVEAL_RADIUS_M,
  FOG_SEGMENT_BREAK_MS,
  FOG_SEGMENT_BREAK_M,
  type WalkTrackPoint,
} from '../services/discovery/walkTrackService';
import {
  resolveCityCoverageBoundsSync,
  type CityCoverageBounds,
} from '../services/discovery/cityCoverageBounds';
import { getCachedUserProfile } from '../services/userProfileService';
import { getCurrentCoords } from '../services/locationService';
import { useFinnusStore } from '../store/useFinnusStore';
import { useGpsStore } from '../store/useGpsStore';
import type { Poi } from '../db/types';

export type StampMapMarker = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  visited: boolean;
  category: StampMapCategory;
  color: string;
};

export type StampMapVisitNode = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  arrivedAtMs: number;
  dwellMin: number | null;
};

type Props = {
  pois: Poi[];
  visitedPoiIds: Set<number>;
  /** Visited pins (default true). */
  showVisited?: boolean;
  /** Unvisited categories to show as pins (default none). */
  enabledCategories?: ReadonlySet<StampMapCategory>;
  /** Map frame height. */
  height?: number;
  /** Fired once user pans / pinches / taps the map. */
  onMapInteracted?: () => void;
  /**
   * Historie-Tag: nur GPS-Pfad dieses Tages + Visit-Knoten.
   * Ohne = gesamter Walk-Track (Fog).
   */
  historyDateKey?: string | null;
  /** Explizite Visit-Knoten (Zeitachse). */
  visitNodes?: StampMapVisitNode[];
  /** Tagesroute einfärben (default true wenn historyDateKey). */
  showDayRoute?: boolean;
};

type UserLoc = { lat: number; lng: number } | null;

function isAreaPoi(p: Poi): boolean {
  const k = p.kind ?? 'legacy';
  return k === 'area' || k === 'legacy' || !k;
}

function toMarker(p: Poi, visited: boolean): StampMapMarker {
  const category = resolveStampMapCategory({
    category: p.category,
    name: p.name,
    kind: p.kind,
    tags: p.tags_json,
  });
  return {
    id: p.id,
    name: p.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
    lat: p.lat,
    lng: p.lng,
    visited,
    category,
    color: colorForStampCategory(category),
  };
}

function buildHtml(
  markers: StampMapMarker[],
  user: UserLoc,
  track: WalkTrackPoint[],
  revealM: number,
  visitNodes: StampMapVisitNode[],
  showDayRoute: boolean,
  cityBounds: CityCoverageBounds | null,
): string {
  const payload = JSON.stringify(markers);
  const userPayload = user
    ? JSON.stringify({ lat: user.lat, lng: user.lng })
    : 'null';
  const trackPayload = JSON.stringify(
    track.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at })),
  );
  const visitsPayload = JSON.stringify(
    visitNodes.map((v) => ({
      id: v.id,
      name: v.name,
      lat: v.lat,
      lng: v.lng,
      dwellMin: v.dwellMin,
      at: v.arrivedAtMs,
    })),
  );
  const cityPayload = cityBounds
    ? JSON.stringify({
        latMin: cityBounds.latMin,
        latMax: cityBounds.latMax,
        lngMin: cityBounds.lngMin,
        lngMax: cityBounds.lngMax,
        name: cityBounds.name,
        polygon: cityBounds.polygon ?? [
          [cityBounds.latMin, cityBounds.lngMin],
          [cityBounds.latMin, cityBounds.lngMax],
          [cityBounds.latMax, cityBounds.lngMax],
          [cityBounds.latMax, cityBounds.lngMin],
          [cityBounds.latMin, cityBounds.lngMin],
        ],
      })
    : 'null';
  const breakMs = FOG_SEGMENT_BREAK_MS;
  const breakM = FOG_SEGMENT_BREAK_M;
  let centerLat = 53.79;
  let centerLng = 7.9;
  let zoom = 14;
  const focus = [...markers];
  if (user) focus.push({ lat: user.lat, lng: user.lng } as StampMapMarker);
  for (const t of track.slice(-20)) {
    focus.push({ lat: t.lat, lng: t.lng } as StampMapMarker);
  }
  for (const v of visitNodes) {
    focus.push({ lat: v.lat, lng: v.lng } as StampMapMarker);
  }
  if (focus.length) {
    const lats = focus.map((m) => m.lat);
    const lngs = focus.map((m) => m.lng);
    centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const span = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs),
    );
    zoom = span < 0.01 ? 15 : span < 0.03 ? 14 : span < 0.08 ? 13 : 12;
  }

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#16362C;}
  .leaflet-container{background:#16362C;}
  .leaflet-control-attribution{font-size:9px;opacity:.7;}
  .fog-canvas{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:450;}
  .pin{
    width:14px;height:14px;border-radius:50%;
    border:2px solid #F4EFE6;box-shadow:0 1px 4px rgba(0,0,0,.45);
    display:flex;align-items:center;justify-content:center;
    box-sizing:border-box;
  }
  .pin.open{opacity:.55;border-width:1.5px;}
  .pin.visited{
    width:18px;height:18px;opacity:1;
    border:2.5px solid #C4A35A;
    box-shadow:0 0 0 3px rgba(196,163,90,.28),0 1px 4px rgba(0,0,0,.45);
  }
  .pin.visited .check{
    color:#F4EFE6;font-size:10px;font-weight:800;line-height:1;
    text-shadow:0 1px 1px rgba(0,0,0,.35);
  }
  .user-wrap{position:relative;width:22px;height:22px;}
  .user-pulse{
    position:absolute;left:50%;top:50%;width:22px;height:22px;
    margin:-11px 0 0 -11px;border-radius:50%;
    background:rgba(66,133,244,.28);
  }
  .user-dot{
    position:absolute;left:50%;top:50%;width:14px;height:14px;
    margin:-7px 0 0 -7px;border-radius:50%;
    background:#4285F4;border:2.5px solid #FFFFFF;
    box-shadow:0 1px 4px rgba(0,0,0,.4);
  }
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var markers = ${payload};
  var userLoc = ${userPayload};
  var walkTrack = ${trackPayload};
  var visitNodes = ${visitsPayload};
  var cityBounds = ${cityPayload};
  var showDayRoute = ${showDayRoute ? 'true' : 'false'};
  var revealM = ${revealM};
  var breakMs = ${breakMs};
  var breakM = ${breakM};
  var interactedSent = false;
  function notifyInteracted() {
    if (interactedSent) return;
    interactedSent = true;
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'map_interacted' }));
      }
    } catch (e) {}
  }

  var map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    dragging: true,
    touchZoom: true,
    doubleClickZoom: true,
    scrollWheelZoom: true,
    boxZoom: false,
    keyboard: false,
    tap: true,
    bounceAtZoomLimits: true,
    preferCanvas: true,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    inertia: true,
    inertiaDeceleration: 2500
  }).setView([${centerLat}, ${centerLng}], ${zoom});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    minZoom: 11,
    attribution: '&copy; OpenStreetMap',
    updateWhenIdle: true,
    keepBuffer: 2
  }).addTo(map);
  setTimeout(function(){ try { map.invalidateSize(true); } catch (e) {} }, 80);
  setTimeout(function(){ try { map.invalidateSize(true); } catch (e) {} }, 320);

  map.on('dragstart zoomstart', notifyInteracted);
  map.on('click', notifyInteracted);

  var cityLayer = null;
  if (cityBounds && cityBounds.polygon && cityBounds.polygon.length >= 3) {
    cityLayer = L.polygon(cityBounds.polygon, {
      color: '#C4A35A',
      weight: 2,
      opacity: 0.85,
      fillColor: '#C4A35A',
      fillOpacity: 0.06,
      interactive: false
    }).addTo(map);
    try {
      map.fitBounds(cityLayer.getBounds().pad(0.08), { maxZoom: 15, animate: false });
    } catch (e) {}
  }

  var fogCanvas = document.createElement('canvas');
  fogCanvas.className = 'fog-canvas';
  map.getContainer().appendChild(fogCanvas);
  var fogCtx = fogCanvas.getContext('2d');

  function resizeFog() {
    var size = map.getSize();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    fogCanvas.width = size.x * dpr;
    fogCanvas.height = size.y * dpr;
    fogCanvas.style.width = size.x + 'px';
    fogCanvas.style.height = size.y + 'px';
    fogCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFog();
  }

  function metersToContainerPixels(lat, lng, meters) {
    var p1 = map.latLngToContainerPoint(L.latLng(lat, lng));
    var dLng = meters / (111320 * Math.cos(lat * Math.PI / 180));
    var p2 = map.latLngToContainerPoint(L.latLng(lat, lng + dLng));
    return Math.max(1, Math.abs(p2.x - p1.x));
  }

  function haversineM(aLat, aLng, bLat, bLng) {
    var R = 6371000;
    var dLat = (bLat - aLat) * Math.PI / 180;
    var dLng = (bLng - aLng) * Math.PI / 180;
    var x = Math.sin(dLat/2)*Math.sin(dLat/2) +
      Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*
      Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function shouldConnect(a, b) {
    if (!a || !b) return false;
    if (a.at == null || b.at == null) {
      return haversineM(a.lat, a.lng, b.lat, b.lng) <= breakM;
    }
    var dt = b.at - a.at;
    if (dt < 0 || dt > breakMs) return false;
    return haversineM(a.lat, a.lng, b.lat, b.lng) <= breakM;
  }
  /** Echte Meter beim aktuellen Zoom — geografisch konstant. */
  function revealRadiusPx(lat, lng) {
    return metersToContainerPixels(lat, lng, revealM);
  }

  function punchCircle(pt, r) {
    var g = fogCtx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.82, 'rgba(0,0,0,0.95)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fogCtx.fillStyle = g;
    fogCtx.beginPath();
    fogCtx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    fogCtx.fill();
  }

  function drawFog() {
    if (!fogCtx) return;
    var size = map.getSize();
    fogCtx.clearRect(0, 0, size.x, size.y);
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.fillStyle = 'rgba(8, 18, 14, 0.72)';
    fogCtx.fillRect(0, 0, size.x, size.y);
    fogCtx.globalCompositeOperation = 'destination-out';
    var pts = walkTrack.slice();
    if (userLoc) pts.push({ lat: userLoc.lat, lng: userLoc.lng, at: Date.now() });
    var maxPts = 1200;
    var step = pts.length > maxPts ? Math.ceil(pts.length / maxPts) : 1;
    var prev = null;
    var prevPt = null;
    for (var i = 0; i < pts.length; i += step) {
      var p = pts[i];
      if (!p || !isFinite(p.lat) || !isFinite(p.lng)) continue;
      var pt = map.latLngToContainerPoint(L.latLng(p.lat, p.lng));
      var r = revealRadiusPx(p.lat, p.lng);
      if (prev && prevPt && shouldConnect(prev, p)) {
        fogCtx.lineWidth = r * 2;
        fogCtx.lineCap = 'round';
        fogCtx.lineJoin = 'round';
        fogCtx.strokeStyle = 'rgba(0,0,0,1)';
        fogCtx.beginPath();
        fogCtx.moveTo(prevPt.x, prevPt.y);
        fogCtx.lineTo(pt.x, pt.y);
        fogCtx.stroke();
      }
      punchCircle(pt, r);
      prev = p;
      prevPt = pt;
    }
    fogCtx.globalCompositeOperation = 'source-over';
  }

  window.setWalkTrack = function(pts) {
    walkTrack = Array.isArray(pts) ? pts : [];
    drawFog();
    if (window.redrawDayRoute) window.redrawDayRoute();
  };

  var dayRouteLine = null;
  window.redrawDayRoute = function() {
    if (dayRouteLine) {
      try { map.removeLayer(dayRouteLine); } catch (e) {}
      dayRouteLine = null;
    }
    if (!showDayRoute || !walkTrack || walkTrack.length < 2) return;
    var segments = [];
    var cur = [];
    for (var i = 0; i < walkTrack.length; i++) {
      var p = walkTrack[i];
      if (!p || !isFinite(p.lat) || !isFinite(p.lng)) continue;
      if (cur.length && i > 0 && !shouldConnect(walkTrack[i-1], p)) {
        if (cur.length >= 2) segments.push(cur);
        cur = [];
      }
      cur.push([p.lat, p.lng]);
    }
    if (cur.length >= 2) segments.push(cur);
    if (!segments.length) return;
    dayRouteLine = L.layerGroup();
    for (var s = 0; s < segments.length; s++) {
      L.polyline(segments[s], {
        color: '#3DCF7A',
        weight: 4,
        opacity: 0.85,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(dayRouteLine);
    }
    dayRouteLine.addTo(map);
  };
  window.redrawDayRoute();

  visitNodes.forEach(function(v, idx) {
    if (!v || !isFinite(v.lat) || !isFinite(v.lng)) return;
    var t = v.at ? new Date(v.at) : null;
    var clock = t
      ? String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0')
      : '';
    var htmlV =
      '<div style="width:22px;height:22px;border-radius:50%;background:#C4A35A;border:2px solid #F4EFE6;display:flex;align-items:center;justify-content:center;color:#0F2C24;font-size:10px;font-weight:800;">' +
      (idx + 1) + '</div>';
    var iconV = L.divIcon({
      className: '',
      html: htmlV,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    L.marker([v.lat, v.lng], { icon: iconV, zIndexOffset: 600, keyboard: false })
      .bindPopup(
        '<b>' + String(v.name || '').replace(/</g,'') + '</b><br/>' +
        (clock ? ('Ankunft ' + clock) : 'Besucht') +
        (v.dwellMin != null ? (' · ' + v.dwellMin + ' Min') : '')
      )
      .addTo(map);
  });

  var fogRaf = null;
  function scheduleFog() {
    if (fogRaf) return;
    fogRaf = requestAnimationFrame(function() {
      fogRaf = null;
      drawFog();
    });
  }
  map.on('move zoom resize', scheduleFog);
  map.on('resize', resizeFog);
  setTimeout(resizeFog, 80);
  setTimeout(resizeFog, 350);

  var group = [];
  markers.forEach(function(m) {
    var html = m.visited
      ? '<div class="pin visited" style="background:' + m.color + '"><span class="check">✓</span></div>'
      : '<div class="pin open" style="background:' + m.color + '"></div>';
    var size = m.visited ? 18 : 14;
    var icon = L.divIcon({
      className: '',
      html: html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
    var mk = L.marker([m.lat, m.lng], { icon: icon, keyboard: false })
      .bindPopup(
        '<b>' + String(m.name).replace(/</g,'') + '</b><br/>' +
        (m.visited ? 'Besucht' : 'Noch offen')
      );
    mk.on('click', notifyInteracted);
    mk.addTo(map);
    group.push(mk);
  });

  var userMarker = null;
  function setUserLocation(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return;
    userLoc = { lat: lat, lng: lng };
    if (userMarker) {
      userMarker.setLatLng([lat, lng]);
      scheduleFog();
      return;
    }
    var icon = L.divIcon({
      className: '',
      html: '<div class="user-wrap"><div class="user-pulse"></div><div class="user-dot"></div></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    userMarker = L.marker([lat, lng], {
      icon: icon,
      zIndexOffset: 1000,
      interactive: false,
      keyboard: false
    }).addTo(map);
    scheduleFog();
  }
  window.updateUserLocation = setUserLocation;
  if (userLoc) setUserLocation(userLoc.lat, userLoc.lng);

  var fitTargets = group.slice();
  if (userMarker) fitTargets.push(userMarker);
  if (fitTargets.length > 1) {
    try {
      map.fitBounds(L.featureGroup(fitTargets).getBounds().pad(0.12), {
        maxZoom: 16,
        animate: false
      });
    } catch (e) {}
  } else if (fitTargets.length === 1) {
    try {
      map.setView(fitTargets[0].getLatLng(), 16);
    } catch (e) {}
  }
  setTimeout(function(){ resizeFog(); }, 100);
</script>
</body></html>`;
}

export const StampCityMap = React.memo(function StampCityMap({
  pois,
  visitedPoiIds,
  showVisited = true,
  enabledCategories,
  height = 460,
  onMapInteracted,
  historyDateKey = null,
  visitNodes = [],
  showDayRoute,
}: Props) {
  const webRef = useRef<WebViewInstance>(null);
  const lastGpsLat = useGpsStore((s) => s.lat);
  const lastGpsLng = useGpsStore((s) => s.lng);
  const [trackTick, setTrackTick] = useState(0);
  const interactedRef = useRef(false);

  const cats = enabledCategories ?? EMPTY_CATS;
  const paintDayRoute = showDayRoute ?? !!historyDateKey;

  const userLoc = useMemo<UserLoc>(() => {
    if (
      lastGpsLat != null &&
      lastGpsLng != null &&
      Number.isFinite(lastGpsLat) &&
      Number.isFinite(lastGpsLng)
    ) {
      return { lat: lastGpsLat, lng: lastGpsLng };
    }
    return null;
  }, [lastGpsLat, lastGpsLng]);

  useEffect(() => {
    const id = setInterval(() => setTrackTick((n) => n + 1), 8_000);
    return () => clearInterval(id);
  }, []);

  const walkTrack = useMemo(() => {
    if (historyDateKey) return sampleWalkTrackForDay(historyDateKey, 1_200);
    return sampleWalkTrackForMap(1_200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackTick, lastGpsLat, lastGpsLng, historyDateKey]);

  const visibleMarkers = useMemo(() => {
    const out: StampMapMarker[] = [];
    for (const p of pois) {
      if (!isAreaPoi(p)) continue;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const visited = visitedPoiIds.has(p.id);
      if (visited) {
        if (showVisited) out.push(toMarker(p, true));
        continue;
      }
      const cat = resolveStampMapCategory({
        category: p.category,
        name: p.name,
        kind: p.kind,
        tags: p.tags_json,
      });
      if (cats.has(cat)) out.push(toMarker(p, false));
    }
    return out;
  }, [pois, visitedPoiIds, showVisited, cats]);

  const cityBounds = useMemo(() => {
    const id = getCachedUserProfile()?.cityId ?? null;
    return resolveCityCoverageBoundsSync(id);
  }, [trackTick]);

  const html = useMemo(
    () =>
      buildHtml(
        visibleMarkers,
        userLoc,
        walkTrack,
        WALK_REVEAL_RADIUS_M,
        visitNodes,
        paintDayRoute,
        cityBounds,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- GPS/track via inject
    [visibleMarkers, !!userLoc, walkTrack.length, visitNodes.length, paintDayRoute, historyDateKey, cityBounds?.cityId],
  );

  useEffect(() => {
    if (!userLoc) return;
    const { lat, lng } = userLoc;
    webRef.current?.injectJavaScript(
      `try{if(window.updateUserLocation)window.updateUserLocation(${lat},${lng});}catch(e){};true;`,
    );
  }, [userLoc]);

  useEffect(() => {
    const payload = JSON.stringify(
      walkTrack.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at })),
    );
    webRef.current?.injectJavaScript(
      `try{if(window.setWalkTrack)window.setWalkTrack(${payload});}catch(e){};true;`,
    );
  }, [walkTrack]);

  useEffect(() => {
    if (userLoc) return;
    const status = useFinnusStore.getState().gpsStatus;
    if (status === 'denied') return;
    void getCurrentCoords({ timeoutMs: 6000 }).catch(() => undefined);
  }, [userLoc]);

  const onMessage = useCallback(
    (ev: { nativeEvent: { data: string } }) => {
      try {
        const data = JSON.parse(ev.nativeEvent.data) as { type?: string };
        if (data?.type === 'map_interacted' && !interactedRef.current) {
          interactedRef.current = true;
          onMapInteracted?.();
        }
      } catch {
        /* ignore */
      }
    },
    [onMapInteracted],
  );

  const showMap =
    visibleMarkers.length > 0 || !!userLoc || walkTrack.length > 0;

  return (
    <View style={styles.wrap}>
      <View
        style={[styles.mapFrame, { height }]}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
      >
        {!showMap ? (
          <View style={styles.emptyMap}>
            <Text style={styles.emptyMapText}>
              Noch keine besuchten Orte — sobald Findus erzählt, erscheinen die
              Stempel hier. Schalte unten Kategorien hinzu, um mehr Pins zu
              sehen.
            </Text>
          </View>
        ) : (
          <WebView
            ref={webRef as never}
            originWhitelist={['*']}
            source={{ html }}
            style={styles.web}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            scrollEnabled={false}
            overScrollMode="never"
            nestedScrollEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            onMessage={onMessage}
            onLoadEnd={() => {
              if (userLoc) {
                webRef.current?.injectJavaScript(
                  `try{if(window.updateUserLocation)window.updateUserLocation(${userLoc.lat},${userLoc.lng});}catch(e){};true;`,
                );
              }
              const payload = JSON.stringify(
                walkTrack.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at })),
              );
              webRef.current?.injectJavaScript(
                `try{if(window.setWalkTrack)window.setWalkTrack(${payload});}catch(e){};true;`,
              );
            }}
          />
        )}
      </View>
    </View>
  );
});

const EMPTY_CATS: ReadonlySet<StampMapCategory> = new Set();

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  mapFrame: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  web: { flex: 1, backgroundColor: colors.bg },
  emptyMap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyMapText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
