#!/usr/bin/env node
/**
 * City-pack GPS QA — flag POIs whose pack coords look wrong vs OSM/Nominatim
 * or city bounds / house-like mismatches.
 *
 * Does NOT invent or auto-apply coordinates (report only). Prefer
 * `city:audit-entrances` (Google) or manual OSM fixes after review.
 *
 * Usage:
 *   npm run city:gps-qa -- --city prisdorf
 *   npm run city:gps-qa -- --city prisdorf --max-delta 180 --story-only
 *   npm run city:gps-qa -- --all --story-only
 *   npm run city:gps-qa -- --city berlin --limit 40
 *
 * Report: data/staedte/<id>.gps_qa.json (+ console summary)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  STAEDTE_DIR,
  arg,
  centroid,
  distM,
  hasFlag,
  loadPack,
  sleep,
  writeJson,
} from './lib.mjs';

const UA = 'FindusCityPackGpsQA/1.0 (https://findus.app; pack-qa)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

function packCenter(spot, trigger) {
  const c = centroid(spot.polygonCoordinates || spot.polygon);
  if (c) return c;
  if (trigger && typeof trigger.lat === 'number') {
    return { lat: trigger.lat, lng: trigger.lng };
  }
  const sub = (spot.sub_pois || spot.subPois || []).find(
    (s) => typeof s.lat === 'number' && typeof s.lng === 'number',
  );
  if (sub) return { lat: sub.lat, lng: sub.lng };
  return null;
}

function isStoryish(spot) {
  if (amenitySkip(spot) && !isMustHaveTag(spot)) return false;
  const role = String(spot.pack_role || '').toLowerCase();
  if (role === 'story') return true;
  const tags = (spot.tags || []).map(String);
  if (tags.some((t) => /^(must_have|landmark|tier1)$/i.test(t))) return true;
  const tier = Number(spot.place_tier);
  return Number.isFinite(tier) && tier <= 2 && role !== 'directory';
}

function isMustHaveTag(spot) {
  return (spot.tags || []).some((t) =>
    /^(must_have|must-see|landmark)$/i.test(String(t)),
  );
}

/** Shorten long pack names so Nominatim can match. */
function queryVariants(spot, cityName) {
  const raw = String(spot.name || '').trim();
  const city = cityName || '';
  const short = raw
    .split(/\s+[–—\-|&]\s+/)[0]
    .split(/\s+mit\s+/i)[0]
    .split(/\s+und\s+/i)[0]
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = short.split(' ').filter(Boolean);
  const compact = words.slice(0, 5).join(' ');
  const out = [];
  const push = (q) => {
    if (q && !out.includes(q)) out.push(q);
  };
  push(`${compact}, ${city}, Germany`);
  push(`${short}, ${city}`);
  if (words.length > 2) push(`${words.slice(0, 3).join(' ')}, ${city}, Germany`);
  // Prefer known brand/place tokens over "Alte"/generic prefixes
  if (/kindergarten|lütt|luett|schule/i.test(raw)) {
    const kit = raw.match(/Lütte\s+\w+|Kindergarten\s+\w+/i)?.[0];
    if (kit) push(`${kit}, ${city}, Germany`);
  }
  if (/tennis/i.test(raw)) {
    push(`Tennisplatz, ${city}, Germany`);
    push(`Ahrenloher Weg 5, ${city}, Germany`);
  }
  if (/niederung|fluss|bach|ufer|pinnau|bilsbek/i.test(raw)) {
    if (/pinnau/i.test(raw)) push(`Pinnau, ${city}, Germany`);
    if (/bilsbek/i.test(raw)) push(`Bilsbek, ${city}, Germany`);
    push(`${words[0]}, ${city}, Germany`);
  }
  if (/kitz|jungtier/i.test(raw)) {
    push(`Peiner Hof, ${city}, Germany`);
    push(`Golf-Park Peiner Hof, ${city}, Germany`);
  }
  return out;
}

function amenitySkip(spot) {
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase());
  return (
    tags.includes('amenity_skip') ||
    tags.includes('directory') ||
    Number(spot.place_tier) === 4 ||
    String(spot.pack_role || '').toLowerCase() === 'directory'
  );
}

async function nominatimSearch(query, { near, viewbox } = {}) {
  const u = new URL(NOMINATIM);
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', '3');
  u.searchParams.set('countrycodes', 'de');
  u.searchParams.set('addressdetails', '1');
  if (near) {
    // Prefer results near pack center
    const d = 0.08;
    u.searchParams.set(
      'viewbox',
      `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`,
    );
    u.searchParams.set('bounded', '0');
  }
  if (viewbox) {
    u.searchParams.set('viewbox', viewbox);
    u.searchParams.set('bounded', '1');
  }
  await sleep(1100); // Nominatim usage policy
  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const top = data[0];
  return {
    lat: Number(top.lat),
    lng: Number(top.lon),
    display_name: top.display_name,
    class: top.class,
    type: top.type,
    importance: top.importance,
    osm_type: top.osm_type,
    osm_id: top.osm_id,
    provider: 'nominatim',
  };
}

/** Photon fallback (Komoot) — no strict rate limit; still be polite. */
async function photonSearch(query, near) {
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', query);
  u.searchParams.set('limit', '3');
  u.searchParams.set('lang', 'de');
  if (near) {
    u.searchParams.set('lat', String(near.lat));
    u.searchParams.set('lon', String(near.lng));
  }
  await sleep(250);
  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = await res.json();
  const f = data?.features?.[0];
  if (!f?.geometry?.coordinates) return null;
  const [lng, lat] = f.geometry.coordinates;
  const p = f.properties || {};
  return {
    lat: Number(lat),
    lng: Number(lng),
    display_name: [p.name, p.street, p.city || p.county, p.country]
      .filter(Boolean)
      .join(', '),
    class: p.osm_key || p.type,
    type: p.osm_value || p.type,
    provider: 'photon',
  };
}

async function resolveOsm(query, near) {
  const tryOne = async (fn) => {
    const hit = await fn();
    if (!hit) return null;
    // City centroid / admin boundary is not a POI match
    if (hit.class === 'boundary' || hit.type === 'administrative') return null;
    if (
      near &&
      Number.isFinite(near.lat) &&
      distM(hit, near) < 40 &&
      /^(Prisdorf|Berlin|Hamburg)\b/i.test(String(hit.display_name || ''))
    ) {
      return null;
    }
    return hit;
  };
  return (
    (await tryOne(() => nominatimSearch(query, { near }))) ||
    (await tryOne(() => photonSearch(query, near)))
  );
}

function cityBoundsRadiusM(pack) {
  // Soft city halo: small towns ~4 km, big metros ~25 km
  const n = (pack.spots || []).length;
  if (n > 200) return 28_000;
  if (n > 80) return 12_000;
  return 5_500;
}

function houseLikeMismatch(osm, spot) {
  if (!osm) return false;
  const house =
    osm.class === 'building' ||
    osm.type === 'house' ||
    osm.type === 'residential' ||
    /Wohn|House|Haus\b/i.test(osm.display_name || '');
  if (!house) return false;
  const blob = `${spot.name} ${spot.category || ''} ${(spot.tags || []).join(' ')}`.toLowerCase();
  const nature =
    /niederung|fluss|bach|pinnau|bilsbek|ufer|natur|wald|teich|aussicht|brücke|eisenbahn|sport|tennis|park|feld/.test(
      blob,
    );
  return nature;
}

function resolveCityIds() {
  if (hasFlag('all')) {
    return fs
      .readdirSync(STAEDTE_DIR)
      .filter((f) => /^[a-z0-9_-]+\.json$/i.test(f))
      .map((f) => f.replace(/\.json$/i, ''))
      .filter((id) => {
        // only real packs (have city_id / spots)
        try {
          const p = loadPack(id);
          return p && Array.isArray(p.spots) && (p.city_id || p.id);
        } catch {
          return false;
        }
      });
  }
  const city = arg('city');
  if (!city) {
    console.error(
      'Usage: node scripts/cityPack/auditGpsQa.mjs --city <id> | --all [--story-only] [--max-delta 150] [--limit N]',
    );
    process.exit(1);
  }
  return [city];
}

async function auditCity(cityId, opts) {
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);
  const near = {
    lat: Number(pack.lat) || Number(pack.center_lat) || null,
    lng: Number(pack.lng) || Number(pack.center_lng) || null,
  };
  if (!Number.isFinite(near.lat) || !Number.isFinite(near.lng)) {
    const first = (pack.spots || [])
      .map((s) => packCenter(s, null))
      .find((c) => c);
    if (first) {
      near.lat = first.lat;
      near.lng = first.lng;
    }
  }
  const maxDelta = opts.maxDelta;
  const halo = cityBoundsRadiusM(pack);
  const rows = [];
  let spots = pack.spots || [];
  if (opts.ids?.size) {
    spots = spots.filter((s) => opts.ids.has(s.id));
  }
  if (opts.storyOnly) spots = spots.filter(isStoryish);
  if (opts.limit > 0) spots = spots.slice(0, opts.limit);

  for (const spot of spots) {
    const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
    const before = packCenter(spot, trigger);
    const flags = [];
    if (!before) {
      rows.push({
        id: spot.id,
        name: spot.name,
        status: 'NO_PACK_CENTER',
        flags: ['missing_coords'],
      });
      continue;
    }

    const fromCity =
      Number.isFinite(near.lat) && Number.isFinite(near.lng)
        ? Math.round(distM(before, near))
        : null;
    if (fromCity != null && fromCity > halo) {
      flags.push('outside_city_halo');
    }

    // Name-matched Nominatim (city-biased) — try shortened variants
    let osm = null;
    let usedQuery = null;
    try {
      for (const q of queryVariants(spot, pack.name || cityId)) {
        osm = await resolveOsm(q, near);
        usedQuery = q;
        if (osm) break;
      }
    } catch (e) {
      rows.push({
        id: spot.id,
        name: spot.name,
        before,
        status: 'NOMINATIM_ERROR',
        error: e.message,
        flags,
      });
      continue;
    }

    let delta = null;
    if (osm) {
      delta = Math.round(distM(before, osm));
      const osmFromCity =
        Number.isFinite(near.lat) && Number.isFinite(near.lng)
          ? Math.round(distM(osm, near))
          : null;
      if (delta > maxDelta) {
        if (osmFromCity != null && osmFromCity > halo) {
          // Name matched something outside the city — pack pin may still be fine
          flags.push('osm_match_outside_city');
        } else if (houseLikeMismatch(osm, spot)) {
          // Street/house hit for a nature/landmark story → review, not auto-BAD
          flags.push('house_like_name_match');
        } else {
          flags.push('far_from_name_match');
        }
      } else if (houseLikeMismatch(osm, spot) && delta > 80) {
        flags.push('house_like_name_match');
      }
    } else {
      flags.push('no_geocode_hit');
    }

    // Duplicate centers (same ~15 m as another story)
    const twins = (pack.spots || []).filter((o) => {
      if (o.id === spot.id) return false;
      const oc = packCenter(
        o,
        (pack.trigger_points || []).find((t) => t.id === o.id),
      );
      if (!oc) return false;
      return distM(before, oc) < 15;
    });
    if (twins.length) {
      flags.push('duplicate_center');
    }

    let status = 'OK';
    if (
      flags.includes('far_from_name_match') ||
      flags.includes('outside_city_halo')
    ) {
      status = 'BAD';
    } else if (
      flags.includes('house_like_name_match') ||
      flags.includes('duplicate_center') ||
      flags.includes('no_geocode_hit') ||
      flags.includes('osm_match_outside_city')
    ) {
      status = 'CHECK';
    } else if (delta != null && delta > Math.min(60, maxDelta * 0.45)) {
      status = 'CHECK';
      flags.push('moderate_delta');
    }

    rows.push({
      id: spot.id,
      name: spot.name,
      category: spot.category,
      place_tier: spot.place_tier,
      pack_role: spot.pack_role,
      amenity_skip: amenitySkip(spot),
      before,
      query: usedQuery,
      osm,
      delta_m: delta,
      from_city_m: fromCity,
      status,
      flags,
      twins: twins.map((t) => t.id),
    });
  }

  const summary = {
    city_id: pack.city_id || cityId,
    checked: rows.length,
    ok: rows.filter((r) => r.status === 'OK').length,
    check: rows.filter((r) => r.status === 'CHECK').length,
    bad: rows.filter((r) => r.status === 'BAD').length,
    errors: rows.filter((r) => r.status === 'NOMINATIM_ERROR' || r.status === 'NO_PACK_CENTER')
      .length,
    max_delta_m: maxDelta,
    city_halo_m: halo,
    story_only: opts.storyOnly,
  };

  const outFile = path.join(STAEDTE_DIR, `${cityId}.gps_qa.json`);
  writeJson(outFile, {
    generated_at: new Date().toISOString(),
    summary,
    rows: rows.sort((a, b) => {
      const rank = { BAD: 0, CHECK: 1, NOMINATIM_ERROR: 2, NO_PACK_CENTER: 3, OK: 4 };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (b.delta_m || 0) - (a.delta_m || 0);
    }),
  });

  console.log(
    `\n[${cityId}] checked=${summary.checked} OK=${summary.ok} CHECK=${summary.check} BAD=${summary.bad} → ${outFile}`,
  );
  for (const r of rows.filter((x) => x.status === 'BAD' || x.status === 'CHECK').slice(0, 25)) {
    console.log(
      `  ${r.status} Δ=${r.delta_m ?? '?'}m city=${r.from_city_m ?? '?'}m ${r.id} — ${(r.flags || []).join(',')}`,
    );
  }
  return summary;
}

async function main() {
  const idsRaw = arg('ids');
  const opts = {
    maxDelta: Number(arg('max-delta') || 150),
    storyOnly: hasFlag('story-only'),
    limit: Number(arg('limit') || 0),
    ids: idsRaw
      ? new Set(
          String(idsRaw)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : null,
  };
  const ids = resolveCityIds();
  const summaries = [];
  for (const id of ids) {
    summaries.push(await auditCity(id, opts));
  }
  if (summaries.length > 1) {
    console.log('\n=== bulk ===');
    for (const s of summaries) {
      console.log(
        `${s.city_id}: bad=${s.bad} check=${s.check} ok=${s.ok}/${s.checked}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
