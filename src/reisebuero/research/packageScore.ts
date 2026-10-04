/**
 * Package-Score: Flug + Stay + Transfer + Must-Fit + Aktivitäten → Top-4.
 */

import type { ReiseLedger, ReiseOption } from '../types';
import { hasUserBudget } from '../completeness';

export type PackageScoreBreakdown = {
  total: number;
  access: number;
  stay: number;
  must: number;
  budget: number;
  prefs: number;
  activities: number;
};

function mustFailCount(o: ReiseOption): number {
  return (o.gaps ?? []).filter((g) => /must-fail:/i.test(g)).length;
}

function mustNearCount(o: ReiseOption): number {
  return (o.gaps ?? []).filter((g) => /must-near:/i.test(g)).length;
}

function hardMetRatio(o: ReiseOption): number {
  const facts = o.facts ?? [];
  if (!facts.length) return 0.6;
  return facts.filter((f) => f.met).length / facts.length;
}

function stablePrefsSafe(): string[] {
  try {
    const { listStablePrefs } = require('../tasteMemory') as {
      listStablePrefs: () => string[];
    };
    return listStablePrefs();
  } catch {
    return [];
  }
}

/**
 * Holistischer Package-Score (0–100).
 * Bevorzugt: Musts belegt, Buy-in im Budget, Zugang+Stay vorhanden, Prefs.
 */
export function scoreTravelPackage(
  opt: ReiseOption,
  ledger: ReiseLedger,
): PackageScoreBreakdown {
  let access = 20;
  const hasFlight = opt.flightPriceEur != null || Boolean(opt.flightBookUrl);
  const hasTrain = (opt.transports ?? []).some((t) => t.kind === 'train');
  const hasBus = (opt.transports ?? []).some((t) => t.kind === 'bus');
  const hasCar = Boolean(opt.carBookUrl) || (opt.transports ?? []).some((t) => t.kind === 'car');
  if (hasFlight || hasTrain || hasBus || hasCar) access = 28;
  else if (ledger.mode?.value === 'daytrip') access = 22;
  else access = 10;
  // Live-Preis auf Bus/Camper belohnt Package-Fit (nicht nur Partner-Link)
  const busPriced = (opt.transports ?? []).some(
    (t) => t.kind === 'bus' && t.priceEur != null && t.priceEur > 0,
  );
  const camperPriced = (opt.transports ?? []).some(
    (t) => t.kind === 'car' && t.priceEur != null && t.priceEur > 0 && /camper/i.test(t.id),
  );
  if (busPriced || camperPriced) access = Math.min(32, access + 4);

  let stay = 10;
  if (opt.stayName && (opt.stayPriceEur != null || opt.stayBookUrl)) stay = 26;
  else if (opt.stayName) stay = 16;

  const fails = mustFailCount(opt);
  const nears = mustNearCount(opt);
  let must = Math.round(hardMetRatio(opt) * 24);
  must -= fails * 10;
  must -= nears * 3;
  must = Math.max(0, Math.min(24, must));

  let budget = 12;
  if (hasUserBudget(ledger) && ledger.budgetEur?.value != null) {
    const buy = opt.buyInEur ?? opt.pricePerPerson;
    const cap = ledger.budgetEur.value;
    try {
      const { budgetValueScore, stayLooksDump } = require('./researchLead') as typeof import('./researchLead');
      budget = budgetValueScore({
        buyInEur: buy,
        budgetEur: cap,
        allowCheapBox:
          ledger.lodgingQuality?.value === 'cheap_box' ||
          ledger.budgetVibe?.value === 'cheap' ||
          ledger.lodgingKind?.value === 'hostel',
        stayLooksDump: stayLooksDump({
          stayName: opt.stayName,
          stayPriceEur: opt.stayPriceEur,
          buyInEur: buy,
          budgetEur: cap,
        }),
      });
    } catch {
      if (buy == null) budget = 6;
      else if (buy <= cap) budget = 14;
      else if (buy <= cap * 1.15) budget = 8;
      else budget = 2;
    }
    // Hart: klar über Budget → Ranking stark runter (nicht als Top verkaufen)
    if (buy != null && buy > cap * 1.08) {
      budget = Math.min(budget, 0);
    } else if (buy != null && buy > cap) {
      budget = Math.min(budget, 3);
    }
  }

  let prefs = 0;
  try {
    const prefList = stablePrefsSafe();
    const blob = `${opt.placeName} ${opt.stayName || ''} ${(opt.decisionNotes ?? []).join(' ')} ${(opt.gaps ?? []).join(' ')}`.toLowerCase();
    for (const p of prefList) {
      if (blob.includes(p.toLowerCase().slice(0, 8))) prefs += 2;
      if (p === 'eco' && (hasTrain || hasBus)) prefs += 3;
      if (p === 'party_no' && /party|magaluf|club/i.test(blob)) prefs -= 4;
      if (p === 'party_yes' && /party|nightlife/i.test(blob)) prefs += 2;
      if (p === 'cheap_beer' && /bier|drink|party|city/i.test(blob)) prefs += 1;
    }
  } catch {
    /* soft */
  }
  prefs = Math.max(-6, Math.min(8, prefs));

  const acts = ledger.mustActivities?.value?.length ?? 0;
  const dayBlocks = (opt.days ?? []).flatMap((d) => d.blocks ?? []);
  const programBlocks = dayBlocks.filter(
    (b) =>
      !/^(flug|bahn|fernbus|camper|anreise|check-in|check-out|transfer|e-?sim)/i.test(
        b.title || '',
      ),
  );
  let activities = 0;
  if (acts > 0) {
    activities = Math.min(6, Math.round((programBlocks.length / Math.max(1, acts)) * 6));
  } else if (programBlocks.length >= 5) {
    activities = 5;
  } else if (programBlocks.length >= 3) {
    activities = 4;
  } else if ((opt.stops?.length ?? 0) >= 3) {
    activities = 4;
  } else if (programBlocks.length >= 1) {
    activities = 2;
  }
  const metChapters = (opt.wishChapters ?? []).filter((c) => c.met).length;
  if (metChapters >= 2) activities = Math.min(6, activities + 2);
  else if (metChapters === 1) activities = Math.min(6, activities + 1);

  // Wetter-Fit: warm gewünscht → wärmeres Ziel belohnen (Vergleich Budapest/Bukarest)
  if (opt.weatherTempHighC != null && Number.isFinite(opt.weatherTempHighC)) {
    const want = ledger.weatherWant?.value;
    if (want === 'warm') {
      if (opt.weatherTempHighC >= 22) prefs += 3;
      else if (opt.weatherTempHighC >= 18) prefs += 1;
      else if (opt.weatherTempHighC < 15) prefs -= 2;
    } else if (want === 'mild') {
      if (opt.weatherTempHighC >= 14 && opt.weatherTempHighC <= 24) prefs += 2;
    } else if (want === 'cool') {
      if (opt.weatherTempHighC <= 18) prefs += 2;
      else if (opt.weatherTempHighC >= 28) prefs -= 2;
    }
  }
  prefs = Math.max(-6, Math.min(10, prefs));

  // whenFlex Prefer vs Soft (Do ab 13 / Di>Mi)
  try {
    const { scoreOptionWhenFlex, hourFromIso } = require('../whenFlex') as typeof import('../whenFlex');
    const flights = (opt.transports ?? []).filter((t) => t.kind === 'flight' || t.kind === 'train');
    const out = flights.find((t) => /out|hin|outbound/i.test(t.id)) || flights[0];
    const ret = flights.find((t) => /ret|rück|return/i.test(t.id)) || flights[1];
    const flexPts = scoreOptionWhenFlex(ledger, {
      outboundDateKey: out?.departDateKey || ledger.dateStart?.value || null,
      outboundHour: hourFromIso(out?.departAt) ?? null,
      returnDateKey: ret?.departDateKey || ledger.dateEnd?.value || null,
      returnHour: hourFromIso(ret?.departAt) ?? null,
    });
    prefs = Math.max(-6, Math.min(12, prefs + Math.round(flexPts / 2)));
  } catch {
    /* soft */
  }

  // FlixTrain≠Bus: Bus abwerten wenn surfacePref train_*
  const surface = ledger.surfacePref?.value;
  if (surface === 'train_only' || surface === 'train_ok_bus_no') {
    if (hasBus && !hasTrain) prefs -= 5;
    if (hasTrain) prefs += 2;
  } else if (surface === 'bus_only' && hasTrain && !hasBus) {
    prefs -= 3;
  }
  prefs = Math.max(-8, Math.min(12, prefs));

  const total = Math.max(
    35,
    Math.min(99, Math.round(access + stay + must + budget + prefs + activities)),
  );
  return { total, access, stay, must, budget, prefs, activities };
}

/** Re-rank Options → Top N Packages mit Package-Score als matchScore. */
export function rankOptionsAsPackages(
  options: ReiseOption[],
  ledger: ReiseLedger,
  n = 4,
): ReiseOption[] {
  const scored = options.map((o) => {
    const br = scoreTravelPackage(o, ledger);
    const next: ReiseOption = {
      ...o,
      matchScore: Math.max(o.matchScore, br.total),
      decisionNotes: [
        ...(o.decisionNotes ?? []).filter((d) => !/^Package:/i.test(d)),
        `Package: Zugang ${br.access} · Stay ${br.stay} · Must ${br.must} · Budget ${br.budget}`,
      ],
    };
    // Blend: 55% package + 45% prior match
    next.matchScore = Math.round(br.total * 0.55 + o.matchScore * 0.45);
    return next;
  });
  const ranked = scored.sort((a, b) => b.matchScore - a.matchScore || a.gaps.length - b.gaps.length);
  try {
    const { uniquifyMatchScores } = require('./optionCard') as typeof import('./optionCard');
    return uniquifyMatchScores(ranked).slice(0, Math.max(1, n));
  } catch {
    return ranked.slice(0, Math.max(1, n));
  }
}
