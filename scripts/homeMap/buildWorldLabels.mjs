/**
 * Offline-Beschriftung + grobe Struktur (Natural Earth): Städte, Flüsse,
 * Fernstraßen, Gebirgsnamen — mit Rank `r` für Zoom-LOD in der App.
 * Run: node scripts/homeMap/buildWorldLabels.mjs
 * npm: city:world-labels
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'src/assets/homeMap/worldLabels.json');
const DE_HYDRO = join(ROOT, 'scripts/homeMap/deHydro.geojson');
const DE_ROADS = join(ROOT, 'scripts/homeMap/deRoads.geojson');

const BASES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/',
];

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function simplifyLine(pts, minDeg, places) {
  if (!Array.isArray(pts) || pts.length < 2) return [];
  const min2 = minDeg * minDeg;
  const out = [];
  let last = null;
  for (const raw of pts) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const p = [round(Number(raw[0]), places), round(Number(raw[1]), places)];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (last && dist2(last, p) < min2) continue;
    out.push(p);
    last = p;
  }
  return out;
}

async function fetchJson(name) {
  let lastErr = null;
  for (const base of BASES) {
    const url = base + name;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`download failed: ${name}`);
}

function placeName(p) {
  const de = String(p.NAME_DE || p.name_de || '').trim();
  const en = String(p.NAME || p.name || p.NAMEASCII || '').trim();
  return de || en;
}

function lineMid(g) {
  const line =
    g?.type === 'LineString'
      ? g.coordinates
      : g?.type === 'MultiLineString'
        ? g.coordinates?.[0]
        : null;
  if (!Array.isArray(line) || !line.length) return null;
  const mid = line[line.length >> 1];
  const lng = Number(mid?.[0]);
  const lat = Number(mid?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function inDe(lng, lat) {
  return lng > 5.5 && lng < 15.4 && lat > 47.2 && lat < 55.2;
}

function inEu(lng, lat) {
  return lng > -12 && lng < 32 && lat > 35 && lat < 72;
}

function collectCities(fc) {
  const rows = [];
  for (const f of fc?.features ?? []) {
    const p = f.properties || {};
    const name = placeName(p);
    if (!name || name.length > 28) continue;
    const rank = Number(p.SCALERANK ?? p.LABELRANK ?? 8);
    const pop = Number(p.POP_MAX ?? p.pop_max ?? 0);
    const cls = String(p.FEATURECLA || p.featurecla || '');
    const g = f.geometry;
    let lng;
    let lat;
    if (g?.type === 'Point') {
      lng = Number(g.coordinates?.[0]);
      lat = Number(g.coordinates?.[1]);
    } else {
      lng = Number(p.LONGITUDE ?? p.longitude);
      lat = Number(p.LATITUDE ?? p.latitude);
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const capital = /capital/i.test(cls);
    const de = inDe(lng, lat);
    const keep =
      rank <= 5 ||
      capital ||
      pop >= 180_000 ||
      (de && (rank <= 10 || pop >= 25_000));
    if (!keep) continue;
    rows.push({
      name,
      rank: capital ? Math.min(rank, 2) : de ? Math.min(rank, rank <= 6 ? rank : 6) : rank,
      lng: round(lng, 3),
      lat: round(lat, 3),
    });
  }
  rows.sort((a, b) => a.rank - b.rank || b.name.localeCompare(a.name));
  const seen = new Set();
  const features = [];
  for (const r of rows) {
    const key = `${r.name}|${r.lng}|${r.lat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: 'Feature',
      properties: { n: r.name, r: r.rank },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
    if (features.length >= 1_400) break;
  }
  return { type: 'FeatureCollection', features };
}

/** Pflicht-Städte DE (50m-NE lässt mittlere Orte oft weg / Cap frisst sie). */
const DE_MUST_CITIES = [
  { n: 'Hamburg', r: 2, lng: 9.993, lat: 53.551 },
  { n: 'Berlin', r: 1, lng: 13.405, lat: 52.52 },
  { n: 'München', r: 2, lng: 11.576, lat: 48.137 },
  { n: 'Köln', r: 2, lng: 6.96, lat: 50.938 },
  { n: 'Frankfurt', r: 2, lng: 8.682, lat: 50.111 },
  { n: 'Stuttgart', r: 3, lng: 9.183, lat: 48.776 },
  { n: 'Düsseldorf', r: 3, lng: 6.773, lat: 51.227 },
  { n: 'Dortmund', r: 3, lng: 7.465, lat: 51.514 },
  { n: 'Essen', r: 3, lng: 7.012, lat: 51.455 },
  { n: 'Leipzig', r: 3, lng: 12.373, lat: 51.339 },
  { n: 'Bremen', r: 3, lng: 8.801, lat: 53.079 },
  { n: 'Dresden', r: 3, lng: 13.738, lat: 51.051 },
  { n: 'Hannover', r: 3, lng: 9.732, lat: 52.375 },
  { n: 'Nürnberg', r: 3, lng: 11.077, lat: 49.452 },
  { n: 'Kiel', r: 4, lng: 10.135, lat: 54.323 },
  { n: 'Lübeck', r: 4, lng: 10.687, lat: 53.866 },
  { n: 'Rostock', r: 4, lng: 12.141, lat: 54.089 },
  { n: 'Flensburg', r: 5, lng: 9.447, lat: 54.784 },
  { n: 'Neumünster', r: 5, lng: 9.98, lat: 54.072 },
  { n: 'Pinneberg', r: 6, lng: 9.797, lat: 53.661 },
  { n: 'Elmshorn', r: 6, lng: 9.653, lat: 53.754 },
  { n: 'Tornesch', r: 7, lng: 9.717, lat: 53.7 },
  { n: 'Uetersen', r: 7, lng: 9.664, lat: 53.688 },
  { n: 'Wedel', r: 6, lng: 9.704, lat: 53.584 },
  { n: 'Norderstedt', r: 5, lng: 10.0, lat: 53.707 },
  { n: 'Ahrensburg', r: 6, lng: 10.241, lat: 53.675 },
  { n: 'Bad Oldesloe', r: 6, lng: 10.374, lat: 53.812 },
  { n: 'Itzehoe', r: 6, lng: 9.515, lat: 53.925 },
  { n: 'Heide', r: 6, lng: 9.094, lat: 54.196 },
  { n: 'Husum', r: 6, lng: 9.051, lat: 54.485 },
  { n: 'Schleswig', r: 6, lng: 9.57, lat: 54.515 },
  { n: 'Rendsburg', r: 6, lng: 9.665, lat: 54.305 },
  { n: 'Schwerin', r: 4, lng: 11.401, lat: 53.635 },
  { n: 'Magdeburg', r: 4, lng: 11.628, lat: 52.12 },
  { n: 'Braunschweig', r: 4, lng: 10.521, lat: 52.266 },
  { n: 'Wolfsburg', r: 5, lng: 10.786, lat: 52.423 },
  { n: 'Göttingen', r: 5, lng: 9.935, lat: 51.533 },
  { n: 'Kassel', r: 4, lng: 9.479, lat: 51.312 },
  { n: 'Bielefeld', r: 4, lng: 8.532, lat: 52.03 },
  { n: 'Münster', r: 4, lng: 7.626, lat: 51.961 },
  { n: 'Osnabrück', r: 5, lng: 8.047, lat: 52.28 },
  { n: 'Oldenburg', r: 5, lng: 8.214, lat: 53.144 },
  { n: 'Bremerhaven', r: 5, lng: 8.581, lat: 53.54 },
  { n: 'Cuxhaven', r: 6, lng: 8.69, lat: 53.87 },
  { n: 'Wilhelmshaven', r: 5, lng: 8.112, lat: 53.52 },
  { n: 'Freiburg', r: 4, lng: 7.842, lat: 47.996 },
  { n: 'Mannheim', r: 4, lng: 8.466, lat: 49.488 },
  { n: 'Karlsruhe', r: 4, lng: 8.404, lat: 49.007 },
  { n: 'Augsburg', r: 4, lng: 10.898, lat: 48.371 },
  { n: 'Regensburg', r: 5, lng: 12.101, lat: 49.013 },
  { n: 'Würzburg', r: 5, lng: 9.936, lat: 49.792 },
  { n: 'Erfurt', r: 4, lng: 11.029, lat: 50.978 },
  { n: 'Jena', r: 5, lng: 11.589, lat: 50.927 },
  { n: 'Halle', r: 4, lng: 11.971, lat: 51.482 },
  { n: 'Chemnitz', r: 4, lng: 12.925, lat: 50.833 },
  { n: 'Potsdam', r: 4, lng: 13.065, lat: 52.391 },
  { n: 'Cottbus', r: 5, lng: 14.334, lat: 51.756 },
  { n: 'Saarbrücken', r: 4, lng: 6.996, lat: 49.235 },
  { n: 'Mainz', r: 4, lng: 8.247, lat: 49.992 },
  { n: 'Wiesbaden', r: 4, lng: 8.24, lat: 50.082 },
  { n: 'Bonn', r: 4, lng: 7.099, lat: 50.734 },
  { n: 'Aachen', r: 4, lng: 6.084, lat: 50.776 },
  { n: 'Wuppertal', r: 4, lng: 7.168, lat: 51.256 },
  { n: 'Bochum', r: 4, lng: 7.216, lat: 51.482 },
  { n: 'Gelsenkirchen', r: 5, lng: 7.086, lat: 51.518 },
  { n: 'Duisburg', r: 4, lng: 6.762, lat: 51.435 },
  { n: 'Mönchengladbach', r: 5, lng: 6.441, lat: 51.195 },
  { n: 'Krefeld', r: 5, lng: 6.559, lat: 51.333 },
  { n: 'Oberhausen', r: 5, lng: 6.851, lat: 51.496 },
  { n: 'Hagen', r: 5, lng: 7.471, lat: 51.361 },
  { n: 'Hamm', r: 5, lng: 7.82, lat: 51.681 },
  { n: 'Leverkusen', r: 5, lng: 6.984, lat: 51.046 },
  { n: 'Solingen', r: 5, lng: 7.085, lat: 51.171 },
  { n: 'Herne', r: 6, lng: 7.224, lat: 51.539 },
  { n: 'Mülheim', r: 5, lng: 6.879, lat: 51.431 },
  { n: 'Paderborn', r: 5, lng: 8.755, lat: 51.719 },
  { n: 'Heilbronn', r: 5, lng: 9.211, lat: 49.143 },
  { n: 'Ulm', r: 5, lng: 9.988, lat: 48.401 },
  { n: 'Pforzheim', r: 5, lng: 8.703, lat: 48.892 },
  { n: 'Reutlingen', r: 5, lng: 9.204, lat: 48.491 },
  { n: 'Koblenz', r: 5, lng: 7.589, lat: 50.357 },
  { n: 'Trier', r: 5, lng: 6.641, lat: 49.757 },
  { n: 'Kaiserslautern', r: 5, lng: 7.769, lat: 49.443 },
  { n: 'Ludwigshafen', r: 5, lng: 8.446, lat: 49.481 },
  { n: 'Darmstadt', r: 5, lng: 8.651, lat: 49.873 },
  { n: 'Offenbach', r: 5, lng: 8.761, lat: 50.105 },
  { n: 'Ingolstadt', r: 5, lng: 11.425, lat: 48.765 },
  { n: 'Fürth', r: 5, lng: 10.988, lat: 49.477 },
  { n: 'Erlangen', r: 5, lng: 11.008, lat: 49.598 },
  { n: 'Bayreuth', r: 6, lng: 11.577, lat: 49.946 },
  { n: 'Bamberg', r: 6, lng: 10.891, lat: 49.891 },
  { n: 'Passau', r: 6, lng: 13.465, lat: 48.567 },
  { n: 'Rosenheim', r: 6, lng: 12.127, lat: 47.856 },
  { n: 'Landshut', r: 6, lng: 12.152, lat: 48.537 },
  { n: 'Konstanz', r: 6, lng: 9.176, lat: 47.66 },
  { n: 'Friedrichshafen', r: 6, lng: 9.479, lat: 47.658 },
  { n: 'Stralsund', r: 6, lng: 13.09, lat: 54.309 },
  { n: 'Greifswald', r: 6, lng: 13.388, lat: 54.093 },
  { n: 'Wismar', r: 6, lng: 11.466, lat: 53.892 },
  { n: 'Gera', r: 5, lng: 12.077, lat: 50.881 },
  { n: 'Zwickau', r: 5, lng: 12.488, lat: 50.719 },
  { n: 'Plauen', r: 6, lng: 12.138, lat: 50.495 },
  { n: 'Dessau', r: 6, lng: 12.245, lat: 51.831 },
  { n: 'Brandenburg', r: 5, lng: 12.55, lat: 52.412 },
  { n: 'Frankfurt (Oder)', r: 5, lng: 14.551, lat: 52.342 },
  { n: 'Görlitz', r: 6, lng: 14.987, lat: 51.152 },
  { n: 'Hof', r: 6, lng: 11.918, lat: 50.313 },
  { n: 'Schweinfurt', r: 6, lng: 10.219, lat: 50.049 },
  { n: 'Aschaffenburg', r: 5, lng: 9.147, lat: 49.976 },
  { n: 'Fulda', r: 6, lng: 9.675, lat: 50.552 },
  { n: 'Marburg', r: 5, lng: 8.77, lat: 50.809 },
  { n: 'Gießen', r: 5, lng: 8.675, lat: 50.584 },
  { n: 'Siegen', r: 5, lng: 8.024, lat: 50.875 },
  { n: 'Hildesheim', r: 5, lng: 9.951, lat: 52.151 },
  { n: 'Salzgitter', r: 5, lng: 10.333, lat: 52.15 },
  { n: 'Celle', r: 6, lng: 10.08, lat: 52.623 },
  { n: 'Lüneburg', r: 5, lng: 10.414, lat: 53.249 },
  { n: 'Stade', r: 6, lng: 9.476, lat: 53.594 },
  { n: 'Buxtehude', r: 6, lng: 9.686, lat: 53.467 },
  { n: 'Buchholz', r: 6, lng: 9.881, lat: 53.321 },
  { n: 'Winsen', r: 7, lng: 10.213, lat: 53.358 },
  { n: 'Geesthacht', r: 6, lng: 10.377, lat: 53.437 },
  { n: 'Reinbek', r: 7, lng: 10.252, lat: 53.51 },
  { n: 'Quickborn', r: 7, lng: 9.909, lat: 53.733 },
  { n: 'Halstenbek', r: 7, lng: 9.842, lat: 53.633 },
  { n: 'Schenefeld', r: 7, lng: 9.823, lat: 53.602 },
  { n: 'Prisdorf', r: 8, lng: 9.761, lat: 53.68 },
];

/** Gebirge / Landschaften — Fallback falls NE-Download dünn ist. */
const EU_MUST_REGIONS = [
  { n: 'Alpen', r: 2, lng: 10.8, lat: 46.9 },
  { n: 'Harz', r: 3, lng: 10.62, lat: 51.78 },
  { n: 'Schwarzwald', r: 3, lng: 8.15, lat: 48.05 },
  { n: 'Bayerischer Wald', r: 4, lng: 13.2, lat: 48.95 },
  { n: 'Eifel', r: 4, lng: 6.6, lat: 50.35 },
  { n: 'Rhön', r: 5, lng: 10.05, lat: 50.5 },
  { n: 'Erzgebirge', r: 4, lng: 12.95, lat: 50.55 },
  { n: 'Thüringer Wald', r: 5, lng: 10.75, lat: 50.65 },
  { n: 'Sauerland', r: 5, lng: 8.3, lat: 51.2 },
  { n: 'Schwäbische Alb', r: 5, lng: 9.3, lat: 48.35 },
  { n: 'Vogesen', r: 4, lng: 7.1, lat: 48.1 },
  { n: 'Ardennen', r: 4, lng: 5.6, lat: 50.2 },
  { n: 'Karpaten', r: 3, lng: 20.5, lat: 48.5 },
  { n: 'Pyrenäen', r: 3, lng: 0.5, lat: 42.7 },
  { n: 'Apennin', r: 4, lng: 13.0, lat: 42.5 },
];

function mergeMustCities(fc) {
  const seen = new Set(
    (fc.features || []).map((f) => String(f.properties?.n || '').toLowerCase()),
  );
  const extra = [];
  for (const c of DE_MUST_CITIES) {
    if (seen.has(c.n.toLowerCase())) continue;
    seen.add(c.n.toLowerCase());
    extra.push({
      type: 'Feature',
      properties: { n: c.n, r: c.r },
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    });
  }
  return {
    type: 'FeatureCollection',
    features: [...(fc.features || []), ...extra],
  };
}

function collectLines(fc, minDeg, places, pred) {
  const features = [];
  for (const f of fc?.features ?? []) {
    if (pred && !pred(f)) continue;
    const g = f.geometry;
    const rank = Number(
      f.properties?.scalerank ?? f.properties?.SCALERANK ?? f.properties?.r ?? 9,
    );
    const props = { r: Number.isFinite(rank) ? rank : 9 };
    const push = (line) => {
      const simp = simplifyLine(line, minDeg, places);
      if (simp.length < 2) return;
      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'LineString', coordinates: simp },
      });
    };
    if (g?.type === 'LineString') push(g.coordinates);
    else if (g?.type === 'MultiLineString') {
      for (const line of g.coordinates ?? []) push(line);
    }
  }
  return { type: 'FeatureCollection', features };
}

function featureTouches(f, pred) {
  const g = f.geometry;
  const lines =
    g?.type === 'LineString'
      ? [g.coordinates]
      : g?.type === 'MultiLineString'
        ? g.coordinates ?? []
        : [];
  for (const line of lines) {
    for (const p of line ?? []) {
      const lng = Number(p?.[0]);
      const lat = Number(p?.[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat) && pred(lng, lat)) {
        return true;
      }
    }
  }
  return false;
}

/** Grobe DE-Hauptflüsse (Natural Earth lässt Nord-DE oft dünn). Koordinaten grob. */
const DE_MUST_RIVERS = [
  {
    r: 2,
    c: [
      [8.5, 47.55],
      [8.6, 48.0],
      [8.4, 49.0],
      [8.35, 49.5],
      [8.2, 50.0],
      [7.6, 50.35],
      [7.1, 50.95],
      [6.95, 51.2],
      [6.75, 51.75],
      [6.1, 51.85],
    ],
  }, // Rhein
  {
    r: 2,
    c: [
      [15.5, 50.85],
      [14.4, 51.05],
      [13.75, 51.05],
      [13.4, 51.35],
      [12.9, 51.85],
      [12.0, 52.15],
      [11.7, 52.85],
      [11.0, 53.15],
      [10.4, 53.35],
      [10.0, 53.55],
      [9.95, 53.7],
      [9.4, 53.85],
      [8.7, 53.9],
    ],
  }, // Elbe
  {
    r: 3,
    c: [
      [8.85, 51.3],
      [9.1, 51.75],
      [9.35, 52.2],
      [9.1, 52.6],
      [8.8, 53.05],
      [8.55, 53.4],
      [8.5, 53.55],
    ],
  }, // Weser
  {
    r: 3,
    c: [
      [7.0, 52.15],
      [7.35, 52.55],
      [7.2, 53.0],
      [7.15, 53.35],
    ],
  }, // Ems
  {
    r: 2,
    c: [
      [10.15, 48.25],
      [11.0, 48.55],
      [12.1, 48.75],
      [12.9, 48.8],
      [13.5, 48.55],
      [14.3, 48.25],
      [16.4, 48.2],
    ],
  }, // Donau (DE)
  {
    r: 3,
    c: [
      [10.9, 50.05],
      [10.0, 50.05],
      [9.2, 50.05],
      [8.65, 50.1],
      [8.25, 49.95],
    ],
  }, // Main
  {
    r: 3,
    c: [
      [6.1, 49.15],
      [6.65, 49.75],
      [7.05, 50.05],
      [7.6, 50.35],
    ],
  }, // Mosel
  {
    r: 3,
    c: [
      [14.55, 52.5],
      [14.4, 52.9],
      [14.25, 53.3],
    ],
  }, // Oder (DE)
  {
    r: 4,
    c: [
      [13.1, 52.4],
      [13.2, 52.55],
      [13.45, 52.55],
      [13.65, 52.45],
    ],
  }, // Spree/Havel grob
  {
    r: 4,
    c: [
      [9.15, 48.4],
      [9.2, 49.0],
      [8.55, 49.4],
      [8.4, 49.5],
    ],
  }, // Neckar
  {
    r: 4,
    c: [
      [11.4, 47.55],
      [11.55, 48.15],
      [11.6, 48.35],
      [12.6, 48.75],
    ],
  }, // Isar
  {
    r: 4,
    c: [
      [12.1, 47.9],
      [12.55, 48.55],
      [12.9, 48.8],
    ],
  }, // Inn
  {
    r: 4,
    c: [
      [9.95, 53.55],
      [10.05, 53.65],
      [10.2, 53.75],
      [10.35, 53.9],
      [10.15, 54.2],
      [9.95, 54.35],
    ],
  }, // Alster/Trave grob Nord
];

function loadDeHydroRivers() {
  if (!existsSync(DE_HYDRO)) return [];
  try {
    const raw = JSON.parse(readFileSync(DE_HYDRO, 'utf8'));
    return Array.isArray(raw?.rivers?.features) ? raw.rivers.features : [];
  } catch {
    return [];
  }
}

function mergeMustRivers(fc) {
  const extra = DE_MUST_RIVERS.map((riv) => ({
    type: 'Feature',
    properties: { r: riv.r },
    geometry: {
      type: 'LineString',
      coordinates: riv.c.map(([lng, lat]) => [round(lng, 3), round(lat, 3)]),
    },
  }));
  // Kein deHydro-OSM-Dump hier: 2500 Bäche mit r=4 → schwarzer Fleck über DE
  // auf Europa-Zoom. Natural-Earth + Must-Flüsse reichen für die Übersicht.
  return {
    type: 'FeatureCollection',
    features: [...extra, ...(fc.features || [])],
  };
}

function collectRivers(rivers50, rivers10) {
  const keep = [];
  const pushFc = (fc, minDeg, places, pred) => {
    for (const f of collectLines(fc, minDeg, places, pred).features) {
      keep.push(f);
    }
  };
  // Welt: nur große Flüsse.
  pushFc(rivers50, 0.04, 4, (f) => {
    const r = Number(f.properties?.scalerank ?? f.properties?.SCALERANK ?? 9);
    return r <= 2;
  });
  // DE/EU: sparsam — Übersicht braucht Rhein/Elbe/Donau, keine Bach-Spaghetti.
  pushFc(rivers10, 0.01, 5, (f) => {
    const r = Number(f.properties?.scalerank ?? f.properties?.SCALERANK ?? 9);
    if (featureTouches(f, inDe)) return r <= 3;
    if (featureTouches(f, inEu)) return r <= 4;
    return false;
  });
  const de = [];
  const eu = [];
  const rest = [];
  for (const f of keep) {
    const rr = Number(f.properties?.r ?? 9);
    f.properties = { ...f.properties, r: Math.min(12, Number.isFinite(rr) ? rr : 9) };
    if (featureTouches(f, inDe)) de.push(f);
    else if (featureTouches(f, inEu)) eu.push(f);
    else rest.push(f);
  }
  const features = [
    ...de.slice(0, 420),
    ...eu.slice(0, 700),
    ...rest.slice(0, 400),
  ];
  return mergeMustRivers({ type: 'FeatureCollection', features });
}

function collectRoads(roads) {
  const europe = [];
  const world = [];
  for (const f of roads?.features ?? []) {
    const r = Number(f.properties?.scalerank ?? f.properties?.SCALERANK ?? 9);
    const type = String(
      f.properties?.type ||
        f.properties?.TYPE ||
        f.properties?.featurecla ||
        '',
    );
    const mid = lineMid(f.geometry);
    if (!mid) continue;
    const { lng, lat } = mid;
    const de = inDe(lng, lat);
    const eu = inEu(lng, lat);
    const highway = /highway|motorway|beltway|major|primary|secondary|trunk|road/i.test(
      type,
    );
    // DE/EU: step-by-step LOD — weit raus nur niedrige Rank-Straßen.
    if (de && (r <= 5 || highway)) europe.push(f);
    else if (eu && !de && (r <= 6 || highway)) europe.push(f);
    else if (r <= 4 || (highway && r <= 5)) world.push(f);
  }
  return {
    type: 'FeatureCollection',
    features: [
      ...collectLines({ type: 'FeatureCollection', features: europe }, 0.01, 5)
        .features,
      ...collectLines(
        { type: 'FeatureCollection', features: world.slice(0, 700) },
        0.06,
        3,
      ).features,
    ],
  };
}

function collectRegions(fc) {
  const rows = [];
  for (const f of fc?.features ?? []) {
    const p = f.properties || {};
    const cls = String(p.featurecla || p.FEATURECLA || '').toLowerCase();
    if (!/mountain|range|peak|plateau|hill|depression|valley/i.test(cls)) {
      continue;
    }
    const name = placeName(p);
    if (!name || name.length > 32) continue;
    const g = f.geometry;
    const lng = Number(g?.coordinates?.[0] ?? p.LONGITUDE);
    const lat = Number(g?.coordinates?.[1] ?? p.LATITUDE);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (!inEu(lng, lat)) continue;
    const rank = Number(p.scalerank ?? p.SCALERANK ?? 6);
    rows.push({
      name,
      rank: inDe(lng, lat) ? Math.min(rank, 5) : rank,
      lng: round(lng, 3),
      lat: round(lat, 3),
    });
  }
  rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const seen = new Set();
  const features = [];
  for (const r of rows) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: 'Feature',
      properties: { n: r.name, r: r.rank },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
    if (features.length >= 80) break;
  }
  for (const c of EU_MUST_REGIONS) {
    if (seen.has(c.n.toLowerCase())) continue;
    seen.add(c.n.toLowerCase());
    features.push({
      type: 'Feature',
      properties: { n: c.n, r: c.r },
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

async function main() {
  console.log('[world-labels] download Natural Earth …');
  const places = await fetchJson('ne_50m_populated_places.geojson');
  const rivers50 = await fetchJson('ne_50m_rivers_lake_centerlines.geojson');
  let rivers10 = rivers50;
  try {
    rivers10 = await fetchJson('ne_10m_rivers_lake_centerlines.geojson');
    console.log('[world-labels] rivers 10m ok');
  } catch (err) {
    console.warn('[world-labels] rivers 10m fallback 50m', err?.message || err);
  }
  const roads = await fetchJson('ne_10m_roads.geojson');
  let regionsRaw = { features: [] };
  try {
    regionsRaw = await fetchJson('ne_50m_geography_regions_points.geojson');
    console.log('[world-labels] regions ok');
  } catch (err) {
    console.warn('[world-labels] regions optional', err?.message || err);
  }

  const cities = mergeMustCities(collectCities(places));
  const riverFc = collectRivers(rivers50, rivers10);
  const roadFc = collectRoads(roads);
  const regionFc = collectRegions(regionsRaw);

  let deRivers = 0;
  let deRoads = 0;
  for (const f of riverFc.features) {
    if (featureTouches(f, inDe)) deRivers += 1;
  }
  for (const f of roadFc.features) {
    const mid = lineMid(f.geometry);
    if (mid && inDe(mid.lng, mid.lat)) deRoads += 1;
  }

  const bundle = {
    v: 2,
    cities,
    rivers: riverFc,
    roads: roadFc,
    regions: regionFc,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const json = JSON.stringify(bundle);
  writeFileSync(OUT, json);
  console.log(
    '[world-labels]',
    Math.round(Buffer.byteLength(json) / 1024),
    'KB cities',
    cities.features.length,
    'rivers',
    riverFc.features.length,
    `(DE ${deRivers})`,
    'roads',
    roadFc.features.length,
    `(DE ${deRoads})`,
    'regions',
    regionFc.features.length,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
