#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { boxPolygon, loadPack, offset, ROOT, savePack } from './lib.mjs';

const pack = loadPack('lissabon');
const researchPath = path.join(ROOT, 'data', 'staedte', 'lissabon.research.json');
const r = JSON.parse(fs.readFileSync(researchPath, 'utf8'));

pack._offline_qa = (r.offline_qa || []).map((e) => ({
  q: e.q,
  a: e.a,
  tags: [...(e.tags || []), 'offline_qa', 'lissabon'],
}));
pack.city_history = r.city_history || pack._city_history || '';
pack._city_history = pack.city_history;

const sg = pack.spots.find((s) => s.id === 'lissabon_stadtgeschichte');
const t = pack.trigger_points.find((x) => x.id === 'lissabon_stadtgeschichte');
if (sg && t) {
  sg.place_tier = 2;
  sg.pack_role = 'story';
  sg.tags = [
    ...new Set([...(sg.tags || []), 'story', 'tier2', 'city_welcome', 'geschichte']),
  ];
  sg.bullets = [
    'Lissabon am Tejo: Entdeckungszeit, UNESCO-Belém (Jerónimos + Torre), Erdbeben 1755 und pombalinischer Wiederaufbau.',
    'Hügelstadt mit Alfama, Baixa und Belém als historischen Schwerpunkten.',
    'Quer: Castelo, Sé, Praça do Comércio, Belém-Ensemble.',
  ];
  const lat = t.lat ?? pack.lat;
  const lng = t.lng ?? pack.lng;
  const n = offset(lat, lng, 45, 0);
  const s = offset(lat, lng, -40, 0);
  sg.approach_triggers = [
    {
      id: 'lissabon_stadtgeschichte_approach_n',
      lat: n.lat,
      lng: n.lng,
      radius_m: 34,
      teaser_text:
        'Stadtkern-Orientierung: Belém westlich am Tejo, Alfama und Castelo östlich der Baixa — die Hügel prägen die Skyline.',
      condition_rule: 'always',
      needs_visual_review: true,
    },
    {
      id: 'lissabon_stadtgeschichte_approach_s',
      lat: s.lat,
      lng: s.lng,
      radius_m: 22,
      teaser_text:
        'Am Flussufer und in der Baixa liest man die Stadtgeschichte: Handelshafen, Wiederaufbau nach 1755, Blick zu den Hügeln.',
      condition_rule: 'always',
      needs_visual_review: true,
    },
  ];
  if (!sg.polygonCoordinates) sg.polygonCoordinates = boxPolygon(lat, lng, 35);
  const hist = r.city_history || t.general_info || '';
  t.general_info = String(hist).slice(0, 280);
  t.deep_data_pool = [
    {
      text: 'Visuell: Hügelkette über dem Tejo; gelbe Straßenbahnen, Azulejos, Manueline in Belém und pombalinisches Baixa-Raster.',
      tags: ['visuell', 'wegweiser'],
    },
    { text: hist, tags: ['geschichte', 'city_welcome'] },
    {
      text: 'Historie: 1147 Rückeroberung unter Afonso Henriques; Entdeckungszeit ab dem 15. Jahrhundert; Erdbeben vom 1. November 1755 mit Tsunami und Bränden; Wiederaufbau unter dem Marquês de Pombal (Baixa Pombalina).',
      tags: ['geschichte'],
    },
    {
      text: 'UNESCO 1983: Mosteiro dos Jerónimos und Torre de Belém als Ensemble der Entdeckungszeit.',
      tags: ['geschichte', 'quer'],
    },
    {
      text: 'Leben jetzt: Belém, Alfama, Miradouros und Parque das Nações (Expo 98 / Oceanário) als heutige Besucherschwerpunkte.',
      tags: ['leben_jetzt'],
    },
    {
      text: 'Quer: Castelo de São Jorge, Sé, Praça do Comércio, Elevador de Santa Justa, Padrão dos Descobrimentos.',
      tags: ['quer'],
    },
    {
      text: 'LIVE: Museen, Monumente und ÖPNV-Tickets (Carris/Metro) tagesaktuell prüfen.',
      tags: ['live_hint', 'ephemeral'],
    },
  ];
}

for (const spot of pack.spots) {
  if (spot.pack_role === 'directory') continue;
  const tr = pack.trigger_points.find((x) => x.id === spot.id);
  if (!tr?.general_info) continue;
  if ((spot.bullets || []).length >= 2) continue;
  const gi = tr.general_info;
  const parts = gi.split(/(?<=\.)\s+/).filter((x) => x.length > 40).slice(0, 3);
  if (parts.length >= 2) spot.bullets = parts.map((x) => x.trim());
  else if (gi.length > 80) {
    spot.bullets = [
      gi.slice(0, 160).trim(),
      (gi.slice(160, 320).trim() || 'Weitere Fakten im deep_data_pool.').trim(),
    ];
  }
}

pack._pack_index = {
  total: pack.spots.length,
  story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
  directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
  offline_qa: (pack._offline_qa || []).length,
  note: 'Lissabon bootstrap+research',
};

const file = savePack(pack, { bumpVersion: true });
console.log(
  `[fix] ${file} v${pack.data_version} offline=${pack._offline_qa.length} sg_approaches=${sg?.approach_triggers?.length || 0}`,
);
