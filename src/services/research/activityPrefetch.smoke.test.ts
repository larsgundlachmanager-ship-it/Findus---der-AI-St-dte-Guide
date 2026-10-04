/**
 * Phase 6 — Alster→SUP Prefetch + Inventory.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/research/activityPrefetch.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  activityPrefetchKey,
  buildWaterActivityAllowSpeech,
  clearActivityPrefetchCache,
  extractWaterAnchorName,
  peekPrefetchedActivity,
  researchActivitySportCached,
  seedActivityPrefetchForTest,
} from './activityPrefetch';
import type { ActivitySportResearchResult } from './activitySportResearch';
import {
  clearLastLiveInventory,
  clearShortTermOnCitySwitch,
  getLastLiveInventory,
  getLastWaterAnchor,
  noteLastLiveInventory,
  noteActivityInventoryDetails,
  noteUserUtterance,
  noteWaterAnchor,
  pushActivityReject,
} from '../../module2/context/shortTermContext';
import {
  detectLiveInventoryKind,
  isInventoryFollowUp,
  resolveLiveInventoryUserText,
} from '../../module2/router/liveInventoryGate';
import { resolveMissionExecutionSoft } from '../../module2/mission/missionFamilyRouting';
import {
  shouldRunCall3Rethink,
  resolveRethinkTail,
} from '../../module2/reboot/pipeline/call3Rethink';

async function main(): Promise<void> {
  clearActivityPrefetchCache();
  clearShortTermOnCitySwitch();
  clearLastLiveInventory();

  assert.equal(extractWaterAnchorName('Wie groß ist die Alster?'), 'Alster');
  assert.equal(
    activityPrefetchKey({
      kind: 'sup',
      namedPlace: 'Alster',
      cityHint: 'Hamburg',
    }),
    'sup|alster|hamburg',
  );

  const seeded: ActivitySportResearchResult = {
    kind: 'sup',
    wantsFreeParking: false,
    namedPlace: 'Alster',
    primary: {
      name: 'SUP School Alster',
      lat: 53.56,
      lng: 10.0,
      distanceM: 800,
      websiteUri: 'https://example.com/sup',
      role: 'primary',
      fitNotes: [],
      priceLabel: null,
    },
    alternative: {
      name: 'Paddle Hamburg',
      lat: 53.57,
      lng: 10.01,
      distanceM: 1200,
      websiteUri: 'https://example.com/paddle',
      role: 'alternative',
      fitNotes: ['zweite Verleih-Option'],
      priceLabel: null,
    },
    parking: null,
    spokenDraft:
      'Für SUP würde ich SUP School Alster nehmen. Zweite Option: Paddle Hamburg.',
    bullets: ['SUP School Alster · 800 m', 'Alt: Paddle Hamburg · 1.2 km'],
    buttons: [
      {
        id: 'act_primary',
        label: 'SUP School',
        payload: {
          kind: 'navigate',
          lat: 53.56,
          lng: 10.0,
          label: 'SUP School Alster',
        },
      },
    ],
    promptBlock: 'ACTIVITY_SPORT seeded',
    activityFit: true,
    alternativeOffered: true,
    priceEur: null,
  };
  seedActivityPrefetchForTest(
    { kind: 'sup', namedPlace: 'Alster', cityHint: 'Hamburg' },
    seeded,
    false,
  );
  const peek = peekPrefetchedActivity({
    userText: 'Kann ich da SUP fahren?',
    cityHint: 'Hamburg',
  });
  assert.ok(peek?.primary, 'prefetch peek has venue');
  assert.equal(peek!.primary!.name, 'SUP School Alster');

  noteWaterAnchor('Alster');
  const cached = await researchActivitySportCached({
    userText: 'Kann ich auf der Alster SUP fahren?',
    lat: 53.55,
    lng: 9.99,
    cityHint: 'Hamburg',
    preferPrefetchWithoutPriceWait: true,
  });
  assert.equal(cached.fromPrefetch, true, 'follow-up from prefetch');
  assert.equal(cached.pricesPending, true, 'prices deferred');
  assert.ok(cached.result.buttons.length >= 1, 'nav button prepared');

  const speech = buildWaterActivityAllowSpeech({
    userText: 'Kann ich da SUP fahren?',
    namedPlace: 'Alster',
    kind: 'sup',
    research: cached.result,
  });
  assert.match(speech, /ja/i, 'allow opener');
  assert.match(speech, /alster/i, 'named water');
  assert.ok(!/\d+\s*€/u.test(speech), 'no invented price in fast speech');

  noteLastLiveInventory({
    kind: 'activity_rental',
    query: 'SUP Verleih Alster Hamburg',
  });
  noteActivityInventoryDetails({
    anchor: 'Alster',
    must: ['sup', 'Alster'],
    venues: [
      {
        name: 'SUP School Alster',
        lat: 53.56,
        lng: 10.0,
        websiteUrl: 'https://example.com/sup',
      },
    ],
  });
  const inv = getLastLiveInventory();
  assert.equal(inv?.kind, 'activity_rental');
  assert.equal(inv?.activityAnchor, 'Alster');
  assert.ok(inv?.activityMust?.includes('sup'));
  assert.equal(getLastWaterAnchor(), 'Alster');

  assert.equal(
    detectLiveInventoryKind('Kann ich SUP auf der Alster ausleihen?'),
    'activity_rental',
  );
  assert.equal(isInventoryFollowUp('wie teuer'), true);
  assert.equal(
    resolveLiveInventoryUserText('wie teuer').inherited,
    true,
    'price follow inherits',
  );
  assert.equal(
    resolveLiveInventoryUserText('wie teuer').kind,
    'activity_rental',
  );

  const reject = resolveLiveInventoryUserText('mag ich nicht');
  assert.equal(reject.inherited, true);
  pushActivityReject('SUP School Alster');
  assert.ok(
    getLastLiveInventory()?.activityRejects?.some((r) => /SUP School/i.test(r)),
    'reject stored',
  );

  clearShortTermOnCitySwitch();
  noteUserUtterance('Wie groß ist die Alster?');
  assert.equal(getLastWaterAnchor(), 'Alster', 'anchor stores Alster');

  assert.equal(
    resolveMissionExecutionSoft('Wo kann ich SUP auf der Alster ausleihen?')
      .execution,
    'task_fanout',
    'rental → fanout not pitch',
  );

  const tail = resolveRethinkTail({
    existing: null,
    completeness: {
      jobId: 'activity_sport',
      ok: false,
      missing: [
        {
          key: 'price_eur',
          severity: 'must',
          lane: 'slow',
          note: 'Verleihpreis',
        },
      ],
      pendingActionHints: [],
    },
  });
  assert.ok(shouldRunCall3Rethink(tail), 'call3 for rental price gap');

  console.log('activityPrefetch.smoke.test.ts ok');
}

void main();
