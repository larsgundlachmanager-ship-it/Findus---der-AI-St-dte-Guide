/**
 * Trip-Package Spine + Blueprint + Cruise/Ferry/Rail smokes.
 */
import assert from 'node:assert/strict';
import { cloneEmptyLedger, mergeLedger } from '../slotLedger';
import { parseBriefSlots } from '../parseBriefSlots';
import { conversationGaps, nextQuestionKey } from '../completeness';
import {
  composePackageBuyIn,
  finalizeBuyInGate,
  type AccessLeg,
} from './tripPackageSpine';
import { resolvePackageBlueprint } from './packageBlueprint';
import { enrichOptionAsPackage } from './enrichOptionAsPackage';
import { enrichOptionAsFerryPlan } from './ferryPlan';
import { enrichOptionAsRailPlan } from './railJourneyPlan';
import { buildCruiseSearchBrief, cruisePartnerSearchLinks } from './cruiseSearch';
import {
  isCruisePackageHandoff,
  isCruiseQuickPitch,
  isFindusReisebueroHandoff,
} from '../handoff';
import { buildCruiseQuickPitchFromText } from '../../module2/planning/cruiseQuickPitch';
import { detectCall1Situation } from '../../module2/reboot/pipeline/call1AnswerContract';

// Spine math: cruise user example
{
  const legs: AccessLeg[] = [
    { id: 'fo', kind: 'flight', label: 'Flug hin', amountEur: 100, scope: 'per_person' },
    { id: 'fr', kind: 'flight', label: 'Flug zurück', amountEur: 200, scope: 'per_person' },
    { id: 't1', kind: 'transfer', label: 'Taxi Apt→Hotel', amountEur: 20, scope: 'group' },
    { id: 'h', kind: 'stay', label: 'Hotel', amountEur: 100, scope: 'group' },
    { id: 't2', kind: 'transfer', label: 'Taxi Hotel→Terminal', amountEur: 40, scope: 'group' },
    {
      id: 'c',
      kind: 'cruise',
      label: 'Kreuzfahrt',
      amountEur: 1000,
      scope: 'group',
      requiredForBuyIn: true,
    },
    { id: 't3', kind: 'transfer', label: 'Taxi Terminal→Apt', amountEur: 40, scope: 'group' },
  ];
  const buy = finalizeBuyInGate(composePackageBuyIn(legs, 2));
  assert.equal(buy.totalPackage, 1800);
  assert.equal(buy.buyInEur, 900);
}

// Gate: missing cruise → no buy-in
{
  const legs: AccessLeg[] = [
    {
      id: 'c',
      kind: 'cruise',
      label: 'Kreuzfahrt',
      amountEur: null,
      scope: 'group',
      requiredForBuyIn: true,
    },
    { id: 'f', kind: 'flight', label: 'Flug', amountEur: 100, scope: 'per_person' },
  ];
  const buy = finalizeBuyInGate(composePackageBuyIn(legs, 2));
  assert.equal(buy.buyInEur, null);
  assert.ok(buy.missingRequired.length >= 1);
}

// Parse scenarios
{
  const cheap = parseBriefSlots('günstigste Kreuzfahrt im Oktober');
  assert.equal(cheap.tripShape?.value, 'cruise');
  assert.equal(cheap.cruiseEmbarkBias?.value, 'cheapest_anywhere');
  assert.ok(cheap.dealHunt?.value || cheap.budgetVibe?.value === 'cheap');

  const port = parseBriefSlots('Kreuzfahrt ab Palma für zwei mit Suite und All Inclusive');
  assert.equal(port.tripShape?.value, 'cruise');
  assert.equal(port.cruiseEmbarkBias?.value, 'named_port');
  assert.ok(port.cruiseEmbarkPort?.value || port.destinationHint?.value);
  assert.equal(port.cruiseCabinClass?.value, 'suite');
  assert.ok(port.cruiseFareBundle?.value || port.meals?.value === 'all');

  const near = parseBriefSlots('Kreuzfahrt in der Nähe starten mit Party und Pool');
  assert.equal(near.cruiseEmbarkBias?.value, 'near_home');
  assert.ok((near.mustHaves?.value || near.wishHaves?.value || []).includes('cruise'));

  const fam = parseBriefSlots(
    'Familienkreuzfahrt mit Wasserrutsche Kids Club und Paddelanlage',
  );
  const ids = [
    ...(fam.mustHaves?.value ?? []),
    ...(fam.wishHaves?.value ?? []),
  ];
  assert.ok(ids.includes('water_slide') || ids.includes('kids_club') || ids.includes('cruise'));

  const ferry = parseBriefSlots('Fähre zur Insel nächste Woche');
  assert.equal(ferry.tripShape?.value, 'ferry');
}

// Anti-loop briefing
{
  const led = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('Kreuzfahrt ab Hamburg zu zweit Oktober max 900 Euro'),
  );
  // ensure adults user
  if (!led.adults || led.adults.source !== 'user') {
    led.adults = { value: 2, source: 'user', hardness: 'must' };
  }
  if (!led.originCity) {
    led.originCity = { value: 'Hamburg', source: 'user', hardness: 'must' };
  }
  const gaps = conversationGaps(led, []);
  assert.ok(
    gaps.length <= 1 || gaps[0]?.key === 'ready_announce' || gaps[0]?.tier === 'green' || gaps[0]?.tier === 'red',
    `cruise gaps ${JSON.stringify(gaps)}`,
  );
  const nq = nextQuestionKey(led, ['budget', 'when', 'adults', 'origin']);
  assert.ok(
    nq.key === 'ready_announce' ||
      nq.key === 'keep_talking' ||
      nq.key === 'when' ||
      nq.key === 'cruiseCore' ||
      nq.key === 'cruiseShipVibe' ||
      nq.key === 'cruiseShipPick' ||
      nq.key === 'cruiseDepth',
    `next ${nq.key}`,
  );
  assert.notEqual(nq.key, 'meals');
  assert.notEqual(nq.key, 'lodging');
}

// Blueprint
{
  const c = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Kreuzfahrt mit Suite'));
  assert.equal(resolvePackageBlueprint(c), 'cruise');
  const f = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Fähre nach Sylt'));
  assert.ok(
    ['ferry_island', 'fly_ferry', 'drive_ferry'].includes(resolvePackageBlueprint(f)),
  );
  const r = mergeLedger(cloneEmptyLedger(), {
    mode: { value: 'train', source: 'user', hardness: 'must' },
    railFlex: { value: 'overnight_ok', source: 'user', hardness: 'wish' },
  } as any);
  assert.equal(resolvePackageBlueprint(r), 'rail_night');
}

// Package enrich gate
{
  const led = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Kreuzfahrt ab Palma'));
  led.adults = { value: 2, source: 'user', hardness: 'must' };
  const opt = enrichOptionAsPackage(
    {
      id: 'x',
      title: 'T',
      placeName: 'Palma',
      lat: 0,
      lng: 0,
      totalEur: null,
      budgetDeltaEur: null,
      pricePerPerson: null,
      priceIncludes: null,
      restBudgetEur: null,
      restBudgetHint: null,
      matchScore: 1,
      fitLine: null,
      whyBlurb: '',
      facts: [],
      softFacts: [],
      whyMatch: ['x'],
      gaps: [],
      photoUrl: null,
      stops: [],
      flightPriceEur: 150,
      stayPriceEur: 100,
    } as any,
    led,
  );
  assert.equal(opt.buyInEur, null, 'no cruise price → no buy-in');
  assert.ok((opt.bookingChecklist || []).some((c) => c.kind === 'cruise'));
}

// Ferry / rail enrich
{
  const fled = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Fähre Insel'));
  fled.adults = { value: 2, source: 'user', hardness: 'must' };
  const fopt = enrichOptionAsFerryPlan(
    {
      id: 'f',
      title: 'F',
      placeName: 'Insel',
      gaps: [],
      decisionNotes: [],
    } as any,
    fled,
    { ferryEur: 80, stayEur: 200 },
  );
  assert.equal(fopt.buyInEur, 140);

  const rled = mergeLedger(cloneEmptyLedger(), {
    mode: { value: 'train', source: 'user', hardness: 'must' },
  } as any);
  rled.adults = { value: 2, source: 'user', hardness: 'must' };
  const ropt = enrichOptionAsRailPlan(
    {
      id: 'r',
      title: 'R',
      placeName: 'Wien',
      stayPriceEur: 200,
      gaps: [],
      decisionNotes: [],
      transports: [
        {
          id: 't1',
          kind: 'train',
          label: 'Bahn',
          priceEur: 89,
          bookUrl: 'https://bahn.de',
          departAt: null,
          arriveAt: null,
          better: true,
        },
      ],
    } as any,
    rled,
  );
  assert.ok(ropt.buyInEur != null && ropt.buyInEur > 0);

  const nled = mergeLedger(cloneEmptyLedger(), {
    mode: { value: 'train', source: 'user', hardness: 'must' },
    railFlex: { value: 'overnight_ok', source: 'user', hardness: 'wish' },
    originCity: { value: 'Hamburg', source: 'user', hardness: 'must' },
    dateStart: { value: '2026-10-04', source: 'user', hardness: 'must' },
    stayNights: { value: 2, source: 'user', hardness: 'wish' },
  } as any);
  nled.adults = { value: 2, source: 'user', hardness: 'must' };
  const destUrl = 'https://dest.example/wien-hotel';
  const startUrl = 'https://start.example/hamburg-hbf';
  const nopt = enrichOptionAsRailPlan(
    {
      id: 'nj',
      title: 'Nightjet',
      placeName: 'Wien',
      stayName: 'Hotel Wien Mitte',
      stayPriceEur: 200,
      stayBookUrl: destUrl,
      gaps: [],
      decisionNotes: [],
      bookendStartStay: {
        id: 'bookend-start-hh',
        name: 'Hotel Hamburg Hbf',
        priceEur: 79,
        bookUrl: startUrl,
        photoUrl: null,
        why: 'Hotel vor dem Nachtzug',
      },
      transports: [
        {
          id: 't1',
          kind: 'train',
          label: 'Nightjet',
          priceEur: 89,
          bookUrl: 'https://bahn.de',
          departAt: '20:10',
          arriveAt: '08:00',
          better: true,
        },
      ],
    } as any,
    nled,
  );
  const startLine = (nopt.priceBreakdown || []).find((l) => l.id === 'stay-start');
  const endLine = (nopt.priceBreakdown || []).find((l) => l.id === 'stay-end');
  assert.equal(startLine?.amountEur, 79, 'bookend start has live price');
  assert.equal(endLine?.amountEur, 200, 'dest stay is the end hotel');
  const startCheck = (nopt.bookingChecklist || []).find((c) => c.id === 'book-stay-start');
  const endCheck = (nopt.bookingChecklist || []).find((c) => c.id === 'book-stay-end');
  assert.ok(startCheck?.url && startCheck.url !== destUrl, 'start hotel is not dest clone');
  assert.equal(startCheck?.url, startUrl);
  assert.equal(endCheck?.url, destUrl);

  const { needsBookendHotels } = require('./bookendHotels') as typeof import('./bookendHotels');
  assert.equal(needsBookendHotels(nled), true, 'night train wants bookend hotels');

  const cloneOpt = enrichOptionAsRailPlan(
    {
      id: 'nj2',
      title: 'Nightjet',
      placeName: 'Wien',
      stayPriceEur: 200,
      stayBookUrl: destUrl,
      gaps: [],
      decisionNotes: [],
      transports: [
        {
          id: 't1',
          kind: 'train',
          label: 'Nightjet',
          priceEur: 89,
          bookUrl: 'https://bahn.de',
          departAt: '20:10',
          arriveAt: null,
          better: true,
        },
      ],
    } as any,
    nled,
  );
  const cloneStart = (cloneOpt.bookingChecklist || []).find((c) => c.id === 'book-stay-start');
  assert.ok(cloneStart?.url, 'start hotel still bookable without live stay');
  assert.notEqual(cloneStart?.url, destUrl, 'fallback start url ≠ dest');
}

// Partner links + M2 dual
{
  const led = mergeLedger(cloneEmptyLedger(), parseBriefSlots('günstigste Kreuzfahrt Oktober'));
  const brief = buildCruiseSearchBrief(led);
  assert.ok(brief.query.length > 5);
  assert.ok(cruisePartnerSearchLinks(led).length >= 2);

  assert.equal(isCruiseQuickPitch('Gibt es eine günstige Kreuzfahrt im Oktober?'), true);
  assert.equal(
    isFindusReisebueroHandoff('Gibt es eine günstige Kreuzfahrt im Oktober?'),
    false,
  );
  assert.equal(
    isCruisePackageHandoff('Plane uns die Kreuzfahrt komplett mit Flug und Hotel'),
    true,
  );
  assert.equal(
    isFindusReisebueroHandoff('Plane uns die Kreuzfahrt komplett mit Flug und Hotel'),
    true,
  );
  assert.equal(
    detectCall1Situation('Gibt es eine günstige Kreuzfahrt im Oktober?'),
    'cruise_quick',
  );
  assert.equal(
    detectCall1Situation('Plane uns die Kreuzfahrt komplett mit Flug'),
    'reisebuero_collect',
  );
  const pitch = buildCruiseQuickPitchFromText('günstigste Kreuzfahrt im Oktober Party');
  assert.ok(pitch && pitch.buttons.length >= 1 && pitch.speech.length > 10);
}

// Taxi / Zwischenstopp überall
{
  const { buildAccessTransferLegs, looksLikeTaxiTransferHub } = require('./accessTransfer') as typeof import('./accessTransfer');
  const { syncFollowThroughGoal } = require('../../module2/router/missionFollowThrough') as typeof import('../../module2/router/missionFollowThrough');
  assert.ok(looksLikeTaxiTransferHub('Taxi zum Kreuzfahrtterminal'));
  assert.ok(looksLikeTaxiTransferHub('Uber zum Fährhafen'));
  assert.ok(looksLikeTaxiTransferHub('Taxi Zwischenstopp Bahnhof'));
  const g = syncFollowThroughGoal('Taxi zum Kreuzfahrtterminal bitte vorbestellen');
  assert.ok(g && /terminal|Taxi/i.test(g.rootLabel));

  const flyLed = mergeLedger(cloneEmptyLedger(), parseBriefSlots('fliegen Mallorca Hotel'));
  flyLed.adults = { value: 2, source: 'user', hardness: 'must' };
  const flyOpt = enrichOptionAsPackage(
    {
      id: 'fly',
      title: 'Mallorca',
      placeName: 'Palma',
      lat: 39.57,
      lng: 2.65,
      stayName: 'Hotel Test',
      gaps: [],
      decisionNotes: [],
      bookingChecklist: [],
    } as any,
    flyLed,
  );
  assert.ok(
    (flyOpt.bookingChecklist || []).some((c) => c.kind === 'transfer'),
    'fly_stay has taxi transfer',
  );

  const cruiseLed = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Kreuzfahrt ab Palma Taxi zum Terminal'));
  cruiseLed.adults = { value: 2, source: 'user', hardness: 'must' };
  const clegs = buildAccessTransferLegs(cruiseLed, {
    id: 'c',
    title: 'C',
    placeName: 'Palma',
    lat: 39.57,
    lng: 2.65,
    stayName: 'Hotel',
  } as any);
  assert.ok(clegs.some((l) => /Terminal|Hotel/i.test(l.label)));
  assert.ok(clegs.every((l) => l.kind === 'transfer' && l.bookUrl));

  const stopLed = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('fliegen Mallorca Taxi Zwischenstopp in Palma'),
  );
  assert.ok(/zwischenstopp/i.test(stopLed.extraWishes?.value || ''), 'zwischenstopp parsed');
  assert.equal(stopLed.transferPref?.value, 'taxi');
  const stopOpt = enrichOptionAsPackage(
    {
      id: 'fly-stop',
      title: 'Mallorca',
      placeName: 'Palma',
      lat: 39.57,
      lng: 2.65,
      stayName: 'Hotel Test',
      gaps: [],
      decisionNotes: [],
      bookingChecklist: [],
    } as any,
    stopLed,
  );
  assert.ok(
    (stopOpt.bookingChecklist || []).some((c) => /Zwischenstopp/i.test(c.label)),
    'waypoint transfer on fly_stay',
  );

  const roadLed = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('Roadtrip Kroatien mit dem Auto'),
  );
  const roadOpt = enrichOptionAsPackage(
    {
      id: 'road',
      title: 'Kroatien',
      placeName: 'Split',
      lat: 43.5,
      lng: 16.4,
      stayName: 'Camp',
      gaps: [],
      decisionNotes: [],
      bookingChecklist: [],
    } as any,
    roadLed,
  );
  assert.ok(
    !(roadOpt.bookingChecklist || []).some((c) => /Flughafen/i.test(c.label)),
    'roadtrip has no default airport taxi',
  );
}

// 14 Szenario-Parse (stadt-agnostisch)
{
  const cases: Array<{ q: string; check: (p: ReturnType<typeof parseBriefSlots>) => boolean }> = [
    { q: 'Kreuzfahrt in der Nähe starten', check: (p) => p.cruiseEmbarkBias?.value === 'near_home' },
    { q: 'Kreuzfahrt ab Palma', check: (p) => p.cruiseEmbarkBias?.value === 'named_port' },
    { q: 'günstigste Kreuzfahrt im Oktober', check: (p) => p.cruiseEmbarkBias?.value === 'cheapest_anywhere' },
    { q: 'Kreuzfahrt in 14 Tagen', check: (p) => Boolean(p.dateStart) },
    { q: 'Kreuzfahrt Party All Inclusive', check: (p) => p.meals?.value === 'all' || Boolean(p.cruiseFareBundle) },
    { q: 'Familienkreuzfahrt Wasserrutsche Pool', check: (p) => p.tripShape?.value === 'cruise' },
    { q: 'Kreuzfahrt Suite Spa', check: (p) => p.cruiseCabinClass?.value === 'suite' },
    { q: 'Kreuzfahrt viele Seetage', check: (p) => p.cruiseSeaDaysBias?.value === 'many_sea' },
    { q: 'Kreuzfahrt viele Stopps viel sehen', check: (p) => p.cruiseSeaDaysBias?.value === 'many_ports' },
    { q: 'warme Kreuzfahrt', check: (p) => (p.mustHaves?.value ?? p.wishHaves?.value ?? []).includes('warm') || p.tripShape?.value === 'cruise' },
    { q: 'kulinarische Kreuzfahrt Gourmet', check: (p) => p.tripShape?.value === 'cruise' },
    { q: 'Flusskreuzfahrt Donau', check: (p) => p.cruiseKind?.value === 'river' || (p.mustHaves?.value ?? []).includes('river_cruise') },
    { q: 'Gibt es eine günstige Kreuzfahrt im Oktober?', check: () => isCruiseQuickPitch('Gibt es eine günstige Kreuzfahrt im Oktober?') },
    { q: 'Plane uns die Kreuzfahrt komplett mit Flug', check: () => isCruisePackageHandoff('Plane uns die Kreuzfahrt komplett mit Flug') },
  ];
  for (const c of cases) {
    const p = parseBriefSlots(c.q);
    assert.ok(c.check(p), `scenario fail: ${c.q}`);
  }
}

console.log('tripPackage.smoke.test.ts ok');
