/**
 * Owner-Gold + Korrektur-Lernen — Struktur, keine Scripts.
 * Run: npx --yes tsx src/module2/blueprints/ownerGold.smoke.test.ts
 */

import {
  mergeOwnerGoldIntoPack,
  normalizeOwnerGoldBlueprint,
  situationKeyFromParts,
  validateOwnerGoldSummary,
} from './ownerGold';
import type { SituationBlueprint } from '../../types/situationBlueprints';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(validateOwnerGoldSummary('Gastro: Empfehlung vorne, belegte Preise und Karte mitliefern.'), 'ok summary');
assert(!validateOwnerGoldSummary('Sag genau: Willkommen in Prisdorf'), 'deny script+place');
assert(!validateOwnerGoldSummary('kurz'), 'too short');

const gold = normalizeOwnerGoldBlueprint({
  intentFamily: 'dining',
  tags: ['speisekarte', 'preis'],
  expect: ['prices', 'menu', 'answer_first', 'concrete_place'],
  avoid: ['long_history', 'vague_filler'],
  summary: 'Gastro-Frage: klare Empfehlung vorne, belegte Preise/Karte mitliefern, Historie nur kurz.',
});
assert(gold && gold.source === 'owner_gold', 'normalize gold');
assert(
  gold!.situationKey ===
    situationKeyFromParts({
      intentFamily: 'dining',
      expect: gold!.expect,
      avoid: gold!.avoid,
    }),
  'key from parts',
);

const downloaded: SituationBlueprint[] = [
  {
    situationKey: gold!.situationKey,
    intentFamily: 'dining',
    tags: [],
    expect: ['alternatives'],
    avoid: [],
    summary: 'alte crowd version',
    source: 'auto_3plus',
    version: 1,
  },
  {
    situationKey: 'events::tickets::vague_filler',
    intentFamily: 'events',
    tags: ['tickets'],
    expect: ['tickets'],
    avoid: ['vague_filler'],
    summary: 'Events: Ticket-Link wenn belegt.',
    source: 'auto_3plus',
    version: 1,
  },
];

const merged = mergeOwnerGoldIntoPack(downloaded, [gold!]);
const hit = merged.find((b) => b.situationKey === gold!.situationKey);
assert(hit?.source === 'owner_gold', 'gold wins same key');
assert(hit?.expect.includes('prices'), 'gold expect kept');
assert(merged.some((b) => b.situationKey === 'events::tickets::vague_filler'), 'other crowd kept');

console.log('ownerGold.smoke.test.ts ok');
