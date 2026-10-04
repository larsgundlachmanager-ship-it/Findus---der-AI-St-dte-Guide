const fs = require('fs');
const path = require('path');

function bump(file, transform) {
  const abs = path.resolve(file);
  let s = fs.readFileSync(abs, 'utf8');
  const next = transform(s);
  if (next === s) {
    console.log('NO CHANGE', file);
  } else {
    const tmp = abs + '.tmpwrite';
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, abs);
    console.log('OK', file);
  }
}

bump('package.json', (s) =>
  s.replace('"version": "2.0.73"', '"version": "2.0.74"'),
);
bump('app.json', (s) =>
  s
    .replace('"version": "2.0.73"', '"version": "2.0.74"')
    .replace('"versionCode": 100', '"versionCode": 101'),
);
bump('android/app/build.gradle', (s) =>
  s
    .replace('versionCode 100', 'versionCode 101')
    .replace('versionName "2.0.73"', 'versionName "2.0.74"'),
);

const notes = 'releases/2.0.74/whatsnew-de-DE-v101.txt';
fs.mkdirSync(path.dirname(notes), { recursive: true });
fs.writeFileSync(
  notes,
  'Stichpunkte nie mittendrin abschneiden. Pitch ohne Review-Schnipsel mit Punkten. Bahnhof max. 3 Fakten, Live zuerst. Timeline ohne Fake-Zeitkonflikt nach der Fahrt. Klareres Konflikt-Banner.\n',
  'utf8',
);
console.log('notes written');

// Fix pitchSpeech import order if broken
{
  const p = 'src/module2/pitch/pitchSpeech.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (s.startsWith('import {\n  looksLikeProseBullet')) {
    s = s.replace(
      /^import \{\n  looksLikeProseBullet,\n  stripLeadingEllipsisSnippet,\n\} from '\.\.\/\.\.\/services\/concierge\/visualBullets';\n/,
      '',
    );
    if (!s.includes("stripLeadingEllipsisSnippet")) {
      s = s.replace(
        `} from '../../services/concierge/findusResponsePolicy';`,
        `} from '../../services/concierge/findusResponsePolicy';\nimport {\n  looksLikeProseBullet,\n  stripLeadingEllipsisSnippet,\n} from '../../services/concierge/visualBullets';`,
      );
    }
    const tmp = p + '.tmpwrite';
    fs.writeFileSync(tmp, s, 'utf8');
    fs.renameSync(tmp, p);
    console.log('pitchSpeech import order fixed');
  } else if (s.includes('stripLeadingEllipsisSnippet')) {
    console.log('pitchSpeech imports ok');
  } else {
    console.log('pitchSpeech MISSING imports');
  }
}
