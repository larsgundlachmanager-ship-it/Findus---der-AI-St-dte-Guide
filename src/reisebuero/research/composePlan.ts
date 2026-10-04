/**
 * Plan-Compose: Buy-in, Days, Checklist, Magazin-Story (Summary/Speech/Beats).
 */

import type {
  BookingCheckItem,
  DayPlan,
  ReiseLedger,
  ReiseOption,
  StayChoice,
  TransportChoice,
} from '../types';
import { preferAffiliateIfSameOffer } from '../../services/affiliate/preferAffiliateIfSameOffer';
import { isHollowPartnerUrl } from '../../services/affiliate/hollowPartnerUrl';
import {
  gateFlightBookItem,
  gateStayBookItem,
  gateTransportChoice,
} from './bookCtaGate';
import {
  isAirbnbUrl,
  withAirbnbStayPrefill,
} from '../../services/affiliate/airbnbDeepLink';
import { hasUserBudget } from '../completeness';
import { perPersonPrice } from './optionCard';
import {
  enrichOptionMagazine,
  estimateCheckInClock,
  speechSummary500,
  userWantsProgramDays,
  withFinalFlightPriceLabel,
} from './storyMagazine';
import { filterRealStays } from './packagePartner';
import {
  enumerateDateKeysInclusive,
  resolveTripDaySpan,
} from './tripDaySpan';

export { speechSummary500, enrichOptionMagazine } from './storyMagazine';
export {
  isCruiseLedger,
  enrichOptionAsCruisePlan,
  cruiseBuyInFromParts,
  buildCruisePriceBreakdown,
  buildCruiseDayPlans,
  buildCruiseBookingChecklist,
} from './cruisePlan';
export { enrichOptionAsPackage } from './enrichOptionAsPackage';
export { resolvePackageBlueprint, isFerryLedger, isRailHeavyLedger } from './packageBlueprint';
export {
  composePackageBuyIn,
  finalizeBuyInGate,
  incompleteBuyInUiHint,
} from './tripPackageSpine';
export {
  formatFinalPriceEur,
  formatFlightTransportLabel,
  withFinalFlightPriceLabel,
  stripAbPriceWording,
  buildExperienceSummary,
  buildSpeechSummary800,
  buildWishChapters,
  buildJourneyBeats,
  buildMagazineTitle,
  buildCoverHeadline,
  buildCoverSubline,
  resolveOptionPhoto,
  pickExperienceHook,
  userWantsProgramDays,
  clampChars,
  beatPhotoWikiTitles,
  EXPERIENCE_SUMMARY_MAX,
  SPEECH_SUMMARY_MAX,
} from './storyMagazine';
export { wikiTitleCandidates, fetchWikiThumb } from './wikiThumb';
export { isPackagePartnerStay, filterRealStays } from './packagePartner';

export const REAL_STAY_CHOICE_MAX = 4;

/**
 * Flugpreis-Hint → Transport-Labels + Magazin-Beats/Buy-in neu compose.
 */
export function applyFlightPriceHintToOption(
  opt: ReiseOption,
  ledger: ReiseLedger,
  priceEur: number,
  adults: number,
): ReiseOption {
  if (!(priceEur > 0)) return opt;
  const transports = (opt.transports ?? []).map((t, i) => {
    if (t.kind !== 'flight') return t;
    if (!(i === 0 || t.id === opt.selectedTransportId || t.better)) return t;
    return {
      ...t,
      priceEur,
      label: withFinalFlightPriceLabel(t.label, priceEur),
    };
  });
  const hasFlight = transports.some((t) => t.kind === 'flight');
  const patched: ReiseOption = {
    ...opt,
    flightPriceEur: priceEur,
    transports: hasFlight ? transports : opt.transports,
  };
  const rebought = buyInFromParts({
    flightPerPersonEur: priceEur,
    stayEur: patched.stayPriceEur ?? null,
    transferEur: patched.transferEur ?? null,
    carEur: sharedCarEurFromOption(patched),
    extrasEur: patched.extrasEur ?? null,
    adults,
  });
  patched.totalEur = rebought.totalPackage ?? patched.totalEur;
  patched.buyInEur = rebought.buyInEur;
  patched.pricePerPerson = rebought.buyInEur ?? perPersonPrice(patched.totalEur, adults);
  const budget = hasUserBudget(ledger) ? ledger.budgetEur?.value ?? null : null;
  patched.budgetDeltaEur = budgetDeltaVsBuyIn(
    patched.buyInEur ?? null,
    budget,
    ledger.budgetScope?.value ?? 'per_person',
    patched.totalEur,
  );
  return enrichOptionMagazine(patched, ledger, {
    transferMinutes: patched.transferMinutes,
    wishEvidence: patched.wishEvidence,
    destPhotoUrl: patched.photoUrl,
  });
}

/**
 * Paketpreis (Fixpreis p.P.):
 * - Flug/Bahn-Ticket = pro Person → × adults (Hin+Rück wenn Quote RT)
 * - Unterkunft / Transfer / Mietwagen / Extras = Gruppen-Gesamt → geteilt
 * total = flightPP×N + stay + transfer + car + extras
 * p.P. = round(total / N)
 *
 * Beispiel User: Flug 100€ p.P., Wohnung 1000€, Mietwagen 100€, 2 Pers.
 * → 100×2 + 1000 + 100 = 1300 · p.P. = 650€
 */
export function buyInFromParts(opts: {
  /** Flugpreis pro Person (Calendar/Kiwi, typisch Hin+Rück). */
  flightPerPersonEur?: number | null;
  /**
   * Legacy: wenn gesetzt und flightPerPersonEur fehlt —
   * wird als **bereits Gruppen-Flugsumme** behandelt (alt).
   */
  flightEur?: number | null;
  /** Unterkunft Gesamt für die Gruppe / Zeitraum. */
  stayEur?: number | null;
  /** Geteilt: Transfer (ideal Hin+Rück Flughafen↔Stay). */
  transferEur?: number | null;
  /** Geteilt: Mietwagen / Camper Gesamt. */
  carEur?: number | null;
  /** Geteilt: Events / Tickets / Wunsch-Extras (Gruppe). */
  extrasEur?: number | null;
  adults: number;
}): { buyInEur: number | null; buyInLabel: string; totalPackage: number | null } {
  const adults = Math.max(1, opts.adults);
  let flightTotal = 0;
  if (opts.flightPerPersonEur != null && opts.flightPerPersonEur > 0) {
    flightTotal = opts.flightPerPersonEur * adults;
  } else if (opts.flightEur != null && opts.flightEur > 0) {
    flightTotal = opts.flightEur;
  }
  const stay = opts.stayEur != null && opts.stayEur > 0 ? opts.stayEur : 0;
  const transfer = opts.transferEur != null && opts.transferEur > 0 ? opts.transferEur : 0;
  const car = opts.carEur != null && opts.carEur > 0 ? opts.carEur : 0;
  // Buy-in = Wohnen + Fortbewegung — Extras/Tickets separat (nicht im Buy-in)
  void opts.extrasEur;
  const totalPackage = Math.round(flightTotal + stay + transfer + car);
  if (totalPackage <= 0) {
    return { buyInEur: null, buyInLabel: 'Buy-in p.P. (Wohnen + Anreise)', totalPackage: null };
  }
  return {
    buyInEur: Math.round(totalPackage / adults),
    buyInLabel: 'p.P. = (Anreise×Pers. + Unterkunft + Transfer + Mietwagen) ÷ Pers. — ohne Extras',
    totalPackage,
  };
}

/** Mietwagen/Camper-Gruppenpreis aus Option (Transport-Wahl oder carPriceEur). */
export function sharedCarEurFromOption(opt: {
  carPriceEur?: number | null;
  transports?: Array<{ id?: string; kind: string; priceEur?: number | null }> | null;
  selectedTransportId?: string | null;
}): number | null {
  if (opt.carPriceEur != null && opt.carPriceEur > 0) return opt.carPriceEur;
  const transports = opt.transports ?? [];
  const selected = transports.find(
    (t) =>
      t.kind === 'car' &&
      t.id === opt.selectedTransportId &&
      t.priceEur != null &&
      t.priceEur > 0,
  );
  if (selected?.priceEur != null) return selected.priceEur;
  const anyCar = transports.find((t) => t.kind === 'car' && t.priceEur != null && t.priceEur > 0);
  return anyCar?.priceEur != null && anyCar.priceEur > 0 ? anyCar.priceEur : null;
}

/** Overnight-Paket: Buy-in nur glaubwürdig mit Stay + Anreise-Preis. */
export function isCrediblePackageBuyIn(opts: {
  overnight: boolean;
  stayEur?: number | null;
  flightPerPersonEur?: number | null;
  /** Bahn/Bus/Camper als Gruppen- oder p.P.-Anreise schon im Buy-in. */
  hasSurfaceTravel?: boolean;
}): boolean {
  if (!opts.overnight) return true;
  const stayOk = opts.stayEur != null && opts.stayEur > 0;
  const travelOk =
    (opts.flightPerPersonEur != null && opts.flightPerPersonEur > 0) ||
    Boolean(opts.hasSurfaceTravel);
  return stayOk && travelOk;
}

/** Budget-Delta: Brief p.P. vs Buy-in p.P. (nicht Gruppen-Total vs p.P.). */
export function budgetDeltaVsBuyIn(
  buyInEur: number | null,
  budgetEur: number | null,
  budgetScope?: 'per_person' | 'total' | null,
  totalPackage?: number | null,
): number | null {
  if (budgetEur == null) return null;
  if (budgetScope === 'total') {
    if (totalPackage == null) return null;
    return Math.round(totalPackage - budgetEur);
  }
  if (buyInEur == null) return null;
  return Math.round(buyInEur - budgetEur);
}

/** Grobe Economy-Mietwagen-Gesamtschätzung (€) für Nächte — nur Fallback ohne Live-Quote. */
export function estimateRentalCarGroupEur(nights: number): number {
  const n = Math.max(1, Math.round(nights) || 1);
  return Math.round(40 * n);
}

export function buildDayPlans(opts: {
  checkin: string;
  checkout: string;
  placeName: string;
  transport?: TransportChoice | null;
  stay?: StayChoice | null;
  transferEur?: number | null;
  activities?: string[];
  /** Ticket-/Tour-Links zu denselben Aktivitäten (Brief → Tag). */
  activityBookByTitle?: Record<string, string>;
  /** Soft-Themen aus Brief-Vibe (Party/Spa/Action…). */
  ledger?: ReiseLedger | null;
  /** Belegte Wish-/Nearby-Namen als Hint-Titel. */
  wishHints?: string[];
}): DayPlan[] {
  const days: DayPlan[] = [];
  const span = resolveTripDaySpan({
    checkin: opts.checkin,
    checkout: opts.checkout,
    ledger: opts.ledger,
  });
  const dayKeys = enumerateDateKeysInclusive(span.checkin, span.checkout);
  if (!dayKeys.length) {
    return normalizeDayPlans([
      {
        dayKey: opts.checkin || 'tag-1',
        title: 'Tag 1 · Anreise',
        blocks: [
          {
            id: 'arr',
            title: 'Anreise',
            detail: opts.transport?.label || `Richtung ${opts.placeName}`,
            time: opts.transport?.departAt,
            costEur: opts.transport?.priceEur ?? null,
            bookUrl: opts.transport?.bookUrl,
          },
        ],
      },
    ]);
  }
  const { softThemesForTrip, softBlocksForTheme } = require('./softCityDayPlan') as typeof import('./softCityDayPlan');
  const middleCount = Math.max(0, dayKeys.length - 2);
  const themes = opts.ledger
    ? softThemesForTrip(opts.ledger, middleCount)
    : Array.from({ length: middleCount }, () => 'explore' as const);
  const acts = (opts.activities ?? []).filter((a) => !/^e-?sim$/i.test(a));
  const bookMap = opts.activityBookByTitle ?? {};
  const hints = [
    ...(opts.wishHints ?? []),
    ...acts,
  ].filter(Boolean);

  for (let i = 0; i < dayKeys.length; i++) {
    const dayKey = dayKeys[i]!;
    const dayNum = i + 1;
    const tabHead = dayTabLabel(dayKey, dayNum);
    const isFirst = i === 0;
    const isLast = i === dayKeys.length - 1;

    // Einzeltag (Daytrip): Anreise + Abreise in einem Tag
    if (isFirst && isLast) {
      days.push({
        dayKey,
        title: `${tabHead} · Tagestrip`,
        blocks: [
          {
            id: `${dayKey}-tr`,
            time: opts.transport?.departAt,
            title:
              opts.transport?.kind === 'flight'
                ? 'Flug'
                : opts.transport?.kind === 'train'
                  ? 'Bahn'
                  : opts.transport?.kind === 'bus'
                    ? 'Fernbus'
                    : opts.transport?.kind === 'car'
                      ? 'Camper/Auto'
                      : 'Anreise',
            detail: [
              opts.transport?.fromStation && opts.transport?.toStation
                ? `${opts.transport.fromStation} → ${opts.transport.toStation}`
                : opts.transport?.label || null,
              opts.transport?.departAt ? `Abfahrt ${opts.transport.departAt}` : null,
              opts.transport?.arriveAt ? `Ankunft ${opts.transport.arriveAt}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            costEur: opts.transport?.priceEur ?? null,
            bookUrl: opts.transport?.bookUrl,
          },
          {
            id: `${dayKey}-out`,
            title: 'Rückreise',
            detail: opts.placeName,
            bookUrl: opts.transport?.bookUrl,
          },
        ],
      });
      continue;
    }

    if (isFirst) {
      const eve =
        opts.ledger
          ? softBlocksForTheme({
              theme: 'arrival_evening',
              dayKey,
              placeName: opts.placeName,
              ledger: opts.ledger,
              wishHints: hints,
              arriveHint: opts.transport?.arriveAt || opts.transport?.departAt || null,
            })
          : [];
      days.push({
        dayKey,
        title: `${tabHead} · Anreise`,
        blocks: [
          {
            id: `${dayKey}-tr`,
            time: opts.transport?.departAt,
            title:
              opts.transport?.kind === 'flight'
                ? 'Flug'
                : opts.transport?.kind === 'train'
                  ? 'Bahn'
                  : opts.transport?.kind === 'bus'
                    ? 'Fernbus'
                    : opts.transport?.kind === 'car'
                      ? 'Camper/Auto'
                      : 'Anreise',
            detail: [
              opts.transport?.departDateKey
                ? opts.transport.departDateKey.slice(0, 10)
                : null,
              opts.transport?.fromStation && opts.transport?.toStation
                ? `${opts.transport.fromStation} → ${opts.transport.toStation}`
                : null,
              opts.transport?.viaHint ||
                (opts.transport?.transfers === 0 ? 'Direkt' : null),
              opts.transport?.flightNumber
                ? `${opts.transport.carrier ? opts.transport.carrier + ' ' : ''}${opts.transport.flightNumber}`
                : null,
              opts.transport?.label &&
              !opts.transport?.fromStation
                ? opts.transport.label
                : null,
              opts.transport?.departAt ? `Abfahrt ${opts.transport.departAt}` : null,
              opts.transport?.arriveAt ? `Ankunft ${opts.transport.arriveAt}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            costEur: opts.transport?.priceEur ?? null,
            bookUrl: opts.transport?.bookUrl,
          },
          {
            id: `${dayKey}-xfer`,
            title: 'Transfer zur Unterkunft',
            detail:
              opts.transferEur != null
                ? `ca. ${opts.transferEur} € für die Gruppe (geteilt)`
                : 'Flughafen/Bahnhof → Check-in',
            costEur: opts.transferEur ?? null,
          },
          {
            id: `${dayKey}-stay`,
            time: estimateCheckInClock(
              opts.transport?.arriveAt,
              opts.stay?.checkInFrom,
            ),
            title: 'Check-in',
            detail: [
              opts.stay?.name || 'Unterkunft',
              `ab ${estimateCheckInClock(opts.transport?.arriveAt, opts.stay?.checkInFrom)} (Hotel-üblich)`,
            ]
              .filter(Boolean)
              .join(' · '),
            costEur: null,
            bookUrl: opts.stay?.bookUrl,
          },
          ...eve,
        ],
      });
      continue;
    }
    if (isLast) {
      days.push({
        dayKey,
        title: `${tabHead} · Abreise`,
        blocks: [
          {
            id: `${dayKey}-out`,
            time: opts.stay?.checkOutUntil || '11:00',
            title: 'Check-out & Rückreise',
            detail: [
              opts.stay?.name ? `Check-out ${opts.stay.name}` : 'Check-out',
              `bis ${opts.stay?.checkOutUntil || '11:00'}`,
              opts.placeName,
            ]
              .filter(Boolean)
              .join(' · '),
            bookUrl: opts.transport?.bookUrl,
          },
        ],
      });
      continue;
    }
    const theme = themes[i - 1] || 'explore';
    const themeLabel =
      theme === 'party'
        ? 'Feiern'
        : theme === 'action'
          ? 'Action'
          : theme === 'spa'
            ? 'Spa / Bad'
            : theme === 'food'
              ? 'Food'
              : theme === 'wind_down'
                ? 'Ausklang'
                : 'Erkunden';
    const soft = opts.ledger
      ? softBlocksForTheme({
          theme,
          dayKey,
          placeName: opts.placeName,
          ledger: opts.ledger,
          wishHints: hints.slice((i - 1) * 2),
        })
      : [];
    // Alle Brief-Aktivitäten rein — Cap erst in normalizeDayPlans (max 20)
    const actBlocks = acts.map((a, idx) => ({
      id: `${dayKey}-a${idx}`,
      title: a,
      detail: 'Aus dem Brief — Ticket/Tour wenn belegt',
      bookUrl: bookMap[a] || bookMap[a.toLowerCase()] || null,
    }));
    const hintBlocks = hints
      .filter((h) => !acts.some((a) => a.toLowerCase() === h.toLowerCase()))
      .slice(0, 8)
      .map((h, idx) => ({
        id: `${dayKey}-h${idx}`,
        title: h,
        detail: `Wunsch aus dem Brief · ${opts.placeName}`,
      }));
    days.push({
      dayKey,
      title: `${tabHead} · ${themeLabel}`,
      blocks: [...actBlocks, ...soft, ...hintBlocks],
    });
  }
  return normalizeDayPlans(days);
}

/** Max. Planpunkte pro Tag (UI/Timeline). */
export const DAY_PLAN_BLOCKS_MAX = 20;

const WEEKDAYS_DE_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

/** Kurzer Reiter-Titel: „Do 11.9.“ */
export function dayTabLabel(dayKey: string, dayNum: number): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dayKey)) return `Tag ${dayNum}`;
  const d = new Date(`${dayKey.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return `Tag ${dayNum}`;
  const wd = WEEKDAYS_DE_SHORT[d.getDay()] ?? `T${dayNum}`;
  return `${wd} ${d.getDate()}.${d.getMonth() + 1}.`;
}

/**
 * Jeder Tag ≥1 Planpunkt, max DAY_PLAN_BLOCKS_MAX — keine leeren Reiter.
 */
export function normalizeDayPlans(days: DayPlan[]): DayPlan[] {
  return (days ?? []).map((day, i) => {
    const dayKey = day.dayKey || `tag-${i + 1}`;
    let blocks = [...(day.blocks ?? [])].filter((b) => (b.title || '').trim());
    if (!blocks.length) {
      blocks = [
        {
          id: `${dayKey}-open`,
          title: 'Frei nach Plan',
          detail: 'Mindestens ein Slot — füllt sich mit Wünschen und Live-Orten.',
        },
      ];
    }
    if (blocks.length > DAY_PLAN_BLOCKS_MAX) {
      blocks = blocks.slice(0, DAY_PLAN_BLOCKS_MAX);
    }
    const title = (day.title || '').trim() || `${dayTabLabel(dayKey, i + 1)} · Tag ${i + 1}`;
    const weekdayLabel =
      day.weekdayLabel ||
      (/^\d{4}-\d{2}-\d{2}/.test(dayKey)
        ? WEEKDAYS_DE_SHORT[new Date(`${dayKey.slice(0, 10)}T12:00:00`).getDay()] ?? null
        : null);
    // Blocks ohne bookUrl behalten — Links kommen aus Transport/Stay/Activity wenn belegt
    return { ...day, dayKey, title, weekdayLabel, blocks };
  });
}

/**
 * Buchungs-Checkliste: nur der gewählte/beste Transport — keine Partner-Vergleichszeilen.
 * Yorro vergleicht intern; User bucht step-by-step den Favoriten.
 */
export function pickTransportsForBooking(
  transports: TransportChoice[] | undefined,
  selectedTransportId?: string | null,
): TransportChoice[] {
  const list = transports ?? [];
  if (!list.length) return [];
  if (selectedTransportId) {
    const hit = list.find((t) => t.id === selectedTransportId);
    if (hit) return [hit];
  }
  const best = list.find((t) => t.better);
  if (best) return [best];
  return [list[0]!];
}

export function buildBookingChecklist(opt: {
  transports?: TransportChoice[];
  /** Nur diesen Transport als Buchungsschritt — nicht alle Vergleichs-Alts. */
  selectedTransportId?: string | null;
  stays?: StayChoice[];
  /** Nur diese Unterkunft buchen — Alternativen bleiben in der Auswahl-UI. */
  selectedStayId?: string | null;
  hubStay?: StayChoice | null;
  bookendStartStay?: StayChoice | null;
  transferUrl?: string | null;
  carUrl?: string | null;
  activityUrls?: Array<{ label: string; url: string }>;
  /** Pauschal-Partner nur hier — nie als Stay. */
  packageUrls?: Array<{ label: string; url: string }>;
  packageBookUrl?: string | null;
  /** Wenn Partner = gleiches Stay-Angebot, Affiliate bevorzugen */
  preferAffiliateSameOffer?: boolean;
  /** Inventar: schon gebuchte Legs nicht nochmal als Book-CTA. */
  alreadyBookedFlight?: boolean;
  alreadyBookedStay?: boolean;
  alreadyBookedTransfer?: boolean;
  alreadyBookedCar?: boolean;
  alreadyBookedRail?: boolean;
  alreadyBookedBus?: boolean;
  alreadyBookedActivities?: Array<{ name: string }>;
}): BookingCheckItem[] {
  const items: BookingCheckItem[] = [];
  // Schon da — Info-Zeilen ohne Partner-Link (ganz oben)
  if (opt.alreadyBookedFlight) {
    items.push({
      id: 'have-flight',
      label: 'Flug · schon gebucht',
      url: null,
      kind: 'flight',
      alreadyBooked: true,
    });
  }
  if (opt.alreadyBookedRail) {
    items.push({
      id: 'have-rail',
      label: 'Bahn · schon gebucht',
      url: null,
      kind: 'train',
      alreadyBooked: true,
    });
  }
  if (opt.alreadyBookedBus) {
    items.push({
      id: 'have-bus',
      label: 'Fernbus · schon gebucht',
      url: null,
      kind: 'other',
      alreadyBooked: true,
    });
  }
  if (opt.alreadyBookedStay) {
    items.push({
      id: 'have-stay',
      label: 'Unterkunft · schon gebucht',
      url: null,
      kind: 'stay',
      alreadyBooked: true,
    });
  }
  if (opt.alreadyBookedTransfer) {
    items.push({
      id: 'have-xfer',
      label: 'Transfer · schon gebucht',
      url: null,
      kind: 'transfer',
      alreadyBooked: true,
    });
  }
  if (opt.alreadyBookedCar) {
    items.push({
      id: 'have-car',
      label: 'Mietwagen · schon gebucht',
      url: null,
      kind: 'car',
      alreadyBooked: true,
    });
  }
  for (const [i, a] of (opt.alreadyBookedActivities ?? []).slice(0, 4).entries()) {
    if (!a?.name) continue;
    items.push({
      id: `have-act-${i}`,
      label: `${a.name.slice(0, 36)} · schon gebucht`,
      url: null,
      kind: 'activity',
      alreadyBooked: true,
    });
  }

  const transportsForBook = pickTransportsForBooking(
    opt.transports,
    opt.selectedTransportId,
  ).filter((t) => {
    if (t.kind === 'flight' && opt.alreadyBookedFlight) return false;
    if (t.kind === 'train' && opt.alreadyBookedRail) return false;
    if (t.kind === 'bus' && opt.alreadyBookedBus) return false;
    if (t.kind === 'car' && opt.alreadyBookedCar) return false;
    return true;
  });
  for (const t of transportsForBook) {
    if (t.kind === 'flight') {
      if (!t.bookUrl && !t.flightNumber) continue;
      items.push(
        gateFlightBookItem({
          id: `tr-${t.id}`,
          label: t.label,
          bookUrl: t.bookUrl,
          flightNumber: t.flightNumber,
          carrier: t.carrier,
        }),
      );
      continue;
    }
    const gated = gateTransportChoice(t);
    if (gated) items.push(gated);
  }
  if (!opt.alreadyBookedStay && (opt.hubStay?.bookUrl || opt.hubStay?.name)) {
    items.push(
      gateStayBookItem({
        id: `hub-${opt.hubStay!.id}`,
        name: `Vornacht ${opt.hubStay!.name}`,
        bookUrl: opt.hubStay!.bookUrl,
        expediaPropertyId: opt.hubStay!.expediaPropertyId,
      }),
    );
  }
  if (
    !opt.alreadyBookedStay &&
    opt.bookendStartStay &&
    opt.bookendStartStay.id !== opt.hubStay?.id &&
    (opt.bookendStartStay.bookUrl || opt.bookendStartStay.name)
  ) {
    items.push(
      gateStayBookItem({
        id: `bookend-${opt.bookendStartStay.id}`,
        name: `Hotel vor der Tour · ${opt.bookendStartStay.name}`,
        bookUrl: opt.bookendStartStay.bookUrl,
        expediaPropertyId: opt.bookendStartStay.expediaPropertyId,
      }),
    );
  }
  const realStays = opt.alreadyBookedStay ? [] : filterRealStays(opt.stays);
  const pkgAffiliate = opt.packageBookUrl || null;
  const staysForBook =
    opt.selectedStayId && realStays.some((s) => s.id === opt.selectedStayId)
      ? realStays.filter((s) => s.id === opt.selectedStayId)
      : realStays.slice(0, 1);
  for (const s of staysForBook) {
    let url = s.bookUrl;
    if (url && pkgAffiliate && opt.preferAffiliateSameOffer) {
      url =
        preferAffiliateIfSameOffer({
          affiliateUrl: pkgAffiliate,
          directUrl: s.bookUrl,
          sameOffer: true,
        }) || s.bookUrl;
    }
    items.push(
      gateStayBookItem({
        id: `st-${s.id}`,
        name: s.name,
        bookUrl: url,
        expediaPropertyId: s.expediaPropertyId,
      }),
    );
  }
  if (opt.transferUrl && !opt.alreadyBookedTransfer) {
    items.push({
      id: 'xfer',
      label: 'Taxi / Transfer zur Unterkunft',
      url: opt.transferUrl,
      kind: 'transfer',
      clickedAtMs: null,
    });
  }
  if (opt.carUrl && !opt.alreadyBookedCar) {
    items.push({
      id: 'car',
      label: 'Mietwagen',
      url: opt.carUrl,
      kind: 'car',
      clickedAtMs: null,
    });
  }
  for (const a of opt.activityUrls ?? []) {
    items.push({
      id: `act-${a.label}`,
      label: a.label,
      url: a.url,
      kind: 'activity',
      clickedAtMs: null,
    });
  }
  const packages = [
    ...(opt.packageUrls ?? []),
    ...(opt.packageBookUrl && !(opt.packageUrls ?? []).some((p) => p.url === opt.packageBookUrl)
      ? [{ label: 'Pauschal CHECK24', url: opt.packageBookUrl }]
      : []),
  ];
  for (const p of packages) {
    if (!p.url) continue;
    // Generische Pauschal-Portal-Suche ohne konkreten Trip-Intent nicht als Buchungsschritt
    if (/check24|ab-in-den|pauschal|lidl|magic\s*life/i.test(p.label) && !opt.packageBookUrl && !(opt.packageUrls ?? []).length) {
      continue;
    }
    items.push({
      id: `pkg-${p.label}`,
      label: p.label,
      url: p.url,
      kind: 'package',
      clickedAtMs: null,
    });
  }
  return items.filter((it) => {
    // Schon gebucht: Info ohne URL behalten
    if (it.alreadyBooked) return true;
    // Pending „noch nachziehen“ ohne URL: behalten (sichtbarer CTA)
    if (/noch nachziehen/i.test(it.label)) return true;
    if (!it.url) return false;
    // Flug/Stay: nie hohle Portal-Homes
    if ((it.kind === 'flight' || it.kind === 'stay') && isHollowPartnerUrl(it.url)) {
      return false;
    }
    return true;
  });
}

/** Hub-Vornacht nur im Buy-in, wenn der gewählte Start früh ist. */
function extrasEurForSideStays(
  opt: ReiseOption,
  tr: TransportChoice | undefined,
): number | null {
  const hubP = tr?.hubPreNight ? (opt.hubPreNightStay?.priceEur ?? 0) : 0;
  const bookP = opt.bookendStartStay?.priceEur ?? 0;
  const same =
    opt.bookendStartStay &&
    opt.hubPreNightStay &&
    opt.bookendStartStay.id === opt.hubPreNightStay.id;
  const side = (same ? Math.max(hubP, bookP) : hubP + (bookP > 0 ? bookP : 0)) || 0;
  const known =
    (opt.hubPreNightStay?.priceEur ?? 0) + (opt.bookendStartStay?.priceEur ?? 0);
  const rest = Math.max(0, (opt.extrasEur ?? 0) - known);
  const total = side + rest;
  return total > 0 ? total : null;
}

export function applySelectedStayTransport(
  opt: ReiseOption,
  adults: number,
  ledger?: ReiseLedger | null,
): ReiseOption {
  const stay = opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0];
  const tr = opt.transports?.find((t) => t.id === opt.selectedTransportId) || opt.transports?.[0];
  const carEur = sharedCarEurFromOption({
    ...opt,
    // selected car transport wins; else keep stored carPriceEur
    selectedTransportId: opt.selectedTransportId,
  });
  const buy = buyInFromParts({
    flightPerPersonEur:
      tr?.kind === 'flight' || tr?.kind === 'bus' || tr?.kind === 'train'
        ? tr.priceEur ?? (tr.kind === 'flight' ? opt.flightPriceEur ?? null : null)
        : tr?.kind === 'car'
          ? null
          : opt.flightPriceEur ?? null,
    stayEur: stay?.priceEur ?? opt.stayPriceEur ?? null,
    transferEur: opt.transferEur ?? null,
    carEur,
    extrasEur: extrasEurForSideStays(opt, tr),
    adults,
  });
  const span = resolveTripDaySpan({
    checkin: opt.days?.[0]?.dayKey || opt.comboWindows?.[0]?.checkin,
    checkout:
      opt.days?.[(opt.days?.length ?? 0) - 1]?.dayKey || opt.comboWindows?.[0]?.checkout,
    ledger,
    comboCheckin: opt.comboWindows?.[0]?.checkin,
    comboCheckout: opt.comboWindows?.[0]?.checkout,
  });
  const checkin = span.checkin;
  const checkout = span.checkout;
  let days: typeof opt.days = opt.days;
  if (ledger) {
    if (!userWantsProgramDays(ledger)) {
      days = [];
    } else if (checkin) {
      days = buildDayPlans({
        checkin,
        checkout,
        placeName: opt.placeName,
        transport: tr ?? null,
        stay: stay ?? null,
        transferEur: opt.transferEur,
        activities: ledger.mustActivities?.value ?? [],
        ledger,
      });
      try {
        const { annotateDayPlansWithHopStops } = require('./hopDayAnnotate') as typeof import('./hopDayAnnotate');
        days = annotateDayPlansWithHopStops(days, ledger.hopStops?.value);
      } catch {
        /* soft */
      }
    }
  }
  const children = Math.max(0, ledger?.children?.value ?? 0);
  const airbnbPrefill = {
    city: opt.placeName,
    checkin: checkin || null,
    checkout: checkout || null,
    adults,
    children: children > 0 ? children : null,
  };
  const staysForChecklist = (opt.stays ?? []).map((s) => {
    if (!s.bookUrl || !isAirbnbUrl(s.bookUrl)) return s;
    return {
      ...s,
      bookUrl: withAirbnbStayPrefill(s.bookUrl, airbnbPrefill),
    };
  });
  let stayBookUrl = stay?.bookUrl ?? opt.stayBookUrl;
  if (stayBookUrl && isAirbnbUrl(stayBookUrl)) {
    stayBookUrl = withAirbnbStayPrefill(stayBookUrl, airbnbPrefill);
  }
  const next: ReiseOption = {
    ...opt,
    stayName: stay?.name ?? opt.stayName,
    stayBookUrl,
    stayPriceEur: stay?.priceEur ?? opt.stayPriceEur,
    photoUrl: stay?.photoUrl ?? opt.photoUrl,
    flightBookUrl: tr?.kind === 'flight' ? tr.bookUrl ?? null : tr?.kind === 'train' ? null : opt.flightBookUrl,
    flightPriceEur: tr?.kind === 'flight' ? tr.priceEur : tr?.kind === 'train' ? null : opt.flightPriceEur,
    carPriceEur: carEur,
    extrasEur: extrasEurForSideStays(opt, tr),
    buyInEur: buy.buyInEur,
    buyInLabel: buy.buyInLabel,
    totalEur: buy.totalPackage ?? opt.totalEur,
    pricePerPerson: buy.buyInEur ?? perPersonPrice(buy.totalPackage, adults),
    budgetDeltaEur: budgetDeltaVsBuyIn(
      buy.buyInEur,
      ledger && hasUserBudget(ledger) ? ledger.budgetEur?.value ?? null : null,
      ledger?.budgetScope?.value ?? 'per_person',
      buy.totalPackage,
    ),
    days,
    stays: staysForChecklist.length ? staysForChecklist : opt.stays,
    bookingChecklist: buildBookingChecklist({
      transports: opt.transports,
      selectedTransportId: opt.selectedTransportId ?? tr?.id ?? null,
      stays: staysForChecklist.length ? staysForChecklist : opt.stays,
      selectedStayId: opt.selectedStayId ?? stay?.id ?? null,
      hubStay: tr?.hubPreNight ? opt.hubPreNightStay ?? null : null,
      bookendStartStay: opt.bookendStartStay ?? null,
      transferUrl: opt.transferBookUrl,
      carUrl: opt.carBookUrl,
      packageBookUrl: opt.packageBookUrl,
      packageUrls: opt.packageBookUrl
        ? [{ label: 'Pauschal CHECK24', url: opt.packageBookUrl }]
        : undefined,
      alreadyBookedFlight: ledger?.bookedFlight?.value === true,
      alreadyBookedStay: ledger?.bookedStay?.value === true,
      alreadyBookedTransfer: ledger?.bookedTransfer?.value === true,
      alreadyBookedCar: ledger?.bookedCar?.value === true,
      alreadyBookedRail: ledger?.bookedRail?.value === true,
      alreadyBookedBus: ledger?.bookedBus?.value === true,
      alreadyBookedActivities: ledger?.bookedActivities?.value ?? undefined,
    }),
  };
  if (ledger) {
    const evidence = (opt.wishEvidence ?? []).map((e) =>
      e.onProperty
        ? { ...e, photoUrl: stay?.photoUrl ?? e.photoUrl, met: e.met }
        : e,
    );
    return enrichOptionMagazine(next, ledger, { wishEvidence: evidence });
  }
  return next;
}
