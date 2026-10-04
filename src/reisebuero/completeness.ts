import type { ReiseLedger } from './types';
import { isAirportVisible } from './slotLedger';
import { vibeGaps } from './vibeProbes';
import { nextCatalogQuestion, type CatalogExtra } from './questionCatalog';

export type GapTier = 'red' | 'yellow' | 'green';

export type CompletenessGap = {
  key: string;
  label: string;
  tier: GapTier;
  /** Katalog-Fragesatz (wenn aus questionCatalog). */
  askSeed?: string;
};

function isCruiseOrFerryShape(ledger: ReiseLedger): boolean {
  if (ledger.tripShape?.value === 'cruise' || ledger.tripShape?.value === 'ferry') return true;
  const ids = [
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ...(ledger.niceHaves?.value ?? []),
  ];
  return ids.includes('cruise') || ids.includes('ferry') || ids.includes('river_cruise');
}

export function hasUserBudget(ledger: ReiseLedger): boolean {
  return Boolean(ledger.budgetEur && ledger.budgetEur.source === 'user');
}

export type BriefPath = 'party' | 'family' | 'couple' | 'chill' | 'senior' | 'default';

export function briefingPath(ledger: ReiseLedger): BriefPath {
  const blob = [
    ledger.purpose?.value,
    ledger.energy?.value,
    ledger.extraWishes?.value,
    ledger.kidsStyle?.value,
    ledger.partyGrain?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if ((ledger.children?.value ?? 0) > 0 || /baby|neugeboren|familie|kinder/.test(blob)) return 'family';
  if (
    /party|jungs|männer|maenner|feier|trinken|bier/.test(blob) ||
    ledger.cheapDrinks?.value ||
    ledger.partyGrain
  ) {
    return 'party';
  }
  if (/überrasch|ueberrasch|jahrestag|romantik|\bpaar\b|flitter|hochzeit|dating/.test(blob)) {
    return 'couple';
  }
  if (/pension|rente|senior|ruhestand/.test(blob)) return 'senior';
  if (
    /spa|wellness|relax|chill|quatsch|beste freundin|freundinnen/.test(blob) &&
    (ledger.adults?.value ?? 2) <= 2
  ) {
    return 'chill';
  }
  return 'default';
}

/** Zeitraum: Dauer allein reicht — kein erzwungenes Exact-Datum für party/default. */
export function hasWhen(ledger: ReiseLedger): boolean {
  if (ledger.mode?.value === 'daytrip') return true;
  if (ledger.dateStart || ledger.dateEnd) return true;
  if (ledger.stayDays || ledger.stayNights || ledger.stayNightsMax) return true;
  if (ledger.dateMonth && (ledger.dateFlex?.value === 'weekend' || ledger.dateFlex?.value === 'month')) {
    return true;
  }
  if (ledger.dateFlex?.value === 'month' && ledger.dateMonth) return true;
  // Abreise fix + davor flexibel zählt als Zeitraum
  if (ledger.dateAnchor?.value === 'depart' && ledger.dateEnd) return true;
  if (ledger.dateFlex?.value === 'open') return false;
  return false;
}

function hasLodging(ledger: ReiseLedger): boolean {
  return Boolean(ledger.lodgingKind || ledger.lodgingOpen?.value || ledger.meals);
}

function needsOriginAsk(ledger: ReiseLedger): boolean {
  if (ledger.originCities?.value?.length) return false;
  return ledger.originCity?.source !== 'user';
}

function gap(key: string, label: string): CompletenessGap {
  return { key, label, tier: 'red' };
}

/**
 * Kernpaket für Such-Ready (gelb→grün): Personen, Zeitraum, Budget, Start, Unterkunftsrichtung.
 * Path-Extras (Anfahrt, Los-Fenster) sind optional Follow-ups — blockieren die Suche nicht.
 * Kreuzfahrt/Fähre: Kabine = Stay → lodging nicht blockieren.
 */
function hardFactOrder(_path: BriefPath, ledger?: ReiseLedger): Array<{ key: string; label: string }> {
  if (ledger && isCruiseOrFerryShape(ledger)) {
    return [
      { key: 'adults', label: 'Gruppe' },
      { key: 'when', label: 'Zeitraum' },
      { key: 'budget', label: 'Budget' },
      { key: 'origin', label: 'Start' },
    ];
  }
  return [
    { key: 'adults', label: 'Gruppe' },
    { key: 'when', label: 'Zeitraum' },
    { key: 'budget', label: 'Budget' },
    { key: 'origin', label: 'Start' },
    { key: 'lodging', label: 'Unterkunft' },
  ];
}

function isHardFilled(ledger: ReiseLedger, key: string): boolean {
  if (key === 'adults') {
    // Nur echte User-/Profil-Angabe — inferred „2“ zählt nicht als gefragt/fertig
    return ledger.adults?.source === 'user' || ledger.adults?.source === 'profile';
  }
  if (key === 'when') {
    if (hasWhen(ledger)) return true;
    // „günstigst / flex Monat“ reicht für Cruise-Deal-Hunt
    if (isCruiseOrFerryShape(ledger) && (ledger.dealHunt?.value || ledger.dateWindow || ledger.dateMonth)) {
      return true;
    }
    return false;
  }
  if (key === 'budget') {
    return (
      hasUserBudget(ledger) ||
      Boolean(ledger.budgetVibe?.value) ||
      (isCruiseOrFerryShape(ledger) && ledger.dealHunt?.value === true)
    );
  }
  if (key === 'mode') {
    return (
      Boolean(ledger.mode && ledger.mode.value !== 'unknown') ||
      ledger.bookedFlight?.value === true ||
      ledger.bookedRail?.value === true ||
      ledger.bookedBus?.value === true
    );
  }
  if (key === 'lodging') {
    if (isCruiseOrFerryShape(ledger)) return true; // Kabine/Schiff
    if (ledger.bookedStay?.value === true) return true;
    // Verpflegung ≠ Unterkunft — meals allein füllt lodging nicht
    return Boolean(ledger.lodgingKind || ledger.lodgingOpen?.value) || !needsNight(ledger);
  }
  if (key === 'driveTime') {
    return Boolean(ledger.maxDriveHours) || ledger.mode?.value === 'fly' || ledger.mode?.value === 'train';
  }
  if (key === 'origin') return ledger.mode?.value === 'daytrip' || !needsOriginAsk(ledger);
  if (key === 'locationBias') return Boolean(ledger.locationBias || ledger.extraWishes);
  if (key === 'departWindow') {
    return Boolean(ledger.departAfterHour || ledger.arriveBeforeHour);
  }
  return true;
}

/** Rot — ohne das bleibt Suche gelb. */
export function searchReadyGaps(ledger: ReiseLedger): CompletenessGap[] {
  return bookingBriefGaps(ledger);
}

/**
 * Schicht A — Buchungs-Param-Brief vor Suche/Ready.
 * Rest-Pack: Gruppe · Zeitraum · Budget · Start · Unterkunft · Anreise-Modus.
 * Bei Flug zusätzlich Gepäck hart (0/0 zählt als beantwortet).
 * Fast-Scope (researchFocus): schrumpft Pflicht je Spur.
 * Angebots-IDs kommen erst Akt 3.
 */
export function bookingBriefGaps(ledger: ReiseLedger): CompletenessGap[] {
  let focus: import('./gapInventory').ResearchFocus = 'full';
  try {
    const { effectiveResearchFocus } = require('./gapInventory') as typeof import('./gapInventory');
    focus = effectiveResearchFocus(ledger);
  } catch {
    /* soft */
  }

  if (focus === 'flight') {
    const keys: Array<{ key: string; label: string }> = [
      { key: 'adults', label: 'Gruppe' },
      { key: 'when', label: 'Zeitraum' },
      { key: 'origin', label: 'Start' },
    ];
    const core = keys.filter((g) => !isHardFilled(ledger, g.key)).map((g) => gap(g.key, g.label));
    const extra: CompletenessGap[] = [];
    // Ziel/Richtung weich — wenn fehlt, als dest gap
    if (!hasDestDirection(ledger)) {
      extra.push(gap('dest', 'Ziel / Richtung'));
    }
    if (!isHardFilled(ledger, 'mode') && ledger.mode?.value !== 'fly') {
      // mode fly oft schon gesetzt; sonst nicht blockieren wenn Focus flight
    }
    if (ledger.cabinBags == null && ledger.checkedBags == null && !ledger.bookedFlight?.value) {
      extra.push(gap('bags', 'Gepäck'));
    }
    // Budget weich via vibe — nur hart wenn weder vibe noch eur
    if (!hasUserBudget(ledger) && !ledger.budgetVibe) {
      // optional soft — nicht in red gaps for flight focus (plan: budget weich ok)
    }
    return [...core, ...extra];
  }

  if (focus === 'stay') {
    const keys: Array<{ key: string; label: string }> = [
      { key: 'adults', label: 'Gruppe' },
      { key: 'when', label: 'Zeitraum' },
      { key: 'lodging', label: 'Unterkunft' },
    ];
    const core = keys.filter((g) => !isHardFilled(ledger, g.key)).map((g) => gap(g.key, g.label));
    const extra: CompletenessGap[] = [];
    if (!hasDestDirection(ledger)) {
      extra.push(gap('dest', 'Ziel / Richtung'));
    }
    return [...core, ...extra];
  }

  if (focus === 'activity') {
    const keys: Array<{ key: string; label: string }> = [
      { key: 'adults', label: 'Gruppe' },
      { key: 'when', label: 'Zeitraum' },
    ];
    const core = keys.filter((g) => !isHardFilled(ledger, g.key)).map((g) => gap(g.key, g.label));
    const extra: CompletenessGap[] = [];
    if (!hasDestDirection(ledger)) {
      extra.push(gap('dest', 'Ziel / Richtung'));
    }
    return [...core, ...extra];
  }

  const core = hardFactOrder(briefingPath(ledger), ledger)
    .filter((g) => !isHardFilled(ledger, g.key))
    .map((g) => gap(g.key, g.label));
  const extra: CompletenessGap[] = [];
  if (!isCruiseOrFerryShape(ledger) && !isHardFilled(ledger, 'mode')) {
    extra.push(gap('mode', 'Anreise'));
  }
  if (
    ledger.mode?.value === 'fly' &&
    !ledger.bookedFlight?.value &&
    ledger.cabinBags == null &&
    ledger.checkedBags == null
  ) {
    extra.push(gap('bags', 'Gepäck'));
  }
  return [...core, ...extra];
}

function hasDestDirection(ledger: ReiseLedger): boolean {
  const dest = (ledger.destinationHint?.value || '').trim();
  if (dest && !/^(offen|egal)$/i.test(dest)) return true;
  if (ledger.corridor?.value || ledger.anchorPoi?.value) return true;
  if (ledger.discoverIntent?.value || ledger.dealHunt?.value === true) return true;
  return false;
}

/** Brief-Params (Schicht A) bereit — Voraussetzung für Ready/Suche/Book-CTA. */
export function briefParamsReady(ledger: ReiseLedger): boolean {
  return bookingBriefGaps(ledger).length === 0;
}

/** Erste Blocker-Lücke vor Suche — oder null wenn Ready. */
export function firstBookingBriefBlocker(ledger: ReiseLedger): CompletenessGap | null {
  return bookingBriefGaps(ledger)[0] ?? null;
}

export function isPartyTrip(ledger: ReiseLedger): boolean {
  const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
  if (ids.includes('party')) return true;
  if (ledger.cheapDrinks?.value || ledger.partyGrain) return true;
  return /party|feier|männerwochenende|maennerwochenende|jungs/i.test(ledger.purpose?.value ?? '');
}

function isThinLedger(ledger: ReiseLedger): boolean {
  if (briefingPath(ledger) !== 'default') return false;
  return (
    !ledger.purpose &&
    !ledger.destinationHint &&
    !ledger.corridor &&
    !ledger.lodgingKind &&
    !hasWhen(ledger)
  );
}

/** Hard Facts zuerst, dann optionale Themen-Follow-ups (blockieren Suche nicht). */
export function conversationGaps(ledger: ReiseLedger, asked: string[] = []): CompletenessGap[] {
  // Kreuzfahrt/Fähre: max 1–2 Blocker, keine Highlight/Meals/Lodging-Schleife
  if (isCruiseOrFerryShape(ledger)) {
    const reds = searchReadyGaps(ledger);
    if (reds.length) return [reds[0]!];
    if (!asked.includes('ready_announce') && !asked.includes('wrap_up')) {
      return [{ key: 'ready_announce', label: 'Ready', tier: 'green' }];
    }
    return [];
  }

  if (isThinLedger(ledger) && !asked.includes('purpose')) {
    return [{ key: 'purpose', label: 'Reiseart', tier: 'yellow' }];
  }

  // Schon-teilweise-geplant: vor Mode/Gepäck-Hard-Reds klären
  if (
    (ledger.bookedStay?.value ||
      ledger.bookedFlight?.value ||
      ledger.bookedRail?.value ||
      ledger.bookedBus?.value ||
      ledger.needCar?.value) &&
    !asked.includes('bookedBits')
  ) {
    if (ledger.bookedStay?.value && ledger.bookedFlight == null && ledger.bookedRail == null && !ledger.mode) {
      return [{ key: 'bookedBits', label: 'Anreise noch?', tier: 'yellow' }];
    }
    if (ledger.bookedFlight?.value && ledger.bookedStay == null && needsNight(ledger)) {
      return [{ key: 'bookedBits', label: 'Unterkunft noch?', tier: 'yellow' }];
    }
    if (
      (ledger.bookedFlight?.value || ledger.bookedStay?.value) &&
      ledger.needCar == null &&
      ledger.bookedCar == null &&
      ledger.rentalCar == null &&
      !asked.includes('needCar')
    ) {
      // optional — after bookedBits filled; don't block here
    }
  }

  // gap_fill: keine Voll-Discovery (Highlight/Meals/Purpose) wenn Lücken startklar
  try {
    const { deriveInventoryMode, inventoryGapLabels } = require('./gapInventory') as typeof import('./gapInventory');
    const inv = ledger.inventoryMode?.value ?? deriveInventoryMode(ledger);
    if (inv === 'gap_fill' || inv === 'add_on') {
      const redsGap = searchReadyGaps(ledger);
      if (redsGap.length) return [redsGap[0]!];
      if (ledger.needCar?.value === true && !asked.includes('needCar') && ledger.bookedCar?.value !== true) {
        // need already known — ready for research
      }
      if (!asked.includes('ready_announce') && !asked.includes('wrap_up')) {
        const gaps = inventoryGapLabels(ledger);
        if (gaps.length || inv === 'add_on') {
          return [{ key: 'ready_announce', label: 'Ready', tier: 'green' }];
        }
      }
      return [];
    }
  } catch {
    /* soft */
  }

  const reds = searchReadyGaps(ledger);
  if (reds.length) return [reds[0]!];

  // Recherche-Kern (vor Ready): Art · was wichtig · Highlight
  if (!ledger.purpose && !asked.includes('purpose')) {
    return [{ key: 'purpose', label: 'Reiseart', tier: 'yellow' }];
  }
  if (
    !ledger.extraWishes &&
    !ledger.mustHaves?.value?.length &&
    !ledger.wishHaves?.value?.length &&
    !asked.includes('extraWishes')
  ) {
    return [{ key: 'extraWishes', label: 'Was wichtig', tier: 'yellow' }];
  }
  if (!ledger.highlightWant && !asked.includes('highlight')) {
    return [{ key: 'highlight', label: 'Highlight', tier: 'yellow' }];
  }

  // Früh: die drei klassischen Score-Lücken (Anreise / Essen / vor Ort)
  try {
    const { scoreSharpenGaps } = require('./briefScore') as typeof import('./briefScore');
    const early = scoreSharpenGaps(ledger, asked).find((g) =>
      g.key === 'mode' || g.key === 'meals' || g.key === 'localMove',
    );
    if (early) return [early];
  } catch {
    /* ignore */
  }

  const path = briefingPath(ledger);

  // Party: nur nach Feier-Korn fragen wenn noch unklar (nicht bei private_house / cheapDrinks klar)
  if (
    path === 'party' &&
    !ledger.partyGrain &&
    !ledger.partyStyle &&
    !asked.includes('partyStyle') &&
    !asked.includes('partyGrain')
  ) {
    return [{ key: 'partyGrain', label: 'Feier-Stil', tier: 'yellow' }];
  }
  if (path === 'party' && !hasLodging(ledger) && !asked.includes('lodging')) {
    return [{ key: 'lodging', label: 'Unterkunft', tier: 'yellow' }];
  }
  if (path === 'family' && !asked.includes('extraWishes') && !ledger.extraWishes) {
    const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
    if (!ids.includes('baby_bed') && !ids.includes('parking') && !ids.includes('kids_club')) {
      return [{ key: 'extraWishes', label: 'Noch wichtig', tier: 'yellow' }];
    }
  }
  if (path === 'couple' && !ledger.locationBias && !asked.includes('locationBias')) {
    return [{ key: 'locationBias', label: 'Lage', tier: 'yellow' }];
  }
  if (path === 'chill') {
    const spaIds = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
    if (
      spaIds.some((id) => id === 'spa' || id === 'sauna' || id === 'massage') &&
      !ledger.spaStyle &&
      !asked.includes('spaStyle')
    ) {
      return [{ key: 'spaStyle', label: 'Spa', tier: 'yellow' }];
    }
    if (!asked.includes('extraWishes') && !ledger.dealbreaker && !ledger.extraWishes) {
      return [{ key: 'extraWishes', label: 'No-Go', tier: 'yellow' }];
    }
  }
  if (
    (path === 'senior' || ledger.mode?.value === 'fly') &&
    ledger.mode?.value === 'fly' &&
    ledger.directFlight == null &&
    !asked.includes('directFlight')
  ) {
    return [{ key: 'directFlight', label: 'Direktflug', tier: 'yellow' }];
  }
  // bags: nur noch Hard in bookingBriefGaps — kein Soft-Duplikat

  // Score-Bausteine die oft fehlen (Anreise, Essen, Ortsbewegung, …) — aktiv fragen
  try {
    const { scoreSharpenGaps } = require('./briefScore') as typeof import('./briefScore');
    const sharpen = scoreSharpenGaps(ledger, asked);
    // mode schon Hard in bookingBriefGaps — nicht nochmal soft
    const next = sharpen.find((g) => g.key !== 'mode');
    if (next) return [next];
  } catch {
    /* ignore */
  }

  try {
    const { shouldAskTransferBlocker } = require('./funnelBlockerAsk') as typeof import('./funnelBlockerAsk');
    if (shouldAskTransferBlocker(ledger) && !asked.includes('transfer')) {
      return [{ key: 'transfer', label: 'Transfer', tier: 'yellow' }];
    }
  } catch {
    if (
      (ledger.mode?.value === 'fly' || ledger.mode?.value === 'train') &&
      !ledger.bookedTransfer?.value &&
      ledger.transferPref == null &&
      !asked.includes('transfer')
    ) {
      return [{ key: 'transfer', label: 'Transfer', tier: 'yellow' }];
    }
  }
  if (needsRentalAsk(ledger) && !asked.includes('rentalCar')) {
    return [{ key: 'rentalCar', label: 'Mietwagen', tier: 'yellow' }];
  }

  const vibes = vibeGaps(ledger).filter((g) => {
    if (g.key === 'partyStyle') return false;
    if (g.key === 'spaStyle') return false;
    if (g.key === 'kidsStyle') return path === 'family' && !ledger.kidsStyle && !ledger.extraWishes;
    if (g.key === 'tripShape') return !ledger.tripShape;
    if (asked.includes(g.key)) return false;
    return true;
  });
  if (vibes[0]) return [vibes[0]];
  return [];
}

export function isCityTrip(ledger: ReiseLedger): boolean {
  return /städt|staedt|city|party|männer|maenner|jungs/i.test(ledger.purpose?.value ?? '');
}

export function needsRentalAsk(ledger: ReiseLedger): boolean {
  if (ledger.rentalCar != null) return false;
  const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
  if (ids.includes('rental_car')) return false;
  if (isPartyTrip(ledger) || isCityTrip(ledger)) return false;
  if (ledger.locationBias?.value === 'cheap_central') return false;
  if (ledger.locationBias?.value === 'quiet_outskirts') {
    const k = ledger.lodgingKind?.value;
    return k === 'apartment' || k === 'ferienhaus' || k === 'airbnb';
  }
  return false;
}

export function completenessGaps(ledger: ReiseLedger): CompletenessGap[] {
  return conversationGaps(ledger);
}

export function needsNight(ledger: ReiseLedger): boolean {
  const m = ledger.mode?.value;
  if (m === 'daytrip') return false;
  return true;
}

export function isBriefComplete(ledger: ReiseLedger): boolean {
  return searchReadyGaps(ledger).length === 0;
}

/** Grün-Suche: Kernpaket voll UND Brief-Score ≥ 80. */
export function isBriefGreen(ledger: ReiseLedger): boolean {
  if (!isBriefComplete(ledger)) return false;
  try {
    const { computeBriefScore } = require('./briefScore') as typeof import('./briefScore');
    return computeBriefScore(ledger).zone === 'green';
  } catch {
    return isBriefComplete(ledger);
  }
}

/**
 * Nächste Lücke.
 * Ready-Ask nur 1× und erst ab Brief-Grün (≥80 + Kernpaket inkl. Gepäck bei Flug) UND Verpflegung geklärt.
 * bookingBriefGaps steckt in conversationGaps/searchReadyGaps — nie ready_announce bei offenem Rest-Pack.
 */
export function nextQuestionKey(
  ledger: ReiseLedger,
  asked: string[] = [],
  opts?: { searchReadyAnnounced?: boolean; catalogExtras?: CatalogExtra[]; userLine?: string },
): CompletenessGap {
  // Cruise/Ferry: Ready schlägt Soft-Master (ages/localMove/meals) — nur Cruise-Branch-Katalog dazwischen
  if (isCruiseOrFerryShape(ledger)) {
    const cruiseGaps = conversationGaps(ledger, asked);
    const head = cruiseGaps[0];
    const coreReady =
      !head ||
      head.key === 'ready_announce' ||
      head.tier === 'green' ||
      head.key === 'keep_talking';
    if (coreReady) {
      const catCruise = nextCatalogQuestion(
        ledger,
        asked,
        opts?.catalogExtras || [],
        opts?.userLine || '',
      );
      if (catCruise && catCruise.branch === 'cruise') {
        return {
          key: catCruise.id,
          label: catCruise.topic,
          tier: 'yellow',
          askSeed: catCruise.askSeed,
        };
      }
      if (!opts?.searchReadyAnnounced && !asked.includes('ready_announce')) {
        return { key: 'ready_announce', label: 'Ready', tier: 'green' };
      }
      return { key: 'keep_talking', label: 'Vibe', tier: 'green' };
    }
  }

  const cat = nextCatalogQuestion(
    ledger,
    asked,
    opts?.catalogExtras || [],
    opts?.userLine || '',
  );
  if (cat) {
    return {
      key: cat.id,
      label: cat.topic,
      tier: cat.branch === 'master' ? 'red' : 'yellow',
      askSeed: cat.askSeed,
    };
  }

  const next = conversationGaps(ledger, asked)[0];
  if (next) return next;

  // Cruise/Ferry: keine Meals-Zwangsschleife
  if (isCruiseOrFerryShape(ledger)) {
    if (!opts?.searchReadyAnnounced && !asked.includes('ready_announce')) {
      return { key: 'ready_announce', label: 'Ready', tier: 'green' };
    }
    return { key: 'keep_talking', label: 'Vibe', tier: 'green' };
  }

  // Verpflegung hart nachziehen bevor Ready — oft vergessen
  if (!ledger.meals && !asked.includes('meals')) {
    return { key: 'meals', label: 'Verpflegung', tier: 'yellow' };
  }

  // Score-Bausteine weiter schärfen (auch schon bei Grün) — Briefing läuft bis User zufrieden
  try {
    const { scoreSharpenGaps } = require('./briefScore') as typeof import('./briefScore');
    const sharpen = scoreSharpenGaps(ledger, asked)[0];
    if (sharpen) return sharpen;
  } catch {
    /* ignore */
  }

  const green = isBriefGreen(ledger);
  if (
    green &&
    Boolean(ledger.meals) &&
    briefParamsReady(ledger) &&
    !opts?.searchReadyAnnounced &&
    !asked.includes('ready_announce')
  ) {
    return { key: 'ready_announce', label: 'Ready', tier: 'green' };
  }

  return { key: 'keep_talking', label: 'Vibe', tier: 'green' };
}

export function buildRecapLines(ledger: ReiseLedger): string[] {
  const lines: string[] = [];
  if (ledger.mode) {
    const alt = ledger.modeFallback
      ? `, sonst ${modeLabel(ledger.modeFallback.value)}`
      : ledger.mode.hardness === 'wish'
        ? ' (wenn passt)'
        : '';
    lines.push(`Anreise: ${modeLabel(ledger.mode.value)}${alt}`);
  }
  if (ledger.originCities?.value?.length) {
    lines.push(`Starts: ${ledger.originCities.value.join(', ')}`);
  } else if (ledger.originCity) {
    lines.push(`Start: ${ledger.originCity.value}`);
  }
  if (ledger.corridor) lines.push(`Korridor: ${ledger.corridor.value}`);
  if (ledger.destinationHint) lines.push(`Ort: ${ledger.destinationHint.value}`);
  if (ledger.stayNights && ledger.stayNightsMax && ledger.stayNightsMax.value > ledger.stayNights.value) {
    lines.push(`${ledger.stayNights.value}–${ledger.stayNightsMax.value} Nächte`);
  } else if (ledger.stayNights) {
    lines.push(`${ledger.stayNights.value} Nächte`);
  } else if (ledger.stayDays) {
    lines.push(`${ledger.stayDays.value} Tage`);
  }
  if (ledger.dateMonth) lines.push(monthLabelFromKey(ledger.dateMonth.value));
  if (ledger.datePart) {
    lines.push(ledger.datePart.value === 'early' ? 'Anfang' : ledger.datePart.value === 'late' ? 'Ende' : 'Mitte');
  }
  if (ledger.dateAnchor?.value === 'depart' && ledger.dateEnd) {
    lines.push(`Abreise fix ${ledger.dateEnd.value}`);
    if (ledger.dateFlex?.value === 'open') lines.push('davor flexibel');
  } else if (ledger.dateAnchor?.value === 'presence' && ledger.dateStart) {
    const end = ledger.dateEnd?.value || ledger.dateStart.value;
    lines.push(`Muss da: ${ledger.dateStart.value}–${end}`);
    if (ledger.arrivalFlexDays?.value) {
      lines.push(`bis ${ledger.arrivalFlexDays.value} Tage früher an`);
    }
    if (ledger.departureFlexDays?.value) {
      lines.push(`bis ${ledger.departureFlexDays.value} Tage länger`);
    }
  } else if (ledger.dateAnchor?.value === 'arrive' && ledger.dateStart) {
    lines.push(`Anreise ${ledger.dateStart.value}`);
  } else {
    if (ledger.dateFlex) lines.push(`Zeit: ${ledger.dateFlex.value}`);
    if (ledger.dateStart) lines.push(`ab ${ledger.dateStart.value}`);
    if (ledger.dateEnd) lines.push(`bis ${ledger.dateEnd.value}`);
  }
  if (ledger.adults) lines.push(`${ledger.adults.value} Personen`);
  if (hasUserBudget(ledger)) {
    lines.push(
      `Budget ${ledger.budgetEur!.value} € ${ledger.budgetScope?.value === 'per_person' ? 'p.P.' : 'gesamt'}`,
    );
  }
  if (ledger.budgetVibe) lines.push(`Preisgefühl ${ledger.budgetVibe.value}`);
  if (ledger.lodgingKind) {
    const fb = ledger.lodgingFallback?.value;
    lines.push(fb ? `${ledger.lodgingKind.value}, sonst ${fb}` : ledger.lodgingKind.value);
  } else if (ledger.lodgingOpen?.value) {
    lines.push('Unterkunft offen');
  }
  if (ledger.meals?.value === 'all') lines.push('All-Inclusive');
  if (ledger.meals?.value === 'half') lines.push('Halbpension');
  if (ledger.maxDriveHours) lines.push(`max. ${ledger.maxDriveHours.value} h Fahrt`);
  if (ledger.energy) lines.push(energyLabel(ledger.energy.value));
  if (ledger.locationBias) lines.push(biasLabel(ledger.locationBias.value));
  if (ledger.purpose) lines.push(ledger.purpose.value);
  if (ledger.bookedStay?.value) lines.push('Unterkunft schon gebucht');
  if (ledger.bookedFlight?.value) lines.push('Flug schon gebucht');
  if (ledger.bookedRail?.value) lines.push('Bahn schon gebucht');
  if (ledger.bookedBus?.value) lines.push('Fernbus schon gebucht');
  if (ledger.bookedCar?.value) lines.push('Mietwagen schon gebucht');
  if (ledger.needCar?.value) lines.push('Noch Mietwagen brauchen');
  if (ledger.inventoryMode?.value === 'gap_fill') lines.push('Modus: Lücken füllen');
  for (const a of ledger.bookedActivities?.value ?? []) {
    if (a?.name) lines.push(`Aktivität gebucht: ${a.name}`);
  }
  if (ledger.transferPref?.value) lines.push(`Transfer: ${ledger.transferPref.value}`);
  if (ledger.intentNotes?.value?.length) {
    lines.push(`Intention: ${ledger.intentNotes.value.slice(0, 3).join('; ')}`);
  }
  if (ledger.cheapDrinks?.value) lines.push('günstiges Bier');
  if (ledger.partyGrain) lines.push(`Feier: ${partyGrainLabel(ledger.partyGrain.value)}`);
  if (ledger.mustHaves?.value.length) {
    lines.push(`Must: ${ledger.mustHaves.value.join(', ')}`);
  }
  if (ledger.wishHaves?.value.length) {
    lines.push(`Wish: ${ledger.wishHaves.value.join(', ')}`);
  }
  if (ledger.inspiration) lines.push(`Stil wie ${ledger.inspiration.value}`);
  if (ledger.lastHighlight) lines.push(`letztes Highlight: ${ledger.lastHighlight.value}`);
  if (ledger.highlightWant) lines.push(`Highlight: ${ledger.highlightWant.value}`);
  if (ledger.partyStyle) lines.push(`Feiern: ${ledger.partyStyle.value}`);
  if (ledger.spaStyle) lines.push(`Spa: ${ledger.spaStyle.value}`);
  if (ledger.children) lines.push(`${ledger.children.value} Kinder`);
  if (ledger.kidsStyle) lines.push(`Kinder: ${ledger.kidsStyle.value}`);
  if (ledger.tripShape) lines.push(`Form: ${ledger.tripShape.value}`);
  if (ledger.ideaHook) lines.push(`Idee: ${ledger.ideaHook.value}`);
  if (ledger.dealbreaker) lines.push(`No-Go: ${ledger.dealbreaker.value}`);
  if (ledger.directFlight?.value) lines.push('Direktflug gewünscht');
  if (ledger.cabinBags != null || ledger.checkedBags != null) {
    const cabin = ledger.cabinBags?.value ?? 0;
    const checked = ledger.checkedBags?.value ?? 0;
    if (cabin <= 0 && checked <= 0) lines.push('kein Gepäck');
    else {
      const bits: string[] = [];
      if (cabin > 0) bits.push(`${cabin} Hand`);
      if (checked > 0) bits.push(`${checked} Aufgabe`);
      lines.push(`Gepäck: ${bits.join(' · ')}`);
    }
  }
  if (ledger.maxLayoverHours) lines.push(`max. ${ledger.maxLayoverHours.value} h Stopp`);
  if (isAirportVisible(ledger) && ledger.airportIata) {
    lines.push(`Abflug ${ledger.airportIata.value}`);
  }
  if (ledger.driverName) lines.push(`${ledger.driverName.value} fährt`);
  return lines;
}

function partyGrainLabel(g: string): string {
  if (g === 'private_house') return 'privat unter euch';
  if (g === 'bars') return 'Bars';
  if (g === 'clubs') return 'Clubs';
  return 'egal';
}

function modeLabel(m: string): string {
  switch (m) {
    case 'fly':
      return 'Flug';
    case 'drive':
      return 'Auto';
    case 'train':
      return 'Bahn';
    case 'bike':
      return 'Fahrrad';
    case 'hike':
      return 'Wandern';
    case 'daytrip':
      return 'Tagestrip';
    case 'camping':
      return 'Camping';
    case 'mix':
      return 'Anreise egal';
    default:
      return m;
  }
}

function energyLabel(e: string | null): string {
  if (e === 'chill_pool') return 'eher chillen / Pool';
  if (e === 'active_out') return 'eher aktiv draußen';
  if (e === 'mixed') return 'Mix Chill + Aktiv';
  return '';
}

function biasLabel(b: string | null): string {
  if (b === 'quiet_outskirts') return 'ruhige Lage';
  if (b === 'cheap_central') return 'günstig zentral';
  if (b === 'near_activity') return 'nah an der Aktivität';
  return '';
}

function monthLabelFromKey(ym: string): string {
  const mm = ym.slice(5, 7);
  const names: Record<string, string> = {
    '01': 'Januar',
    '02': 'Februar',
    '03': 'März',
    '04': 'April',
    '05': 'Mai',
    '06': 'Juni',
    '07': 'Juli',
    '08': 'August',
    '09': 'September',
    '10': 'Oktober',
    '11': 'November',
    '12': 'Dezember',
  };
  return names[mm] || ym;
}
