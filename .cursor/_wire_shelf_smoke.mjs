import { readFileSync, writeFileSync } from 'node:fs';

const p = 'package.json';
const j = JSON.parse(readFileSync(p, 'utf8'));
const key = 'test:reisebuero-qa';
const needle = 'tsx src/reisebuero/touristPersonas.smoke.test.ts';
const insert = 'tsx src/reisebuero/touristPersonas.smoke.test.ts && npx --yes --package tsx@4.19.4 tsx src/reisebuero/shelfAskedPrefs.smoke.test.ts';
if (!j.scripts?.[key]) throw new Error('missing script');
if (j.scripts[key].includes('shelfAskedPrefs.smoke')) {
  console.log('already wired');
} else if (!j.scripts[key].includes(needle)) {
  throw new Error('anchor missing');
} else {
  j.scripts[key] = j.scripts[key].replace(needle, insert);
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log('wired shelfAskedPrefs smoke');
}
