#!/usr/bin/env node
/**
 * Expand Amsterdam metro landmarks (Places API New) as deep stories.
 *   node scripts/cityPack/expandAmsterdamLandmarks.mjs
 */
import {
  boxPolygon,
  distM,
  loadPack,
  offset,
  savePack,
  slugify,
  suggestedPolygonHalfM,
} from './lib.mjs';
import { resolvePlace, requireGoogleKey } from './google.mjs';

requireGoogleKey();
const CITY_ID = 'amsterdam';
const CENTER = { lat: 52.3676, lng: 4.9041 };

/** Metro icons — stories only (no hotels/gastro noise). */
const LANDMARKS = [
  // Core already partly present — resolve promotes/fills gaps
  { q: "A'DAM Lookout Amsterdam", name: "A'DAM Lookout", category: 'aussicht', tier: 1 },
  { q: 'Ons Lieve Heer op Solder Amsterdam', name: "Ons' Lieve Heer op Solder", category: 'museum', tier: 1 },
  { q: 'Amsterdam Museum', name: 'Amsterdam Museum', category: 'museum', tier: 1 },
  { q: 'Beurs van Berlage Amsterdam', name: 'Beurs van Berlage', category: 'denkmal', tier: 1 },
  { q: 'Basiliek van de Heilige Nicolaas Amsterdam', name: 'Sint-Nicolaasbasiliek', category: 'kirche', tier: 1 },
  { q: 'Noorderkerk Amsterdam', name: 'Noorderkerk', category: 'kirche', tier: 2 },
  { q: 'Leidseplein Amsterdam', name: 'Leidseplein', category: 'altstadt', tier: 1 },
  { q: 'Rembrandtplein Amsterdam', name: 'Rembrandtplein', category: 'altstadt', tier: 1 },
  { q: 'Nieuwmarkt Amsterdam', name: 'Nieuwmarkt', category: 'altstadt', tier: 1 },
  { q: 'Waterlooplein Amsterdam', name: 'Waterlooplein', category: 'markt', tier: 2 },
  { q: 'De Wallen Amsterdam Red Light District', name: 'De Wallen', category: 'altstadt', tier: 1 },
  { q: 'Negen Straatjes Amsterdam', name: 'Negen Straatjes', category: 'altstadt', tier: 1 },
  { q: 'Brouwersgracht Amsterdam', name: 'Brouwersgracht', category: 'altstadt', tier: 1 },
  { q: 'Herengracht Amsterdam Canal', name: 'Herengracht', category: 'altstadt', tier: 1 },
  { q: 'Keizersgracht Amsterdam', name: 'Keizersgracht', category: 'altstadt', tier: 1 },
  { q: 'Prinsengracht Amsterdam', name: 'Prinsengracht', category: 'altstadt', tier: 1 },
  { q: 'Singel Amsterdam canal', name: 'Singel', category: 'altstadt', tier: 2 },
  { q: 'FOAM Fotografiemuseum Amsterdam', name: 'FOAM', category: 'museum', tier: 2 },
  { q: 'Allard Pierson Museum Amsterdam', name: 'Allard Pierson', category: 'museum', tier: 2 },
  { q: 'Museum Van Loon Amsterdam', name: 'Museum Van Loon', category: 'museum', tier: 2 },
  { q: 'Museum Willet-Holthuysen Amsterdam', name: 'Museum Willet-Holthuysen', category: 'museum', tier: 2 },
  { q: 'HART Museum Amsterdam Hermitage', name: "H'ART Museum", category: 'museum', tier: 2 },
  { q: 'Verzetsmuseum Amsterdam', name: 'Verzetsmuseum', category: 'museum', tier: 1 },
  { q: 'Hollandsche Schouwburg Amsterdam', name: 'Hollandsche Schouwburg', category: 'denkmal', tier: 1 },
  { q: 'Portuguese Synagogue Amsterdam', name: 'Portugese Synagoge', category: 'kirche', tier: 1 },
  { q: 'Micropia Amsterdam', name: 'Micropia', category: 'museum', tier: 2 },
  { q: 'Heineken Experience Amsterdam', name: 'Heineken Experience', category: 'freizeit', tier: 2 },
  { q: 'Houseboat Museum Amsterdam', name: 'Houseboat Museum', category: 'museum', tier: 2 },
  { q: 'VOC ship Amsterdam Nederlands Scheepvaartmuseum', name: 'VOC-schip Amsterdam', category: 'denkmal', tier: 1 },
  { q: 'Oosterdok Amsterdam', name: 'Oosterdok', category: 'hafen', tier: 2 },
  { q: 'Openbare Bibliotheek Amsterdam OBA', name: 'OBA Centrale Bibliotheek', category: 'museum', tier: 2 },
  { q: 'Stopera Amsterdam City Hall', name: 'Stopera', category: 'denkmal', tier: 2 },
  { q: 'Muziekgebouw aan t IJ Amsterdam', name: "Muziekgebouw aan 't IJ", category: 'theater', tier: 2 },
  { q: 'Bimhuis Amsterdam', name: 'Bimhuis', category: 'theater', tier: 2 },
  { q: 'Paradiso Amsterdam', name: 'Paradiso', category: 'theater', tier: 2 },
  { q: 'Melkweg Amsterdam', name: 'Melkweg', category: 'theater', tier: 2 },
  { q: 'Carré Theater Amsterdam', name: 'Koninklijk Theater Carré', category: 'theater', tier: 2 },
  { q: 'Olympisch Stadion Amsterdam', name: 'Olympisch Stadion', category: 'sport', tier: 2 },
  { q: 'Johan Cruijff ArenA Amsterdam', name: 'Johan Cruijff ArenA', category: 'sport', tier: 1 },
  { q: 'Amsterdamse Bos', name: 'Amsterdamse Bos', category: 'natur', tier: 1 },
  { q: 'Amstelpark Amsterdam', name: 'Amstelpark', category: 'natur', tier: 2 },
  { q: 'Frankendael Park Amsterdam', name: 'Park Frankendael', category: 'natur', tier: 3 },
  { q: 'Flevopark Amsterdam', name: 'Flevopark', category: 'natur', tier: 3 },
  { q: 'Westergasfabriek Amsterdam', name: 'Westergasfabriek', category: 'altstadt', tier: 1 },
  { q: 'IJ-Hallen Amsterdam', name: 'IJ-Hallen', category: 'markt', tier: 2 },
  { q: 'Buiksloterweg ferry Amsterdam', name: 'Buiksloterwegveer', category: 'hafen', tier: 2 },
  { q: 'Java-eiland Amsterdam', name: 'Java-eiland', category: 'altstadt', tier: 2 },
  { q: 'KNSM-eiland Amsterdam', name: 'KNSM-eiland', category: 'altstadt', tier: 2 },
  { q: 'Zeeburgereiland Amsterdam', name: 'Zeeburgereiland', category: 'altstadt', tier: 3 },
  { q: 'Haarlemmerstraat Amsterdam', name: 'Haarlemmerstraat', category: 'altstadt', tier: 2 },
  { q: 'Spui Amsterdam', name: 'Spui', category: 'altstadt', tier: 2 },
  { q: 'Kalverstraat Amsterdam', name: 'Kalverstraat', category: 'einkaufen', tier: 2 },
  { q: 'Damrak Amsterdam', name: 'Damrak', category: 'altstadt', tier: 2 },
  { q: 'Rokin Amsterdam', name: 'Rokin', category: 'altstadt', tier: 2 },
  { q: 'Zeedijk Amsterdam', name: 'Zeedijk', category: 'altstadt', tier: 2 },
  { q: 'Chin. Buurt Zeedijk Amsterdam', name: 'Chinatown Zeedijk', category: 'altstadt', tier: 2 },
  { q: 'Munttoren Amsterdam', name: 'Munttoren', category: 'denkmal', tier: 1 },
  { q: 'Reguliersgracht Amsterdam', name: 'Reguliersgracht', category: 'altstadt', tier: 2 },
  { q: 'Seven Bridges Reguliersgracht', name: 'Sieben Brücken (Reguliersgracht)', category: 'aussicht', tier: 2 },
  { q: 'Homomonument Amsterdam', name: 'Homomonument', category: 'denkmal', tier: 1 },
  { q: 'Nationaal Monument Dam Amsterdam', name: 'Nationaal Monument Dam', category: 'denkmal', tier: 1 },
  { q: 'Dokwerker Monument Amsterdam', name: 'De Dokwerker', category: 'denkmal', tier: 2 },
  { q: 'Schreierstoren Amsterdam', name: 'Schreierstoren', category: 'denkmal', tier: 2 },
  { q: 'Waag Nieuwmarkt Amsterdam', name: 'De Waag', category: 'denkmal', tier: 1 },
  { q: 'Trippenhuis Amsterdam', name: 'Trippenhuis', category: 'denkmal', tier: 2 },
  { q: 'Felix Meritis Amsterdam', name: 'Felix Meritis', category: 'denkmal', tier: 2 },
  { q: 'De Krijtberg Amsterdam', name: 'De Krijtberg', category: 'kirche', tier: 2 },
  { q: 'English Reformed Church Begijnhof Amsterdam', name: 'English Reformed Church Begijnhof', category: 'kirche', tier: 3 },
  { q: 'Rijksmuseum tuin Amsterdam', name: 'Rijksmuseumtuinen', category: 'natur', tier: 2 },
  { q: 'Museumplein IAmsterdam letters', name: 'I amsterdam Letters Museumplein', category: 'denkmal', tier: 3, skip: true },
  { q: 'Coster Diamonds Amsterdam', name: 'Coster Diamonds', category: 'einkaufen', tier: 3 },
  { q: 'Diamond Museum Amsterdam', name: 'Diamond Museum', category: 'museum', tier: 3 },
  { q: 'Madame Tussauds Amsterdam', name: 'Madame Tussauds Amsterdam', category: 'freizeit', tier: 3 },
  { q: 'Body Worlds Amsterdam', name: 'Body Worlds Amsterdam', category: 'museum', tier: 3 },
  { q: 'Sex Museum Amsterdam', name: 'Sexmuseum Amsterdam', category: 'museum', tier: 3 },
  { q: 'Hash Marijuana Hemp Museum Amsterdam', name: 'Hash Museum', category: 'museum', tier: 3 },
  { q: 'Electric Ladyland Amsterdam', name: 'Electric Ladyland', category: 'museum', tier: 3 },
  { q: 'Cheese Museum Amsterdam', name: 'Amsterdam Cheese Museum', category: 'museum', tier: 3, skip: true },
  { q: 'Torture Museum Amsterdam', name: 'Torture Museum', category: 'museum', tier: 3, skip: true },
  { q: 'Amsterdam Pipe Museum', name: 'Amsterdam Pipe Museum', category: 'museum', tier: 3 },
  { q: 'Bijbels Museum Amsterdam', name: 'Bijbels Museum', category: 'museum', tier: 3 },
  { q: 'Pianola Museum Amsterdam', name: 'Pianola Museum', category: 'museum', tier: 3 },
  { q: 'Museum of Bags and Purses Amsterdam', name: 'Tassenmuseum', category: 'museum', tier: 3 },
  { q: 'Multatuli Museum Amsterdam', name: 'Multatuli Huis', category: 'museum', tier: 3 },
  { q: 'Geelvinck Pianola Museum', name: 'SKIP_dup', skip: true },
  { q: 'Het Schip Amsterdam School Museum', name: 'Museum Het Schip', category: 'museum', tier: 2 },
  { q: 'Spaarndammerbuurt Amsterdam', name: 'Spaarndammerbuurt', category: 'altstadt', tier: 2 },
  { q: 'De Pijp Amsterdam', name: 'De Pijp', category: 'altstadt', tier: 1 },
  { q: 'Jordaan Amsterdam', name: 'Jordaan', category: 'altstadt', tier: 1 },
  { q: 'Grachtengordel Amsterdam UNESCO', name: 'Grachtengordel', category: 'altstadt', tier: 1 },
  { q: 'Plantage Amsterdam district', name: 'Plantage', category: 'altstadt', tier: 2 },
  { q: 'Jewish Cultural Quarter Amsterdam', name: 'Joods Cultureel Kwartier', category: 'altstadt', tier: 1 },
  { q: 'Wertheimpark Amsterdam', name: 'Wertheimpark', category: 'natur', tier: 3 },
  { q: 'Entrepotdok Amsterdam', name: 'Entrepotdok', category: 'altstadt', tier: 2 },
  { q: 'Kadijken Amsterdam', name: 'Kadijken', category: 'altstadt', tier: 3 },
  { q: 'Amstel River Amsterdam Magere Brug', name: 'Amstel', category: 'natur', tier: 2 },
  { q: 'Amstel Hotel Amsterdam landmark', name: 'Hotel Amstel facade', category: 'denkmal', tier: 3, skip: true },
  { q: 'Blauwbrug Amsterdam', name: 'Blauwbrug', category: 'denkmal', tier: 2 },
  { q: 'Torensluis Singel Amsterdam', name: 'Torensluis', category: 'denkmal', tier: 2 },
  { q: 'Skinny Bridge Magere Brug', name: 'Magere Brug', category: 'denkmal', tier: 1 },
  { q: 'NEMO Science Museum Amsterdam', name: 'NEMO Science Museum', category: 'museum', tier: 1 },
  { q: 'EYE Filmmuseum Amsterdam', name: 'EYE Filmmuseum', category: 'museum', tier: 1 },
  { q: 'Tolhuistuin Amsterdam', name: 'Tolhuistuin', category: 'altstadt', tier: 3 },
  { q: 'Overhoeks Tower Amsterdam', name: 'Overhoeks', category: 'denkmal', tier: 2 },
  { q: "A'DAM Tower Amsterdam", name: "A'DAM Toren", category: 'denkmal', tier: 2 },
  { q: 'Ferry Central Station Buiksloterweg', name: 'Centraal–Noord Ferry', category: 'hafen', tier: 2 },
  { q: 'Sloterdijk Station Amsterdam', name: 'Station Sloterdijk', category: 'bahnhof', tier: 3 },
  { q: 'Station Zuid Amsterdam', name: 'Station Zuid', category: 'bahnhof', tier: 3 },
  { q: 'RAI Amsterdam', name: 'RAI Amsterdam', category: 'freizeit', tier: 2 },
  { q: 'Ziggo Dome Amsterdam', name: 'Ziggo Dome', category: 'theater', tier: 2 },
  { q: 'AFAS Live Amsterdam', name: 'AFAS Live', category: 'theater', tier: 3 },
  { q: 'De Nieuwe Kerk Amsterdam', name: 'Nieuwe Kerk', category: 'kirche', tier: 1 },
  { q: 'Oude Kerk Amsterdam', name: 'Oude Kerk', category: 'kirche', tier: 1 },
  { q: 'Westerkerk Amsterdam', name: 'Westerkerk', category: 'kirche', tier: 1 },
  { q: 'Zuiderkerk Amsterdam', name: 'Zuiderkerk', category: 'kirche', tier: 2 },
  { q: 'Rijksmuseum Amsterdam', name: 'Rijksmuseum Amsterdam', category: 'museum', tier: 1 },
  { q: 'Van Gogh Museum Amsterdam', name: 'Van Gogh Museum', category: 'museum', tier: 1 },
  { q: 'Stedelijk Museum Amsterdam', name: 'Stedelijk Museum', category: 'museum', tier: 1 },
  { q: 'Anne Frank House Amsterdam', name: 'Anne Frank Huis', category: 'museum', tier: 1 },
  { q: 'Vondelpark Amsterdam', name: 'Vondelpark', category: 'natur', tier: 1 },
  { q: 'Artis Zoo Amsterdam', name: 'Artis Royal Zoo', category: 'freizeit', tier: 1 },
  { q: 'Hortus Botanicus Amsterdam', name: 'Hortus Botanicus Amsterdam', category: 'natur', tier: 1 },
  { q: 'Scheepvaartmuseum Amsterdam', name: 'Het Scheepvaartmuseum', category: 'museum', tier: 1 },
  { q: 'Rembrandthuis Amsterdam', name: 'Museum Rembrandthuis', category: 'museum', tier: 1 },
  { q: 'Concertgebouw Amsterdam', name: 'Concertgebouw', category: 'theater', tier: 1 },
  { q: 'Koninklijk Paleis Amsterdam', name: 'Koninklijk Paleis', category: 'denkmal', tier: 1 },
  { q: 'Begijnhof Amsterdam', name: 'Begijnhof', category: 'altstadt', tier: 1 },
  { q: 'Dam Square Amsterdam', name: 'Dam', category: 'altstadt', tier: 1 },
  { q: 'Museumplein Amsterdam', name: 'Museumplein', category: 'altstadt', tier: 1 },
  { q: 'Albert Cuyp Markt Amsterdam', name: 'Albert Cuyp Markt', category: 'markt', tier: 1 },
  { q: 'Bloemenmarkt Amsterdam', name: 'Bloemenmarkt', category: 'markt', tier: 1 },
  { q: 'NDSM Werf Amsterdam', name: 'NDSM-Werf', category: 'altstadt', tier: 1 },
  { q: 'Wereldmuseum Amsterdam Tropenmuseum', name: 'Wereldmuseum Amsterdam', category: 'museum', tier: 1 },
  { q: 'Moco Museum Amsterdam', name: 'Moco Museum Amsterdam', category: 'museum', tier: 2 },
  { q: 'Joods Historisch Museum Amsterdam', name: 'Joods Historisch Museum', category: 'museum', tier: 1 },
  { q: 'National Opera Ballet Amsterdam Stopera', name: 'Nationale Opera & Ballet', category: 'theater', tier: 1 },
];

function approaches(lat, lng, name, spotId) {
  return [
    { id: 'n', north: 45, east: 0, r: 36 },
    { id: 's', north: -40, east: 0, r: 24 },
  ].map((d) => {
    const p = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: d.r,
      teaser_text: `${name} liegt kurz voraus — auf die typische Silhouette bzw. den Eingang achten.`,
      condition_rule: 'always',
      needs_visual_review: true,
    };
  });
}

function nameSimilar(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, ' ');
  const na = norm(a);
  const nb = norm(b);
  const wa = new Set(na.split(' ').filter((w) => w.length > 3));
  let hit = 0;
  for (const w of nb.split(' ').filter((w) => w.length > 3)) if (wa.has(w)) hit += 1;
  return hit >= 2 || na.includes(nb.slice(0, 10)) || nb.includes(na.slice(0, 10));
}

async function main() {
  const pack = loadPack(CITY_ID);
  if (!pack) throw new Error('amsterdam pack missing');
  pack.symbol = pack.symbol || '🇳🇱';
  pack._product = {
    family: 'international',
    tier: 'metro',
    paywall: false,
    notes: 'Amsterdam metro core + IJ/Noord/Zuid icons',
  };

  let added = 0;
  let promoted = 0;
  for (const lm of LANDMARKS) {
    if (lm.skip) continue;
    process.stdout.write(`[ams] ${lm.name}… `);
    let hit = null;
    try {
      hit = await resolvePlace(lm.q, {
        near: { lat: CENTER.lat, lng: CENTER.lng, radiusM: 14000 },
      });
    } catch (e) {
      console.log('fail', String(e.message || e).slice(0, 80));
      continue;
    }
    if (!hit?.lat) {
      console.log('miss');
      continue;
    }
    if (distM(CENTER, hit) > 16000) {
      console.log('far', Math.round(distM(CENTER, hit)));
      continue;
    }

    const byName = pack.spots.find((s) => nameSimilar(s.name, lm.name));
    if (byName) {
      if (byName.pack_role === 'directory' || (byName.place_tier || 9) > lm.tier) {
        byName.pack_role = 'story';
        byName.place_tier = lm.tier;
        byName.category = lm.category;
        byName.tags = [
          ...new Set([
            ...(byName.tags || []).filter((t) => t !== 'directory' && t !== 'demoted_noise'),
            'story',
            lm.category,
            `tier${lm.tier}`,
            'curated_keep',
            'needs_deep_research',
          ]),
        ];
        promoted += 1;
        console.log('promote', byName.id);
      } else {
        console.log('exists');
      }
      continue;
    }

    const id = `${CITY_ID}_${slugify(lm.name)}`;
    if (pack.spots.some((s) => s.id === id)) {
      console.log('id-exists');
      continue;
    }

    const half = suggestedPolygonHalfM(lm.category, lm.name);
    pack.spots.push({
      id,
      name: lm.name,
      district: 'Amsterdam',
      category: lm.category,
      tags: [
        lm.category,
        'story',
        `tier${lm.tier}`,
        'curated_keep',
        'needs_deep_research',
      ],
      bullets: [
        hit.address ? `Adresse (Google): ${hit.address}.` : null,
        hit.placeId
          ? `Google Maps: https://www.google.com/maps/place/?q=place_id:${hit.placeId}`
          : null,
      ].filter(Boolean),
      facts: {
        now: hit.address ? `Adresse: ${hit.address}` : '',
        tags: [lm.category],
      },
      polygonCoordinates: boxPolygon(hit.lat, hit.lng, half),
      approach_triggers: approaches(hit.lat, hit.lng, lm.name, id),
      sub_pois: [],
      nav_waypoints: [],
      pack_role: 'story',
      place_tier: lm.tier,
    });
    pack.trigger_points = pack.trigger_points || [];
    pack.trigger_points.push({
      id,
      name: lm.name,
      lat: hit.lat,
      lng: hit.lng,
      radius_m: Math.max(28, Math.round(half * 0.7)),
      general_info: '',
      deep_data_pool: [],
    });
    added += 1;
    console.log('added', id);
  }

  savePack(pack, { bumpVersion: true });
  const stories = pack.spots.filter((s) => s.pack_role === 'story');
  console.log(
    JSON.stringify(
      {
        added,
        promoted,
        stories: stories.length,
        version: pack.data_version,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
