/**
 * Run: npx --yes tsx src/components/homeMap/homePresenceMapHtml.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/components/homeMap/homePresenceMapHtml.ts'),
  'utf8',
);

assert(
  !src.includes("'fill-rule'") && !src.includes('"fill-rule"'),
  'MapLibre 4.7 kennt fill-rule nicht — Fog-Layer würde sonst komplett fehlen',
);
assert(
  /HOME_MAP_RENDERER_REV = 129/.test(src),
  'WebView muss neu mounten (REV 129)',
);
assert(src.includes('function isClutterLandcover'), 'Wiesen-/Sumpf-Muster erkennen');
assert(src.includes('landcover_wetland'), 'Liberty-Sumpf-Pattern aus');
assert(src.includes('landcover_wood'), 'Liberty-Wald-Flecken aus (Zoom 9)');
assert(
  !src.includes('landcover_wetland|landcover_grass'),
  'Wiese/Acker nicht ausblenden — sonst dunkle Kachel-Quadrate',
);
assert(src.includes('boundary_3'), 'gestrichelte Kreis-Grenzen bleiben aus');
assert(src.includes('hideClutterLandcoverLayers'), 'Muster-Layer bleiben aus, auch nach Liberty-Mode');
assert(src.includes("window.setHeadingFollow"), 'Kompass: Karte folgt Blickrichtung');
assert(src.includes('function beginUserGesture'), 'Finger löst Follow, bevor jumpTo die Geste frisst');
assert(src.includes('function ensureMapGestures'), 'dragPan nach Freeze wieder an');
assert(src.includes('userIsDragging'), 'Follow/Injects nicht während Finger-Geste');
assert(src.includes('tickDisplayedHeading'), 'Kompass: flüssige Interpolation wie Google Maps');
assert(src.includes('0.92'), 'Heading snappy, kein 90°-Nachlauf');
assert(src.includes('applyFollowCamera'), 'Follow: jumpTo statt Ease-Stau');
assert(src.includes('followBearingDeg'), 'Karte folgt Sensor-Ziel, nicht der Puck-EMA');
assert(src.includes('setTargetHeading'), 'Heading-Ziel getrennt von der Anzeige');
assert(src.includes('function fogMaskPadM'), 'Fog-Pad deckt gedrehte Viewport-AABB');
assert(src.includes('scheduleFogFromCamera'), 'Fog nicht bei jeder Follow-Drehung rastern');
assert(
  src.includes('fogFollowHold'),
  'Follow-Fog auf 280 ms gedrosselt',
);
assert(
  src.includes("if (fogLightMode && fogMaskDisabled) return"),
  'Fog-Stempel nicht bei jedem Pan neu setzen',
);
assert(
  /map\.on\('move', function\(\) \{\s*if \(userIsDragging\(\)\) return;/.test(src),
  'Pan: kein Fog/Bearing während Finger-Geste',
);
assert(
  src.includes('if (headingFollow || centerLock) return') &&
    src.includes("map.on('moveend'"),
  'Follow: kein Viewport-Inject bei jeder Kompass-Drehung',
);
assert(src.includes('maxTileCacheSize: 192'), 'Tile-Cache für Extract+Tiles');
assert(src.includes('lodVisState[id] === want'), 'LOD-Visibility nicht doppelt setzen');
assert(!src.includes('function applyMapOverscan'), 'kein Overscan-Resize der Canvas');
assert(!src.includes('pixelRatio: Math.min(2'), 'kein künstliches pixelRatio');
assert(
  src.includes('deadReckonRaf = requestAnimationFrame(tickDeadReckon);') &&
    src.includes('gpsSpeedMs < 0.2'),
  'Dead-Reckon nicht dauerhaft 60 fps',
);
assert(!src.includes("id: 'user-dot'"), 'kein blauer GPS-Kreis');
assert(src.includes("'user-arrow'"), 'GPS nur als Richtungspfeil');
assert(src.includes('g.moveTo(0, -40)'), 'Pfeil zentriert auf der Position, kein Aufsatz auf Kreis');
assert(src.includes("'icon-rotation-alignment': 'map'"), 'Puck dreht geografisch mit der Blickrichtung');
assert(src.includes("heading: hasHeading ? userHeading : 0"), 'Heading am GeoJSON-Feature');
assert(src.includes("'route-pins','route-arrows'"), 'Tour-Pins immer sichtbar');
assert(src.includes('buildFogPolygonsJs'), 'Fog: vereinigte Fläche, keine Stempel');
assert(src.includes('buildExploredPolygonsJs'), 'Fog-Reveal in Weltkoordinaten');
assert(src.includes('scheduleFogIfTrackChanged'), 'Fog nicht bei jedem Pan neu rastern');
assert(src.includes('fogLightMode') && src.includes('stampFogAt'), 'Fog: leichte Stempel statt Full-Rebuild');
assert(src.includes('fogMaskDisabled'), 'Fog-Abdunklung optional aus (Performance)');
assert(src.includes('fogOuterContains'), 'Fog-Maske bleibt beim Schwenken liegen');
assert(!src.includes('fogMoveTimer'), 'kein Fog-Rebuild beim Kartenverschieben');
assert(src.includes('fogSmoothClosed'), 'Fog-Kante geglättet (Chaikin)');
assert(src.includes('fogClusterSegments'), 'Fog: GPS-Inseln getrennt rastern');
assert(src.includes('fogSplitTiles'), 'Fog: Stadt-Spur in feinen Kacheln');
assert(src.includes('fogRoundIfCompact(fogSimplifyClosed'), 'Raster-Rand wird zum Kreis');
assert(src.includes('Z_DETAIL_GONE'), 'Fog/Orte/Gebäude: gemeinsamer Fade-Start');
assert(src.includes('Z_DETAIL_FULL'), 'Fog/Orte/Gebäude: voll ab 10.5');
assert(src.includes('HOME_MAP_DETAIL_FADE'), 'Fade-SSOT aus homeMapStyle');
assert(!src.includes('var Z_FOG = 12.5'), 'kein hartes Fog-Cut bei 12.5');
assert(src.includes("z >= Z_DETAIL_GONE"), 'Fog+Gebäude+Orte zusammen sichtbar ab Fade-Zoom');
assert(src.includes('fog-reveal-base'), 'Erkundungs-Spur als Layer');
assert(src.includes('function restackLayers'), 'Orte über Gebäude, Spur darunter');
assert(src.includes("'fog-reveal-base'"), 'Spur im Layer-Stack');
assert(src.includes('var fogLightMode = false'), 'Fog als Maske+Reveal, keine Minz-Stempel');
assert(src.includes('var fogMaskDisabled = false'), 'unerkundet bleibt abgedunkelt');
assert(src.includes("id: 'places-icon-street'"), 'Alltag-Icons erst ab Street-Zoom');
assert(src.includes("id: 'places-icon-transit'"), 'Bahn/Bus getrennt vom Alltag');
assert(src.includes('place-doctor'), 'Arzt-Icon');
assert(src.includes("badge('place-pharmacy'"), 'Apotheke-Icon');
assert(src.includes("badge('place-supermarket'"), 'Supermarkt-Einkaufswagen');
assert(src.includes("badge('place-kiosk'"), 'Kiosk-Stand');
assert(src.includes("badge('place-bar'"), 'Bar/Kneipe-Theke');
assert(src.includes("badge('place-restaurant'"), 'Restaurant: Gabel und Messer');
assert(src.includes("badge('place-ferry'"), 'Fähre von vorn');
assert(src.includes("badge('place-park'"), 'Park: Bank und Baum');
assert(src.includes("badge('place-nature'"), 'Natur: Bäume');
assert(src.includes("badge('place-historic'"), 'Historisch: Rolle und Feder');
assert(src.includes("badge('place-activity'"), 'Aktivitäten: Wanderer');
assert(!src.includes("g.fillText('AKTIV"), 'Aktivitäten ohne Schriftzug');
assert(src.includes("badge('place-camping'"), 'Camping-Zelt');
assert(src.includes("badge('place-hotel'"), 'Hotel: Bett und Zzz');
assert(src.includes("badge('place-hostel'"), 'Hostel: Stockbett');
assert(src.includes("badge('place-attraction'"), 'Sehenswürdigkeit: Kamera');
assert(src.includes("badge('place-museum'"), 'Museum: Tempel');
assert(src.includes("badge('place-cinema'"), 'Kino: Filmklappe');
assert(src.includes("badge('place-theater'"), 'Theater: Masken');
assert(src.includes("badge('place-cafe'"), 'Café: Tasse mit Dampf');
assert(!src.includes("g.fillText('MUSEUM'"), 'Museum ohne Schriftzug');
assert(src.includes('g.quadraticCurveTo(s * 0.28, s * 0.78'), 'Fähre: Wasserlinie');
assert(src.includes('g.arc(s / 2, s / 2, s * 0.34'), 'Apotheke: Kreuz im Kreis');
assert(src.includes('g.arc(s * 0.30, s * 0.78, s * 0.055'), 'Arzt: Stethoskop');
assert(src.includes('function liftBasemapLabels'), 'Straßennamen über Extract-Straßen');
assert(src.includes('function recoverMap'), 'Karte nach Overlay wiederbeleben');
assert(src.includes("ensurePlaceAmenityImages"), 'Bahn- und P-Icons gezeichnet');
assert(src.includes("place-post"), 'Briefkasten-Icon');
assert(src.includes("badge('place-post', '#F5C400'"), 'Briefkasten gelb, kein Minus-Sprite');
assert(src.includes('g.lineTo(s * 0.50, s * 0.70)'), 'Briefkasten: Umschlag-Klappe');
assert(src.includes("badge('place-rail'"), 'Bahnhof als Zug-Piktogramm');
assert(src.includes('s * 0.36, s * 0.18, s * 0.28, s * 0.07'), 'Bahn: Zielanzeige von vorn');
assert(src.includes("badge('place-bus'"), 'Bushaltestelle als Bus-Piktogramm');
assert(src.includes('for (i = 0; i < 3; i++)'), 'Bus: drei Seitenfenster');
assert(!src.includes("badge('place-bridge'"), 'kein Brücken-Icon');
assert(src.includes("place-toilet"), 'WC-Icon für Touristen');
assert(src.includes('g.arc(s * 0.32, s * 0.24, s * 0.075'), 'WC: Mann/Frau-Piktogramm');
assert(!src.includes("g.fillText('WC'"), 'WC nicht als Buchstaben');
assert(src.includes("badge('place-water'"), 'Wasserspender-Icon');
assert(src.includes('var drops ='), 'Wasserglas mit Blasen');
assert(!src.includes("adoptSprite"), 'keine Liberty-Sprites (Minus-Quadrate)');
assert(src.includes('function applyPendingLiberty'), 'Liberty-Stil als Unterlage');
assert(
  !src.includes('if (basemapExtractOnly || lastExtract) return'),
  'Liberty auch mit Stadt-Extract laden — sonst leere Flächen',
);
assert(
  !src.includes('Vector-Tiles entfernen'),
  'OpenFreeMap-Tiles bleiben, Extract nur Overlay',
);
assert(src.includes("window.recenter = function(lat, lng, zoom) {\n    window.jumpTo(lat, lng, zoom);"), 'GPS-Zentrieren sofort, kein Ease');
assert(src.includes('var lastExtract = null'), 'Extract nach Pause wieder anwenden');
assert(src.includes("'fog-reveal-base', 'fog-mask-fill'"), 'Fog unter Straßen und Gebäuden');
assert(
  src.indexOf("'user-arrow',") > src.indexOf("'places-label'"),
  'GPS über Orts-Pins, nicht darunter',
);
assert(!src.includes("id: 'fog-reveal-fill'"), 'kein Mint-Overlay über der Karte');
assert(!src.includes('LAND_BY_ZOOM'), 'kein globaler heller Land-Farbwechsel');
assert(!src.includes('HOME_MAP_FOG_EDGE'), 'keine weiße Fog-Kante');
assert(!src.includes('fog-mask-edge'), 'kein Fog-Linien-Layer');
assert(src.includes('FOG_MERGE_GAP_M'), 'Fog schließt Lücken bis 20 m');
assert(!src.includes('capsuleRing'), 'keine überlappenden Kapsel-Löcher');
assert(src.includes('Z_CITY_NONE'), 'Stadt-Füllung Zoom-Kurve');
assert(src.includes('CITY_OP_57'), '90 % ab Zoom 5.7');
assert(src.includes("boundary_2"), 'Ländergrenzen sichtbar');
assert(src.includes('Z_WOODS_GONE'), 'Wälder-LOD');
assert(src.includes('Z_SECONDARY'), 'Straßen-LOD ab 9.7');

const styleSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapStyle.ts'),
  'utf8',
);
assert(styleSrc.includes("catalog: '#A85848'"), 'Katalog-Rot gedämpft (Marktreife)');
assert(
  styleSrc.includes('HOME_MAP_FOG_MASK_ENABLED = false'),
  'kein Viewport-Fog-Mask-Nachladen',
);
assert(
  styleSrc.includes("HOME_MAP_FOG_REVEAL = '#2A9A62'") ||
    styleSrc.includes("HOME_MAP_FOG_REVEAL = 'rgba(") ||
    styleSrc.includes('HOME_MAP_FOG_REVEAL = colors.online'),
  'erkundet: dezentes Mint-Reveal',
);
assert(
  styleSrc.includes("HOME_MAP_FOG_FILL = 'rgba(0, 0, 0, 0)'") ||
    styleSrc.includes("HOME_MAP_FOG_FILL = 'rgba(0, 0, 0, 0.18)'"),
  'Abdunkeln über Basiskarte, nicht über Maske',
);
assert(styleSrc.includes('HOME_MAP_CHROME_DIM = 0.5'), 'Popup/Stichpunkte: Karte 50 % dunkler');
assert(!styleSrc.includes('HOME_MAP_LAND_REVEAL'), 'kein globaler Reveal-Landton');
assert(!styleSrc.includes('HOME_MAP_FOG_EDGE'), 'keine Fog-Kantenfarbe');
assert(styleSrc.includes('opacity12: 0.72'), 'Zoom ~12: starke Stadt-Füllung (~80%)');
assert(styleSrc.includes('noneAt: 14.2'), 'Füllung blendet auf Street-Zoom aus');
assert(styleSrc.includes('HOME_MAP_CITY_OUTLINE_UNTIL = 17.5'), 'Pack-Kontur bleibt sichtbar');
assert(styleSrc.includes('woodsGoneBelow: 7'), 'Gelände weg ab Zoom 7');
assert(src.includes("id: 'route-ahead-line'"), 'Tour: lila Folgeben');
assert(src.includes("id: 'route-arrows'"), 'Tour: Richtungspfeile auf der blauen Linie');
assert(src.includes("id: 'route-pins'"), 'Tour: nummerierte Stopp-Pins');
assert(!src.includes("id: 'places-dot-near'"), 'keine zweite Dot-Schicht die Street-Zoom filtert');
assert(src.includes('if (covered) continue'), 'kein Punkt in einer Orts-Fläche');
assert(src.includes("id: 'places-fill', type: 'fill'"), 'Gebäude-Orte als Fläche');
assert(src.includes('FADE_PLACE'), 'Ort-Gebäudeflächen sichtbar eingefärbt');
assert(!src.includes('maxzoom: 14'), 'Orte-Punkte nicht ab Zoom 14 abschalten');
assert(!src.includes("['get', 'covered']"), 'Punkte nicht ausblenden weil Nachbar-Gebäude');
assert(src.includes('function fogBasemapReady'), 'Fog erst wenn Straßen da sind');
assert(src.includes('extractHasRoads'), 'Extract-Straßen-Flag');
assert(src.includes("type: 'dropPin'"), 'Long-Press Drop-Pin');
assert(src.includes('window.setDropPin'), 'Drop-Pin in der Karte');
assert(src.includes('mapPaused = false'), 'Overlays frieren GL nicht ein');
assert(src.includes("type: 'placeTap'"), 'Ort-Tap postet placeTap');
assert(src.includes("type: 'mapBlank'"), 'Leerer Karten-Tap schließt das Popup');
assert(src.includes("id: 'extract-rails-dash'"), 'Gleise als Schwellen, nicht nur Linie');
assert(styleSrc.includes('HOME_MAP_BG = HOME_MAP_LAND_MUTED'), 'Karten-BG = Land, keine dunklen Kachel-Quadrate');
assert(styleSrc.includes("neutral: MODUL1_MAP_COLORS.neutral"), 'Ort-Rot = kein Auto-Trigger');
assert(styleSrc.includes("visited: MODUL1_MAP_COLORS.visited"), 'Ort-Grün = besucht');
assert(styleSrc.includes("planned: MODUL1_MAP_COLORS.planned"), 'Ort-Blau = geplant');
assert(
  !src.includes("['match', ['get', 'kind'], 'transit', '${HOME_MAP_RAIL}'"),
  'berechnete Route nicht in Gleis-Farbe',
);
assert(
  src.includes("set('extract-rails', linesToFeatures(extract.rails || []))"),
  'Gleise als Linien, nicht als geschlossene Polygone',
);
assert(src.includes('gLat:'), 'Ort-Tap sendet Geometrie-Fallback');
assert(!src.includes('setMapClicks'), 'Ort-Taps nicht global sperren');
assert(src.includes('span > REVEAL_M * 2.2'), 'Stempelkarte: keine Riesenkreise aus Schleifen');
assert(!src.includes("id: 'fog-mask-fade'"), 'kein weicher Fade-Rand (Artefakte)');
assert(!src.includes("'line-offset'"), 'kein versetzter Nebel-Ring über der Schrift');
assert(src.includes("id: 'fog-mask-line'"), 'ab Street-Zoom klare Kante');
assert(src.includes('minzoom: 13.2'), 'klare Linie erst nah ran, weiträumig nur Fläche');
assert(src.includes("'line-blur': 0"), 'Kante ohne Unschärfe-Dreck');
assert(!src.includes("id: 'fog-reveal-glow'"), 'kein mint-Ring über den Straßen');
assert(src.includes("'route-pin-now-' + n"), 'Ziel-Pinnadel mit Nummer im Kopf');
assert(src.includes("p.amenityDot === true"), 'Briefkasten bleibt Punkt, Gebäude werden Fill');
assert(
  src.includes('if (prev.amenityDot === true || prev.icon) continue'),
  'nachgezogene Ringe ersetzen Amenity-Punkte nicht, Gebäude dürfen Fill werden',
);
assert(src.includes("['==', ['to-number', ['coalesce', ['get', 'keepDot'], 0]], 1]"), 'Alltags-Punkte bekommen Labels');
assert(src.includes('peekMapLibreHtmlAssets'), 'MapLibre JS/CSS/Style von Disk');
assert(src.includes('MAPLIBRE_JS_URL'), 'CDN nur Fallback');
assert(src.includes("type: 'interactive'"), 'Karte zuerst verschiebbar');
assert(src.includes('ensureUserOverlay'), 'GPS-Puck ohne vollen Overlay-Stack');
assert(src.includes('id="mapClip"'), 'Overscan: sichtbare Fläche voll, Rand schon gerendert');
assert(src.includes('enqueueNeighbors'), 'Nachbar-Kacheln im HTTP-Cache');
assert(src.includes('prefetchPaused'), 'Prefetch pausiert beim Schieben');
assert(!src.includes('prefetchPaused = mapPaused'), 'Prefetch läuft hinter Settings weiter');
assert(src.includes('duration: 0, maxZoom: 12.4'), 'Stadt-Fit ohne Ease, Zoom 12 statt 14');
assert(src.includes('window.jumpTo'), 'erster Stand ohne Ease — sofort schiebbar');
assert(src.includes('window.warmupRing'), 'Tile-Warmup in Ringen');
assert(!/window\.warmupRing = function[\s\S]{0,80}fitBounds/.test(src), 'Warmup bewegt die Kamera nicht');
assert(src.includes("type: 'ringReady'"), 'Ring fertig gemeldet');
assert(src.includes('tickDeadReckon'), 'Dead Reckoning zwischen GPS-Fixes');
assert(src.includes('Math.round(userLat * 2500)'), 'Live-GPS im Fog auf ~40 m gerastert');
assert(src.includes('window.setMapPaused'), 'setMapPaused bleibt API');
assert(src.includes('keepAliveTimer'), 'Keepalive-Timer-Variable bleibt');
assert(!/window\.setMapPaused = function\(on\) \{[\s\S]{0,400}recoverMap\(\)/.test(src), 'Unpause baut die Karte nicht neu');
assert(src.includes('paintUserLocation({ skipFog: true })'), 'Puck-Update ohne Fog-Rebuild');
assert(src.includes('lastPostedBearingAt'), 'Bearing nicht jedes Frame an RN');
assert(src.includes('centerLock'), 'GPS-Follow hält den blauen Punkt in der Mitte');
assert(src.includes('gpsSpeedMs'), 'GPS-Speed für Interpolation');
assert(src.includes("layout.visibility = 'visible'"), 'Liberty-Gebäude sichtbar');
assert(!src.includes('revealLibertyDetailLayers'), 'Gebäude nicht mehr nach Idle einblenden');

console.log('homePresenceMapHtml.smoke.test.ts OK');
