#!/usr/bin/env node
/**
 * Map-Perfect Gate — Footprint- + Bullet-QA für eine Stadt.
 *
 *   node scripts/cityPack/mapPerfectGate.mjs --city kiel
 *   node scripts/cityPack/mapPerfectGate.mjs --city kiel --strict
 */
import { arg, hasFlag, loadPack } from './lib.mjs';
import { needsBuildingFootprint, resolveMapPaint, stampMapPaintOnPack } from './mapPaintPolicy.mjs';

const SKIP_NAME_RE =
  /stadtgeschichte|strassenverzeichnis|strassen_gestern|gestern_heute|virtuell/i;

const MAP_POINT_RE =
  /briefkasten|post.?box|bus.?halt|bushaltestelle|haltestelle|trinkwasser|toilette|viewpoint|aussichtspunkt|atm|geldautomat|map_point/i;

const BAD_BULLET_RE =
  /adresse\s*\(|google maps:|mehr infos und route im popup|offline-directory|offline-katalog|user-frage:|gps-eingang|koordinaten\s*~/i;

function isMapPoint(spot) {
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('map_point') || tags.includes('transit')) return true;
  const blob = `${spot.id || ''} ${spot.name || ''} ${spot.category || ''}`.toLowerCase();
  return MAP_POINT_RE.test(blob);
}

function isStory(spot) {
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('directory') || tags.includes('tier4')) return false;
  return (
    tags.includes('story') ||
    tags.includes('module1') ||
    spot.pack_role === 'story' ||
    Number(spot.place_tier) <= 2
  );
}

function uniqueCount(poly) {
  const s = new Set();
  for (const p of poly || []) {
    const lat = p.lat ?? p.latitude;
    const lng = p.lng ?? p.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      s.add(`${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`);
    }
  }
  return s.size;
}

function isAxisBox(poly) {
  if (!poly || poly.length < 4 || poly.length > 6) return false;
  const lats = new Set();
  const lngs = new Set();
  for (const p of poly) {
    const lat = p.lat ?? p.latitude;
    const lng = p.lng ?? p.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    lats.add(Number(lat).toFixed(6));
    lngs.add(Number(lng).toFixed(6));
  }
  return lats.size === 2 && lngs.size === 2;
}

function footprintOk(spot) {
  if (isMapPoint(spot) || resolveMapPaint(spot) === 'icon_only') {
    return { ok: true, reason: 'icon_only' };
  }
  if (!needsBuildingFootprint(spot)) return { ok: true, reason: 'no_building' };
  const poly = spot.polygonCoordinates || spot.polygon;
  if (!Array.isArray(poly) || poly.length < 4) {
    return { ok: false, reason: 'missing_poly' };
  }
  if (isAxisBox(poly)) return { ok: false, reason: 'axis_box' };
  if (uniqueCount(poly) < 3) return { ok: false, reason: 'too_few_verts' };
  return { ok: true, reason: 'poly' };
}

function bulletsOk(spot) {
  const bullets = spot.bullets;
  if (!Array.isArray(bullets) || bullets.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const good = bullets.filter(
    (b) =>
      typeof b === 'string' &&
      b.trim().length >= 8 &&
      !BAD_BULLET_RE.test(b) &&
      !/^\d{5}\b/.test(b.trim()),
  );
  if (!good.length) return { ok: false, reason: 'junk' };
  return { ok: true, reason: 'ok' };
}

export function runMapPerfectGate(cityId, { strict = false } = {}) {
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`pack missing: ${cityId}`);
  stampMapPaintOnPack(pack);
  const spots = (pack.spots || []).filter(
    (s) => !SKIP_NAME_RE.test(`${s.id || ''} ${s.name || ''}`),
  );
  let story = 0;
  let storyFootFail = 0;
  let building = 0;
  let footFail = 0;
  let bulletFail = 0;
  const footFails = [];
  const bulletFails = [];

  for (const spot of spots) {
    const st = isStory(spot);
    if (st) story += 1;
    if (!isMapPoint(spot)) building += 1;

    const fp = footprintOk(spot);
    if (!fp.ok) {
      footFail += 1;
      if (st) storyFootFail += 1;
      if (footFails.length < 25) {
        footFails.push({ id: spot.id, name: spot.name, reason: fp.reason });
      }
    }

    const bu = bulletsOk(spot);
    if (!bu.ok) {
      bulletFail += 1;
      if (bulletFails.length < 25) {
        bulletFails.push({ id: spot.id, name: spot.name, reason: bu.reason });
      }
    }
  }

  const storyFootRate = story ? 1 - storyFootFail / story : 1;
  const buildingFootRate = building ? 1 - footFail / Math.max(building, 1) : 1;
  const bulletRate = spots.length ? 1 - bulletFail / spots.length : 1;

  // Soft: 90% buildings with footprint, 80% bullets, stories 90%
  // Strict: 95% / 92% / 98%
  const thr = strict
    ? { story: 0.98, building: 0.95, bullet: 0.92 }
    : { story: 0.9, building: 0.78, bullet: 0.8 };

  const errors = [];
  if (storyFootRate < thr.story) {
    errors.push(
      `story footprints ${(storyFootRate * 100).toFixed(1)}% < ${thr.story * 100}% (${storyFootFail}/${story})`,
    );
  }
  if (buildingFootRate < thr.building) {
    errors.push(
      `building footprints ${(buildingFootRate * 100).toFixed(1)}% < ${thr.building * 100}% (${footFail}/${building})`,
    );
  }
  if (bulletRate < thr.bullet) {
    errors.push(
      `bullets ${(bulletRate * 100).toFixed(1)}% < ${thr.bullet * 100}% (${bulletFail}/${spots.length})`,
    );
  }

  const report = {
    cityId,
    strict,
    ok: errors.length === 0,
    counts: {
      spots: spots.length,
      story,
      building,
      storyFootFail,
      footFail,
      bulletFail,
    },
    rates: {
      storyFoot: storyFootRate,
      buildingFoot: buildingFootRate,
      bullet: bulletRate,
    },
    errors,
    footFails,
    bulletFails,
  };

  console.log(
    `[map-perfect-gate] ${cityId} ${report.ok ? 'OK' : 'FAIL'} · spots=${spots.length} story=${story} footFail=${footFail} bulletFail=${bulletFail}`,
  );
  for (const e of errors) console.error(`  ✗ ${e}`);
  if (!report.ok && footFails.length) {
    console.error('  footprint samples:', JSON.stringify(footFails.slice(0, 8)));
  }
  if (!report.ok && bulletFails.length) {
    console.error('  bullet samples:', JSON.stringify(bulletFails.slice(0, 8)));
  }
  return report;
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/mapPerfectGate.mjs --city <id> [--strict]');
    process.exit(1);
  }
  const report = runMapPerfectGate(cityId, { strict: hasFlag('strict') });
  if (!report.ok) process.exitCode = 1;
}

const isDirect = process.argv[1]?.replace(/\\/g, '/').endsWith('mapPerfectGate.mjs');
if (isDirect) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
