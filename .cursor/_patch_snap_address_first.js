const fs = require('fs');
const p = 'src/services/homeMap/snapMapDrop.ts';
let s = fs.readFileSync(p, 'utf8');

const old = `export function snapMapLongPress(opts: {
  lat: number;
  lng: number;
  places: MapDropPlace[];
  houses?: MapDropHouse[] | null;
}): SnappedMapDrop {
  const { lat, lng, places, houses } = opts;
  let bestPlace: MapDropPlace | null = null;
  let bestPlaceM = PLACE_SNAP_M;
  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.id <= 0) continue;
    const d = metersBetween(lat, lng, p.lat, p.lng);
    if (d < bestPlaceM) {
      bestPlaceM = d;
      bestPlace = p;
    }
  }
  if (bestPlace) {
    return { kind: 'place', place: bestPlace, meters: bestPlaceM };
  }

  let bestHouse: MapDropHouse | null = null;
  let bestHouseM = ADDRESS_SNAP_M;
  for (const h of houses ?? []) {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) continue;
    const d = metersBetween(lat, lng, h.lat, h.lng);
    if (d < bestHouseM) {
      bestHouseM = d;
      bestHouse = h;
    }
  }
  if (bestHouse) {
    const street = (bestHouse.s || '').trim();
    const name = street
      ? \`\${street} \${bestHouse.n}\`.trim()
      : \`Hausnummer \${bestHouse.n}\`;
    return {
      kind: 'address',
      lat: bestHouse.lat,
      lng: bestHouse.lng,
      name,
      meters: bestHouseM,
    };
  }

  return { kind: 'point', lat, lng };
}`;

const neu = `export function snapMapLongPress(opts: {
  lat: number;
  lng: number;
  places: MapDropPlace[];
  houses?: MapDropHouse[] | null;
}): SnappedMapDrop {
  const { lat, lng, places, houses } = opts;

  // Hausnummer zuerst — sonst schnappt der nächste Laden (140 m) die Adresse weg.
  let bestHouse: MapDropHouse | null = null;
  let bestHouseM = ADDRESS_SNAP_M;
  for (const h of houses ?? []) {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) continue;
    const d = metersBetween(lat, lng, h.lat, h.lng);
    if (d < bestHouseM) {
      bestHouseM = d;
      bestHouse = h;
    }
  }
  if (bestHouse) {
    const street = (bestHouse.s || '').trim();
    const name = street
      ? \`\${street} \${bestHouse.n}\`.trim()
      : \`Hausnummer \${bestHouse.n}\`;
    return {
      kind: 'address',
      lat: bestHouse.lat,
      lng: bestHouse.lng,
      name,
      meters: bestHouseM,
    };
  }

  let bestPlace: MapDropPlace | null = null;
  let bestPlaceM = PLACE_SNAP_M;
  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.id <= 0) continue;
    const d = metersBetween(lat, lng, p.lat, p.lng);
    if (d < bestPlaceM) {
      bestPlaceM = d;
      bestPlace = p;
    }
  }
  if (bestPlace) {
    return { kind: 'place', place: bestPlace, meters: bestPlaceM };
  }

  return { kind: 'point', lat, lng };
}`;

if (!s.includes('bestPlaceM = PLACE_SNAP_M')) {
  console.error('unexpected snapMapDrop shape');
  process.exit(1);
}
if (!s.includes('Hausnummer zuerst')) {
  // replace by finding the function body start
  const start = s.indexOf('export function snapMapLongPress');
  const end = s.indexOf('export function resolveMapDropName', start);
  if (start < 0 || end < 0) {
    console.error('markers not found', start, end);
    process.exit(1);
  }
  s = s.slice(0, start) + neu + '\n\n' + s.slice(end);
  fs.writeFileSync(p + '.new', s);
  fs.renameSync(p + '.new', p);
  console.log('snapMapDrop rewritten');
} else {
  console.log('already patched');
}
