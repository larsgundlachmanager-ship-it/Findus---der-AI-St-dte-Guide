/**
 * Cruise inclusions FAQ smokes (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/cruiseInclusionsFaq.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  extractCruiseInclusionsFromBlob,
  looksLikeCruiseInclusionAsk,
} from './cruiseInclusionsFaq';

assert.equal(
  looksLikeCruiseInclusionAsk('Was ist bei AIDA inklusive?'),
  true,
  'aida inkl',
);
assert.equal(
  looksLikeCruiseInclusionAsk('Adidia was ist dabei Trinkgeld und Getränke'),
  true,
  'stt adidia',
);
assert.equal(
  looksLikeCruiseInclusionAsk('Mein Schiff — was kostet extra WLAN und Spa?'),
  true,
  'mein schiff extras',
);
assert.equal(
  looksLikeCruiseInclusionAsk('Trag AIDA Programm in die Timeline'),
  false,
  'timeline write ≠ faq',
);
assert.equal(
  looksLikeCruiseInclusionAsk('Was ist im Hotel inklusive?'),
  false,
  'hotel only',
);

const aida = extractCruiseInclusionsFromBlob(
  [
    'AIDA Premium All Inclusive.',
    'Vollpension inklusive.',
    'Alkohol inklusive in Premium.',
    'Trinkgeld inklusive Servicegebühr.',
    'WLAN als Paket buchbar.',
    'Landausflüge extra buchbar.',
    'Spa Massagen gegen Aufpreis.',
  ].join(' '),
  { userText: 'Was ist bei AIDA inklusive?' },
);
assert.equal(aida.lineName, 'AIDA');
assert.ok(aida.included.some((s) => /mahlzeit/i.test(s.topic)), 'meals');
assert.ok(aida.included.some((s) => /getränk|alkohol/i.test(s.topic)), 'drinks');
assert.ok(aida.included.some((s) => /trinkgeld/i.test(s.topic)), 'tips');
assert.ok(aida.packages.some((s) => /wlan|premium/i.test(s.topic)), 'wlan/premium');
assert.ok(aida.extras.some((s) => /landausflug|spa/i.test(s.topic)), 'extras');

const mein = extractCruiseInclusionsFromBlob(
  'Mein Schiff Genussvielfalt. Vollpension. Getränkepaket optional. Trinkgeld extra.',
  { userText: 'Mein Schiff was ist inklusive?' },
);
assert.equal(mein.lineName, 'Mein Schiff');
assert.ok(mein.included.length + mein.packages.length + mein.extras.length >= 2);

console.log('cruiseInclusionsFaq.smoke.test.ts OK');
