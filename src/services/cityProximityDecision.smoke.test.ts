/**
 * Tri-City / Danzig family + session-open catalog prompt.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/cityProximityDecision.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  decideSessionOpenCitySwitch,
  isSameCityFamily,
  resolveFamilyCatalogPackId,
} from './cityProximityDecision';

assert.equal(
  isSameCityFamily({ name: 'Danzig' }, { name: 'Gdańsk' }),
  true,
  'danzig≈gdansk',
);
assert.equal(
  isSameCityFamily({ id: 'danzig', name: 'Danzig' }, { name: 'Gdynia' }),
  true,
  'danzig≈gdynia',
);
assert.equal(
  isSameCityFamily({ name: 'Danzig' }, { name: 'Kiel' }),
  false,
  'danzig≠kiel',
);

{
  const d = decideSessionOpenCitySwitch({
    selected: { id: 'kiel', name: 'Kiel' },
    selectedKm: 420,
    nearest: { id: 'danzig', name: 'Danzig', km: 21 },
    locality: { name: 'Gdańsk', km: 2 },
  });
  assert.equal(d.action, 'prompt', 'session open prompts');
  assert.equal(
    (d as { via?: string }).via,
    'catalog',
    'Gdańsk locality → Danzig pack card',
  );
}

{
  const d = decideSessionOpenCitySwitch({
    selected: { id: 'danzig', name: 'Danzig' },
    selectedKm: 18,
    nearest: { id: 'danzig', name: 'Danzig', km: 18 },
    locality: { name: 'Gdynia', km: 1 },
  });
  assert.equal(d.action, 'skip_same', 'already in trojmiasto');
}

assert.equal(
  resolveFamilyCatalogPackId({ name: 'Gdynia' }),
  'danzig',
  'gdynia->danzig pack',
);
assert.equal(
  resolveFamilyCatalogPackId({ id: 'soft_gdynia', name: 'Gdynia' }),
  'danzig',
  'soft_gdynia->danzig',
);

console.log('cityProximityDecision.smoke.test.ts OK');
