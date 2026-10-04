import { deriveSpickzettelTitle } from '../src/services/concierge/spickzettelTitle';
const t = deriveSpickzettelTitle({
  userText: 'Wie groß ist ein Tennisplatz?',
  speech: 'Im Doppel 23,77 × 10,97 Meter.',
  bullets: ['Doppelfeld: 23,77×10,97 m', 'Einzelfeld: 23,77×8,23 m'],
});
console.log(JSON.stringify(t));
const u = 'Wie groß ist ein Tennisplatz?';
console.log('gro test', /\bwie\s+gro/iu.test(u));
console.log('subj', u.match(/\bwie\s+gro\w*\s+(?:ist|sind)\s+(.+?)(?:\s*\?|$)/iu));
