import fs from 'node:fs';
const p = 'src/services/discovery/nominatimCityLocale.ts';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("danzig: 'Gdańsk'")) {
  s = s.replace(
    "amsterdam: 'Amsterdam',",
    "amsterdam: 'Amsterdam',\n  danzig: 'Gdańsk',\n  gdansk: 'Gdańsk',",
  );
  fs.writeFileSync(p, s);
  console.log('patched OSM_ADMIN');
} else console.log('already');
