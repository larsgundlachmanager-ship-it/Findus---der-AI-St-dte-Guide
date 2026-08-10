/**
 * Patch Prisdorf city pack after first road test.
 * Run: node scripts/patchPrisdorfRoadtest.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '..', 'data', 'staedte', 'prisdorf.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

data.data_version = Math.max(Number(data.data_version) || 15, 16);

function findSpot(id) {
  return (data.spots || []).find((s) => s.id === id);
}

function findTriggerPoint(id) {
  return (data.trigger_points || []).find((t) => t.id === id);
}

const bahnhof = findSpot('prisdorf_bahnhof_wartehäuschen');
if (bahnhof) {
  bahnhof.name = 'Bahnhof Prisdorf';
  bahnhof.bullets = [
    '➔ Prisdorf ist seit 1844 an die Strecke Hamburg–Kiel angeschlossen und die einzige Kommune im Kreis Pinneberg ohne regulären Busanschluss.',
    '➔ Heute Haltepunkt (ohne Weichen): RB61/RB71 mit HVV-Ticket Richtung Hamburg oder Elmshorn.',
    '➔ Das denkmalgeschützte Fachwerk-Wartehäuschen von 1911 steht direkt am Bahnsteig — eigener Blickfang, eigener Stopp.',
  ];
  for (const a of bahnhof.approach_triggers || []) {
    if (a.id?.includes('gueter')) {
      a.lat = 53.67406;
      a.lng = 9.763339;
      a.radius_m = 22;
      a.teaser_text =
        'Richtung Gleisende: Dort lag der alte Güterbereich. Ein abgetrenntes Gleis verrät, dass Prisdorf früher mehr Bahnhof war als heute. Geh ruhig näher ran.';
    } else {
      a.teaser_text =
        'Siehst du schon den Bahnhof Prisdorf vor dir? Genau da gehen wir hin — und das kleine Fachwerk-Wartehäuschen daneben ist ein eigenes Schmuckstück.';
    }
  }
  for (const s of bahnhof.sub_pois || []) {
    if (s.id === 'prisdorf_bahnhof_wartehaeuschen_sub') {
      s.name = 'Historisches Bahnwartehäuschen';
      s.fact_details =
        'Siehst du das gemütliche Fachwerk mit dem Walmdach? 1911 von Bürgerinnen und Bürgern mitfinanziert, später vom Verein Wartehäuschen Prisdorf gerettet und saniert — das letzte erhaltene Stück der alten Bahnhofsanlage.';
      s.radius_m = 14;
    }
    if (s.id === 'prisdorf_bahnhof_gueterbahnsteig_sub') {
      s.name = 'Alter Güterbahnsteig / abgetrenntes Gleis';
      s.lat = 53.67406;
      s.lng = 9.763339;
      s.radius_m = 20;
      s.fact_details =
        'Genau hier lag früher der Güterbereich. Solange Weichen da waren und Güterzüge rangiert wurden, war Prisdorf ein waschechter Bahnhof. Das tote Gleis liegt isoliert da — ein Relikt. Schau vorsichtig rüber, ohne das Gleisfeld zu betreten, und vergleich es mit dem befahrenen Hauptgleis.';
    }
  }
  if (bahnhof.facts) {
    bahnhof.facts.origin =
      'Prisdorf ist seit 1844 an die Strecke Hamburg–Kiel bzw. Hamburg-Altona–Westerland angeschlossen.';
    bahnhof.facts.architecture =
      'Neben dem Bahnsteig steht das denkmalgeschützte Fachwerk-Wartehäuschen von 1911 — eigener Sub-Stopp.';
    bahnhof.facts.now =
      'Heute Haltepunkt ohne Weichen: RB61/RB71. Wer wegwill, steigt direkt in die Bahn — Prisdorf hat keinen regulären Busanschluss.';
  }
}

const schlueter = findSpot('prisdorf_bäcker_schlüter');
if (schlueter) {
  schlueter.name = 'Bäcker Schlüter';
  schlueter.tags = Array.from(
    new Set([
      ...(schlueter.tags || []),
      'story_enriched',
      'historical_core',
      'geschichte',
      'landmark_food',
    ]),
  );
  schlueter.polygonCoordinates = [
    { latitude: 53.67135, longitude: 9.77105 },
    { latitude: 53.67135, longitude: 9.77165 },
    { latitude: 53.6717, longitude: 9.77165 },
    { latitude: 53.6717, longitude: 9.77105 },
    { latitude: 53.67135, longitude: 9.77105 },
  ];
  for (const a of schlueter.approach_triggers || []) {
    a.radius_m = Math.max(a.radius_m || 20, 32);
    a.teaser_text =
      'Riechst du schon den Duft von frischen Brötchen? Vor dir liegt Bäcker Schlüter — Familienbetrieb seit 1888 und der einzige Sonntagsbäcker im Ort.';
  }
  if (schlueter.facts) {
    schlueter.facts.origin =
      'Bäcker Schlüter ist ein Familienbetrieb seit 1888 — über 130 Jahre Handwerksbackwaren im Nordwesten Hamburgs.';
    schlueter.facts.now =
      'Einziger Prisdorfer Bäcker mit Sonntagsladen: unter der Woche ab 7 Uhr bis nachmittags, samstags bis mittags, sonntags vormittags Franzbrötchen-Rettung.';
    schlueter.facts.tags = Array.from(
      new Set([...(schlueter.facts.tags || []), 'landmark_food', 'geschichte']),
    );
  }
}

const schlueterTp = findTriggerPoint('prisdorf_bäcker_schlüter');
if (schlueterTp) {
  schlueterTp.name = 'Bäcker Schlüter';
  schlueterTp.radius_m = 35;
  schlueterTp.special_radius_m = 8;
}

const teich = findSpot('prisdorf_feuerlöschteich_gemeindeteich');
if (teich) {
  for (const a of teich.approach_triggers || []) {
    a.teaser_text =
      'Siehst du den Feuerlöschteich? Hier übt die Jugendfeuerwehr, und im Winter gibt’s Weihnachtssingen mit Glühwein. Komm näher ran.';
  }
}

const gz = findSpot('prisdorf_gemeindezentrum_hudenbarg');
if (gz) {
  for (const a of gz.approach_triggers || []) {
    a.teaser_text =
      'Siehst du das Gemeindezentrum dort? Hier schlägt das Herz von Prisdorf — Kindergarten, Turnhalle, Feuerwache und der Bilsbekraum unter einem Dach.';
  }
}

const luette = findSpot('prisdorf_alte_schule_lütte_prisdörper');
if (luette) {
  luette.name = 'Kindergarten Lütte Prisdörper';
  for (const a of luette.approach_triggers || []) {
    a.teaser_text =
      'Hier war früher die Gemeindeschule, heute ist hier der Kindergarten Lütte Prisdörper. Komm näher — ich erzähl dir die Chronik flüssig.';
  }
  if (luette.facts) {
    luette.facts.origin =
      'Bis 2013 stand hier die Gemeinde-Grundschule. Nach dem Umbau eröffnete 2014 der Kindergarten Lütte Prisdörper neu am Dorfzentrum.';
    luette.facts.now =
      'Kindergarten-Chronik: 1976 erste Spielstunde, 1978 anerkannt, 1988 Umzug nach Dahl 60a (im Grenzbereich Hauen), 2014 zurück ans Dorfzentrum. Dahl 60a war also der alte Kindergarten-Standort — umgangssprachlich oft „im Hauen“ genannt.';
  }
}

for (const spot of data.spots || []) {
  for (const a of spot.approach_triggers || []) {
    if (/Schätzfrage|Quiz|gibt’s Geschichte, Alltag/i.test(a.teaser_text || '')) {
      const name = (spot.name || 'dem Ort').replace(/\s+Peiner Hag.*$/i, '');
      a.teaser_text = `Siehst du schon ${name}? Genau da gehen wir hin — ich erzähl dir gleich mehr.`;
    }
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Patched', file, '→ data_version', data.data_version);
