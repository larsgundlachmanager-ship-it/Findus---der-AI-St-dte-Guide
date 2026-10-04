import { deriveSpickzettelTitle } from '../src/services/concierge/spickzettelTitle';
const u = 'Wie groß ist ein Tennisplatz?';
console.log('match', u.match(/\bwie\s+gro\S{0,8}?\s+(?:ist|sind)\s+(.+?)(?:\s*\?|$)/iu));
console.log('title', JSON.stringify(deriveSpickzettelTitle({
  userText: u,
  speech: 'Im Doppel 23,77 × 10,97 Meter.',
  bullets: ['Doppelfeld: 23,77×10,97 m'],
})));
// char codes around groß
const i = u.indexOf('gro');
console.log([...u.slice(i, i+8)].map(c => c + ':' + c.codePointAt(0).toString(16)));
