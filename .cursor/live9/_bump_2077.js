const fs = require('fs');
const path = require('path');
function w(file, transform) {
  const abs = path.resolve(file);
  const s = fs.readFileSync(abs, 'utf8');
  const n = transform(s);
  if (n === s) {
    console.log('NO CHANGE', file);
    return;
  }
  const tmp = abs + '.tmpwrite';
  fs.writeFileSync(tmp, n, 'utf8');
  fs.renameSync(tmp, abs);
  console.log('OK', file);
}
w('package.json', (s) => s.replace('"version": "2.0.76"', '"version": "2.0.77"'));
w('app.json', (s) =>
  s
    .replace('"version": "2.0.76"', '"version": "2.0.77"')
    .replace('"versionCode": 103', '"versionCode": 104'),
);
w('android/app/build.gradle', (s) =>
  s
    .replace('versionCode 103', 'versionCode 104')
    .replace('versionName "2.0.76"', 'versionName "2.0.77"'),
);
fs.mkdirSync('releases/2.0.77', { recursive: true });
fs.writeFileSync(
  'releases/2.0.77/whatsnew-de-DE-v104.txt',
  'Taxi vor Flug: Uber-Vorbestellung mit Uhrzeit und Flughafen (Reserve-Link). Stay-Suche weitet Apartment auf Hotel aus, wenn sonst leer.\n',
  'utf8',
);
console.log('bump 2.0.77 / 104 ok');
