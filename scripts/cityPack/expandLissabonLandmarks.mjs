#!/usr/bin/env node
/**
 * Expand Lissabon with landmark discovery (Places API New) across districts.
 * Adds story-candidate spots; deep research fills pools afterwards.
 *
 *   node scripts/cityPack/expandLissabonLandmarks.mjs
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

const CITY_ID = 'lissabon';
const CENTER = { lat: 38.7223, lng: -9.1393 };

/** Curated metro landmarks — story-worthy, not cafés/hotels. */
const LANDMARKS = [
  // Belém / Ajuda
  { q: 'Convento do Carmo Lisboa', name: 'Convento do Carmo', category: 'denkmal', tier: 1 },
  { q: 'Igreja de São Roque Lisboa', name: 'Igreja de São Roque', category: 'kirche', tier: 1 },
  { q: 'Museu Nacional de Arte Antiga Lisboa', name: 'Museu Nacional de Arte Antiga', category: 'museum', tier: 1 },
  { q: 'Museu Nacional dos Coches Lisboa', name: 'Museu Nacional dos Coches', category: 'museum', tier: 1 },
  { q: 'Centro Cultural de Belém', name: 'Centro Cultural de Belém', category: 'theater', tier: 2 },
  { q: 'Palácio Nacional da Ajuda Lisboa', name: 'Palácio Nacional da Ajuda', category: 'denkmal', tier: 1 },
  { q: 'Jardim Botânico Tropical Belém', name: 'Jardim Botânico Tropical', category: 'natur', tier: 2 },
  { q: 'Pastéis de Belém Lisboa', name: 'Pastéis de Belém', category: 'cafe', tier: 2 },
  { q: 'Museu Coleção Berardo Lisboa', name: 'Museu Coleção Berardo', category: 'museum', tier: 2 },
  { q: 'Palácio de Belém Lisboa', name: 'Palácio de Belém', category: 'denkmal', tier: 2 },
  // Alfama / Castelo / Graça
  { q: 'Museu do Fado Lisboa', name: 'Museu do Fado', category: 'museum', tier: 1 },
  { q: 'Panteão Nacional Lisboa', name: 'Panteão Nacional', category: 'denkmal', tier: 1 },
  { q: 'Mosteiro de São Vicente de Fora Lisboa', name: 'Mosteiro de São Vicente de Fora', category: 'kirche', tier: 1 },
  { q: 'Igreja de Santo António de Lisboa', name: 'Igreja de Santo António', category: 'kirche', tier: 2 },
  { q: 'Casa dos Bicos Lisboa', name: 'Casa dos Bicos', category: 'denkmal', tier: 2 },
  { q: 'Miradouro da Graça Lisboa', name: 'Miradouro da Graça', category: 'aussicht', tier: 2 },
  { q: 'Igreja da Graça Lisboa', name: 'Igreja da Graça', category: 'kirche', tier: 2 },
  { q: 'Mouraria Lisboa', name: 'Mouraria', category: 'altstadt', tier: 2 },
  { q: 'Castelo de São Jorge Portas do Sol', name: 'Miradouro das Portas do Sol', category: 'aussicht', tier: 2 },
  // Baixa / Chiado / Bairro Alto
  { q: 'Arco da Rua Augusta Lisboa', name: 'Arco da Rua Augusta', category: 'denkmal', tier: 1 },
  { q: 'Teatro Nacional D. Maria II Lisboa', name: 'Teatro Nacional D. Maria II', category: 'theater', tier: 2 },
  { q: 'Elevador da Glória Lisboa', name: 'Elevador da Glória', category: 'aussicht', tier: 1 },
  { q: 'Elevador da Bica Lisboa', name: 'Elevador da Bica', category: 'aussicht', tier: 1 },
  { q: 'Miradouro de São Pedro de Alcântara Lisboa', name: 'Miradouro de São Pedro de Alcântara', category: 'aussicht', tier: 1 },
  { q: 'Chiado Lisboa', name: 'Chiado', category: 'altstadt', tier: 1 },
  { q: 'Largo do Carmo Lisboa', name: 'Largo do Carmo', category: 'altstadt', tier: 2 },
  { q: 'Igreja do Loreto Lisboa', name: 'Igreja do Loreto', category: 'kirche', tier: 3 },
  { q: 'Rua Augusta Lisboa', name: 'Rua Augusta', category: 'altstadt', tier: 2 },
  { q: 'Praça dos Restauradores Lisboa', name: 'Praça dos Restauradores', category: 'altstadt', tier: 2 },
  { q: 'Elevador do Lavra Lisboa', name: 'Elevador do Lavra', category: 'aussicht', tier: 2 },
  { q: 'Igreja de São Domingos Lisboa', name: 'Igreja de São Domingos', category: 'kirche', tier: 2 },
  // Estrela / Campo de Ourique / Amoreiras
  { q: 'Jardim da Estrela Lisboa', name: 'Jardim da Estrela', category: 'natur', tier: 2 },
  { q: 'Mercado de Campo de Ourique Lisboa', name: 'Mercado de Campo de Ourique', category: 'markt', tier: 2 },
  { q: 'Casa Fernando Pessoa Lisboa', name: 'Casa Fernando Pessoa', category: 'museum', tier: 2 },
  { q: 'Amoreiras Shopping Center Lisboa tower', name: 'Torres das Amoreiras', category: 'aussicht', tier: 3 },
  { q: 'Águas Livres Aqueduct Lisboa', name: 'Aqueduto das Águas Livres', category: 'denkmal', tier: 1 },
  { q: 'Mãe d\'Água das Amoreiras Lisboa', name: 'Mãe d\'Água das Amoreiras', category: 'denkmal', tier: 2 },
  // Alcântara / Santos / Docas
  { q: 'Docas de Santo Amaro Lisboa', name: 'Docas de Santo Amaro', category: 'hafen', tier: 2 },
  { q: 'Museu da Marioneta Lisboa', name: 'Museu da Marioneta', category: 'museum', tier: 2 },
  { q: 'Museu do Oriente Lisboa', name: 'Museu do Oriente', category: 'museum', tier: 1 },
  { q: 'Rua Nova do Carvalho Pink Street Lisboa', name: 'Pink Street', category: 'altstadt', tier: 2 },
  { q: 'Cais do Sodré Lisboa', name: 'Cais do Sodré', category: 'hafen', tier: 2 },
  { q: 'Pilar 7 Bridge Experience Lisboa', name: 'Pilar 7 Bridge Experience', category: 'aussicht', tier: 2 },
  // Parque das Nações / Oriente
  { q: 'Parque das Nações Lisboa', name: 'Parque das Nações', category: 'natur', tier: 1 },
  { q: 'Torre Vasco da Gama Lisboa', name: 'Torre Vasco da Gama', category: 'aussicht', tier: 2 },
  { q: 'Telecabine Parque das Nações', name: 'Telecabine Lisboa', category: 'aussicht', tier: 2 },
  { q: 'Pavilhão do Conhecimento Lisboa', name: 'Pavilhão do Conhecimento', category: 'museum', tier: 2 },
  { q: 'Casino Lisboa', name: 'Casino Lisboa', category: 'freizeit', tier: 3 },
  { q: 'Centro Vasco da Gama Lisboa', name: 'Centro Vasco da Gama', category: 'einkaufen', tier: 3 },
  // North / other
  { q: 'Jardim Zoológico de Lisboa', name: 'Jardim Zoológico de Lisboa', category: 'freizeitpark', tier: 1 },
  { q: 'Estádio da Luz Lisboa', name: 'Estádio da Luz', category: 'sport', tier: 2 },
  { q: 'Estádio José Alvalade Lisboa', name: 'Estádio José Alvalade', category: 'sport', tier: 2 },
  { q: 'Palácio Fronteira Lisboa', name: 'Palácio dos Marqueses de Fronteira', category: 'denkmal', tier: 1 },
  { q: 'Fundação Calouste Gulbenkian gardens Lisboa', name: 'Jardins Gulbenkian', category: 'natur', tier: 2 },
  { q: 'Praça do Marquês de Pombal Lisboa', name: 'Marquês de Pombal', category: 'denkmal', tier: 2 },
  { q: 'Parque Eduardo VII viewpoint Lisboa', name: 'Miradouro Parque Eduardo VII', category: 'aussicht', tier: 2 },
  { q: 'Basilica da Estrela viewpoint Lisboa', name: 'Kuppel Basílica da Estrela', category: 'aussicht', tier: 2 },
  { q: 'Museu da Farmácia Lisboa', name: 'Museu da Farmácia', category: 'museum', tier: 3 },
  { q: 'Museu Medeiros e Almeida Lisboa', name: 'Museu Medeiros e Almeida', category: 'museum', tier: 2 },
  { q: 'Casa-Museu Dr. Anastácio Gonçalves Lisboa', name: 'Casa-Museu Anastácio Gonçalves', category: 'museum', tier: 3 },
  { q: 'Igreja da Memória Lisboa', name: 'Igreja da Memória', category: 'kirche', tier: 3 },
  { q: 'Fortaleza do Bom Sucesso Lisboa', name: 'Forte do Bom Sucesso', category: 'denkmal', tier: 3 },
  { q: 'Torre de Belém riverside walk Lisboa', name: 'Jardim da Torre de Belém', category: 'natur', tier: 3 },
  { q: 'Praça do Império Lisboa', name: 'Praça do Império', category: 'natur', tier: 2 },
  { q: 'Mercado da Ribeira Lisboa', name: 'Mercado da Ribeira', category: 'markt', tier: 2 },
  { q: 'Livraria Bertrand Chiado Lisboa', name: 'Livraria Bertrand', category: 'einkaufen', tier: 2 },
  { q: 'A Brasileira do Chiado Lisboa', name: 'A Brasileira', category: 'cafe', tier: 2 },
  { q: 'Solar do Vinho do Porto Lisboa', name: 'Solar do Vinho do Porto', category: 'cafe', tier: 3 },
  { q: 'Museu Militar de Lisboa', name: 'Museu Militar de Lisboa', category: 'museum', tier: 2 },
  { q: 'Campo Pequeno Lisboa', name: 'Campo Pequeno', category: 'denkmal', tier: 2 },
  { q: 'Fonte Luminosa Alameda Lisboa', name: 'Fonte Luminosa', category: 'denkmal', tier: 3 },
  { q: 'Instituto Superior Técnico Lisboa', name: 'Instituto Superior Técnico', category: 'denkmal', tier: 3 },
  { q: 'Assembleia da República Lisboa', name: 'Assembleia da República', category: 'denkmal', tier: 2 },
  { q: 'Jardim Botânico da Universidade de Lisboa', name: 'Jardim Botânico da Universidade', category: 'natur', tier: 2 },
  { q: 'Miradouro do Torel Lisboa', name: 'Miradouro do Torel', category: 'aussicht', tier: 2 },
  { q: 'Castelo dos Mouros Sintra', name: 'SKIP_sintra', category: 'denkmal', tier: 9, skip: true },
];

function approaches(lat, lng, name, spotId) {
  return [
    { id: 'n', north: 48, east: 0, label: 'von Norden', r: 36 },
    { id: 's', north: -42, east: 0, label: 'von Süden', r: 24 },
    { id: 'e', north: 0, east: 40, label: 'von Osten', r: 28 },
  ].map((d) => {
    const p = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: d.r,
      teaser_text: `Wenn du ${d.label} kommst: ${name} liegt wenige Dutzend Meter weiter — achte auf Fassade, Eingang und typische Silhouette.`,
      condition_rule: 'always',
      needs_visual_review: true,
    };
  });
}

async function main() {
  const pack = loadPack(CITY_ID);
  if (!pack) throw new Error('missing lissabon pack');

  let added = 0;
  let skipped = 0;
  const report = [];

  for (const lm of LANDMARKS) {
    if (lm.skip) continue;
    process.stdout.write(`[exp] ${lm.name}… `);
    let hit = null;
    try {
      hit = await resolvePlace(lm.q, {
        near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 14000 },
        preferTypes: [],
      });
    } catch (e) {
      console.log('fail', String(e.message || e).slice(0, 80));
      continue;
    }
    if (!hit?.lat) {
      console.log('miss');
      skipped += 1;
      continue;
    }
    // Reject far outliers (e.g. Sintra false matches)
    if (distM(CENTER, hit) > 16000) {
      console.log('far', Math.round(distM(CENTER, hit)));
      skipped += 1;
      continue;
    }
    const near = pack.spots.find((s) => {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      return t && distM(t, hit) < 70;
    });
    if (near) {
      // Promote existing directory → story candidate if landmark
      if (near.pack_role === 'directory' && (lm.tier || 2) <= 2) {
        near.pack_role = 'story';
        near.place_tier = lm.tier || 2;
        near.category = lm.category;
        near.tags = [
          ...new Set([
            ...(near.tags || []).filter((x) => x !== 'directory' && x !== 'tier4'),
            'story',
            `tier${near.place_tier}`,
            'lissabon_expand',
            'needs_deep_research',
          ]),
        ];
        if (!(near.approach_triggers || []).length) {
          near.approach_triggers = approaches(hit.lat, hit.lng, lm.name, near.id);
        }
        console.log('promote', near.id);
        report.push({ action: 'promote', id: near.id, name: lm.name });
        added += 1;
        continue;
      }
      console.log('dup', near.id);
      skipped += 1;
      continue;
    }

    const spotId = `${CITY_ID}_${slugify(lm.name)}`.slice(0, 80);
    if (pack.spots.some((s) => s.id === spotId)) {
      console.log('id-dup');
      skipped += 1;
      continue;
    }

    pack.spots.push({
      id: spotId,
      name: lm.name,
      district: lm.category,
      category: lm.category,
      place_tier: lm.tier || 2,
      pack_role: 'story',
      tags: [
        lm.category,
        'story',
        `tier${lm.tier || 2}`,
        'lissabon',
        'lissabon_expand',
        'needs_deep_research',
      ],
      bullets: hit.address ? [`Adresse (Maps): ${hit.address}.`] : [],
      facts: { tags: [lm.category, 'needs_deep_research'] },
      polygonCoordinates: boxPolygon(hit.lat, hit.lng, (lm.tier || 2) === 1 ? 28 : 22),
      approach_triggers: approaches(hit.lat, hit.lng, lm.name, spotId),
      sub_pois: [
        {
          id: `${spotId}_sub_eingang`,
          name: `${lm.name} · Eingang`,
          lat: hit.lat,
          lng: hit.lng,
          radius_m: 10,
          fact_details: 'Navigationspin / Eingang — visuell prüfen.',
          tags: ['sub_poi', 'eingang'],
        },
      ],
      nav_waypoints: [],
      _google: {
        place_id: hit.place_id,
        rating: hit.rating,
        maps_url: hit.maps_url,
      },
    });
    pack.trigger_points.push({
      id: spotId,
      name: lm.name,
      lat: hit.lat,
      lng: hit.lng,
      radius_m: (lm.tier || 2) === 1 ? 40 : 30,
      general_info: '',
      deep_data_pool: [],
    });
    added += 1;
    report.push({ action: 'add', id: spotId, name: lm.name, lat: hit.lat, lng: hit.lng });
    console.log(`${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`);
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'Lissabon metro expand + deep research pending',
  };
  pack._coverage = {
    latMin: 38.69,
    latMax: 38.8,
    lngMin: -9.23,
    lngMax: -9.08,
  };

  const file = savePack(pack, { bumpVersion: true });
  console.log(
    `[exp] wrote ${file} v${pack.data_version} story=${pack._pack_index.story} added=${added} skipped=${skipped}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
