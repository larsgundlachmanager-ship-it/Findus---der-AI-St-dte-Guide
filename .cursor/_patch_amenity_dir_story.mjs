import { readFileSync, writeFileSync } from 'node:fs';

const p = 'src/interests/amenityInterest.smoke.test.ts';
let s = readFileSync(p, 'utf8');
const needle =
  "  'Story gewinnt gegen versehentliches amenity_skip/tier4',\n);";
if (!s.includes(needle)) {
  console.error('anchor missing');
  process.exit(1);
}
if (s.includes('mistaggedDirStory')) {
  console.log('already patched');
  process.exit(0);
}
const insert = `${needle}
const mistaggedDirStory = poi({
  name: 'Museum mit Directory-Tag',
  category: 'museum',
  tags_json: JSON.stringify([
    'museum',
    'story',
    'must_have',
    'directory',
    'tier4',
    'amenity_skip',
  ]),
});
assert(
  !isNonStoryTouristNoisePoi(mistaggedDirStory),
  'Story gewinnt gegen versehentliches directory',
);`;
s = s.replace(needle, insert);
writeFileSync(p, s);
console.log('patched');
