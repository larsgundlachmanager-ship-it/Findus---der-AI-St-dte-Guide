/**
 * Phase 7 — Crowd-promoted Follow-up-Slots → MissionChecklist.
 * Test-Override ohne React Native / Collective-Hydrate.
 */

import type { MissionChecklistItem, MissionFamily } from './missionContract';

export type PromotedSlotSeed = {
  intentFamily: string;
  slot: string;
};

let testSeeds: PromotedSlotSeed[] | null = null;

/** Nur Smokes / Unit — Runtime nutzt Collective-Cache. */
export function __setPromotedFollowUpSlotsForTest(
  seeds: PromotedSlotSeed[] | null,
): void {
  testSeeds = seeds;
}

function familyToIntentFamily(family: MissionFamily): string {
  switch (family) {
    case 'hotel':
      return 'hotel';
    case 'place':
      return 'dining';
    case 'schedule':
    case 'event':
      return 'events';
    case 'activity':
    case 'amenity':
    case 'rental':
      return 'activity';
    case 'flight':
      return 'flight';
    case 'transit':
      return 'nav';
    default:
      return 'general';
  }
}

export function isPromotedFollowUpSlot(opts: {
  intentFamily: string;
  slot: string;
}): boolean {
  const fam = (opts.intentFamily || '').toLowerCase();
  const slot = String(opts.slot || '');
  if (testSeeds) {
    return testSeeds.some(
      (s) =>
        s.slot === slot &&
        (s.intentFamily === fam ||
          s.intentFamily === 'general' ||
          fam === 'general'),
    );
  }
  try {
    const { hasPromotedFollowUpSlot } = require('../../services/memory/collectiveLearning') as {
      hasPromotedFollowUpSlot: (o: {
        intentFamily?: string | null;
        slot: string;
      }) => boolean;
    };
    return hasPromotedFollowUpSlot({
      intentFamily: fam,
      slot,
    });
  } catch {
    return false;
  }
}

function pushUniqueFact(
  facts: MissionChecklistItem[],
  item: MissionChecklistItem,
): void {
  if (facts.some((f) => f.id === item.id)) return;
  facts.push(item);
}

/**
 * Crowd ≥3 → Slot wird Standard in der nächsten Checkliste.
 * Hotel + prices → live_price (+ need.prices Flag für UI).
 */
export function mergePromotedSlotsIntoMission(opts: {
  family: MissionFamily;
  facts: MissionChecklistItem[];
  need: { prices?: boolean; openHours?: boolean; menu?: boolean };
}): { needPrices: boolean; needOpenHours: boolean; needMenu: boolean } {
  const intent = familyToIntentFamily(opts.family);
  let needPrices = Boolean(opts.need.prices);
  let needOpenHours = Boolean(opts.need.openHours);
  let needMenu = Boolean(opts.need.menu);

  if (
    isPromotedFollowUpSlot({ intentFamily: intent, slot: 'prices' }) ||
    (opts.family === 'hotel' &&
      isPromotedFollowUpSlot({ intentFamily: 'hotel', slot: 'prices' }))
  ) {
    needPrices = true;
    pushUniqueFact(opts.facts, {
      id: 'live_price',
      label: 'Live-Preis (Crowd-promoted)',
      status: 'pending',
      critical: false,
      value: 'promoted',
      source: 'infer',
    });
  }

  if (
    isPromotedFollowUpSlot({ intentFamily: intent, slot: 'times_hours' })
  ) {
    needOpenHours = true;
    pushUniqueFact(opts.facts, {
      id: 'open_hours',
      label: 'Öffnungszeiten (Crowd-promoted)',
      status: 'pending',
      critical: false,
      value: 'promoted',
      source: 'infer',
    });
  }

  if (
    isPromotedFollowUpSlot({ intentFamily: intent, slot: 'menu' }) ||
    (intent === 'dining' &&
      isPromotedFollowUpSlot({ intentFamily: 'dining', slot: 'menu' }))
  ) {
    needMenu = true;
    pushUniqueFact(opts.facts, {
      id: 'menu_url',
      label: 'Speisekarte (Crowd-promoted)',
      status: 'pending',
      critical: false,
      value: 'promoted',
      source: 'infer',
    });
  }

  return { needPrices, needOpenHours, needMenu };
}
