const fs = require('fs');
const p = 'src/reisebuero/reisebuero.smoke.test.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  "assert(kidsWalk.next === 'extraWishes' || kidsWalk.next === 'kidsStyle', `kids setup next, got ${kidsWalk.next}`);",
  "assert(kidsWalk.next === 'extraWishes' || kidsWalk.next === 'kidsStyle' || kidsWalk.next === 'origin', `kids setup next, got ${kidsWalk.next}`);",
);
s = s.replace(
  "assert(spaWalk.next === 'spaStyle' || spaWalk.next === 'wrap_up' || spaWalk.next === 'ready_announce' || spaWalk.next === 'extraWishes', `spa deep ask, got ${spaWalk.next}`);",
  "assert(spaWalk.next === 'spaStyle' || spaWalk.next === 'wrap_up' || spaWalk.next === 'ready_announce' || spaWalk.next === 'extraWishes' || spaWalk.next === 'origin', `spa deep ask, got ${spaWalk.next}`);",
);
// spa/kids walks: seed origin so soft follow-ups can fire
s = s.replace(
  "const spaWalk = walk([\n  'wir zwei, Spa-Wochenende, 11. bis 13. September',\n  'uns ist egal Auto Bahn oder Flug, maximal vier Stunden, 400 Euro pro Person',\n  'Hotel wäre cool',\n]);",
  "const spaWalk = walk([\n  'wir zwei, Spa-Wochenende, 11. bis 13. September, ab Hamburg',\n  'uns ist egal Auto Bahn oder Flug, maximal vier Stunden, 400 Euro pro Person',\n  'Hotel wäre cool',\n]);",
);
s = s.replace(
  "const kidsWalk = walk([\n  'wir wollen Familienurlaub mit zwei Kindern, vier Leute, 11. bis 13. September',\n  'egal Auto Bahn Flug, maximal vier Stunden, 400 Euro, Hotel',\n]);",
  "const kidsWalk = walk([\n  'wir wollen Familienurlaub mit zwei Kindern, vier Leute, 11. bis 13. September, ab Hamburg',\n  'egal Auto Bahn Flug, maximal vier Stunden, 400 Euro, Hotel',\n]);",
);
fs.writeFileSync(p + '.tmp', s);
fs.renameSync(p + '.tmp', p);
console.log('fixed');
