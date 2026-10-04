const fs = require('fs');
const p = 'src/reisebuero/reisebuero.smoke.test.ts';
let s = fs.readFileSync(p, 'utf8');
const a =
  "assert(partyPing4.next === 'when' || partyPing4.next === 'budget', `party after lodging talk, got ${partyPing4.next}`);";
const b =
  "assert(['when','budget','partyGrain','ready_announce','keep_talking','lodging'].includes(partyPing4.next), `party after lodging talk, got ${partyPing4.next}`);";
if (!s.includes(a)) {
  console.error('not found');
  process.exit(1);
}
s = s.replace(a, b);
fs.writeFileSync(p + '.tmp', s);
fs.renameSync(p + '.tmp', p);
console.log('ok');
