/**
 * Phase 7 — Lernen + Pack-Klugheit.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/missionLearn.smoke.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMissionChecklist } from './buildMissionChecklist';
import {
  __setPromotedFollowUpSlotsForTest,
  mergePromotedSlotsIntoMission,
} from './promotedMissionSlots';
import {
  buildLiveResearchVenue,
  isPersistableLiveSource,
  planLivePitchPersistDrafts,
} from '../../services/research/persistLiveResearch';
import type { PitchCandidate, PitchRequest } from '../pitch/types';

__setPromotedFollowUpSlotsForTest(null);

{
  // Crowd ≥3 Hotelpreis → live_price auch wenn Reisezeitraum critical (kein Default-Preis)
  __setPromotedFollowUpSlotsForTest([
    { intentFamily: 'hotel', slot: 'prices' },
  ]);
  const hotel = buildMissionChecklist({
    userText: 'Hotel in Amsterdam für 3 Nächte mit Pool',
  });
  assert.equal(hotel.family, 'hotel');
  assert.ok(
    hotel.factsToProve.some((f) => f.id === 'travel_dates'),
    'dates critical without concrete day',
  );
  assert.ok(
    hotel.factsToProve.some((f) => f.id === 'live_price'),
    'promoted hotel prices → live_price in checklist',
  );
  __setPromotedFollowUpSlotsForTest(null);

  // Ohne Promotion: nur travel_dates, kein live_price in diesem Pattern
  const bare = buildMissionChecklist({
    userText: 'Hotel in Amsterdam für 3 Nächte mit Pool',
  });
  assert.ok(bare.factsToProve.some((f) => f.id === 'travel_dates'));
  assert.ok(
    !bare.factsToProve.some((f) => f.id === 'live_price'),
    'without crowd promotion no live_price when dates critical',
  );
}

{
  // Dining menu promoted
  __setPromotedFollowUpSlotsForTest([
    { intentFamily: 'dining', slot: 'menu' },
  ]);
  const facts: import('./missionContract').MissionChecklistItem[] = [];
  const r = mergePromotedSlotsIntoMission({
    family: 'place',
    facts,
    need: {},
  });
  assert.equal(r.needMenu, true);
  assert.ok(facts.some((f) => f.id === 'menu_url'), 'menu fact');
  __setPromotedFollowUpSlotsForTest(null);
}

{
  // Hotel Stay22 persistable; soft_seed not
  assert.equal(isPersistableLiveSource('stay22', 'hotel'), true);
  assert.equal(isPersistableLiveSource('soft_seed', 'hotel'), false);
  assert.equal(isPersistableLiveSource('places', 'food'), true);

  const hotelCand: PitchCandidate = {
    name: 'Canal Hotel',
    lat: 52.37,
    lng: 4.89,
    mapsUrl: 'https://maps.example/c',
    rating: 4.5,
    softTags: ['hotel', 'amsterdam', 'pool'],
    hardEvidence: ['pool'],
    source: 'stay22',
    priceTotalEur: 180,
  };
  const nearMiss: PitchCandidate = {
    name: 'Near Miss Inn',
    lat: 52.38,
    lng: 4.9,
    mapsUrl: 'https://maps.example/n',
    rating: 4.1,
    softTags: ['hotel', 'near_miss'],
    hardEvidence: [],
    source: 'stay22',
  };
  const req = {
    requestId: 'p7',
    kind: 'hotel' as const,
    title: 'Hotel Amsterdam Pool',
    context: 'Amsterdam',
    searchMode: 'city_best' as const,
    visitAtMs: Date.now(),
    wishes: [],
    prefs: {},
    anchor: { lat: 52.37, lng: 4.89 },
    uiLayout: 'live_split' as const,
    cityHint: 'Amsterdam',
    forbidSoftFill: true,
  } satisfies PitchRequest;

  const drafts = planLivePitchPersistDrafts(req, [hotelCand], {
    includeNearMisses: [nearMiss],
  });
  assert.ok(drafts.length >= 1, 'hotel drafts planned');
  assert.ok(
    drafts.some((d) => d.category === 'hotel'),
    'hotel category',
  );
  assert.ok(
    drafts.some((d) => /Canal Hotel|Near Miss/i.test(d.name)),
    'includes researched / near-miss',
  );
}

{
  // Amenity category for Spot-Process payload
  const court = buildLiveResearchVenue(
    {
      name: 'Basketballplatz Stadtpark',
      lat: 53.58,
      lng: 10.0,
      softTags: ['basketballplatz', 'osm'],
      hardEvidence: ['basketball'],
      hookNotes: [],
      websiteUrl: null,
    },
    'generic',
  );
  assert.ok(court);
  assert.equal(court!.category, 'basketball', 'amenity type for pack');

  // Spot-inbox → research payload tags contain category (ohne Supabase)
  const spot = {
    name: court!.name,
    category: court!.category,
    lat: court!.lat,
    lng: court!.lng,
    pack_role: 'directory',
    facts_json: court!.facts,
  };
  const tags = [
    'from_live_research',
    'directory',
    spot.category,
    ...court!.tags.filter((t) => t !== 'from_live_research'),
  ];
  assert.ok(tags.includes('basketball'), 'spot tags carry amenity type');
}

{
  // Night path still wired
  const root = path.resolve(__dirname, '../../..');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  assert.match(
    String(pkg.scripts?.['city:spot:process'] || ''),
    /processPackSpotInbox/,
  );
  const wf = fs.readFileSync(
    path.join(root, '.github/workflows/city-pack-demand.yml'),
    'utf8',
  );
  assert.match(wf, /city:spot:process/);

  const persistSrc = fs.readFileSync(
    path.join(root, 'src/services/research/persistLiveResearch.ts'),
    'utf8',
  );
  assert.ok(
    !/if \(req\.kind === 'hotel'\) return 0/.test(persistSrc),
    'hotel no longer skipped',
  );
  const checklistSrc = fs.readFileSync(
    path.join(root, 'src/module2/mission/buildMissionChecklist.ts'),
    'utf8',
  );
  assert.match(checklistSrc, /mergePromotedSlotsIntoMission/);
}

console.log('missionLearn.smoke.test.ts ok');
