/**
 * Call-2 Must-Fit.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/speech/call2MustFit.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  strengthenCall2Musts,
  call2MustsAreWeak,
  formatCall2MustFitRail,
  stripCall2SoftAmbiguity,
  extractProvisionalMustTokens,
  looksLikePlaceSeek,
} from './call2MustFit';

assert.ok(looksLikePlaceSeek('Wo kann ich all you can eat essen?'));
assert.ok(
  extractProvisionalMustTokens('Ey digga Reifen is platt wa').some((t) =>
    /reifen/i.test(t),
  ),
);

const weakAyce = strengthenCall2Musts('Irgendwie AYCE heute Abend, kein Asiatisch', []);
assert.ok(
  weakAyce.some((m) => /ayce|all_you_can_eat|buffet|kein_/i.test(m)),
  `ayce/kein strengthened: ${weakAyce.join(',')}`,
);
assert.ok(
  call2MustsAreWeak([], 'Wo gibt’s hier ein gutes Steakhouse?'),
  'empty musts + place seek = weak',
);
assert.equal(
  call2MustsAreWeak(['Steak', 'Steakhouse'], 'Wo gibt’s hier ein gutes Steakhouse?'),
  false,
);

assert.ok(
  /Top-2|Shortlist|Gap-Litanei|Buttons still/i.test(
    formatCall2MustFitRail({
      musts: ['Steak', 'kein_asiatisch'],
      weak: true,
    }),
  ),
  'dual pitch rail',
);

assert.ok(
  !/leider keine Preise/i.test(
    stripCall2SoftAmbiguity(
      'Leider keine Preise gefunden. Zwei Steakhouses sind offen.',
    ),
  ),
);
assert.ok(
  /Steak/i.test(
    stripCall2SoftAmbiguity(
      'Leider keine Preise gefunden. Zwei Steakhouses sind offen.',
    ),
  ),
);
assert.equal(
  stripCall2SoftAmbiguity(
    'Was meinst du genau mit Boot? Am Hafen liegt die Alster.',
  ).includes('Was meinst'),
  false,
);
const scrubbed = stripCall2SoftAmbiguity(
  'Kannst du das etwas präziser sagen? Zwei Steakhouses sind offen.',
);
assert.ok(!/präziser|meinst/i.test(scrubbed));
assert.ok(/Steak/i.test(scrubbed));

console.log('call2MustFit.smoke: ok');
