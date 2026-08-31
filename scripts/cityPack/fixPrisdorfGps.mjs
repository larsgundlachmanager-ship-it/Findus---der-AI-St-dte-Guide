#!/usr/bin/env node
/**
 * Manual GPS corrections for known-bad Prisdorf pins (OSM + Google Geocode/Places).
 *
 * Why pins drift: gps-wegweiser / snapOsmStoryFootprints can snap a story to the
 * wrong nearby OSM building (e.g. Eisenbahnbrücke → Gemeindezentrum, Kita → Teich).
 * Directory geocodes sometimes hit the wrong street (Marktkauf → Pinneberg-lng).
 *
 *   node scripts/cityPack/fixPrisdorfGps.mjs
 *   node scripts/cityPack/fixPrisdorfGps.mjs --dry
 */
import {
  boxPolygon,
  distM,
  hasFlag,
  loadPack,
  offset,
  savePack,
} from './lib.mjs';

const FIXES = [
  // Kita-Pin: SSOT in fixPrisdorfOsmPins.mjs (Google Place + OSM way 80253967)
  {
    id: 'prisdorf_alte_schule_lütte_prisdörper',
    // Google Place „Kita Lütte Prisdörper“ (maps.app.goo.gl/LoC6cG3g2LZuK2X29)
    lat: 53.6771732,
    lng: 9.7577021,
    halfM: 22,
    source: 'google_maps:Kita Lütte Prisdörper (LoC6cG3g2LZuK2X29)',
    note: 'Google Place-Pin — OSM-Footprint/Centroid darf das nicht überschreiben',
  },
  {
    id: 'prisdorf_gemeindezentrum_hudenbarg',
    lat: 53.6774,
    lng: 9.7574,
    halfM: 70,
    source: 'pack:Hudenbarg Ensemble (Kita+Turnhalle+Feuerwache)',
    note: 'Ensemble-Zentrum — nicht Unterführung',
  },
  {
    id: 'prisdorf_freiwillige_feuerwehr',
    lat: 53.677597,
    lng: 9.757233,
    halfM: 25,
    source: 'osm:way/80253965 Freiwillige Feuerwehr',
    note: 'Feuerwache Hudenbarg 5',
  },
  {
    id: 'prisdorf_bilsbekraum',
    lat: 53.67735,
    lng: 9.75735,
    halfM: 20,
    source: 'pack:Bilsbekraum im Gemeindezentrum Hudenbarg',
    note: 'War am Bahnhof — gehört ins Dorfzentrum',
  },
  {
    id: 'prisdorf_bilsbek_fluss',
    // User GPS pin — Bilsbek durch Prisdorf
    lat: 53.680089,
    lng: 9.756544,
    halfM: 40,
    source: 'user_gps:53.680089,9.756544',
    note: 'User-Pin Bilsbek durch Prisdorf',
  },
  {
    id: 'prisdorf_kriegerehrenmal_bilsbek',
    lat: 53.679952,
    lng: 9.75705,
    halfM: 18,
    source: 'user_gps:53.679952,9.757050',
    note: 'User-Pin Kriegerdenkmal / Ehrenmal Bilsbekbrücke',
  },
  {
    id: 'prisdorf_pinnau_ufer',
    lat: 53.666844,
    lng: 9.766679,
    halfM: 55,
    source: 'nominatim:Pinnau waterway south Gemeindegrenze',
    note: 'War auf Heimatverein/Dorfkern — Pinnau liegt südlich',
  },
  {
    id: 'prisdorf_bahnhof_wartehäuschen',
    lat: 53.675269,
    lng: 9.76026,
    halfM: 45,
    source: 'user:53.675269,9.760260 Haltepunkt Prisdorf',
    note: 'Haltepunkt-Pin User-Fix; Wartehäuschen ist eigener Spot',
    subFixes: [],
  },
  {
    id: 'prisdorf_bahnwartehaeuschen',
    lat: 53.675147,
    lng: 9.760333,
    halfM: 10,
    source: 'user:53.675147,9.760333 Wartehäuschen-Gebäude',
    note: 'Fachwerk-Gebäude am Gleis (nicht Haltepunkt-Mitte)',
  },
  {
    id: 'prisdorf_peiner_hof',
    lat: 53.669089,
    lng: 9.765418,
    halfM: 55,
    source: 'google:Peiner Hof 7, 25497 Prisdorf',
    note: 'Golf/Restaurant-Zufahrt Peiner Hof 7',
  },
  {
    id: 'prisdorf_fairway_hotel',
    lat: 53.668906,
    lng: 9.766119,
    halfM: 25,
    source: 'google:Fairway Hotel Peiner Hof',
    note: 'Hotel-Pin getrennt vom Golf-Zufahrts-Centroid',
  },
  {
    id: 'prisdorf_marktkauf_meyers_frischecenter',
    lat: 53.672139,
    lng: 9.773197,
    halfM: 45,
    source: 'google:Meyers Frischecenter Peiner Hag 1 + osm supermarket',
    note: 'War ~1,2 km zu weit ost (lng 9.79) — Center Peiner Hag 1',
  },
  {
    id: 'prisdorf_team_tankstelle',
    lat: 53.673019,
    lng: 9.772252,
    halfM: 20,
    source: 'google+photon:team Peiner Hag 1a',
    note: 'Tankstelle 1a',
  },
  {
    id: 'prisdorf_tcp_tennis',
    lat: 53.683158,
    lng: 9.751320,
    halfM: 40,
    source: 'google:Ahrenloher Weg 5, 25497 Prisdorf',
    note: 'Navigationspin Hausnummer 5',
    promoteStory: true,
  },
  {
    id: 'prisdorf_kitz_jungtierrettung',
    lat: 53.666972,
    lng: 9.772663,
    halfM: 35,
    source: 'nominatim:Golf-Park Peiner Hof + Verein Peiner Hof 7',
    note: 'Verein am Golfpark',
  },
];

const ATM_SPOT = {
  id: 'prisdorf_sparkasse_geldautomat_meyers',
  name: 'Sparkasse Südholstein Geldautomat Meyers Frischecenter',
  category: 'bank',
  lat: 53.672128,
  lng: 9.773201,
  source: 'google_places:Sparkasse Südholstein Geldautomat Peiner Hag 1',
};

/** Google Place P+R Parkplatz Bahnhof — maps.app.goo.gl/zfYe3Cr6Z5PvmvbX8 */
const PR_SPOT = {
  id: 'prisdorf_pr_parkplatz_bahnhof',
  name: 'P+R Parkplatz Bahnhof Prisdorf',
  category: 'parking',
  lat: 53.675109,
  lng: 9.7609606,
  source: 'google_maps:P+R Parkplatz (zfYe3Cr6Z5PvmvbX8)',
};

function rebuildApproaches(spot, lat, lng, oldCenter) {
  const existing = spot.approach_triggers || spot.approachTriggers || [];
  if (existing.length >= 1 && oldCenter) {
    return existing.map((a) => {
      const dNorth = ((a.lat ?? a.latitude) - oldCenter.lat) * 111320;
      const dEast =
        ((a.lng ?? a.longitude) - oldCenter.lng) *
        (111320 * Math.cos((oldCenter.lat * Math.PI) / 180));
      const p = offset(lat, lng, dNorth, dEast);
      return { ...a, lat: p.lat, lng: p.lng };
    });
  }
  const a = offset(lat, lng, 40, 0);
  const b = offset(lat, lng, -35, 12);
  return [
    {
      id: `${spot.id}_approach_n`,
      lat: a.lat,
      lng: a.lng,
      radius_m: 32,
      teaser_text:
        existing[0]?.teaser_text ||
        `Kurz vorher: ${spot.name} liegt voraus.`,
      condition_rule: 'always',
    },
    {
      id: `${spot.id}_approach_s`,
      lat: b.lat,
      lng: b.lng,
      radius_m: 24,
      teaser_text:
        existing[1]?.teaser_text ||
        `Von dieser Seite: geh auf ${spot.name} zu.`,
      condition_rule: 'always',
    },
  ];
}

function packCenter(spot, trigger) {
  const poly = spot.polygonCoordinates || spot.polygon;
  if (poly?.length) {
    return {
      lat: poly.reduce((s, p) => s + (p.latitude ?? p.lat), 0) / poly.length,
      lng: poly.reduce((s, p) => s + (p.longitude ?? p.lng), 0) / poly.length,
    };
  }
  if (trigger && typeof trigger.lat === 'number') {
    return { lat: trigger.lat, lng: trigger.lng };
  }
  return null;
}

function promoteTcp(spot) {
  spot.pack_role = 'story';
  spot.place_tier = 2;
  const drop = new Set([
    'amenity_skip',
    'directory',
    'offline_lookup',
    'tier4',
  ]);
  const tags = (spot.tags || []).filter((t) => !drop.has(String(t)));
  for (const t of ['module1', 'tier2', 'story', 'freizeit', 'sport']) {
    if (!tags.includes(t)) tags.push(t);
  }
  spot.tags = tags;
}

function applyFix(pack, fix) {
  const spot = (pack.spots || []).find((s) => s.id === fix.id);
  if (!spot) return { id: fix.id, status: 'MISSING_SPOT' };
  const trigger = (pack.trigger_points || []).find((t) => t.id === fix.id);
  const before = packCenter(spot, trigger);
  const delta = before
    ? Math.round(distM(before, { lat: fix.lat, lng: fix.lng }))
    : null;

  if (fix.promoteStory) promoteTcp(spot);

  spot.polygonCoordinates = boxPolygon(fix.lat, fix.lng, fix.halfM);
  const remapApproaches = !(delta != null && delta > 250);
  spot.approach_triggers = rebuildApproaches(
    spot,
    fix.lat,
    fix.lng,
    remapApproaches ? before : null,
  );
  spot.tags = (spot.tags || []).filter(
    (t) => t !== 'sourced_osm' && t !== 'map_outline',
  );
  spot.tags = [...new Set([...(spot.tags || []), 'gps_manual_fix'])];

  const subs = spot.sub_pois || spot.subPois || [];
  let nextSubs = [
    {
      id: `${spot.id}_sub_eingang`,
      name: `${spot.name} · Haupteingang`,
      lat: fix.lat,
      lng: fix.lng,
      radius_m: 10,
      fact_details: `GPS-Korrektur (${fix.source}).`,
      tags: ['sub_poi', 'eingang', 'gps_entrance', 'sourced_osm'],
    },
    ...subs.filter((s) => !String(s.id || '').includes('eingang')),
  ];
  for (const sf of fix.subFixes || []) {
    nextSubs = nextSubs.map((s) => {
      if (!String(s.id || '').includes(sf.idIncludes)) return s;
      return {
        ...s,
        lat: sf.lat,
        lng: sf.lng,
        fact_details: `GPS-Korrektur Sub (${sf.source}).`,
        tags: [...new Set([...(s.tags || []), 'gps_manual_fix', 'sourced_osm'])],
      };
    });
  }
  spot.sub_pois = nextSubs;

  if (trigger) {
    trigger.lat = fix.lat;
    trigger.lng = fix.lng;
    trigger.radius_m = fix.halfM;
    trigger.polygon = spot.polygonCoordinates.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
    }));
    const pool = trigger.deep_data_pool || [];
    const gpsLine = {
      text: `GPS-Eingang: ${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)} — ${fix.source}.`,
      tags: ['gps_confirmed', 'sourced_osm', 'orientierung'],
    };
    const rest = pool.filter(
      (x) => !/GPS-Eingang|Koordinaten\s*~/i.test(String(x.text || '')),
    );
    trigger.deep_data_pool = [gpsLine, ...rest];
  }

  return {
    id: fix.id,
    name: spot.name,
    status: 'FIXED',
    before,
    after: { lat: fix.lat, lng: fix.lng },
    delta_m: delta,
    source: fix.source,
    note: fix.note,
    promoted: !!fix.promoteStory,
  };
}

function ensureAtmSpot(pack) {
  const existing = (pack.spots || []).find((s) => s.id === ATM_SPOT.id);
  if (existing) {
    const t = (pack.trigger_points || []).find((x) => x.id === ATM_SPOT.id);
    if (t) {
      t.lat = ATM_SPOT.lat;
      t.lng = ATM_SPOT.lng;
    }
    return { id: ATM_SPOT.id, status: 'ATM_EXISTS' };
  }
  const spot = {
    id: ATM_SPOT.id,
    name: ATM_SPOT.name,
    district: 'Peiner_Hag',
    bullets: [
      '➔ Sparkasse Südholstein Geldautomat im Meyers Frischecenter, Peiner Hag 1.',
    ],
    category: 'bank',
    tags: [
      'directory',
      'tier4',
      'offline_lookup',
      'bank',
      'atm',
      'geldautomat',
      'gps_manual_fix',
    ],
    facts: {
      origin: `Geldautomat Sparkasse Südholstein, Peiner Hag 1 (${ATM_SPOT.source}).`,
      now: 'LIVE: Öffnungszeiten des Centers prüfen — Automat oft rund um die Uhr im Foyer.',
    },
    approach_triggers: [],
    sub_pois: [
      {
        id: `${ATM_SPOT.id}_sub_eingang`,
        name: `${ATM_SPOT.name} · Standort`,
        lat: ATM_SPOT.lat,
        lng: ATM_SPOT.lng,
        radius_m: 8,
        fact_details: `Google Places: ${ATM_SPOT.source}`,
        tags: ['sub_poi', 'eingang', 'gps_entrance', 'atm', 'bank'],
      },
    ],
    pack_role: 'directory',
    place_tier: 4,
    polygonCoordinates: boxPolygon(ATM_SPOT.lat, ATM_SPOT.lng, 12),
  };
  const trigger = {
    id: ATM_SPOT.id,
    name: ATM_SPOT.name,
    trigger_type: 'arrival',
    radius_m: 18,
    special_radius_m: null,
    general_info:
      'Sparkasse Südholstein Geldautomat im Meyers Frischecenter am Peiner Hag.',
    deep_data_pool: [
      {
        text: `GPS-Eingang: ${ATM_SPOT.lat.toFixed(6)}, ${ATM_SPOT.lng.toFixed(6)} — ${ATM_SPOT.source}.`,
        tags: ['gps_confirmed', 'orientierung', 'bank', 'atm'],
      },
      {
        text: 'LIVE: Verfügbarkeit / Störung des Automaten aktuell prüfen.',
        tags: ['live_hint', 'ephemeral'],
      },
    ],
    cascading_triggers: [],
    lat: ATM_SPOT.lat,
    lng: ATM_SPOT.lng,
    trigger_kind: 'poi',
  };
  pack.spots.push(spot);
  pack.trigger_points.push(trigger);
  return { id: ATM_SPOT.id, status: 'ATM_ADDED', after: { lat: ATM_SPOT.lat, lng: ATM_SPOT.lng } };
}

function ensurePrParking(pack) {
  const existing = (pack.spots || []).find((s) => s.id === PR_SPOT.id);
  const parking = pack.parking || { parkopedia_enabled: false, hint_spots: [] };
  const hints = Array.isArray(parking.hint_spots) ? [...parking.hint_spots] : [];
  const hasHint = hints.some((h) =>
    /p\+r|park.?and.?ride|bahnhof prisdorf/i.test(`${h.name || ''}`),
  );
  if (!hasHint) {
    hints.unshift({
      name: PR_SPOT.name,
      lat: PR_SPOT.lat,
      lng: PR_SPOT.lng,
      type: 'car',
      pricing: 'free',
    });
    pack.parking = { ...parking, hint_spots: hints };
  }
  if (existing) {
    const t = (pack.trigger_points || []).find((x) => x.id === PR_SPOT.id);
    if (t) {
      t.lat = PR_SPOT.lat;
      t.lng = PR_SPOT.lng;
    }
    existing.polygonCoordinates = boxPolygon(PR_SPOT.lat, PR_SPOT.lng, 28);
    const sub = (existing.sub_pois || []).find((s) =>
      String(s.id || '').includes('eingang'),
    );
    if (sub) {
      sub.lat = PR_SPOT.lat;
      sub.lng = PR_SPOT.lng;
    }
    return {
      id: PR_SPOT.id,
      status: 'PR_EXISTS',
      after: { lat: PR_SPOT.lat, lng: PR_SPOT.lng },
    };
  }
  const spot = {
    id: PR_SPOT.id,
    name: PR_SPOT.name,
    district: 'Bahnhofsviertel',
    bullets: [
      '➔ P+R-Parkplatz direkt am Haltepunkt Prisdorf — Pendlerparkplatz an der Bahn.',
    ],
    category: 'parking',
    tags: [
      'directory',
      'tier4',
      'offline_lookup',
      'parking',
      'p+r',
      'parkplatz',
      'bahn',
      'gps_manual_fix',
      'map_point',
    ],
    facts: {
      origin: `P+R Parkplatz Bahnhof Prisdorf (${PR_SPOT.source}).`,
      now: 'Parken für Pendler am Bahnhof — LIVE ggf. Auslastung / Schilder prüfen.',
      tags: ['parking', 'directory', 'bahn'],
    },
    approach_triggers: [],
    sub_pois: [
      {
        id: `${PR_SPOT.id}_sub_eingang`,
        name: `${PR_SPOT.name} · Einfahrt`,
        lat: PR_SPOT.lat,
        lng: PR_SPOT.lng,
        radius_m: 12,
        fact_details: `Google Place: ${PR_SPOT.source}`,
        tags: ['sub_poi', 'eingang', 'gps_entrance', 'parking'],
      },
    ],
    pack_role: 'directory',
    place_tier: 4,
    polygonCoordinates: boxPolygon(PR_SPOT.lat, PR_SPOT.lng, 28),
  };
  const trigger = {
    id: PR_SPOT.id,
    name: PR_SPOT.name,
    trigger_type: 'arrival',
    radius_m: 35,
    special_radius_m: null,
    general_info:
      'P+R-Parkplatz am Haltepunkt Prisdorf — Parken und Zug nehmen.',
    deep_data_pool: [
      {
        text: `GPS-Eingang: ${PR_SPOT.lat.toFixed(6)}, ${PR_SPOT.lng.toFixed(6)} — ${PR_SPOT.source}.`,
        tags: ['gps_confirmed', 'orientierung', 'parking'],
      },
    ],
    cascading_triggers: [],
    lat: PR_SPOT.lat,
    lng: PR_SPOT.lng,
    trigger_kind: 'poi',
  };
  pack.spots.push(spot);
  pack.trigger_points.push(trigger);
  return {
    id: PR_SPOT.id,
    status: 'PR_ADDED',
    after: { lat: PR_SPOT.lat, lng: PR_SPOT.lng },
  };
}

function main() {
  const dry = hasFlag('dry');
  const pack = loadPack('prisdorf');
  if (!pack) throw new Error('prisdorf pack missing');

  const rows = FIXES.map((f) => applyFix(pack, f));
  rows.push(ensureAtmSpot(pack));
  rows.push(ensurePrParking(pack));
  for (const r of rows) {
    console.log(
      `${r.status} ${r.id}` +
        (r.delta_m != null ? ` Δ=${r.delta_m}m` : '') +
        (r.before
          ? ` ${r.before.lat.toFixed(6)},${r.before.lng.toFixed(6)} → ${r.after.lat},${r.after.lng}`
          : r.after
            ? ` → ${r.after.lat},${r.after.lng}`
            : ''),
    );
    if (r.note) console.log(`  ${r.note}`);
  }

  if (!dry) {
    pack.updated_at = new Date().toISOString();
    savePack(pack);
    console.log('Saved data/staedte/prisdorf.json');
  } else {
    console.log('Dry-run — pack not written');
  }
}

main();
