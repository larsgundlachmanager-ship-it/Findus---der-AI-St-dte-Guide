import fs from 'node:fs';
const p = 'app.json';
let s = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
s = s.replace(/"version"\s*:\s*"2\.0\.109"/, '"version": "2.0.110"');
s = s.replace(/"versionCode"\s*:\s*136/, '"versionCode": 137');
fs.writeFileSync(p, s);
console.log('ver', /"version":\s*"([^"]+)"/.exec(s)?.[1], /versionCode"\s*:\s*(\d+)/.exec(s)?.[1]);
