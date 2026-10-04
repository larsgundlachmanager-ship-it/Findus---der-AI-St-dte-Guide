import fs from 'node:fs';

function sample(city) {
  const pack = JSON.parse(fs.readFileSync(`data/staedte/${city}.json`, 'utf8'));
  const spots = pack.spots || [];
  const transit = spots.filter((s) => {
    const t = (s.tags || []).join(' ').toLowerCase();
    const c = String(s.category || '').toLowerCase();
    return (
      c === 'bahnhof' ||
      t.includes('transit') ||
      t.includes('bus_stop') ||
      /haltestelle|bushalt/i.test(s.name)
    );
  });
  const googleN = spots.filter((s) => s._google).length;
  const googleSample = spots
    .filter((s) => s._google)
    .slice(0, 3)
    .map((s) => ({ name: s.name, _google: s._google, tags: (s.tags || []).filter((x) => /review|google|place/.test(String(x))) }));
  const facet = spots.filter((s) => (s.tags || []).some((t) => /review_facet|frühstück|steak|vegan|terrasse/.test(String(t)))).slice(0, 6)
    .map((s) => ({ name: s.name, cat: s.category, tags: (s.tags || []).filter((t) => !['directory','tier4','offline_lookup','map_outline','sourced_osm','amenity_skip','optional_live','master_baseline','kulinarik','module1','normalized'].includes(String(t))) }));
  const osmTransit = transit.filter((s) => String(s.id || '').includes('_osm_'));
  const hoursSpots = spots.filter((s) => /öffnung|Öffnung|opening_hours|geöffnet/i.test(JSON.stringify(s.bullets||[]) + JSON.stringify(s.facts||{})))
    .map((s) => ({ name: s.name, cat: s.category, bullets: s.bullets, factsNow: s.facts?.now }));
  const boxSpots = spots.filter((s) => {
    const poly = s.polygonCoordinates || s.polygon;
    if (!poly || poly.length < 4 || poly.length > 6) return false;
    const lats = new Set(); const lngs = new Set();
    for (const p of poly) {
      lats.add((p.lat ?? p.latitude).toFixed(6));
      lngs.add((p.lng ?? p.longitude).toFixed(6));
    }
    return lats.size === 2 && lngs.size === 2;
  }).map((s) => ({ name: s.name, cat: s.category, n: (s.polygonCoordinates||s.polygon).length, tags: s.tags?.slice(0,8) }));

  return {
    nTransit: transit.length,
    nOsmTransit: osmTransit.length,
    transitSample: osmTransit.slice(0, 5).map((s) => ({
      id: s.id,
      name: s.name,
      cat: s.category,
      bullets: s.bullets,
      nPoly: (s.polygonCoordinates || s.polygon || []).length,
      tags: (s.tags || []).slice(0, 12),
    })),
    namedHalt: transit.filter((s) => /haltestelle|bus/i.test(s.name)).slice(0, 6).map((s) => ({
      id: s.id, name: s.name, cat: s.category, bullets: s.bullets, nPoly: (s.polygonCoordinates||[]).length,
    })),
    googleN,
    googleSample,
    facet,
    hoursSpots,
    boxSpots,
    nLive: (pack._live_research || []).length,
    torneschTransit: pack._transit || null,
  };
}

const out = { pinneberg: sample('pinneberg'), tornesch: sample('tornesch') };
console.log(JSON.stringify(out, null, 2).slice(0, 14000));
fs.writeFileSync('.phone-check/_tmp-pack-poi-audit2.json', JSON.stringify(out, null, 2));
