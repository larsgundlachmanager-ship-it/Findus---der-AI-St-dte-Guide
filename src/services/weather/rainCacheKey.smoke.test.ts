/**
 * Run: npx --yes tsx src/services/weather/rainCacheKey.smoke.test.ts
 */
import { rainCacheKey, rainCellCenter } from './rainCacheKey';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function run(): void {
  // Blankenese ~53.56 / 9.81 vs Volksdorf ~53.65 / 10.16
  const blank = rainCacheKey({ lat: 53.557, lng: 9.823 });
  const volk = rainCacheKey({ lat: 53.65, lng: 10.163 });
  const wilh = rainCacheKey({ lat: 53.496, lng: 10.0 });
  assert(blank !== volk, 'Blankenese ≠ Volksdorf rain key');
  assert(blank !== wilh, 'Blankenese ≠ Wilhelmsburg rain key');
  assert(volk !== wilh, 'Volksdorf ≠ Wilhelmsburg rain key');

  const a = rainCacheKey({ lat: 53.6612, lng: 9.7971 });
  const b = rainCacheKey({ lat: 53.6618, lng: 9.7974 });
  assert(a === b, 'gleiche ~1 km Zelle teilt Key');

  const c = rainCellCenter(53.6612, 9.7971);
  assert(a === rainCacheKey(c), 'Zentrum → gleicher Key');
  assert(a.startsWith('rain:'), 'Prefix rain:');

  console.log('rainCacheKey.smoke.test.ts ok');
}

run();
