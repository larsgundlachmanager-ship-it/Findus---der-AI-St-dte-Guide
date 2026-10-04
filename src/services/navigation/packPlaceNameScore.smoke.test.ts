/**
 * Pack-Place Name-Score: keine Policke→Polizei-Diebstähle.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/packPlaceNameScore.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { packPlaceNameScore } from './packPlaceNameScore';

assert.equal(
  packPlaceNameScore('Polizeikommissariat 15', 'Policke'),
  0,
  'Policke ≠ Polizeikommissariat',
);
assert.equal(
  packPlaceNameScore('Polizeipräsidium Stuttgart', 'Policke'),
  0,
  'Policke ≠ Polizeipräsidium',
);
assert.equal(
  packPlaceNameScore('Polizei', 'Policke'),
  0,
  'Policke ≠ Polizei (Prefix poli)',
);
assert.ok(
  packPlaceNameScore('Polizeikommissariat 15', 'Polizei') >= 85,
  'echte Polizei-Frage trifft Kommissariat',
);
assert.ok(
  packPlaceNameScore('POLICKE Herrenkleidung', 'Policke') >= 85,
  'Policke trifft Shop-Namen',
);
assert.ok(
  packPlaceNameScore('Hamburger Rathaus', 'Rathaus') >= 85,
  'Substring-Treffer bleibt',
);

console.log('packPlaceNameScore.smoke.test.ts OK');
