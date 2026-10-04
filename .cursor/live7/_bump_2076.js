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
w('package.json', (s) => s.replace('"version": "2.0.75"', '"version": "2.0.76"'));
w('app.json', (s) =>
  s
    .replace('"version": "2.0.75"', '"version": "2.0.76"')
    .replace('"versionCode": 102', '"versionCode": 103'),
);
w('android/app/build.gradle', (s) =>
  s
    .replace('versionCode 102', 'versionCode 103')
    .replace('versionName "2.0.75"', 'versionName "2.0.76"'),
);
fs.mkdirSync('releases/2.0.76', { recursive: true });
fs.writeFileSync(
  'releases/2.0.76/whatsnew-de-DE-v103.txt',
  'Call-1 spricht wieder zu: Zusage auch bei Follow-ups (SUP, Rad-Umschalten, Filter) — Bridge wird nicht mehr stumm geschaltet.\n',
  'utf8',
);
console.log('notes ok');
