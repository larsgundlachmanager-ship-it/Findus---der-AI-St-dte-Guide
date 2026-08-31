#!/usr/bin/env node
/**
 * Surgical name/id fixes after bad rename/promote; force-add missing icons.
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

function approaches(lat, lng, name, spotId) {
  return [
    { id: 'n', north: 45, east: 0, r: 34 },
    { id: 's', north: -40, east: 0, r: 22 },
  ].map((d) => {
    const p = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: d.r,
      teaser_text: `${name} liegt kurz voraus — Fassade/Eingang im Blick behalten.`,
      condition_rule: 'always',
      needs_visual_review: true,
    };
  });
}

function ensureSpot(pack, { id, name, category, tier, lat, lng, place_id }) {
  let s = pack.spots.find((x) => x.id === id);
  let t = pack.trigger_points.find((x) => x.id === id);
  if (!s) {
    s = {
      id,
      name,
      district: category,
      category,
      place_tier: tier,
      pack_role: 'story',
      tags: [category, 'story', `tier${tier}`, 'lissabon_expand', 'needs_deep_research'],
      bullets: [],
      facts: { tags: [category] },
      polygonCoordinates: boxPolygon(lat, lng, tier === 1 ? 28 : 22),
      approach_triggers: approaches(lat, lng, name, id),
      sub_pois: [],
      nav_waypoints: [],
      _google: { place_id },
    };
    pack.spots.push(s);
  } else {
    s.name = name;
    s.category = category;
    s.place_tier = tier;
    s.pack_role = 'story';
    s.tags = [
      ...new Set([
        ...(s.tags || []).filter((x) => x !== 'directory' && x !== 'tier4' && x !== 'bad_promote_revert'),
        'story',
        `tier${tier}`,
        'lissabon_expand',
        'needs_deep_research',
      ]),
    ];
    if (!(s.approach_triggers || []).length) {
      s.approach_triggers = approaches(lat, lng, name, id);
    }
  }
  if (!t) {
    t = {
      id,
      name,
      lat,
      lng,
      radius_m: tier === 1 ? 40 : 30,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(t);
  } else {
    t.name = name;
    t.lat = lat;
    t.lng = lng;
  }
}

async function resolve(q) {
  const hit = await resolvePlace(q, {
    near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 14000 },
  });
  if (!hit?.lat || distM(CENTER, hit) > 16000) return null;
  return hit;
}

async function main() {
  const pack = loadPack('lissabon');

  // Restore Elevador da Glória if renamed
  const gloria = pack.spots.find((s) => s.id === 'lissabon_elevador_da_gloria');
  if (gloria) {
    gloria.name = 'Elevador da Glória';
    gloria.category = 'aussicht';
    gloria.place_tier = 1;
    gloria.pack_role = 'story';
    const tg = pack.trigger_points.find((x) => x.id === gloria.id);
    if (tg) tg.name = 'Elevador da Glória';
  }

  // Demote luggage/bounce again
  for (const s of pack.spots) {
    if (/luggage|bounce|auchan|lavabos|emporium|black_cat|biclas|escala25|duke_of|fabrica_da_nata|drogaria|souvenir_de_lisboa|mercado_de_fusao|alfama_collections|neighbourhood|chafariz_do_carmo/i.test(s.id)) {
      s.pack_role = 'directory';
      s.place_tier = 4;
    }
  }

  // Fix wrong Santa Catarina promotions — keep as directory unless it's really that church
  const catarina = pack.spots.find((s) => s.id === 'lissabon_igreja_de_santa_catarina');
  if (catarina && /Ant[oó]nio|Domingos/i.test(catarina.name)) {
    catarina.name = 'Igreja de Santa Catarina';
    catarina.pack_role = 'directory';
    catarina.place_tier = 4;
  }

  // Restore Senhora do Monte name if overwritten
  const monte = pack.spots.find((s) => s.id === 'lissabon_miradouro_da_senhora_do_monte');
  if (monte) {
    monte.name = 'Miradouro da Senhora do Monte';
    monte.pack_role = 'story';
    monte.place_tier = 2;
    const tm = pack.trigger_points.find((x) => x.id === monte.id);
    if (tm) tm.name = monte.name;
  }

  // Restore Arco name
  const arco = pack.spots.find((s) => s.id === 'lissabon_arco_da_rua_augusta');
  if (arco) {
    arco.name = 'Arco da Rua Augusta';
    arco.pack_role = 'story';
    arco.place_tier = 1;
  }

  const MUST = [
    { id: 'lissabon_elevador_da_bica', q: 'Elevador da Bica Lisboa', name: 'Elevador da Bica', category: 'aussicht', tier: 1 },
    { id: 'lissabon_igreja_de_santo_antonio', q: 'Igreja de Santo António de Lisboa', name: 'Igreja de Santo António', category: 'kirche', tier: 2 },
    { id: 'lissabon_igreja_de_sao_domingos', q: 'Igreja de São Domingos Largo São Domingos Lisboa', name: 'Igreja de São Domingos', category: 'kirche', tier: 2 },
    { id: 'lissabon_miradouro_da_graca', q: 'Miradouro da Graça Lisboa', name: 'Miradouro da Graça', category: 'aussicht', tier: 2 },
    { id: 'lissabon_miradouro_das_portas_do_sol', q: 'Miradouro das Portas do Sol Lisboa', name: 'Miradouro das Portas do Sol', category: 'aussicht', tier: 2 },
    { id: 'lissabon_chiado', q: 'Largo do Chiado Lisboa', name: 'Chiado', category: 'altstadt', tier: 1 },
    { id: 'lissabon_rua_augusta', q: 'Rua Augusta Lisboa Baixa', name: 'Rua Augusta', category: 'altstadt', tier: 2 },
    { id: 'lissabon_jardim_da_estrela', q: 'Jardim da Estrela Lisboa', name: 'Jardim da Estrela', category: 'natur', tier: 2 },
  ];

  for (const m of MUST) {
    process.stdout.write(`[must] ${m.name}… `);
    const hit = await resolve(m.q);
    if (!hit) {
      console.log('miss');
      continue;
    }
    ensureSpot(pack, {
      id: m.id,
      name: m.name,
      category: m.category,
      tier: m.tier,
      lat: hit.lat,
      lng: hit.lng,
      place_id: hit.place_id,
    });
    console.log('ok', hit.lat.toFixed(5));
  }

  // Gloria coords refresh
  const gHit = await resolve('Elevador da Glória Lisboa');
  if (gHit && gloria) {
    const tg = pack.trigger_points.find((x) => x.id === gloria.id);
    if (tg) {
      tg.lat = gHit.lat;
      tg.lng = gHit.lng;
    }
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
  };
  savePack(pack, { bumpVersion: true });
  console.log(`[surg] v${pack.data_version} story=${pack._pack_index.story}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
