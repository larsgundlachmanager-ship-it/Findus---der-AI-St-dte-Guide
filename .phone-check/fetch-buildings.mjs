const lat = 53.67667, lng = 9.76285, r = 2500;
const dLat = r / 111320;
const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
const q = `[out:json][timeout:90];
(
  way["building"](${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng});
);
out geom;`;
const mirrors = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
for (const url of mirrors) {
  try {
    console.log('try', url);
    const ctrl = AbortSignal.timeout(50000);
    const res = await fetch(url, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl,
    });
    if (!res.ok) { console.log('status', res.status); continue; }
    const j = await res.json();
    const n = (j.elements || []).filter(e => e.type === 'way' && e.tags?.building).length;
    console.log('OK ways', n);
    if (n > 0) {
      const fs = await import('node:fs');
      fs.writeFileSync('./.phone-check/prisdorf-buildings-raw.json', JSON.stringify(j));
      console.log('saved raw');
      break;
    }
  } catch (e) {
    console.log('fail', e.cause?.code || e.message);
  }
}
