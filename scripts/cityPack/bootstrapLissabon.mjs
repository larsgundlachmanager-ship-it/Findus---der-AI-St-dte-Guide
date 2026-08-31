#!/usr/bin/env node
/**
 * Bootstrap Lissabon when Google Places Legacy is unavailable.
 * Geocodes known landmarks + builds a Module-1 pack skeleton.
 *
 *   node scripts/cityPack/bootstrapLissabon.mjs
 */
import {
  boxPolygon,
  defaultLiveResearch,
  distM,
  loadEnvFile,
  offset,
  savePack,
  slugify,
} from './lib.mjs';
import { geocode, requireGoogleKey } from './google.mjs';

loadEnvFile();

const CITY_ID = 'lissabon';
const CITY_NAME = 'Lissabon';
const CENTER = { lat: 38.7223, lng: -9.1393 };

/** Must-see + strong story candidates (PT/DE/EN aliases for geocode). */
const LANDMARKS = [
  { q: 'Torre de Belém Lisboa', name: 'Torre de Belém', category: 'denkmal', tier: 1 },
  { q: 'Mosteiro dos Jerónimos Lisboa', name: 'Mosteiro dos Jerónimos', category: 'museum', tier: 1 },
  { q: 'Castelo de São Jorge Lisboa', name: 'Castelo de São Jorge', category: 'aussicht', tier: 1 },
  { q: 'Praça do Comércio Lisboa', name: 'Praça do Comércio', category: 'altstadt', tier: 1 },
  { q: 'Sé de Lisboa', name: 'Sé Catedral de Lisboa', category: 'kirche', tier: 1 },
  { q: 'Elevador de Santa Justa Lisboa', name: 'Elevador de Santa Justa', category: 'aussicht', tier: 1 },
  { q: 'Alfama Lisboa', name: 'Alfama', category: 'altstadt', tier: 1 },
  { q: 'Bairro Alto Lisboa', name: 'Bairro Alto', category: 'altstadt', tier: 2 },
  { q: 'Miradouro da Senhora do Monte Lisboa', name: 'Miradouro da Senhora do Monte', category: 'aussicht', tier: 2 },
  { q: 'Miradouro de Santa Luzia Lisboa', name: 'Miradouro de Santa Luzia', category: 'aussicht', tier: 2 },
  { q: 'Parque Eduardo VII Lisboa', name: 'Parque Eduardo VII', category: 'natur', tier: 2 },
  { q: 'Basílica da Estrela Lisboa', name: 'Basílica da Estrela', category: 'kirche', tier: 2 },
  { q: 'Padrão dos Descobrimentos Lisboa', name: 'Padrão dos Descobrimentos', category: 'denkmal', tier: 1 },
  { q: 'Oceanário de Lisboa', name: 'Oceanário de Lisboa', category: 'freizeitpark', tier: 1 },
  { q: 'MAAT Lisboa', name: 'MAAT', category: 'museum', tier: 2 },
  { q: 'Museu Nacional do Azulejo Lisboa', name: 'Museu Nacional do Azulejo', category: 'museum', tier: 2 },
  { q: 'LX Factory Lisboa', name: 'LX Factory', category: 'freizeit', tier: 2 },
  { q: 'Time Out Market Lisboa', name: 'Time Out Market', category: 'markt', tier: 2 },
  { q: 'Rossio Lisboa', name: 'Rossio', category: 'altstadt', tier: 2 },
  { q: 'Avenida da Liberdade Lisboa', name: 'Avenida da Liberdade', category: 'altstadt', tier: 2 },
  { q: 'Ponte 25 de Abril Lisboa viewpoint', name: 'Ponte 25 de Abril', category: 'aussicht', tier: 2 },
  { q: 'Tram 28 Lisboa', name: 'Elétrico 28', category: 'tour', tier: 2 },
  { q: 'Feira da Ladra Lisboa', name: 'Feira da Ladra', category: 'markt', tier: 3 },
  { q: 'Jardim Botânico de Lisboa', name: 'Jardim Botânico de Lisboa', category: 'natur', tier: 2 },
  { q: 'Gulbenkian Museum Lisboa', name: 'Museu Calouste Gulbenkian', category: 'museum', tier: 2 },
  { q: 'Estação do Oriente Lisboa', name: 'Gare do Oriente', category: 'bahnhof', tier: 2 },
  { q: 'Santa Apolónia station Lisboa', name: 'Santa Apolónia', category: 'bahnhof', tier: 3 },
  { q: 'Lisbon Airport', name: 'Aeroporto de Lisboa', category: 'service', tier: 4, directory: true },
];

function approaches(lat, lng, name, spotId) {
  return [
    { id: 'n', north: 42, east: 0, label: 'von Norden' },
    { id: 's', north: -40, east: 0, label: 'von Süden' },
  ].map((d, i) => {
    const p = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: i === 0 ? 34 : 22,
      teaser_text: `Wenn du ${d.label} kommst: etwa ${Math.round(Math.hypot(d.north, d.east))} Meter weiter liegt ${name} — schau nach dem Eingang / der markanten Fassade.`,
      condition_rule: 'always',
      needs_visual_review: true,
    };
  });
}

async function geoOne(query) {
  const data = await geocode(query, {
    swLat: CENTER.lat - 0.12,
    swLng: CENTER.lng - 0.18,
    neLat: CENTER.lat + 0.12,
    neLng: CENTER.lng + 0.18,
  });
  const r = data.results?.[0];
  if (!r?.geometry?.location) return null;
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    address: r.formatted_address || null,
    place_id: r.place_id || null,
  };
}

async function main() {
  requireGoogleKey();
  const pack = {
    city_id: CITY_ID,
    name: CITY_NAME,
    data_version: 0,
    symbol: '🌊',
    lat: CENTER.lat,
    lng: CENTER.lng,
    district_division: [],
    spots: [],
    trigger_points: [],
    _live_research: defaultLiveResearch(CITY_NAME),
    _links: [],
    _coverage: {
      latMin: 38.69,
      latMax: 38.8,
      lngMin: -9.23,
      lngMax: -9.08,
    },
    _product: {
      family: 'international',
      tier: 'city',
      paywall: false,
      notes: 'Lissabon / Lisboa',
    },
  };

  let added = 0;
  for (const lm of LANDMARKS) {
    process.stdout.write(`[geo] ${lm.name}… `);
    let hit = null;
    try {
      hit = await geoOne(lm.q);
    } catch (e) {
      console.log('fail', String(e.message || e).slice(0, 80));
      continue;
    }
    if (!hit) {
      console.log('miss');
      continue;
    }
    const near = pack.spots.find((s) => {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      return t && distM(t, hit) < 60;
    });
    if (near) {
      console.log('dup', near.id);
      continue;
    }
    const spotId = `${CITY_ID}_${slugify(lm.name)}`.slice(0, 80);
    const role = lm.directory ? 'directory' : 'story';
    const tier = lm.directory ? 4 : lm.tier || 2;
    pack.spots.push({
      id: spotId,
      name: lm.name,
      district: lm.category,
      category: lm.category,
      place_tier: tier,
      pack_role: role,
      tags: [lm.category, role, `tier${tier}`, 'lissabon', 'geocode_bootstrap'],
      bullets: hit.address ? [`Adresse (Geocode): ${hit.address}.`] : [],
      facts: { tags: [lm.category, 'needs_deep_research'] },
      polygonCoordinates: boxPolygon(hit.lat, hit.lng, tier === 1 ? 28 : 22),
      approach_triggers: role === 'story' ? approaches(hit.lat, hit.lng, lm.name, spotId) : [],
      sub_pois: [
        {
          id: `${spotId}_sub_eingang`,
          name: `${lm.name} · Haupteingang`,
          lat: hit.lat,
          lng: hit.lng,
          radius_m: 10,
          fact_details: 'Geocode-Pin / Navigationspunkt. Visuell prüfen.',
          tags: ['sub_poi', 'eingang'],
        },
      ],
      nav_waypoints: [],
      _google: { place_id: hit.place_id, rating: null },
    });
    pack.trigger_points.push({
      id: spotId,
      name: lm.name,
      lat: hit.lat,
      lng: hit.lng,
      radius_m: tier === 1 ? 40 : 30,
      general_info: '',
      deep_data_pool: [],
    });
    added += 1;
    console.log(`${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`);
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: 0,
  };
  const file = savePack(pack, { bumpVersion: true });
  console.log(
    `[lissabon] wrote ${file} spots=${pack.spots.length} story=${pack._pack_index.story} added=${added}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
