/**
 * Order-Ticket end-to-end wiring smoke (search/need/ui/forbidSoftFill).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1OrderWire.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { diningExpandRingsFor } from '../pitch/searchBrief';
import { buildOpenWorldContract } from './call1OpenWorldContract';
import { mergeCall2Bullets } from '../reboot/pipeline/call2Tail';
import {
  parseCall1OrderTicket,
  defaultOrderTicket,
  formatCall1OrderTicketForPrompt,
} from './call1OrderTicket';

const order = parseCall1OrderTicket({
  order: {
    must: ['all_you_can_eat'],
    avoid: ['avoid_cuisine_asian'],
    search: {
      mode: 'hard',
      stages: ['pack', 'neighbor', 'metro', 'web'],
      maxRadiusKm: 80,
      forbidSoftFill: true,
    },
    need: { menuUrl: true, prices: true, maps: true },
    ui: { openPitch: true, openCalendar: false },
    bulletBudget: { max: 2, maxLines: 2, maxChars: 64 },
  },
});

// Simuliert, was buildPitchRequestFromText aus call1Order setzt (ohne RN-Store)
const requestLike = {
  title: 'AYCE Freitag ohne Asia',
  context: 'Hamburg',
  wishes: [
    { text: 'all_you_can_eat', kind: 'amenity', hardness: 'must' },
  ],
  forbidSoftFill: order.search.forbidSoftFill,
  maxRadiusKm: order.search.maxRadiusKm,
  liveExpandRadiusM: Math.round(order.search.maxRadiusKm * 1000),
  searchStages: order.search.stages,
  orderNeed: order.need,
  orderUi: order.ui,
  bulletBudget: order.bulletBudget,
};

assert.equal(requestLike.forbidSoftFill, true);
assert.equal(requestLike.maxRadiusKm, 80);
assert.equal(requestLike.liveExpandRadiusM, 80_000);

const rings = diningExpandRingsFor(requestLike);
assert.ok(rings.every((r) => r <= 80_000), 'rings capped at 80km');
assert.ok(rings.includes(80_000), 'cap ring present');

const ow = buildOpenWorldContract({
  userText: 'Freitag All you can eat, kein Asiatisch',
  order,
  mustHaves: order.must,
});
assert.equal(ow.stopPolicy.forbidSoftFillOnMust, true);
assert.equal(ow.searchPlan.maxRadiusKm, 80);
assert.equal(ow.uiRequirements.needMenuUrl, true);
assert.equal(ow.uiRequirements.maxBullets, 2);

const prompt = formatCall1OrderTicketForPrompt(order);
assert.ok(/forbidSoftFill=true/.test(prompt));
assert.ok(/need:.*menuUrl/.test(prompt));

const merged = mergeCall2Bullets({
  tailBullets: ['29 € Buffet', 'Kein Asia'],
  agentBullets: ['META: Gold-Familie dining', 'Adresse nicht gefragt'],
  speechText:
    'Zwei AYCE-Spots ohne Asia: eines mit 29 € Buffet, klar kein Asia. Speisekarte dabei.',
  bulletMaxChars: 64,
  maxCount: 2,
  preferCall2Only: true,
  allowAddress: true,
});
assert.ok(merged.length >= 1, `Call-2 bullets kept (got ${merged.length})`);
assert.ok(
  merged.every((b) => !/META:|Gold-Familie/i.test(b)),
  'Call-2 bullets beat agent meta',
);

const emptyTail = mergeCall2Bullets({
  tailBullets: [],
  agentBullets: ['19 € Notfall'],
  speechText: 'Ein Spot für 19 € Notfall.',
  bulletMaxChars: 64,
  maxCount: 2,
  preferCall2Only: true,
  allowAddress: true,
});
assert.ok(
  emptyTail.length >= 1 && emptyTail.some((b) => /19/.test(b)),
  'agent only as emergency when tail empty',
);

assert.equal(defaultOrderTicket().search.forbidSoftFill, false);

console.log('call1OrderWire.smoke.test.ts OK');
