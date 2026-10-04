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

w('package.json', (s) =>
  s.replace('"version": "2.0.74"', '"version": "2.0.75"'),
);
w('app.json', (s) =>
  s
    .replace('"version": "2.0.74"', '"version": "2.0.75"')
    .replace('"versionCode": 101', '"versionCode": 102'),
);
w('android/app/build.gradle', (s) =>
  s
    .replace('versionCode 101', 'versionCode 102')
    .replace('versionName "2.0.74"', 'versionName "2.0.75"'),
);

fs.mkdirSync('releases/2.0.75', { recursive: true });
fs.writeFileSync(
  'releases/2.0.75/whatsnew-de-DE-v102.txt',
  'Call-1 Bridge ohne Notbremse: deine Bridge kommt 1:1 — kein automatisches Ersetzen von Floskeln.\n',
  'utf8',
);
console.log('notes ok');
