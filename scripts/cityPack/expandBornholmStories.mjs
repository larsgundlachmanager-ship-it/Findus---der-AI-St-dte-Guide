#!/usr/bin/env node
/**
 * Expand Bornholm island stories to ~60–75 tourist landmarks (not hotels/shops).
 */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR, distM } from './lib.mjs';
import { placesText, resolvePlace, setPackCityCostLabel } from './google.mjs';

setPackCityCostLabel('bornholm');

const EXTRA = [
  { name: 'Christiansø', aliases: ['Ertholmene', 'Christiansoe'], category: 'denkmal', tier: 1, gi: 'Seefestung von 1684 auf den Ertholmene vor Gudhjem — Turmmuseen, enge Gassen. LIVE: Fähre von Gudhjem prüfen.', deep: ['Festung ab 1684.', 'Fähre typischerweise von Gudhjem — LIVE Fahrplan.', 'Teil der Inselgruppe Ertholmene.'] },
  { name: 'NaturBornholm', aliases: ['Natur Bornholm Aakirkeby'], category: 'museum', tier: 1, gi: 'Geologie- und Naturzentrum in Aakirkeby (~3000–3800 m²): Inselgeschichte, Dinosaurier, Fossilien suchen im Außenbereich. LIVE: Saison/Eintritt prüfen.', deep: ['Eröffnet 2000 in Aakirkeby nahe Klintebakken.', 'Interaktive Ausstellung für Familien.', 'LIVE Eintritt oft ~150 DKK Erwachsene.'] },
  { name: 'Opalsøen', aliases: ['Opalsoen', 'Opalsøen Allinge'], category: 'natur', tier: 1, gi: 'Türkis-grüner Steinbruchsee bei Allinge — Wanderwege und (Saison) längste Zipline Dänemarks (Tovbanen, 290 m).', deep: ['Ehemaliger Steinbruch, heute Naturbad/See.', 'Tovbanen LIVE: Juni–August, Mindestgröße ~120 cm.'] },
  { name: 'Paradisbakkerne', aliases: ['Paradisbakkerne Bornholm'], category: 'natur', tier: 1, gi: 'Hügellandschaft mit Wanderwegen im Osten — Rokkestenen, Gamleborg und Ausblicke über die Insel.', deep: ['Klassisches Wandergebiet Ost-Bornholm.', 'Nahe: Rokkestenen, Gamleborg.'] },
  { name: 'Gamleborg', aliases: ['Gamleborg Paradisbakkerne', 'Gamleborg i Almindingen'], category: 'denkmal', tier: 2, gi: 'Frühmittelalterliche Wallburg in den Paradisbakkerne / Almindingen — eine der ältesten Befestigungen der Insel.', deep: ['Eisenzeit/frühes Mittelalter.', 'Teil der Wanderrouten Paradisbakkerne.'] },
  { name: 'Melstedgård', aliases: ['Melstedgaard', 'Melstedgård Landbrugsmuseum'], category: 'museum', tier: 2, gi: 'Landwirtschaftsmuseum bei Gudhjem: Hof aus dem späten 18. Jh. mit Tieren, Garten und historischem Gerät.', deep: ['Melstedvej 25, Nähe Gudhjem.', 'Familienfreundlich, Saison LIVE prüfen.'] },
  { name: 'Listed', aliases: ['Listed Havn', 'Listed Fiskerimuseum'], category: 'hafen', tier: 2, gi: 'Kleines Fischerdorf östlich von Gudhjem — Hafen und Fischereimuseum, ruhiger Küstencharakter.', deep: ['Zwischen Gudhjem und Svaneke.', 'Fischereimuseum LIVE öffnen prüfen.'] },
  { name: 'Tejn', aliases: ['Tejn Havn'], category: 'hafen', tier: 2, gi: 'Hafenort an der Nordküste mit Fischereigeschichte — Mole, Events, Nähe zu Allinge und Helligdomsklipperne.', deep: ['Nordbornholm zwischen Allinge und Gudhjem.', 'Raues Hafenmilieu, lokale Kultur.'] },
  { name: 'Snogebæk', aliases: ['Snogebaek', 'Snogebæk Havn'], category: 'hafen', tier: 2, gi: 'Fischerdorf im Süden zwischen Balka und Dueodde — lange Hafenbrücke, Glas/Handwerk, Sandstrände.', deep: ['Südostküste.', 'Historischer Hafen mit langer Brücke.'] },
  { name: 'Åkirkeby', aliases: ['Aakirkeby', 'Aa Kirke'], category: 'altstadt', tier: 2, gi: 'Inselmitte: Ausgangspunkt zu NaturBornholm, Wald und Outdoor — ruhiger Marktort mit Kirchengeschichte.', deep: ['Midtbornholm.', 'Nahe NaturBornholm und Almindingen.'] },
  { name: 'Aa Kirke', aliases: ['Aa Kirke Aakirkeby', 'Aakirke'], category: 'kirche', tier: 2, gi: 'Historische Kirche in Aakirkeby — Namensgeber des Ortes, mittelalterliche Substanz.', deep: ['Zentrum Aakirkeby.', 'LIVE: Öffnung prüfen.'] },
  { name: 'Allinge', aliases: ['Allinge Havn', 'Allinge-Sandvig'], category: 'hafen', tier: 1, gi: 'Nordküsten-Ort (mit Sandvig) — Ausgang zu Hammershus, Hammerknuden, Opalsøen und Folkemødet-Atmosphäre.', deep: ['Zwillingsort Allinge-Sandvig.', 'Nahe Hammershus und Madsebakke.'] },
  { name: 'Sandvig', aliases: ['Sandvig Strand'], category: 'strand', tier: 2, gi: 'Nachbarort von Allinge mit Strand und Felsküste — Nordspitze der Insel.', deep: ['Teil von Allinge-Sandvig.', 'Strände und Küstenwege.'] },
  { name: 'Madsebakke', aliases: ['Madsebakke helleristninger'], category: 'denkmal', tier: 2, gi: 'Größte Sammlung bronzezeitlicher Felsritzungen Dänemarks bei Allinge — Schiffe und Sonnenräder im Fels.', deep: ['Bronzezeitliche Petroglyphen.', 'Nahe Allinge/Sandvig.'] },
  { name: 'Tovbanen', aliases: ['Tovbanen Zipline', 'Tovbanen Opalsøen'], category: 'activity', tier: 2, gi: 'Längste Zipline Dänemarks (290 m) über den Opalsøen bei Allinge. LIVE: Saison Juni–August, Größe ab ~120 cm.', deep: ['Über dem Steinbruchsee Opalsøen.', 'LIVE Preise und Öffnung prüfen.'] },
  { name: 'Melsted Strand', aliases: ['Melsted Beach'], category: 'strand', tier: 3, gi: 'Strand bei Melsted / Gudhjem — ruhige Bucht an der Ostküste.', deep: ['Nähe Melstedgård und Gudhjem.'] },
  { name: 'Balka Strand', aliases: ['Balka Beach'], category: 'strand', tier: 2, gi: 'Familienfreundlicher Sandstrand an der Südostküste zwischen Nexø und Dueodde.', deep: ['Flacher Zugang, Südostküste.'] },
  { name: 'Grønbechs Gård', aliases: ['Gronbechs Gard', 'Bornholms Center for Kunsthåndværk'], category: 'museum', tier: 2, gi: 'Kunsthandwerk-Zentrum in Hasle — Glas, Keramik und Handwerk der World Craft Region Bornholm.', deep: ['Hasle.', 'Teil des Kunsthandwerk-Netzwerks der Insel.'] },
  { name: 'Bornholms Automobilmuseum', aliases: ['Automobilmuseum Aakirkeby'], category: 'museum', tier: 3, gi: 'Automuseum in Aakirkeby (Grammegårdsvej) — historische Fahrzeuge inkl. Ostblock/DDR-Sammlung.', deep: ['Aakirkeby.', 'LIVE Öffnung prüfen.'] },
  { name: 'Hasle', aliases: ['Hasle By'], category: 'altstadt', tier: 2, gi: 'Westküsten-Ort mit Hafen, Räucherei und Kunsthandwerk — Etappe zwischen Rønne und Hammershus.', deep: ['Westküste.', 'Nahe Grønbechs Gård und Jons Kapel.'] },
  { name: 'Almindingen', aliases: ['Almindingen Skov'], category: 'natur', tier: 1, gi: 'Großes Waldgebiet im Inselzentrum — Wandern, Radfahren, Ekkodalen und Rokkestenen.', deep: ['Eines der größten Waldgebiete Dänemarks auf einer Insel.', 'Kontrast zur Fels- und Sandküste.'] },
  { name: 'Store Klint', aliases: ['Jons Kapel Store Klint'], category: 'aussicht', tier: 3, gi: 'Steilküsten-Abschnitt an der Westküste nahe Jons Kapel.', deep: ['Westküsten-Klippen.'] },
  { name: 'Helligdomsklipperne', aliases: [], category: 'aussicht', tier: 1, gi: 'Steile Granitklippen bei Gudhjem mit Stegen — direkt am Bornholms Kunstmuseum.', deep: ['Nordostküste.', 'Visuell: Granitfelsen, Ostsee, schmale Pfade.'] },
  { name: 'Dueodde', aliases: ['Dueodde By'], category: 'strand', tier: 2, gi: 'Südspitze: Ort und Dünenlandschaft um den berühmten Feinsandstrand.', deep: ['Zusammen mit Dueodde Strand und Fyr.'] },
  { name: 'Nexø Havn', aliases: ['Nekso Havn'], category: 'hafen', tier: 2, gi: 'Hafen von Nexø — Fischerei und Ostküsten-Atmosphäre Richtung Dueodde.', deep: ['Zweitgrößte Stadt der Insel.'] },
  { name: 'Svaneke Fyr', aliases: ['Svaneke Lighthouse'], category: 'aussicht', tier: 3, gi: 'Leuchtturm bei Svaneke an der Ostküste.', deep: ['Ostküste nahe Svaneke.'] },
  { name: 'Gudhjem Museum', aliases: ['Gudhjem By Museum'], category: 'museum', tier: 3, gi: 'Ortsmuseum in Gudhjem — Stadt- und Fischergeschichte.', deep: ['LIVE Öffnung prüfen.'] },
  { name: 'Gudhjem Røgeri', aliases: ['Gudhjem Roegerí', 'Sol over Gudhjem'], category: 'restaurant', tier: 3, gi: 'Berühmte Räucherei in Gudhjem — Klassiker Sol over Gudhjem. Story als kulinarisches Wahrzeichen, nicht als Gastro-Spam.', deep: ['Wahrzeichen-Gericht Sol over Gudhjem.', 'LIVE Zeiten/Preise.'] },
  { name: 'Brændesgårdshaven', aliases: ['Joboland', 'Braendesgaardshaven'], category: 'freizeitpark', tier: 2, gi: 'Freizeitpark bei Svaneke: Fahrgeschäfte, Wasserpark, Kleintiere. Saison typisch Mai–September — LIVE prüfen.', deep: ['Familienziel Ostküste.', 'Früher Joboland.'] },
  { name: 'Bornholms Middelaldercenter', aliases: ['Middelaldercentret Østerlars'], category: 'museum', tier: 2, gi: 'Mittelalterzentrum bei Østerlars neben der Rundkirche — Saison Mai–Oktober, Fest Mitte Juli LIVE.', deep: ['Eintritt LIVE prüfen.', 'Direkt an Østerlars Rundkirke.'] },
  { name: 'Vang', aliases: ['Vang Bornholm'], category: 'natur', tier: 3, gi: 'Ort und Küste an der Nordwestseite — Anstieg Richtung Hammershus auf der Radroute.', deep: ['Zwischen Hasle und Hammershus.'] },
  { name: 'Helligpeder', aliases: [], category: 'strand', tier: 3, gi: 'Kleine Westküsten-Bucht / Fischerstelle an der Route Richtung Hammershus.', deep: ['Westküste.'] },
  { name: 'Randkløve Skår', aliases: ['Randklove Skar'], category: 'aussicht', tier: 2, gi: 'Dramatische Felsspalte/Klippe an der Ostküste — Wanderziel mit Ausblick.', deep: ['Ostküsten-Natur.'] },
  { name: 'Østerlars', aliases: ['Osterlars By'], category: 'altstadt', tier: 3, gi: 'Ort um die große Rundkirche und das Middelaldercenter — guter Halbtagesstopp mit Gudhjem.', deep: ['Inland nahe Gudhjem.'] },
  { name: 'Pedersker', aliases: [], category: 'natur', tier: 3, gi: 'Südliches Inseldorf Richtung Dueodde — ländliches Bornholm.', deep: ['Südinsel.'] },
  { name: 'Ibsker', aliases: [], category: 'kirche', tier: 3, gi: 'Kirchdorf im Osten — typische Inselkirche abseits der Küstenorte.', deep: ['Ostinsel.'] },
  { name: 'Sankt Knuds Kirke', aliases: ['St Knuds Kirke Rønne'], category: 'kirche', tier: 3, gi: 'Kirche in/bei Rønne — weiteres Sakralbau-Wahrzeichen der Hauptstadt.', deep: ['Rønne-Umfeld.'] },
  { name: 'Store Torv Rønne', aliases: ['Store Torv'], category: 'altstadt', tier: 3, gi: 'Zentraler Marktplatz in Rønne — Altstadt-Anker.', deep: ['Fußläufig vom Hafen.'] },
  { name: 'Laksegade', aliases: ['Laksegade Rønne'], category: 'altstadt', tier: 3, gi: 'Charakteristische Altstadtgasse in Rønne.', deep: ['Rønne Altstadt.'] },
  { name: 'Lille Torv Rønne', aliases: ['Lille Torv'], category: 'altstadt', tier: 3, gi: 'Kleiner Marktplatz in der Rønne-Altstadt.', deep: ['Rønne.'] },
];

const DISCOVER_QUERIES = [
  'Hammershus Bornholm',
  'attraction Bornholm Denmark',
  'museum Bornholm',
  'rundkirke Bornholm',
  'strand beach Bornholm',
  'viewpoint cliff Bornholm',
  'harbour Gudhjem Svaneke Allinge',
  'NaturBornholm Aakirkeby',
  'Paradisbakkerne Bornholm',
  'Opalsøen Allinge',
  'Melstedgård Gudhjem',
  'Madsebakke Allinge',
  'Listed Bornholm',
  'Snogebæk Bornholm',
  'Tejn Bornholm',
  'Christiansø ferry',
  'lighthouse Bornholm',
];

const FORCE_DIR =
  /hotel|hostel|danhostel|camping|feriepark|restaurant|cafeteria|cafe\b|grill|pizza|bodega|steakhouse|thai|spar\b|k[øo]bmand|circle\s*k|tank|oil|cykel|bike\s*shop|minigolf|hallen|idr[æa]t|turistinformation|proviant|shoppen|brød|diner|familiecamping|vandrerhjem|svømmehal|sommerpension|kroen(?!.*christians)|madhus/i;

const packPath = path.join(STAEDTE_DIR, 'bornholm.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const center = { lat: p.lat, lng: p.lng };

function ensureTp(spot) {
  if (!p.trigger_points) p.trigger_points = [];
  let tp = p.trigger_points.find((t) => t.id === spot.id);
  if (!tp) {
    tp = { id: spot.id, name: spot.name, lat: spot.lat, lng: spot.lng };
    p.trigger_points.push(tp);
  }
  return tp;
}

function findByNames(names) {
  const keys = names.map((n) => String(n).toLowerCase());
  for (const s of p.spots) {
    const n = String(s.name || '').toLowerCase();
    if (keys.some((k) => n === k || n.includes(k.slice(0, 12)) || k.includes(n.slice(0, 12)))) {
      return s;
    }
  }
  return null;
}

function upsertStory(r) {
  let s = findByNames([r.name, ...(r.aliases || [])]);
  if (!s) {
    let id = `bornholm_${String(r.name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'oe')
      .replace(/å/g, 'aa')
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 42)}`;
    const base = id;
    let n = 2;
    while (p.spots.some((x) => x.id === id)) id = `${base}_${n++}`;
    s = {
      id,
      name: r.name,
      lat: center.lat,
      lng: center.lng,
      category: r.category,
      pack_role: 'story',
      place_tier: r.tier,
      tags: ['story', 'island', 'expand'],
    };
    p.spots.push(s);
    console.log('[add]', r.name);
  }
  if (FORCE_DIR.test(s.name) && !/røgeri|kunstmuseum|naturbornholm|middelalder|automobil/i.test(s.name)) {
    return s;
  }
  s.pack_role = 'story';
  s.place_tier = r.tier;
  s.category = r.category;
  s.name = r.name;
  s.tags = [
    ...new Set([
      ...(s.tags || []).filter((t) => !['directory', 'demoted_noise'].includes(t)),
      'story',
      'island',
      r.tier === 1 ? 'must_have' : 'tourist',
    ]),
  ];
  const tp = ensureTp(s);
  tp.name = s.name;
  if (r.gi) tp.general_info = r.gi;
  if (r.deep?.length) {
    tp.deep_data_pool = r.deep.map((text) => ({ text, tags: ['research', 'sourced'] }));
  }
  return s;
}

for (const r of EXTRA) upsertStory(r);

// Places discovery — tourist attractions island-wide
for (const q of DISCOVER_QUERIES) {
  try {
    console.log('[discover]', q);
    const data = await placesText(`${q}`, {
      lat: center.lat,
      lng: center.lng,
      radiusM: 22000,
    });
    for (const r of (data.results || []).slice(0, 8)) {
      const loc = r.geometry?.location;
      if (!loc || !r.name) continue;
      if (distM(center, loc) > 28000) continue;
      if (FORCE_DIR.test(r.name)) continue;
      const types = (r.types || []).join(' ');
      if (/lodging|restaurant|meal_takeaway|store|supermarket|gas_station|parking/i.test(types)) {
        continue;
      }
      let cat = 'denkmal';
      let tier = 3;
      if (/museum|art_gallery/i.test(types) || /museum|galleri/i.test(r.name)) {
        cat = 'museum';
        tier = 2;
      } else if (/church|place_of_worship|kirke|rundkirke/i.test(types + r.name)) {
        cat = 'kirche';
        tier = 2;
      } else if (/park|natural|strand|beach|klippe|bakke/i.test(types + r.name)) {
        cat = /strand|beach/i.test(r.name) ? 'strand' : 'natur';
        tier = 2;
      } else if (/harbor|harbour|havn|marina/i.test(types + r.name)) {
        cat = 'hafen';
        tier = 2;
      } else if (/lighthouse|fyr|viewpoint|aussicht/i.test(r.name)) {
        cat = 'aussicht';
        tier = 2;
      }
      const existing = findByNames([r.name]);
      if (existing) {
        if (existing.pack_role === 'directory' && !FORCE_DIR.test(r.name)) {
          existing.pack_role = 'story';
          existing.place_tier = Math.min(existing.place_tier || 3, tier);
          existing.category = existing.category || cat;
          existing.lat = loc.lat;
          existing.lng = loc.lng;
        }
        continue;
      }
      let id = `bornholm_${String(r.name)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 42)}`;
      const base = id;
      let n = 2;
      while (p.spots.some((x) => x.id === id)) id = `${base}_${n++}`;
      p.spots.push({
        id,
        name: r.name,
        lat: loc.lat,
        lng: loc.lng,
        category: cat,
        pack_role: 'story',
        place_tier: tier,
        tags: ['story', 'island', 'places_discover'],
        google_place_id: r.place_id || null,
      });
      console.log('[places+]', r.name, cat);
    }
  } catch (e) {
    console.warn('[discover fail]', q, e.message);
  }
}

// Final demote noise
for (const s of p.spots) {
  if (FORCE_DIR.test(s.name || '') && !/røgeri|kunstmuseum|naturbornholm|middelalder|automobil|grønbech/i.test(s.name || '')) {
    s.pack_role = 'directory';
    s.place_tier = 4;
    s.tags = [...new Set([...(s.tags || []), 'directory', 'demoted_noise'])];
  }
}

// Geocode stories without good coords
const stories = p.spots.filter((s) => s.pack_role !== 'directory');
for (const s of stories) {
  const bad =
    !Number.isFinite(s.lat) ||
    !Number.isFinite(s.lng) ||
    distM({ lat: s.lat, lng: s.lng }, center) < 60;
  if (!bad) continue;
  try {
    const hit = await resolvePlace(`${s.name} Bornholm Denmark`, center);
    if (hit?.lat != null) {
      s.lat = hit.lat;
      s.lng = hit.lng;
      const tp = ensureTp(s);
      tp.lat = hit.lat;
      tp.lng = hit.lng;
      console.log('[gps]', s.name, hit.lat.toFixed(4), hit.lng.toFixed(4));
    }
  } catch {
    /* soft */
  }
}

p.country = 'DK';
p.region = 'Bornholm';
p._pack_index = {
  ...(p._pack_index || {}),
  total: p.spots.length,
  story: p.spots.filter((s) => s.pack_role !== 'directory').length,
  directory: p.spots.filter((s) => s.pack_role === 'directory').length,
};
p.data_version = (Number(p.data_version) || 0) + 1;
fs.writeFileSync(packPath, JSON.stringify(p, null, 2), 'utf8');

const finalStories = p.spots.filter((s) => s.pack_role !== 'directory');
let max = 0;
for (const s of finalStories) {
  if (!Number.isFinite(s.lat)) continue;
  max = Math.max(max, distM(center, { lat: s.lat, lng: s.lng }));
}
console.log(
  `[expand] story=${finalStories.length} dir=${p._pack_index.directory} spanKm=${(max / 1000).toFixed(1)} v${p.data_version}`,
);
finalStories
  .sort((a, b) => (a.place_tier || 9) - (b.place_tier || 9) || a.name.localeCompare(b.name))
  .forEach((s) => {
    const d = Number.isFinite(s.lat)
      ? `${(distM(center, { lat: s.lat, lng: s.lng }) / 1000).toFixed(1)}km`
      : '?';
    console.log(`  T${s.place_tier} ${d.padStart(6)} ${(s.category || '').padEnd(12)} ${s.name}`);
  });
