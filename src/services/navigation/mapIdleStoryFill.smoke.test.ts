/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/mapIdleStoryFill.smoke.test.ts
 */
import {
  isMapIdleStoryFillPoi,
  isPackStoryMapPoi,
  isMapOpenAreaNoFillPoi,
  isMapEverydayBuildingFocusPoi,
  shouldPaintPlaceBuildingFill,
  NO_MODUL1_AUTO_BLOB_RE,
} from './mapIdleStoryFill';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const m = {
    name: 'Marktkauf / Meyers Frischecenter Peiner Hag 1',
    category: 'supermarket',
    tags_json: JSON.stringify([
      'directory',
      'tier4',
      'supermarket',
      'map_outline',
      'story_enriched',
    ]),
  };
  assert(!isPackStoryMapPoi(m), 'Marktkauf nie Pack-Story');
  assert(!isMapIdleStoryFillPoi(m), 'Marktkauf nie Idle-Fill');
  assert(isMapEverydayBuildingFocusPoi(m), 'Marktkauf Fokus-Gebäude ok');
  assert(
    NO_MODUL1_AUTO_BLOB_RE.test(`${m.name} ${m.category}`),
    'Marktkauf blockt M1-Auto',
  );
  assert(
    !shouldPaintPlaceBuildingFill({
      visited: false,
      navOrPlanFocus: false,
      modul1Auto: false,
      openArea: false,
      streetPointAmenity: false,
      directoryNoStory: true,
    }),
    'Marktkauf Directory nie Fill',
  );
}

{
  const s = {
    name: 'Spielplatz Schnickenfeld',
    category: 'spielplatz',
    tags_json: JSON.stringify(['directory', 'spielplatz', 'map_outline', 'story']),
  };
  assert(isMapOpenAreaNoFillPoi(s), 'Spielplatz ist Open-Area');
  assert(!isMapIdleStoryFillPoi(s), 'Spielplatz nie Idle-Fill');
  assert(!isMapEverydayBuildingFocusPoi(s), 'Spielplatz nie Gebäude-Fokus');
  assert(!isPackStoryMapPoi(s), 'Spielplatz nie Pack-Story');
}

{
  const g = {
    name: 'Gewerbegebiet Peiner Hag',
    category: 'service',
    tags_json: JSON.stringify(['directory', 'service', 'map_outline']),
  };
  assert(isMapOpenAreaNoFillPoi(g), 'Gewerbegebiet Open-Area');
  assert(!isMapIdleStoryFillPoi(g), 'Gewerbe nie Idle-Fill');
}

{
  const praxis = {
    name: 'Gemeinschaftspraxis Prisdorf',
    category: 'gesundheit',
    tags_json: JSON.stringify(['directory', 'gesundheit', 'map_outline']),
  };
  assert(!isMapIdleStoryFillPoi(praxis), 'Praxis nie Idle-Fill');
  assert(isMapEverydayBuildingFocusPoi(praxis), 'Praxis Fokus-Gebäude');
}

{
  const tank = {
    name: 'team Tankstelle Peiner Hag 1a',
    category: 'service',
    tags_json: JSON.stringify(['directory', 'service', 'map_outline']),
  };
  assert(!isMapIdleStoryFillPoi(tank), 'Tankstelle nie Idle-Fill');
  assert(isMapEverydayBuildingFocusPoi(tank), 'Tankstelle Fokus-Gebäude');
  assert(
    !shouldPaintPlaceBuildingFill({
      visited: true,
      navOrPlanFocus: true,
      modul1Auto: false,
      openArea: false,
      streetPointAmenity: true,
      directoryNoStory: true,
    }),
    'Tankstelle nie Fill (auch visited/nav)',
  );
}

{
  const bade = {
    name: 'Historisches Badehaus',
    category: 'geschichte',
    tags_json: JSON.stringify(['story', 'must_have', 'landmark']),
  };
  assert(isPackStoryMapPoi(bade), 'Badehaus ist Pack-Story');
  assert(isMapIdleStoryFillPoi(bade), 'Badehaus Story-Kandidat');
  assert(
    shouldPaintPlaceBuildingFill({
      visited: false,
      navOrPlanFocus: false,
      modul1Auto: true,
      openArea: false,
      streetPointAmenity: false,
      directoryNoStory: false,
    }),
    'M1-auto → Fill',
  );
  assert(
    !shouldPaintPlaceBuildingFill({
      visited: false,
      navOrPlanFocus: false,
      modul1Auto: false,
      openArea: false,
      streetPointAmenity: false,
      directoryNoStory: false,
    }),
    'Idle non-M1 → kein Fill',
  );
  assert(
    shouldPaintPlaceBuildingFill({
      visited: true,
      navOrPlanFocus: false,
      modul1Auto: false,
      openArea: false,
      streetPointAmenity: false,
      directoryNoStory: false,
    }),
    'Visited → Fill',
  );
}

{
  const hybrid = {
    name: 'Bäcker Schlüter',
    category: 'bakerei',
    tags_json: JSON.stringify(['directory', 'cafe', 'geschichte', 'story_enriched']),
  };
  assert(isMapIdleStoryFillPoi(hybrid), 'Schlüter Hybrid Story-Signal');
}

{
  const plainCafe = {
    name: 'Café am Markt',
    category: 'cafe',
    tags_json: JSON.stringify(['directory', 'cafe', 'tier4']),
  };
  assert(!isMapIdleStoryFillPoi(plainCafe), 'Normal-Café ohne Story → kein Fill');
  assert(isMapEverydayBuildingFocusPoi(plainCafe), 'Café Fokus-Gebäude');
}

console.log('mapIdleStoryFill.smoke.test.ts OK');

{
  const packStory = {
    name: 'Irgendwas',
    category: 'cafe',
    tags_json: JSON.stringify(['map_story_fill', 'directory']),
  };
  assert(isMapIdleStoryFillPoi(packStory), 'Pack map_story_fill schlägt Heuristik');
  const packIcon = {
    name: 'Badehaus',
    category: 'freizeit',
    tags_json: JSON.stringify(['map_icon_only', 'story', 'module1']),
  };
  assert(!isMapIdleStoryFillPoi(packIcon), 'Pack map_icon_only blockt Fill');
  assert(isMapOpenAreaNoFillPoi(packIcon), 'map_icon_only = no fill');
  const packBldg = {
    name: 'Shop',
    category: 'ort',
    tags_json: JSON.stringify(['map_building_focus']),
  };
  assert(isMapEverydayBuildingFocusPoi(packBldg), 'map_building_focus Fokus');
  assert(!isMapIdleStoryFillPoi(packBldg), 'building_focus kein Idle-Fill');
}
