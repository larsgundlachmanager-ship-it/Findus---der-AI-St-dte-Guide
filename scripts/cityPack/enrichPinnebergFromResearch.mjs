#!/usr/bin/env node
/**
 * Enrich Pinneberg from research JSON + Google Maps discovery.
 *
 *   node scripts/cityPack/enrichPinnebergFromResearch.mjs
 *   node scripts/cityPack/enrichPinnebergFromResearch.mjs --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  STAEDTE_DIR,
  arg,
  boxPolygon,
  defaultLiveResearch,
  distM,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
  slugify,
  writeJson,
} from './lib.mjs';
import { requireGoogleKey, resolvePlace, streetViewMeta } from './google.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function approachesFromHints(lat, lng, spotId, name, hints = []) {
  if (!hints.length) {
    const a = offset(lat, lng, 45, 0);
    const b = offset(lat, lng, -28, 18);
    return [
      {
        id: `${spotId}_approach_far`,
        lat: a.lat,
        lng: a.lng,
        radius_m: 36,
        teaser_text: `Wenn du dich näherst: ${name} liegt voraus — Ziel ist der Haupteingang.`,
        condition_rule: 'always',
      },
      {
        id: `${spotId}_approach_near`,
        lat: b.lat,
        lng: b.lng,
        radius_m: 18,
        teaser_text: `Gleich da: der Eingang von ${name}.`,
        condition_rule: 'always',
      },
    ];
  }
  return hints.map((h, i) => {
    // Place approach roughly "south" of entrance by meters (synthetic bearing)
    const p = offset(lat, lng, -(Number(h.meters) || 40), i * 8);
    return {
      id: `${spotId}_approach_${i + 1}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: Math.min(40, Math.max(12, Math.round((Number(h.meters) || 40) * 0.35))),
      teaser_text: h.teaser,
      condition_rule: 'always',
    };
  });
}

function upsertSpot(pack, payload, geo) {
  const id =
    payload.id ||
    `${pack.city_id}_${slugify(payload.name)}`.slice(0, 80);
  let spot = pack.spots.find((s) => s.id === id);
  let trigger = pack.trigger_points.find((t) => t.id === id);
  const half =
    payload.category === 'bahnhof' || /park|wald|bad/i.test(payload.name)
      ? 45
      : 26;

  if (!spot) {
    spot = {
      id,
      name: payload.name,
      district: payload.category || 'ort',
      category: payload.category || 'ort',
      tags: [payload.category || 'ort', 'module1', 'master_report'],
      bullets: [],
      facts: { tags: [] },
      polygonCoordinates: [],
      approach_triggers: [],
      sub_pois: [],
    };
    pack.spots.push(spot);
  }
  if (!trigger) {
    trigger = {
      id,
      name: payload.name,
      lat: geo.lat,
      lng: geo.lng,
      radius_m: half,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }

  spot.name = payload.name || spot.name;
  if (payload.category) spot.category = payload.category;
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      ...(payload.facts?.tags || []),
      spot.category,
      'master_report',
      'research_2026',
    ]),
  ];
  if (payload.facts) {
    spot.facts = { ...(spot.facts || {}), ...payload.facts };
  }
  if (payload.bullets?.length) {
    spot.bullets = [
      ...new Set([...(spot.bullets || []), ...payload.bullets]),
    ];
  }

  trigger.lat = geo.lat;
  trigger.lng = geo.lng;
  trigger.radius_m = half;
  trigger.trigger_kind = 'area';
  trigger.trigger_type = 'polygon';
  spot.polygonCoordinates = boxPolygon(geo.lat, geo.lng, half);
  trigger.polygon = spot.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));

  if (payload.general_info) trigger.general_info = payload.general_info;

  const pool = [];
  const push = (text, tags) => {
    if (!text || text.length < 15) return;
    const key = text.toLowerCase().slice(0, 70);
    if (pool.some((e) => e.text.toLowerCase().slice(0, 70) === key)) return;
    pool.push({ text, tags: tags || ['master_report'] });
  };
  for (const e of trigger.deep_data_pool || []) {
    if (typeof e === 'string') push(e, ['legacy']);
    else push(e.text, e.tags);
  }
  for (const e of payload.deep_data_pool || []) {
    if (typeof e === 'string') push(e, ['master_report']);
    else push(e.text, e.tags || ['master_report']);
  }
  for (const f of payload.faqs || []) {
    push(
      `User-Frage: ${f.q} Antwort: ${f.a}`,
      ['faq', 'user_question', 'tiefenwissen', 'master_report'],
    );
  }
  push(
    `GPS-Eingang (Google Maps Pin): ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)}${geo.address ? ` — ${geo.address}` : ''}.`,
    ['gps_confirmed', 'sourced_google', 'orientierung'],
  );
  trigger.deep_data_pool = pool;

  spot.approach_triggers = approachesFromHints(
    geo.lat,
    geo.lng,
    id,
    spot.name,
    payload.approach_hints,
  );
  spot.sub_pois = [
    {
      id: `${id}_sub_eingang`,
      name: `${spot.name} · Haupteingang`,
      lat: geo.lat,
      lng: geo.lng,
      radius_m: 10,
      fact_details:
        'Haupteingang / Google-Maps-Navigationspin — Area-Trigger-Zentrum.',
      tags: ['sub_poi', 'eingang', 'gps_entrance'],
    },
  ];

  return { id, geo };
}

async function main() {
  requireGoogleKey();
  const apply = hasFlag('apply') || !hasFlag('dry');
  const researchPath =
    arg('file') ||
    path.join(STAEDTE_DIR, 'pinneberg.research.json');
  const research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
  let pack = loadPack('pinneberg');
  if (!pack) throw new Error('pinneberg pack missing');

  pack.name = 'Pinneberg';
  pack.symbol = pack.symbol || '🌳';
  // cover Thesdorf + center
  pack._coverage = {
    latMin: 53.62,
    latMax: 53.69,
    lngMin: 9.74,
    lngMax: 9.86,
  };
  pack._live_research =
    research.live_research?.length
      ? research.live_research
      : defaultLiveResearch('Pinneberg');
  pack._links = research.links || pack._links || [];
  pack._transit = {
    provider: 'db_rest',
    default_ibnr: '8004812',
    hafas_base_url: 'https://v6.db.transport.rest',
    stops: [
      {
        id: 'pinneberg_hbf',
        name: 'Pinneberg',
        lat: pack.lat || 53.6549,
        lng: pack.lng || 9.7989,
        ibnr: '8004812',
        mode: 'rail',
      },
    ],
  };
  pack.district_division = [
    'Zentrum_Dingstaette',
    'Bahnhof',
    'Thesdorf',
    'Nord_Wupperman',
    'Waldenau',
    'ILO_Park',
  ];

  const near = { lat: pack.lat || 53.661, lng: pack.lng || 9.797 };
  const report = { updated: [], created: [], failed: [], google: [] };

  // City history as spot
  if (research.city_history) {
    const hist = {
      id: 'pinneberg_stadtgeschichte',
      name: 'Pinneberg Stadtgeschichte & Orientierung',
      category: 'geschichte',
      general_info: research.spots?.find((s) => s.id === 'pinneberg_stadtgeschichte')
        ?.general_info,
      facts: research.spots?.find((s) => s.id === 'pinneberg_stadtgeschichte')
        ?.facts,
      bullets: research.spots?.find((s) => s.id === 'pinneberg_stadtgeschichte')
        ?.bullets,
      deep_data_pool: [
        {
          text: research.city_history,
          tags: ['geschichte', 'heute', 'master_report', 'city_welcome'],
        },
        ...(research.spots?.find((s) => s.id === 'pinneberg_stadtgeschichte')
          ?.deep_data_pool || []),
      ],
      faqs:
        research.spots?.find((s) => s.id === 'pinneberg_stadtgeschichte')
          ?.faqs || [],
    };
    const geo = {
      lat: 53.661,
      lng: 9.7966,
      address: 'Dingstätte / Zentrum Pinneberg',
    };
    const before = pack.spots.some((s) => s.id === hist.id);
    upsertSpot(pack, hist, geo);
    report[before ? 'updated' : 'created'].push(hist.id);
  }

  const all = [
    ...(research.spots || []).filter((s) => s.id !== 'pinneberg_stadtgeschichte'),
    ...(research.new_places || []),
  ];

  for (const item of all) {
    const query =
      item.query ||
      `${item.name}, Pinneberg, Germany`;
    console.log(`[pin] resolve ${query}`);
    let geo = null;
    try {
      geo = await resolvePlace(query, {
        near,
        preferTypes:
          item.category === 'bahnhof'
            ? ['train_station', 'transit_station', 'subway_station']
            : item.category === 'kirche'
              ? ['church', 'place_of_worship']
              : item.category === 'gesundheit'
                ? ['hospital', 'doctor']
                : ['point_of_interest', 'establishment', 'park', 'museum'],
      });
    } catch (e) {
      report.failed.push({ name: item.name, error: e.message });
      continue;
    }
    if (!geo) {
      report.failed.push({ name: item.name, error: 'NO_GOOGLE' });
      continue;
    }
    // Keep inside greater Pinneberg
    if (distM(near, geo) > 12000) {
      report.failed.push({
        name: item.name,
        error: `TOO_FAR ${Math.round(distM(near, geo))}m`,
        geo,
      });
      continue;
    }
    report.google.push({
      name: item.name,
      lat: geo.lat,
      lng: geo.lng,
      address: geo.address,
      place_id: geo.place_id,
    });
    const existed = pack.spots.some(
      (s) =>
        s.id === item.id ||
        s.name.toLowerCase() === String(item.name).toLowerCase(),
    );
    const r = upsertSpot(pack, item, geo);
    report[existed ? 'updated' : 'created'].push(r.id);

    // Street View soft check on first approach
    const ap0 = pack.spots.find((s) => s.id === r.id)?.approach_triggers?.[0];
    if (ap0) {
      try {
        const sv = await streetViewMeta(ap0.lat, ap0.lng);
        ap0.streetview_ok = sv.status === 'OK';
      } catch {
        /* ignore */
      }
    }
  }

  // Enrich Thesdorf stop coords into transit if present
  const thesdorf = pack.spots.find((s) =>
    /thesdorf/i.test(s.id + s.name),
  );
  const thT = pack.trigger_points.find((t) => t.id === thesdorf?.id);
  if (thT && pack._transit) {
    pack._transit.stops = pack._transit.stops || [];
    if (!pack._transit.stops.some((s) => s.id === 'pinneberg_thesdorf')) {
      pack._transit.stops.push({
        id: 'pinneberg_thesdorf',
        name: 'Pinneberg-Thesdorf',
        lat: thT.lat,
        lng: thT.lng,
        mode: 'rail',
      });
    }
    // update main stop coords from bahnhof spot
    const bahn = pack.trigger_points.find((t) => t.id === 'pinneberg_bahnhof_pr');
    if (bahn) {
      const s0 = pack._transit.stops.find((s) => s.id === 'pinneberg_hbf');
      if (s0) {
        s0.lat = bahn.lat;
        s0.lng = bahn.lng;
      }
    }
  }

  // Strip streetview flags
  for (const s of pack.spots) {
    for (const a of s.approach_triggers || []) delete a.streetview_ok;
  }

  const gate = runQualityGate(pack, { strict: false });
  writeJson(path.join(STAEDTE_DIR, 'pinneberg.enrich_report.json'), {
    report,
    gate,
  });

  console.log(
    `[pin] created=${report.created.length} updated=${report.updated.length} failed=${report.failed.length}`,
  );
  if (report.failed.length) console.log('[pin] failed', report.failed);
  console.log(
    `[pin] gate ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length} spots=${pack.spots.length} missingCats=${gate.gaps.missingCategories}`,
  );

  if (apply) {
    const file = savePack(pack, { bumpVersion: true });
    console.log(`[pin] wrote ${file} v${pack.data_version}`);
  } else {
    console.log('[pin] dry-run — pass --apply to write');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
