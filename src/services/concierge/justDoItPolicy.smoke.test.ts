/**
 * Smoke: nie Siezen + weiches Lookup-Angebot + Button-Label „schau nach“.
 */
import {
  detectSoftLookupOffer,
  normalizeLookupShowMoreLabel,
  rewriteSiezenToDu,
  stripPermissionLookupAsks,
  SOFT_LOOKUP_OFFER_TAIL,
} from './justDoItPolicy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  rewriteSiezenToDu('Möchten Sie die aktuellen Meldungen hören?').includes('Möchtest du'),
  'möchten Sie → du',
);
assert(!/\bSie\b/.test(rewriteSiezenToDu('Können Sie mir helfen?')), 'können Sie stripped');
assert(rewriteSiezenToDu('Ich zeige Ihnen das.').includes('dir'), 'Ihnen → dir');

const vatican =
  'Leo XIV. ist 69. Kann ich die aktuellen Meldungen vom Vatikan sagen?';
assert(detectSoftLookupOffer(vatican), 'permission news is soft lookup');
const cleaned = stripPermissionLookupAsks(vatican);
assert(!/\bkann\s+ich\b/iu.test(cleaned), 'permission removed');
assert(cleaned.includes(SOFT_LOOKUP_OFFER_TAIL) || /schau ich kurz live/i.test(cleaned), 'soft offer kept');
assert(/\b69\b/.test(cleaned), 'fact kept');

assert(
  normalizeLookupShowMoreLabel('Mehr Informationen', 'Schau kurz live nach zum Vatikan') ===
    'schau nach',
  'vague mehr → schau nach',
);
assert(normalizeLookupShowMoreLabel('schau nach', 'x') === 'schau nach', 'schau nach stays');

console.log('justDoItPolicy.smoke.test.ts OK');
