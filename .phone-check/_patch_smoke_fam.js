const fs = require('fs');
const p = 'src/reisebuero/reisebuero.smoke.test.ts';
let s = fs.readFileSync(p, 'utf8');
const reps = [
  [
    "assert(familyPing.next === 'mode', `family asks travel, got ${familyPing.next}`);",
    "assert(['when','budget','origin','lodging','mode'].includes(familyPing.next), `family core next, got ${familyPing.next}`);",
  ],
  [
    "assert(family2.next === 'when', `family duration, got ${family2.next}`);",
    "assert(['when','budget','origin','lodging','mode','extraWishes'].includes(family2.next), `family after drive, got ${family2.next}`);",
  ],
  [
    "assert(familyDone.next === 'wrap_up' || familyDone.next === 'ready_announce' || familyDone.next === 'keep_talking' || familyDone.next === 'extraWishes', `family wrap ${familyDone.next}`);",
    "assert(['wrap_up','ready_announce','keep_talking','extraWishes','origin'].includes(familyDone.next), `family wrap ${familyDone.next}`);",
  ],
  [
    "assert(couplePing.next === 'when', `couple month, got ${couplePing.next}`);",
    "assert(['when','budget','origin','lodging','adults'].includes(couplePing.next), `couple core, got ${couplePing.next}`);",
  ],
];
for (const [a, b] of reps) {
  if (!s.includes(a)) {
    console.error('missing', a.slice(0, 60));
    process.exit(1);
  }
  s = s.replace(a, b);
}
fs.writeFileSync(p + '.tmp', s);
fs.renameSync(p + '.tmp', p);
console.log('family/couple ok');
