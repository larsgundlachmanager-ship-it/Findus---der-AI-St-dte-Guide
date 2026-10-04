const lat = 53.67667;
const lng = 9.76285;
const r = 2000;
const dLat = r / 111320;
const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
const q = `[out:json][timeout:60];
way["building"](${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng});
out count;`;
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: 'data=' + encodeURIComponent(q),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
const j = await res.json();
console.log(JSON.stringify(j.elements ?? j, null, 2));
