/** OSM / Nominatim helpers for place pack generation. */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'FindusPlacePackGenerator/1.0 (local; contact: findus-app)';

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Try primary Overpass, then mirrors on failure. */
export async function fetchOverpass(query) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/cgi/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  let lastErr;
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      await sleep(400);
      return data;
    } catch (e) {
      lastErr = e;
      console.warn(`[osm] overpass fail ${endpoint}: ${e.message}`);
      await sleep(1200);
    }
  }
  throw lastErr || new Error('overpass failed');
}

/**
 * Nominatim search with polygon_geojson — fallback when Overpass is down.
 * Returns { polygon, name, osmId, source_url } or null.
 */
export async function fetchNominatimPolygon(query, { countrycodes = 'de' } = {}) {
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('addressdetails', '1');
  if (countrycodes) url.searchParams.set('countrycodes', countrycodes);
  await sleep(1100);
  const rows = await fetchJson(url.toString());
  if (!rows?.length) return null;
  for (const r of rows) {
    const gj = r.geojson;
    if (!gj) continue;
    let coords = null;
    if (gj.type === 'Polygon' && Array.isArray(gj.coordinates?.[0])) {
      coords = gj.coordinates[0];
    } else if (gj.type === 'MultiPolygon' && Array.isArray(gj.coordinates?.[0]?.[0])) {
      // pick largest ring by point count
      let best = gj.coordinates[0][0];
      for (const poly of gj.coordinates) {
        const ring = poly[0];
        if (ring?.length > best.length) best = ring;
      }
      coords = best;
    }
    if (!coords || coords.length < 4) continue;
    const polygon = coords.map(([lng, lat]) => ({
      latitude: Number(lat),
      longitude: Number(lng),
    }));
    return {
      polygon,
      name: r.display_name?.split(',')[0] || query,
      osmId: Number(r.osm_id),
      source_url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
      dist: 0,
    };
  }
  return null;
}

export async function geocodePlace(query, { countrycodes = 'de' } = {}) {
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  if (countrycodes) url.searchParams.set('countrycodes', countrycodes);
  await sleep(1100);
  const rows = await fetchJson(url.toString());
  if (!rows?.length) return null;
  const r = rows[0];
  return {
    lat: Number(r.lat),
    lng: Number(r.lon),
    displayName: r.display_name,
    osmType: r.osm_type,
    osmId: Number(r.osm_id),
    source_url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
  };
}

function wayToLatLngRing(el, nodesById) {
  if (!el.nodes) return null;
  const ring = [];
  for (const nid of el.nodes) {
    const n = nodesById.get(nid);
    if (n) ring.push({ latitude: n.lat, longitude: n.lon });
  }
  if (ring.length >= 3) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a.latitude !== b.latitude || a.longitude !== b.longitude) {
      ring.push({ ...a });
    }
    return ring;
  }
  return null;
}

/** Approx square footprint around a point (degrees). */
export function boxPolygon(lat, lng, halfMeters = 25) {
  const dLat = halfMeters / 111_320;
  const dLng = halfMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    { latitude: lat - dLat, longitude: lng - dLng },
    { latitude: lat - dLat, longitude: lng + dLng },
    { latitude: lat + dLat, longitude: lng + dLng },
    { latitude: lat + dLat, longitude: lng - dLng },
    { latitude: lat - dLat, longitude: lng - dLng },
  ];
}

export async function fetchBuildingPolygon(lat, lng, radiusM = 60) {
  const query = `
    [out:json][timeout:45];
    (
      way(around:${radiusM},${lat},${lng})[building];
      relation(around:${radiusM},${lat},${lng})[building];
      way(around:${radiusM},${lat},${lng})[railway=station];
      way(around:${radiusM},${lat},${lng})[public_transport=station];
      way(around:${radiusM},${lat},${lng})[amenity];
      way(around:${radiusM},${lat},${lng})[tourism];
    );
    out body;
    >;
    out skel qt;
  `;
  const data = await fetchOverpass(query);

  const nodesById = new Map();
  for (const el of data.elements || []) {
    if (el.type === 'node') nodesById.set(el.id, el);
  }

  let best = null;
  let bestDist = Infinity;
  for (const el of data.elements || []) {
    if (el.type !== 'way' || !el.tags) continue;
    const ring = wayToLatLngRing(el, nodesById);
    if (!ring) continue;
    const cLat = ring.reduce((s, p) => s + p.latitude, 0) / ring.length;
    const cLng = ring.reduce((s, p) => s + p.longitude, 0) / ring.length;
    const dist =
      Math.hypot((cLat - lat) * 111_320, (cLng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180));
    if (dist < bestDist) {
      bestDist = dist;
      best = {
        polygon: ring,
        tags: el.tags,
        osmId: el.id,
        source_url: `https://www.openstreetmap.org/way/${el.id}`,
      };
    }
  }
  return best;
}

export async function fetchNearbyRoadNodes(lat, lng, radiusM = 120) {
  const query = `
    [out:json][timeout:45];
    way(around:${radiusM},${lat},${lng})[highway];
    node(w);
    out body;
  `;
  const data = await fetchOverpass(query);

  const nodes = (data.elements || []).filter((e) => e.type === 'node');
  // Prefer nodes that appear on multiple ways ≈ intersections
  const count = new Map();
  for (const el of data.elements || []) {
    if (el.type !== 'way' || !el.nodes) continue;
    for (const nid of el.nodes) {
      count.set(nid, (count.get(nid) || 0) + 1);
    }
  }

  const scored = nodes
    .map((n) => {
      const dist = Math.hypot(
        (n.lat - lat) * 111_320,
        (n.lon - lng) * 111_320 * Math.cos((lat * Math.PI) / 180),
      );
      const degree = count.get(n.id) || 1;
      return { lat: n.lat, lng: n.lon, dist, degree, id: n.id };
    })
    .filter((n) => n.dist > 25 && n.dist < radiusM)
    .sort((a, b) => b.degree - a.degree || a.dist - b.dist);

  const picked = [];
  for (const n of scored) {
    if (picked.length >= 3) break;
    const tooClose = picked.some(
      (p) =>
        Math.hypot((p.lat - n.lat) * 111_320, (p.lng - n.lng) * 70_000) < 35,
    );
    if (!tooClose) picked.push(n);
  }
  return picked;
}

export async function fetchSubAmenities(lat, lng, radiusM = 80) {
  const query = `
    [out:json][timeout:45];
    (
      node(around:${radiusM},${lat},${lng})[amenity~"bench|fountain|toilets|shelter|clock"];
      node(around:${radiusM},${lat},${lng})[historic];
      node(around:${radiusM},${lat},${lng})[tourism=artwork];
      node(around:${radiusM},${lat},${lng})[railway=buffer_stop];
      way(around:${radiusM},${lat},${lng})[building=roof];
    );
    out center tags;
  `;
  const data = await fetchOverpass(query);

  return (data.elements || [])
    .map((el) => {
      const plat = el.lat ?? el.center?.lat;
      const plng = el.lon ?? el.center?.lon;
      if (typeof plat !== 'number' || typeof plng !== 'number') return null;
      const name =
        el.tags?.name ||
        el.tags?.amenity ||
        el.tags?.historic ||
        el.tags?.tourism ||
        `detail_${el.id}`;
      return {
        id: `sub_${el.type}_${el.id}`,
        name: String(name),
        lat: plat,
        lng: plng,
        tags: el.tags || {},
        source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export async function fetchWikidataFacts(lat, lng) {
  // Optional: reverse wikipedia via Nominatim extratags not always available.
  // Keep sourced-only: return empty if nothing reliable.
  return [];
}

export function bearingLabel(fromLat, fromLng, toLat, toLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(toLng - fromLng)) * Math.cos(toRad(toLat));
  const x =
    Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
    Math.sin(toRad(fromLat)) *
      Math.cos(toRad(toLat)) *
      Math.cos(toRad(toLng - fromLng));
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const dirs = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
  return dirs[Math.round(brng / 45) % 8];
}
