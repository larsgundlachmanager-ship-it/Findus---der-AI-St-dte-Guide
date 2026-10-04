/**
 * Package-Blueprint aus Ledger — steuert Research-Pfad und Plan-Adapter.
 */

import type { ReiseLedger } from '../types';
import { isCruiseLedger } from './cruisePlan';
import type { PackageBlueprintId } from './tripPackageSpine';
import { resolveResearchPath, type ResearchPathKind } from './researchPath';

export function isFerryLedger(ledger: ReiseLedger): boolean {
  if (ledger.tripShape?.value === 'ferry') return true;
  const ids = [
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ...(ledger.niceHaves?.value ?? []),
  ];
  if (ids.includes('ferry')) return true;
  const blob = [
    ledger.destinationHint?.value,
    ledger.highlightWant?.value,
    ledger.purpose?.value,
    ledger.extraWishes?.value,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\bfähr|faehr|ferry|inselfähre|autofähre\b/i.test(blob);
}

export function isRailHeavyLedger(ledger: ReiseLedger): boolean {
  if (ledger.mode?.value === 'train') return true;
  if (ledger.railFlex?.value === 'overnight_ok') return true;
  const blob = [
    ledger.mode?.value,
    ledger.highlightWant?.value,
    ledger.extraWishes?.value,
    ledger.purpose?.value,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\b(nightjet|nachtzug|interrail|nur\s+bahn|mit\s+dem\s+zug)\b/i.test(blob);
}

export function resolvePackageBlueprint(ledger: ReiseLedger): PackageBlueprintId {
  if (isCruiseLedger(ledger)) {
    if (ledger.cruiseKind?.value === 'river') return 'cruise';
    return 'cruise';
  }
  if (isFerryLedger(ledger)) {
    const mode = ledger.mode?.value;
    if (mode === 'fly' || mode === 'mix') return 'fly_ferry';
    if (mode === 'drive') return 'drive_ferry';
    return 'ferry_island';
  }
  if (isRailHeavyLedger(ledger)) {
    if (ledger.railFlex?.value === 'overnight_ok') return 'rail_night';
    if (ledger.mode?.value === 'fly') return 'fly_rail';
    return 'rail_day';
  }
  if (ledger.mode?.value === 'camping' || (ledger.mustHaves?.value ?? []).includes('camping')) {
    return 'camping';
  }
  if (ledger.tripShape?.value === 'roadtrip' || ledger.mode?.value === 'drive') {
    return 'road';
  }
  if (ledger.mode?.value === 'hike' || ledger.mode?.value === 'bike' || ledger.tripShape?.value === 'tour') {
    return 'route_tour';
  }
  if (ledger.mode?.value === 'train') return 'rail_day';
  return 'fly_stay';
}

/** Research-Pfad aus Blueprint (über bestehende Path-Logik + Overrides). */
export function researchPathForBlueprint(
  ledger: ReiseLedger,
): ResearchPathKind {
  const bp = resolvePackageBlueprint(ledger);
  if (bp === 'route_tour') return 'route_tour';
  if (bp === 'camping' || bp === 'road') {
    const base = resolveResearchPath(ledger);
    return base;
  }
  if (bp === 'cruise' || bp === 'fly_ferry' || bp === 'fly_rail' || bp === 'fly_stay') {
    return 'flight_first';
  }
  if (bp === 'rail_day' || bp === 'rail_night' || bp === 'bus' || bp === 'ferry_island' || bp === 'drive_ferry') {
    return 'flight_first'; // access-first innerhalb; Funnel wählt Bahn/Bus
  }
  return resolveResearchPath(ledger);
}
