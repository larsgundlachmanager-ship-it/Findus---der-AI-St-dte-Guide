#!/usr/bin/env node
/** Fix obvious category mislabels after full Prisdorf optimize. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/prisdorf.json');
const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));

const FIX = {
  prisdorf_gemeindezentrum_hudenbarg: 'verwaltung',
  prisdorf_kriegerehrenmal_bilsbek: 'denkmal',
  prisdorf_peiner_hof: 'sport',
  prisdorf_gemeinschaftspraxis: 'gesundheit',
  prisdorf_zahnarztpraxis: 'gesundheit',
  prisdorf_bilsbekraum: 'verwaltung',
  prisdorf_fairway_hotel: 'restaurant',
  prisdorf_bäcker_schlüter: 'cafe',
  prisdorf_backstube_münster: 'cafe',
  prisdorf_haus_prisdorf_altenheim: 'service',
  prisdorf_drk_ortsverein: 'service',
  prisdorf_pmv_veranstaltungen: 'kultur',
  prisdorf_stadtgeschichte_gesamt: 'geschichte',
  prisdorf_strassenverzeichnis: 'geschichte',
  prisdorf_strassen_gestern_heute: 'geschichte',
  prisdorf_eisenbahnbrücke_hudenbarg: 'transport',
  prisdorf_grossstadtmission_dahl: 'soziales',
};

let geoComplete = 0;
for (const s of pack.spots) {
  if (FIX[s.id]) {
    s.category = FIX[s.id];
    s.tags = Array.from(new Set([FIX[s.id], ...(s.tags || [])]));
  }
  if (
    s.polygonCoordinates?.length >= 3 &&
    (s.approach_triggers || []).length >= 1
  ) {
    geoComplete += 1;
  }
}

const v = validateCityPack(pack);
if (!v.ok) {
  console.error(v.errors);
  process.exit(1);
}

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));
console.log(
  JSON.stringify(
    {
      version: pack.data_version,
      spots: pack.spots.length,
      geoComplete,
      missingGeo: pack.spots.length - geoComplete,
    },
    null,
    2,
  ),
);
