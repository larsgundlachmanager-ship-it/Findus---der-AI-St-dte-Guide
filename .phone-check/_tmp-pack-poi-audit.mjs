import fs from 'node:fs';

function isAxisBox(poly) {
  if (!poly || poly.length < 4 || poly.length > 6) return false;
  const lats = new Set();
  const lngs = new Set();
  for (const p of poly) {
    const lat = p.lat ?? p.latitude;
    const lng = p.lng ?? p.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    lats.add(lat.toFixed(6));
    lngs.add(lng.toFixed(6));
  }
  return lats.size === 2 && lngs.size === 2;
}

function analyze(city) {
  const pack = JSON.parse(fs.readFileSync(`data/staedte/${city}.json`, 'utf8'));
  const spots = pack.spots || [];
  const sampleFields = new Set();
  const tagCount = {};
  let story = 0;
  let dir = 0;
  let mixed = 0;
  let osm = 0;
  let box = 0;
  let poly = 0;
  let noPoly = 0;
  let booking = 0;
  let hours = 0;
  let menu = 0;
  let breakfast = 0;
  let checkin = 0;
  let price = 0;
  let website = 0;
  let live = 0;
  let mapOutline = 0;
  const hotels = [];
  const bakeries = [];
  const buses = [];
  const cats = {};

  for (const s of spots) {
    Object.keys(s).forEach((k) => sampleFields.add(k));
    const tags = (s.tags || []).map((t) => String(t).toLowerCase());
    const role = String(s.pack_role || '').toLowerCase();
    const isStory =
      role === 'story' || tags.includes('story') || tags.includes('module1');
    const isDir = role === 'directory' || tags.includes('directory');
    if (isStory && isDir) mixed++;
    else if (isStory) story++;
    else dir++;
    tags.forEach((t) => {
      tagCount[t] = (tagCount[t] || 0) + 1;
    });
    if (tags.includes('sourced_osm') || tags.includes('map_outline')) osm++;
    if (tags.includes('map_outline')) mapOutline++;
    const polyArr = s.polygonCoordinates || s.polygon;
    if (polyArr && polyArr.length >= 3) {
      poly++;
      if (isAxisBox(polyArr)) box++;
    } else noPoly++;
    if (s.booking || s.bookingUrl || s.booking_url || s.openTableId) booking++;
    const blob = JSON.stringify(s).toLowerCase();
    if (/öffnung|oeffnung|opening_hours|geöffnet|geoeffnet/.test(blob)) hours++;
    if (/speisekarte|menü|menu_url/.test(blob)) menu++;
    if (/frühstück|fruehstueck|breakfast/.test(blob)) breakfast++;
    if (/check.?in|check.?out|eincheck|auscheck/.test(blob)) checkin++;
    if (/€|euro|preis|price/.test(blob)) price++;
    if (/https?:\/\//.test(blob)) website++;
    if (/live:/.test(blob)) live++;
    const cat = String(s.category || 'none');
    cats[cat] = (cats[cat] || 0) + 1;
    const cl = `${cat} ${s.name} ${tags.join(' ')}`.toLowerCase();
    const rec = {
      id: s.id,
      name: s.name,
      category: s.category,
      pack_role: s.pack_role,
      place_tier: s.place_tier,
      tags: tags.slice(0, 20),
      nPoly: (polyArr || []).length,
      box: isAxisBox(polyArr),
      osm: tags.includes('sourced_osm') || tags.includes('map_outline'),
      keys: Object.keys(s),
      bullets: (s.bullets || []).slice(0, 4),
      booking: s.booking || s.bookingUrl || s.booking_url || null,
      liveHints: (s.bullets || []).filter((b) => /LIVE:/i.test(b)).slice(0, 2),
      factsNow: s.facts?.now?.slice?.(0, 180) || null,
    };
    if (/hotel|pension|hostel|gasthof/.test(cl) && hotels.length < 4) hotels.push(rec);
    if (/bäck|baeck|bakery|bäcker/.test(cl) && bakeries.length < 4) bakeries.push(rec);
    if (/bus|haltestelle|bushalt/.test(cl) && buses.length < 5) buses.push(rec);
  }

  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 22);
  const transit = pack._transit || null;
  const liveR = (pack._live_research || []).slice(0, 10).map((x) => ({
    id: x.id || x.spot_id,
    kind: x.kind || x.topic || x.type,
    keys: Object.keys(x),
    prompt: String(x.prompt || x.text || x.query || '').slice(0, 120),
  }));

  return {
    city,
    version: pack.data_version,
    nSpots: spots.length,
    nTriggers: (pack.trigger_points || []).length,
    story,
    dir,
    mixed,
    osm,
    mapOutline,
    box,
    poly,
    noPoly,
    booking,
    hours,
    menu,
    breakfast,
    checkin,
    price,
    website,
    live,
    fields: [...sampleFields].sort(),
    topTags,
    topCats: Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18),
    idx: pack._pack_index || null,
    transit: transit
      ? {
          provider: transit.provider,
          gtfs_rt: transit.gtfs_rt_url,
          nStops: (transit.stops || []).length,
          stopSample: (transit.stops || []).slice(0, 6),
          extraKeys: Object.keys(transit),
        }
      : null,
    nLiveResearch: (pack._live_research || []).length,
    liveR,
    hotels,
    bakeries,
    buses,
    nLinks: (pack._links || []).length,
    linkSample: (pack._links || []).slice(0, 6),
  };
}

const out = {
  pinneberg: analyze('pinneberg'),
  tornesch: analyze('tornesch'),
};
fs.writeFileSync('.phone-check/_tmp-pack-poi-audit.json', JSON.stringify(out, null, 2));
console.log('wrote audit');
console.log(
  JSON.stringify(
    {
      pinneberg: {
        n: out.pinneberg.nSpots,
        story: out.pinneberg.story,
        dir: out.pinneberg.dir,
        mixed: out.pinneberg.mixed,
        osm: out.pinneberg.osm,
        box: out.pinneberg.box,
        poly: out.pinneberg.poly,
        hours: out.pinneberg.hours,
        booking: out.pinneberg.booking,
        transit: out.pinneberg.transit,
        idx: out.pinneberg.idx,
        fields: out.pinneberg.fields,
        hotels: out.pinneberg.hotels.map((h) => h.name),
        bakeries: out.pinneberg.bakeries.map((h) => h.name),
        buses: out.pinneberg.buses.map((h) => h.name),
      },
      tornesch: {
        n: out.tornesch.nSpots,
        story: out.tornesch.story,
        dir: out.tornesch.dir,
        mixed: out.tornesch.mixed,
        osm: out.tornesch.osm,
        box: out.tornesch.box,
        poly: out.tornesch.poly,
        hours: out.tornesch.hours,
        booking: out.tornesch.booking,
        transit: out.tornesch.transit,
        idx: out.tornesch.idx,
        fields: out.tornesch.fields,
        hotels: out.tornesch.hotels.map((h) => h.name),
        bakeries: out.tornesch.bakeries.map((h) => h.name),
        buses: out.tornesch.buses.map((h) => h.name),
      },
    },
    null,
    2,
  ),
);
