#!/usr/bin/env node
/**
 * Fix bad proximity-promotions + force-add key Lissabon landmarks by name.
 */
import {
  boxPolygon,
  distM,
  loadPack,
  offset,
  savePack,
  slugify,
} from './lib.mjs';
import { resolvePlace, requireGoogleKey } from './google.mjs';

requireGoogleKey();
const CENTER = { lat: 38.7223, lng: -9.1393 };

const BAD_ID_RE =
  /luggage|auchan|fabrica_da_nata|drogaria|bounce|neighbourhood|souvenir_de_lisboa|lavabos|emporium|black_cat|mercado_de_fusao|biclas|escala25|duke_of_terceira|chafariz_do_carmo|alfama_collections/i;

const FORCE = [
  { q: 'Convento do Carmo Lisboa ruins', name: 'Convento do Carmo', category: 'denkmal', tier: 1 },
  { q: 'Museu do Fado Lisboa Largo do Chafariz de Dentro', name: 'Museu do Fado', category: 'museum', tier: 1 },
  { q: 'Igreja de Santo António de Lisboa cathedral nearby', name: 'Igreja de Santo António', category: 'kirche', tier: 2 },
  { q: 'Casa dos Bicos Fundação José Saramago Lisboa', name: 'Casa dos Bicos', category: 'denkmal', tier: 2 },
  { q: 'Miradouro da Graça Lisboa Senhora', name: 'Miradouro da Graça', category: 'aussicht', tier: 2 },
  { q: 'Igreja e Convento da Graça Lisboa', name: 'Igreja da Graça', category: 'kirche', tier: 2 },
  { q: 'Mouraria Lisboa historic district', name: 'Mouraria', category: 'altstadt', tier: 2 },
  { q: 'Miradouro das Portas do Sol Lisboa', name: 'Miradouro das Portas do Sol', category: 'aussicht', tier: 2 },
  { q: 'Teatro Nacional Dona Maria II Lisboa Rossio', name: 'Teatro Nacional D. Maria II', category: 'theater', tier: 2 },
  { q: 'Elevador da Bica Lisboa', name: 'Elevador da Bica', category: 'aussicht', tier: 1 },
  { q: 'Chiado Lisboa district', name: 'Chiado', category: 'altstadt', tier: 1 },
  { q: 'Largo do Carmo Lisboa', name: 'Largo do Carmo', category: 'altstadt', tier: 2 },
  { q: 'Rua Augusta Lisboa pedestrian', name: 'Rua Augusta', category: 'altstadt', tier: 2 },
  { q: 'Praça dos Restauradores Lisboa', name: 'Praça dos Restauradores', category: 'altstadt', tier: 2 },
  { q: 'Elevador do Lavra Lisboa', name: 'Elevador do Lavra', category: 'aussicht', tier: 2 },
  { q: 'Igreja de São Domingos Lisboa', name: 'Igreja de São Domingos', category: 'kirche', tier: 2 },
  { q: 'Jardim da Estrela Lisboa park', name: 'Jardim da Estrela', category: 'natur', tier: 2 },
  { q: 'Cais do Sodré station Lisboa', name: 'Cais do Sodré', category: 'hafen', tier: 2 },
  { q: 'Pilar 7 Bridge Experience Lisboa', name: 'Pilar 7 Bridge Experience', category: 'aussicht', tier: 2 },
  { q: 'Parque das Nações Lisboa park', name: 'Parque das Nações', category: 'natur', tier: 1 },
  { q: 'Livraria Bertrand Chiado Rua Garrett', name: 'Livraria Bertrand', category: 'einkaufen', tier: 2 },
  { q: 'Café A Brasileira Chiado Lisboa', name: 'A Brasileira', category: 'cafe', tier: 2 },
  { q: 'Marquês de Pombal square Lisboa', name: 'Praça Marquês de Pombal', category: 'denkmal', tier: 2 },
  { q: 'Amoreiras 360 Panoramic View Lisboa', name: 'Amoreiras 360', category: 'aussicht', tier: 2 },
];

function approaches(lat, lng, name, spotId) {
  return [
    { id: 'n', north: 48, east: 0, r: 36 },
    { id: 's', north: -42, east: 0, r: 24 },
  ].map((d) => {
    const p = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: d.r,
      teaser_text: `${name} liegt kurz voraus — achte auf die typische Fassade bzw. den Aussichtspunkt.`,
      condition_rule: 'always',
      needs_visual_review: true,
    };
  });
}

function nameSimilar(a, b) {
  const na = String(a || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ');
  const nb = String(b || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ');
  const wa = new Set(na.split(' ').filter((w) => w.length > 3));
  const wb = nb.split(' ').filter((w) => w.length > 3);
  let hit = 0;
  for (const w of wb) if (wa.has(w)) hit += 1;
  return hit >= 2 || na.includes(nb.slice(0, 12)) || nb.includes(na.slice(0, 12));
}

async function main() {
  const pack = loadPack('lissabon');
  let demoted = 0;
  for (const s of pack.spots) {
    if (s.pack_role === 'directory') continue;
    if (BAD_ID_RE.test(s.id) || BAD_ID_RE.test(s.name)) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []).filter((x) => !/^tier\d$/.test(x) && x !== 'story'),
          'directory',
          'tier4',
          'bad_promote_revert',
        ]),
      ];
      demoted += 1;
    }
  }
  console.log(`[fix] demoted bad promotions: ${demoted}`);

  let added = 0;
  for (const lm of FORCE) {
    process.stdout.write(`[force] ${lm.name}… `);
    const hit = await resolvePlace(lm.q, {
      near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 14000 },
    });
    if (!hit?.lat || distM(CENTER, hit) > 16000) {
      console.log('miss');
      continue;
    }
    // Exact-ish existing by name
    const byName = pack.spots.find((s) => nameSimilar(s.name, lm.name));
    if (byName) {
      byName.pack_role = 'story';
      byName.place_tier = lm.tier;
      byName.category = lm.category;
      byName.name = lm.name;
      byName.tags = [
        ...new Set([
          ...(byName.tags || []).filter((x) => x !== 'directory' && x !== 'tier4' && x !== 'bad_promote_revert'),
          'story',
          `tier${lm.tier}`,
          'lissabon_expand',
          'needs_deep_research',
        ]),
      ];
      if (!(byName.approach_triggers || []).length) {
        const t = pack.trigger_points.find((x) => x.id === byName.id);
        byName.approach_triggers = approaches(t?.lat ?? hit.lat, t?.lng ?? hit.lng, lm.name, byName.id);
      }
      console.log('rename/promote', byName.id);
      added += 1;
      continue;
    }
    // Nearby only if same name-ish google hit
    const nearSame = pack.spots.find((s) => {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      return t && distM(t, hit) < 45 && nameSimilar(s.name, lm.name);
    });
    if (nearSame) {
      console.log('near-same', nearSame.id);
      continue;
    }

    const spotId = `lissabon_${slugify(lm.name)}`.slice(0, 80);
    if (pack.spots.some((s) => s.id === spotId)) {
      const s = pack.spots.find((x) => x.id === spotId);
      s.pack_role = 'story';
      s.place_tier = lm.tier;
      console.log('id-exists');
      continue;
    }
    pack.spots.push({
      id: spotId,
      name: lm.name,
      district: lm.category,
      category: lm.category,
      place_tier: lm.tier,
      pack_role: 'story',
      tags: [lm.category, 'story', `tier${lm.tier}`, 'lissabon_expand', 'needs_deep_research'],
      bullets: hit.address ? [`Adresse (Maps): ${hit.address}.`] : [],
      facts: { tags: [lm.category, 'needs_deep_research'] },
      polygonCoordinates: boxPolygon(hit.lat, hit.lng, lm.tier === 1 ? 28 : 22),
      approach_triggers: approaches(hit.lat, hit.lng, lm.name, spotId),
      sub_pois: [
        {
          id: `${spotId}_sub_eingang`,
          name: `${lm.name} · Eingang`,
          lat: hit.lat,
          lng: hit.lng,
          radius_m: 10,
          fact_details: 'Navigationspin.',
          tags: ['sub_poi', 'eingang'],
        },
      ],
      nav_waypoints: [],
      _google: { place_id: hit.place_id, rating: hit.rating },
    });
    pack.trigger_points.push({
      id: spotId,
      name: lm.name,
      lat: hit.lat,
      lng: hit.lng,
      radius_m: lm.tier === 1 ? 40 : 30,
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
    offline_qa: (pack._offline_qa || []).length,
  };
  savePack(pack, { bumpVersion: true });
  console.log(`[fix] v${pack.data_version} story=${pack._pack_index.story} forceAdded=${added}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
