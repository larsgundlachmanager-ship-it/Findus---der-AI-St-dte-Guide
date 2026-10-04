/**
 * Research-Brief JSON aus Ledger — Funnel/LLM-Plan, kein Wortlaut.
 */

import type { ReiseLedger } from './types';
import { classifyOptionBrief, targetOptionCount } from './optionPolicy';

export type ResearchBriefJson = {
  purpose: string | null;
  dest: string | null;
  corridor: string | null;
  when: {
    start: string | null;
    end: string | null;
    flex: string | null;
    preferOutbound: string | null;
    softOutbound: string[];
    earliestHour: number | null;
    preferReturn: string | null;
    softReturn: string[];
  };
  party: number;
  budgetEur: number | null;
  budgetVibe: string | null;
  mode: string | null;
  surfacePref: string | null;
  lodgingPrimary: string | null;
  lodgingFallback: string | null;
  meals: string | null;
  must: string[];
  wish: string[];
  nice: string[];
  hardNos: string[];
  hops: { city: string; nights: number | null }[];
  accessNeeds: string[];
  inventoryMode: string | null;
  optionGrain: 'open' | 'medium' | 'specific';
  targetOptions: number;
  cityExplore: string | null;
};

export function buildResearchBriefJson(ledger: ReiseLedger): ResearchBriefJson {
  const flex = ledger.whenFlex?.value;
  return {
    purpose: ledger.purpose?.value ?? null,
    dest: ledger.destinationHint?.value ?? null,
    corridor: ledger.corridor?.value ?? null,
    when: {
      start: ledger.dateStart?.value ?? null,
      end: ledger.dateEnd?.value ?? null,
      flex: ledger.dateFlex?.value ?? null,
      preferOutbound: flex?.outbound?.preferWeekday ?? null,
      softOutbound: flex?.outbound?.softWeekdays ?? [],
      earliestHour: flex?.outbound?.earliestHour ?? null,
      preferReturn: flex?.return?.preferWeekday ?? null,
      softReturn: flex?.return?.softWeekdays ?? [],
    },
    party: ledger.adults?.value ?? 1,
    budgetEur: ledger.budgetEur?.value ?? null,
    budgetVibe: ledger.budgetVibe?.value ?? null,
    mode: ledger.mode?.value ?? null,
    surfacePref: ledger.surfacePref?.value ?? null,
    lodgingPrimary: ledger.lodgingKind?.value ?? null,
    lodgingFallback: ledger.lodgingFallback?.value ?? null,
    meals: ledger.meals?.value ?? null,
    must: [...(ledger.mustHaves?.value ?? [])],
    wish: [...(ledger.wishHaves?.value ?? [])],
    nice: [...(ledger.niceHaves?.value ?? [])],
    hardNos: [...(ledger.hardNos?.value ?? [])],
    hops: (ledger.hopStops?.value ?? []).map((h) => ({
      city: h.city,
      nights: h.nights ?? null,
    })),
    accessNeeds: [...(ledger.accessNeeds?.value ?? [])],
    inventoryMode: ledger.inventoryMode?.value ?? null,
    optionGrain: classifyOptionBrief(ledger),
    targetOptions: targetOptionCount(ledger),
    cityExplore: ledger.cityExplore?.value ?? null,
  };
}
