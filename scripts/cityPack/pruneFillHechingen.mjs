#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR, loadPack, savePack } from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

const pack = loadPack('hechingen');

const nameKeep =
  /stiftskirche|johannes|barfuß|barfuss|erleb.?dich|starzel|hohenzollernblick|beurener|rathaus|krieger|oldtimer|fürstengarten|furstengarten|unterer turm|luzen|landesmuseum|freilicht|obertor|domäne|domane|stetten|bahnhof hechingen|burg hohenzollern|stadtgeschichte|jüdischer friedhof|judischer friedhof|marktplatz|happy|häppy|villa eugenia|heiliges|marienkapelle/i;

const researchedIds = new Set(
  pack.spots
    .filter((s) =>
      (s.tags || []).some((t) =>
        ['deep_research_merged', 'city_welcome', 'gap_fill', 'master_report'].includes(
          t,
        ),
      ) &&
      ((s.tags || []).includes('deep_research_merged') ||
        (s.tags || []).includes('city_welcome') ||
        /stadtgeschichte|unterer|luzen|friedhof|freilicht|obertor|stetten|domäne|domane|landesmuseum|fürsten|fursten|bahnhof|burg hohenzollern/i.test(
          s.id + s.name,
        )),
    )
    .map((s) => s.id),
);

const mustCats = new Set([
  'geschichte',
  'denkmal',
  'museum',
  'kirche',
  'bahnhof',
  'natur',
  'verwaltung',
  'aussicht',
]);

const keep = pack.spots.filter((s) => {
  if (researchedIds.has(s.id)) return true;
  if ((s.tags || []).includes('deep_research_merged')) return true;
  if ((s.tags || []).includes('city_welcome')) return true;
  if (nameKeep.test(s.name) || nameKeep.test(s.id)) return true;
  if ((s.tags || []).includes('must_have') && mustCats.has(s.category)) return true;
  // drop cafe/restaurant/hotel/gesundheit skeleton noise
  if (['cafe', 'restaurant', 'hotel', 'gesundheit'].includes(s.category)) return false;
  if ((s.tags || []).includes('optional_live') || (s.tags || []).includes('skeleton')) {
    return false;
  }
  return mustCats.has(s.category);
});

const keepIds = new Set(keep.map((s) => s.id));
const removed = pack.spots.length - keep.length;
pack.spots = keep;
pack.trigger_points = pack.trigger_points.filter((t) => keepIds.has(t.id));
console.log(`[prune] kept=${pack.spots.length} removed=${removed}`);

function fillSpot(rx, payload) {
  const spot = pack.spots.find((s) => rx.test(s.name) || rx.test(s.id));
  if (!spot) return;
  const t = pack.trigger_points.find((x) => x.id === spot.id);
  if (!t) return;
  if ((t.general_info || '').length >= 80) return;
  t.general_info = payload.gi;
  t.deep_data_pool = t.deep_data_pool || [];
  for (const text of payload.deep) {
    const tags = /^LIVE:/i.test(text)
      ? ['live_hint', 'ephemeral']
      : /^User-Frage/i.test(text)
        ? ['faq', 'user_question', 'master_report']
        : ['master_report'];
    if (!t.deep_data_pool.some((e) => (e.text || '').slice(0, 50) === text.slice(0, 50))) {
      t.deep_data_pool.push({ text, tags });
    }
  }
  if (!(spot.approach_triggers || []).length) {
    spot.approach_triggers = [
      {
        id: `${spot.id}_a1`,
        lat: t.lat + 0.00025,
        lng: t.lng,
        radius_m: 28,
        teaser_text: `${spot.name} liegt voraus.`,
        condition_rule: 'always',
      },
      {
        id: `${spot.id}_a2`,
        lat: t.lat - 0.00015,
        lng: t.lng + 0.0001,
        radius_m: 14,
        teaser_text: `Gleich da: ${spot.name}.`,
        condition_rule: 'always',
      },
    ];
  }
  spot.tags = [...new Set([...(spot.tags || []), 'gap_fill', 'master_report'])];
  console.log('[fill]', spot.id);
}

fillSpot(/stiftskirche/i, {
  gi: "Die Stiftskirche St. Jakobus prägt die Oberstadt: Architekt Pierre Michel d'Ixnard — geistliches Gegenstück zur Residenzgeschichte der Zollern, später Grablege nach Verlegung aus Stetten.",
  deep: [
    "Architekt der Stiftskirche: Pierre Michel d'Ixnard — sakrales Highlight der Oberstadt.",
    'Querverbindung Stetten: Ab 1488 verlegten die Grafen die Familiengruft vom Dominikanerinnenkloster Stetten in die Stiftskirche.',
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: In der Oberstadt markiert die große Stiftskirche St. Jakobus den sakralen Hochpunkt am städtischen Platzumfeld.',
    'LIVE: Gottesdienste und Konzerte frisch prüfen.',
  ],
});

fillSpot(/barfuss|barfuß/i, {
  gi: 'Im Feilbachtal liegt der rund 900 Meter lange Barfußpfad — Teil des Schaukelwegs häppy und der Naherholungsachse vom Obertorplatz.',
  deep: [
    'Teil des etwa 4 km langen Schaukelwegs häppy mit Themenstationen.',
    'Schließfächer für Schuhe am Einstieg laut Bericht.',
    'Hunde auf dem erleb-dich-/Barfußpfad streng verboten.',
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: Weg im Feilbachtal mit Barfußstationen und Schuhschließfächern.',
    'LIVE: Ob der Pfad begehbar ist, saisonal prüfen.',
  ],
});

fillSpot(/erleb.?dich/i, {
  gi: 'Der erleb-dich-Pfad im Feilbachtal ist die Barfuß-/Erlebnisstrecke der Stadt — verknüpft mit Schaukelweg und Kneipp-Angeboten.',
  deep: [
    'Querverbindung Obertorplatz: Startlogik des Schaukelwegs vom Feilbachtal aufwärts.',
    'Hunde verboten auf dem Pfad.',
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: Beschilderte Erlebnis-/Barfußstationen im Feilbachtal.',
    'LIVE: Zustand und Sperrungen frisch prüfen.',
  ],
});

fillSpot(/starzelpark/i, {
  gi: 'Am Starzelpark kann man Füße in der renaturierten Starzel kühlen — Familienpark mit Spielangeboten im Stadtgrün.',
  deep: [
    'Querverbindung Schaukelweg/Stadtgarten als grüne Achse.',
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: Grünanlage an der Starzel mit Spiel- und Wassernähe.',
    'LIVE: Wasserzugang und Spielgeräte saisonal prüfen.',
  ],
});

fillSpot(/hohenzollernblick/i, {
  gi: 'Aussichtspunkt Hohenzollernblick: freier Blick auf die Burg — Panorama-Anker ohne Burgticket.',
  deep: [
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: Sobald die Burg klar im Blickfeld steht und Plateau/Tafeln den Punkt markieren.',
    'Querverbindung Himmelsschaukel am Obertorplatz mit ausgerichtetem Burgblick.',
    'LIVE: Wegezustand prüfen.',
  ],
});

fillSpot(/beurener/i, {
  gi: 'Sonnenplateau Beurener Heide: freier Panoramablick auf die Burg Hohenzollern — einer der besten Fotoorte der Gemarkung.',
  deep: [
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: Offenes Plateau mit freiem Burgpanorama.',
    'LIVE: Zufahrt und Parken vor Ort prüfen.',
  ],
});

fillSpot(/rathaus/i, {
  gi: 'Rathaus Hechingen am Obertorplatz-Komplex: heutige Form 1957 von Paul Schmitthenner — Puls der Stadtverwaltung und Festort (u.a. Irma-West).',
  deep: [
    'Architekt Paul Schmitthenner, 1957.',
    'Tourist-Info/Bürgerbüro-Umfeld: Marktplatz 1 / Kirchplatz 12.',
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: Rathausfassade am verkehrsberuhigten Obertorplatz mit Wassertisch und grüner Mitte.',
    'LIVE: Bürgerbüro-Zeiten frisch prüfen.',
  ],
});

fillSpot(/krieger/i, {
  gi: 'Kriegerdenkmal in Hechingen — städtischer Erinnerungsort im öffentlichen Raum.',
  deep: [
    'User-Frage: Woran erkenne ich diesen Ort? Antwort: Als freistehendes Denkmal/Skulptur im öffentlichen Grün oder Platzumfeld, klar vom Alltag getrennt.',
    'LIVE: Gedenkveranstaltungen prüfen.',
  ],
});

const sg = pack.spots.find((s) => s.id === 'hechingen_stadtgeschichte');
if (sg) {
  const t = pack.trigger_points.find((x) => x.id === sg.id);
  sg.approach_triggers = [
    {
      id: 'hechingen_stadtgeschichte_a1',
      lat: t.lat + 0.0004,
      lng: t.lng,
      radius_m: 40,
      teaser_text:
        'Willkommen in der Zollernstadt — Burg über der Stadt, Geschichte unter den Füßen.',
      condition_rule: 'always',
    },
  ];
}

pack._mobility = pack._mobility || {
  bike_share: { providers: [], nextbike_city_id: null },
  parking: { parkopedia_enabled: false, hint_spots: [] },
};

const file = savePack(pack, { bumpVersion: true });
const gate = runQualityGate(pack, { strict: false });
fs.writeFileSync(
  path.join(STAEDTE_DIR, 'hechingen.prune_report.json'),
  JSON.stringify(
    {
      kept: pack.spots.length,
      removed,
      gate,
      names: pack.spots.map((s) => s.name),
    },
    null,
    2,
  ),
);
console.log(
  `[prune] wrote ${file} v${pack.data_version} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length} needsNarration=${gate.gaps.needsNarration.length}`,
);
console.log('[prune] remaining narration gaps:', gate.gaps.needsNarration.slice(0, 20));
