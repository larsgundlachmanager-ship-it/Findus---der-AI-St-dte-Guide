/**
 * Vertrag: Protomaps-Basiskarte Fetch+Recolor (Maps-Verfassung LOCK).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/yorroProtomapsBasemapStyle.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const loader = readFileSync(
  join(process.cwd(), 'src/services/homeMap/yorroProtomapsBasemapStyle.ts'),
  'utf8',
);
assert(loader.includes('loadYorroProtomapsBasemapStyle'), 'async style load');
assert(loader.includes('hydrateYorroProtomapsBasemapStyleFromDisk'), 'disk hydrate');
assert(loader.includes('beginYorroProtomapsStyleWarm'), 'splash style warm start');
assert(loader.includes('awaitYorroProtomapsStyleWarm'), 'splash style warm await');
assert(loader.includes('YORRO_PROTOMAPS_RECOLOR_REV'), 'recolor rev for disk envelope');
assert(loader.includes('protomapsStyleRawFingerprint'), 'raw fp skips recolor on refresh');
assert(loader.includes('recolorProtomapsStyleForYorro'), 'yorro recolor');
assert(loader.includes('resolveProtomapsStyleUrl'), 'style url from config');
assert(loader.includes('HOME_MAP_ROAD_COLORS'), 'road colors');
assert(loader.includes('HOME_MAP_STREET_LABEL'), 'street labels');
assert(
  loader.includes('text-color') || loader.includes('text-halo'),
  'street label paint',
);
assert(
  loader.includes('roads_labels') && loader.includes('roadLabels'),
  'Straßenname-Layer ans Ende für Route-belowLayerID',
);
assert(loader.includes('HOME_MAP_BG'), 'land bg');
assert(
  loader.includes('HOME_MAP_COUNTRY_BORDER') &&
    loader.includes('boundar') &&
    loader.includes('ensureProtomapsBoundaryLayers') &&
    loader.includes('boundaries_country') &&
    loader.includes("visibility = 'visible'"),
  'Protomaps-Ländergrenzen weiß aus Basemap',
);
assert(
  loader.includes('ensureProtomapsPlaceLabelsOff') &&
    loader.includes("visibility = 'none'"),
  'Basemap-Ortsnamen aus — Pack-Label einmal',
);
assert(
  /YORRO_PROTOMAPS_RECOLOR_REV\s*=\s*[6-9]/.test(loader),
  'recolor rev bumped for place-label hide',
);
assert(
  loader.includes('Style als Objekt') || loader.includes('nicht nur URL'),
  'object style — not URL-only on Android',
);
assert(loader.includes('yorro-protomaps-style'), 'disk cache dir');
assert(
  loader.includes('Gleicher Roh-Fingerprint') ||
    loader.includes('cachedRawFp === rawFp'),
  'refresh skips sync recolor when fp matches',
);

const cfg = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapTileConfig.ts'),
  'utf8',
);
assert(cfg.includes('styles/v5/'), 'protomaps styles v5');
assert(cfg.includes('resolveProtomapsStyleUrl'), 'hosted style helper');
assert(
  cfg.includes('isVectorExplicitlyDisabled'),
  'vector default on unless =0',
);

const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(view.includes('loadYorroProtomapsBasemapStyle'), 'map loads style');
assert(view.includes('vectorStyle'), 'style in state');
assert(view.includes('peekYorroProtomapsBasemapStyle'), 'peek seed');
assert(view.includes('mapBasemapStyle'), 'basemap applied');
assert(view.includes('Kamera-Verfassung'), 'camera constitution');
assert(
  view.includes('Kein setCamera / syncDefaultStop') ||
    view.includes('kein native defaultStop'),
  'no defaultStop snap path',
);

const warm = readFileSync(
  join(process.cwd(), 'src/services/homeMap/warmupHomeMap.ts'),
  'utf8',
);
assert(
  warm.includes('awaitYorroProtomapsStyleWarm') ||
    warm.includes('beginYorroProtomapsStyleWarm'),
  'warmup awaits/prefetches basemap style during splash',
);

const app = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
assert(
  app.includes('beginYorroProtomapsStyleWarm'),
  'App boot starts Protomaps warm before DB',
);

const rule = readFileSync(
  join(process.cwd(), '.cursor/rules/findus-map-three-releases.mdc'),
  'utf8',
);
assert(rule.includes('Maps-Verfassung LOCK'), 'rule lock title');
assert(rule.includes('yorroProtomapsBasemapStyle.ts'), 'rule owns loader');
assert(rule.includes('Verboten'), 'rule forbids extract default');


assert(
  loader.includes('Disk + Netz parallel') ||
    loader.includes('fetchRecolorAndCache'),
  'style load races disk with network',
);
assert(
  loader.includes('loadYorroProtomapsBasemapStyle().finally') ||
    /splashWarmInflight\s*=\s*loadYorroProtomapsBasemapStyle/.test(loader),
  'begin warm uses parallel load path',
);

const kick = readFileSync(
  join(process.cwd(), 'src/services/homeMap/kickProtomapsStyleWarm.ts'),
  'utf8',
);
assert(kick.includes('beginYorroProtomapsStyleWarm'), 'kick starts style warm');
const index = readFileSync(join(process.cwd(), 'index.ts'), 'utf8');
assert(
  index.includes('kickProtomapsStyleWarm'),
  'index imports style warm before App',
);

const warmFull = readFileSync(
  join(process.cwd(), 'src/services/homeMap/warmupHomeMap.ts'),
  'utf8',
);
assert(
  warmFull.includes('PROTOMAPS_STYLE_SPLASH_BUDGET_MS') ||
    /awaitYorroProtomapsStyleWarm\(\s*2[_]?400/.test(warmFull),
  'splash style budget >= 2.4s',
);
assert(
  warmFull.includes('kein GeoJSON-Extract') ||
    warmFull.includes('kein GeoJSON'),
  'vector splash skips GeoJSON extract',
);

console.log('yorroProtomapsBasemapStyle.smoke.test.ts OK');
