/**
 * Run: npx --yes tsx src/services/cityPack/packDelta.smoke.test.ts
 */

import {
  applyPackPatch,
  applyPackPatchChain,
  buildPackPatch,
  chooseUpdatePath,
  packDataVersion,
  patchTooLarge,
} from './packDelta';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function run(): void {
  const v10 = {
    city_id: 'hamburg',
    data_version: 10,
    name: 'Hamburg',
    spots: [
      { id: 'rathaus', name: 'Rathaus', bullets: ['alt'] },
      { id: 'hafen', name: 'Hafen' },
    ],
  };
  const v11 = {
    city_id: 'hamburg',
    data_version: 11,
    name: 'Hamburg',
    spots: [
      { id: 'rathaus', name: 'Rathaus', bullets: ['neu'] },
      { id: 'elbphilharmonie', name: 'Elbphilharmonie' },
    ],
    symbol: '⚓',
  };

  const patch = buildPackPatch(v10, v11);
  assert(patch, 'Patch wird gebaut');
  assert(patch?.from_version === 10 && patch?.to_version === 11, 'Versionen');
  assert(patch?.spots_remove?.includes('hafen'), 'entferntes Spot');
  assert(
    (patch?.spots_upsert ?? []).some(
      (s) => (s as { id?: string }).id === 'elbphilharmonie',
    ),
    'neues Spot',
  );

  const applied = applyPackPatch(v10, patch!);
  assert(packDataVersion(applied) === 11, 'Patch hebt Version');
  const spots = applied.spots as Array<{ id?: string; bullets?: string[] }>;
  assert(
    spots.some((s) => s.id === 'rathaus' && s.bullets?.[0] === 'neu'),
    'Spot-Update',
  );
  assert(
    spots.some((s) => s.id === 'elbphilharmonie'),
    'Spot-Insert',
  );
  assert(!spots.some((s) => s.id === 'hafen'), 'Spot-Delete');
  assert(applied.symbol === '⚓', 'pack_set');

  assert(chooseUpdatePath(11, 11, []).kind === 'skip', 'gleiche Version = skip');
  assert(chooseUpdatePath(0, 11, []).kind === 'full', 'kein Lokal = full');
  assert(chooseUpdatePath(5, 11, []).kind === 'full', 'zu weit weg = full');

  const refs = [
    { from: 10, to: 11, file: 'patches/hamburg.v10-v11.patch.json' },
  ];
  const viaPatch = chooseUpdatePath(10, 11, refs);
  assert(viaPatch.kind === 'patch', 'eine Version weiter = patch');

  const chain = applyPackPatchChain(v10, [patch!]);
  assert(packDataVersion(chain) === 11, 'Kette');

  const tinyPrev = { city_id: 'x', data_version: 1, spots: [{ id: 'a', name: 'A' }] };
  const tinyNext = {
    city_id: 'x',
    data_version: 2,
    spots: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  };
  const tinyPatch = buildPackPatch(tinyPrev, tinyNext)!;
  assert(
    patchTooLarge(tinyPatch, tinyNext),
    'winziges Pack: Patch-Anteil groß → Full-File',
  );

  const fatSpots = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    name: `Ort ${i}`,
    bullets: ['Fakt eins', 'Fakt zwei', 'Fakt drei'],
  }));
  const fatPrev = { city_id: 'y', data_version: 3, spots: fatSpots };
  const fatNext = {
    city_id: 'y',
    data_version: 4,
    spots: [...fatSpots, { id: 'neu', name: 'Neu' }],
  };
  const fatPatch = buildPackPatch(fatPrev, fatNext)!;
  assert(
    !patchTooLarge(fatPatch, fatNext),
    'ein neues Spot in großem Pack bleibt unter 30%',
  );

  console.log('packDelta.smoke.test.ts OK');
}

run();
