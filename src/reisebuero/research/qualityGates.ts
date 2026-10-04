/**
 * Zwei End-Kontrollen vor Ergebnis:
 * 1) Paket komplett? (Stay, Anreise, Preis, Buchungslinks)
 * 2) Wünsche erfüllt? (Pflicht-Facts, Budget, kritische Gaps)
 * Bei Hard-Fail → Funnel darf nachziehen (max. 2 Runden).
 */

import type { ReiseLedger, ReiseOption } from '../types';
import { haversineKm } from './candidates';
import { hasUserBudget, needsNight } from '../completeness';
import { userWantsProgramDays } from './storyMagazine';
import { isPackagePartnerStay } from './packagePartner';
import {
  SAME_CITY_STAY_DEST_KM,
  farOutdoorWishHits,
  stayOrPlaceAnchor,
} from './sameCity';

export type GateIssue = {
  code: string;
  label: string;
  severity: 'hard' | 'soft';
};

export type GateResult = {
  ok: boolean;
  hardOk: boolean;
  issues: GateIssue[];
};

export type EndControlsReport = {
  pass: boolean;
  minPassing: number;
  passingIds: string[];
  failingIds: string[];
  byOption: Record<string, { completeness: GateResult; wishes: GateResult }>;
  summary: string;
};

function needsOutbound(ledger: ReiseLedger): 'flight' | 'train' | 'car' | 'any' {
  const m = ledger.mode?.value;
  if (m === 'drive' || m === 'daytrip') return 'car';
  if (m === 'train') return 'train';
  if (m === 'fly') return 'flight';
  return 'any';
}

/** Overnight = Brief braucht Nacht — nicht „erst wenn Stay schon da“ (sonst fehlt stay_missing). */
export function isOvernightOption(ledger: ReiseLedger, opt?: ReiseOption | null): boolean {
  if (needsNight(ledger)) return true;
  if ((ledger.stayNights?.value ?? 0) > 0) return true;
  if (ledger.dateStart?.value && ledger.dateEnd?.value) {
    const a = Date.parse(`${ledger.dateStart.value}T12:00:00`);
    const b = Date.parse(`${ledger.dateEnd.value}T12:00:00`);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return true;
  }
  if (opt && (Boolean(opt.stayName) || (opt.stays?.length ?? 0) > 0)) return true;
  return false;
}

/** @deprecated use isOvernightOption — kept for local call sites */
function overnight(ledger: ReiseLedger, opt: ReiseOption): boolean {
  return isOvernightOption(ledger, opt);
}

/** Kontrolle 1 — ist der Plan buch-/zeigbar komplett? */
export function checkPackageComplete(opt: ReiseOption, ledger: ReiseLedger): GateResult {
  const issues: GateIssue[] = [];
  const over = overnight(ledger, opt);
  const stay =
    opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0] || null;
  const tr =
    opt.transports?.find((t) => t.id === opt.selectedTransportId) || opt.transports?.[0] || null;

  if (over) {
    // Pauschal-URL allein ≠ Unterkunft — sonst Magazin ohne Stay-Preis
    const hasStayPrice =
      (stay?.priceEur != null && stay.priceEur > 0) ||
      (opt.stayPriceEur != null && opt.stayPriceEur > 0);
    const hasStayName = Boolean(stay?.name || opt.stayName);
    if (!hasStayName || !hasStayPrice) {
      issues.push({
        code: 'stay_missing',
        label: 'Unterkunft mit Preis fehlt',
        severity: 'hard',
      });
    }
    if (!(opt.photoUrl || stay?.photoUrl)) {
      issues.push({
        code: 'photo_missing',
        label: 'Noch kein Unterkunfts-/Ort-Foto',
        severity: 'soft',
      });
    }
  }

  const need = needsOutbound(ledger);
  const hasFlight =
    tr?.kind === 'flight' || Boolean(opt.flightBookUrl) || opt.flightPriceEur != null;
  const hasTrain = tr?.kind === 'train';
  const hasCar = tr?.kind === 'car' || Boolean(opt.carBookUrl) || need === 'car';

  if (over && need === 'flight' && !hasFlight) {
    issues.push({
      code: 'flight_missing',
      label: 'Flug (Preis oder Buchungslink) fehlt',
      severity: 'hard',
    });
  }
  if (over && need === 'train' && !hasTrain && !hasFlight) {
    issues.push({
      code: 'train_missing',
      label: 'Anreise Bahn/Flug fehlt',
      severity: 'hard',
    });
  }
  if (over && need === 'any' && !hasFlight && !hasTrain && !hasCar) {
    issues.push({
      code: 'outbound_missing',
      label: 'Keine Anreise (Flug/Bahn/Auto) belegt',
      severity: 'hard',
    });
  }

  // Glaubwürdiges Overnight-Buy-in braucht Stay im Preis — totalEur allein (Flug+Taxi) reicht nicht
  const priced = opt.buyInEur != null || opt.pricePerPerson != null;
  if (over && !priced) {
    issues.push({
      code: 'price_missing',
      label: 'Kein Buy-in (Unterkunft + Anreise)',
      severity: 'hard',
    });
  }

  const hasBook =
    Boolean(opt.stayBookUrl || stay?.bookUrl || opt.flightBookUrl || tr?.bookUrl || opt.packageBookUrl) ||
    (opt.bookingChecklist ?? []).some((b) => Boolean(b.url));
  if (over && !hasBook) {
    issues.push({
      code: 'book_missing',
      label: 'Kein Buchungslink',
      severity: 'hard',
    });
  }

  if (
    over &&
    need === 'flight' &&
    (opt.transferEur == null || opt.transferEur <= 0) &&
    !opt.transferBookUrl
  ) {
    issues.push({
      code: 'transfer_soft',
      label: 'Transfer Flughafen→Stay noch dünn',
      severity: 'soft',
    });
  }

  if (over && need === 'flight' && opt.transferEur != null && opt.transferEur > 0 && !opt.transferMinutes) {
    issues.push({
      code: 'transfer_minutes_soft',
      label: 'Transfer-Dauer fehlt',
      severity: 'soft',
    });
  }

  const summary = (opt.experienceSummary || '').trim();
  if (summary && summary.length > 300) {
    issues.push({
      code: 'summary_long',
      label: 'Erlebnis-Summary länger als 300 Zeichen',
      severity: 'soft',
    });
  }
  if (!summary && over) {
    issues.push({
      code: 'summary_missing',
      label: 'Erlebnis-Summary fehlt',
      severity: 'soft',
    });
  }

  const speech = (opt.speechSummary || '').trim();
  if (speech && speech.length > 800) {
    issues.push({
      code: 'speech_long',
      label: 'Speech länger als 800 Zeichen',
      severity: 'soft',
    });
  }
  if (/\bab\s*\d+\s*€/i.test(`${opt.whyBlurb} ${speech} ${summary}`)) {
    issues.push({
      code: 'price_ab_wording',
      label: 'Preis-Copy enthält „ab …€“',
      severity: 'soft',
    });
  }

  const flightLabels = [
    ...(opt.transports ?? []).filter((t) => t.kind === 'flight').map((t) => t.label),
    ...(opt.journeyBeats ?? []).map((b) => `${b.title} ${b.detail}`),
  ].join(' ');
  if (/\bab\s*\d+\s*€/i.test(flightLabels)) {
    issues.push({
      code: 'flight_label_ab_price',
      label: 'Flug-Label enthält „ab …€“',
      severity: 'soft',
    });
  }

  if (over && !(opt.journeyBeats?.length)) {
    issues.push({
      code: 'journey_missing',
      label: 'Anreise-Beats fehlen',
      severity: 'soft',
    });
  }

  const stayGps =
    stay && stay.lat != null && stay.lng != null
      ? { lat: stay.lat, lng: stay.lng }
      : null;
  const placeGps =
    opt.lat != null && opt.lng != null ? { lat: opt.lat, lng: opt.lng } : null;
  if (over && stayGps && placeGps && haversineKm(stayGps, placeGps) > SAME_CITY_STAY_DEST_KM) {
    issues.push({
      code: 'dest_mismatch',
      label: 'Unterkunft und Flugziel liegen zu weit auseinander',
      severity: 'hard',
    });
  }

  const wishAnchor = stayOrPlaceAnchor({
    stayLat: stay?.lat,
    stayLng: stay?.lng,
    placeLat: opt.lat,
    placeLng: opt.lng,
  });
  const farWishes = farOutdoorWishHits(
    [
      ...((opt.wishEvidence ?? []) as Array<{
        mustHaveId?: string;
        onProperty?: boolean;
        met?: boolean;
        lat?: number | null;
        lng?: number | null;
        distanceM?: number | null;
        name?: string | null;
      }>),
      ...(opt.wishChapters ?? []).map((c) => ({
        mustHaveId: c.mustHaveId,
        onProperty: /pool|grill|sauna|spa/i.test(c.mustHaveId),
        met: c.met,
        lat: c.lat,
        lng: c.lng,
        name: c.title,
      })),
    ],
    wishAnchor,
  );
  if (farWishes.length) {
    const hit = farWishes[0]!;
    issues.push({
      code: 'wish_poi_city',
      label: `${hit.name} liegt nicht in derselben Stadt wie die Unterkunft${hit.km != null ? ` (${hit.km} km)` : ''}`,
      severity: 'hard',
    });
  }

  if (over && !(opt.speechSummary || '').trim()) {
    issues.push({
      code: 'speech_missing',
      label: 'Magazin-Speech fehlt',
      severity: 'soft',
    });
  }

  const mustN = (ledger.mustHaves?.value ?? []).length;
  if (mustN > 0 && (opt.wishChapters?.length ?? 0) < mustN) {
    issues.push({
      code: 'wish_chapters_thin',
      label: 'Wunsch-Kapitel unvollständig',
      severity: 'soft',
    });
  }

  const outdoorMet = (opt.wishChapters ?? []).filter(
    (c) =>
      ['padel', 'tennis', 'sand', 'sea'].includes(c.mustHaveId) &&
      c.met &&
      !c.photoUrl &&
      !c.distanceHint,
  );
  if (outdoorMet.length) {
    issues.push({
      code: 'wish_nearby_thin',
      label: 'Nearby-Wunsch ohne Foto/Distanz',
      severity: 'soft',
    });
  }

  if (!userWantsProgramDays(ledger) && (opt.days?.length ?? 0) > 0) {
    issues.push({
      code: 'days_without_program',
      label: 'Tage ohne Programm-Brief',
      severity: 'soft',
    });
  }

  if ((opt.stays ?? []).some((s) => isPackagePartnerStay(s))) {
    issues.push({
      code: 'package_as_fake_stay',
      label: 'Pauschal-Partner als Fake-Stay',
      severity: 'soft',
    });
  }

  const hard = issues.filter((i) => i.severity === 'hard');
  return { ok: hard.length === 0, hardOk: hard.length === 0, issues };
}

/** Kontrolle 2 — passen Pflichtwünsche / Budget? */
export function checkWishesMet(opt: ReiseOption, ledger: ReiseLedger): GateResult {
  const issues: GateIssue[] = [];

  for (const f of opt.facts ?? []) {
    if (f.met) continue;
    issues.push({
      code: `must_${f.id}`,
      label: `Pflicht nicht belegt: ${f.label}`,
      severity: 'hard',
    });
  }

  for (const f of opt.softFacts ?? []) {
    if (f.met) continue;
    issues.push({
      code: `soft_${f.id}`,
      label: `Wunsch offen: ${f.label}`,
      severity: 'soft',
    });
  }

  if (hasUserBudget(ledger) && ledger.budgetEur?.value != null) {
    const budget = ledger.budgetEur.value;
    const buy = opt.buyInEur ?? opt.pricePerPerson;
    if (buy != null && buy > budget * 1.2) {
      issues.push({
        code: 'budget_over',
        label: `Buy-in €${buy} über Budget €${budget}`,
        severity: 'hard',
      });
    } else if (buy != null && buy > budget) {
      issues.push({
        code: 'budget_soft',
        label: `Buy-in leicht über Budget (€${buy} / €${budget})`,
        severity: 'soft',
      });
    }
  }

  const gapBlob = (opt.gaps ?? []).join(' · ');
  if (/keine unterkunft|nicht gelaufen|fehlgeschlagen/i.test(gapBlob)) {
    issues.push({
      code: 'gap_stay',
      label: 'Kritische Unterkunfts-Lücke',
      severity: 'hard',
    });
  }
  if (/pool nicht/i.test(gapBlob) && (ledger.mustHaves?.value ?? []).includes('pool')) {
    issues.push({
      code: 'gap_pool',
      label: 'Pool-Pflicht nicht belegt',
      severity: 'hard',
    });
  }
  if (/must-fail:/i.test(gapBlob)) {
    const failBits = (opt.gaps ?? []).filter((g) => /must-fail:/i.test(g)).slice(0, 3);
    for (const g of failBits) {
      issues.push({
        code: 'must_fail',
        label: g.replace(/^Must-Fail:\s*/i, '').slice(0, 80),
        severity: 'hard',
      });
    }
  }

  const named = (ledger.destinationHint?.value || '').trim();
  if (named && named.length >= 3 && !/^offen|egal$/iu.test(named)) {
    const blob = `${opt.placeName} ${opt.title}`.toLowerCase();
    if (!blob.includes(named.toLowerCase().slice(0, 4))) {
      issues.push({
        code: 'named_alt',
        label: `Andere Richtung als „${named}“`,
        severity: 'soft',
      });
    }
  }

  const hard = issues.filter((i) => i.severity === 'hard');
  return { ok: hard.length === 0, hardOk: hard.length === 0, issues };
}

/**
 * Beide Kontrollen über die Finalisten.
 * pass = mindestens `minPassing` Optionen ohne Hard-Fail in beiden Gates.
 */
export function runEndControls(
  options: ReiseOption[],
  ledger: ReiseLedger,
  minPassing = 2,
): EndControlsReport {
  const byOption: EndControlsReport['byOption'] = {};
  const passingIds: string[] = [];
  const failingIds: string[] = [];

  for (const opt of options) {
    const completeness = checkPackageComplete(opt, ledger);
    const wishes = checkWishesMet(opt, ledger);
    byOption[opt.id] = { completeness, wishes };
    if (completeness.hardOk && wishes.hardOk) passingIds.push(opt.id);
    else failingIds.push(opt.id);
  }

  const need = Math.min(minPassing, Math.max(1, options.length));
  const pass = passingIds.length >= need;
  const hardBits = failingIds
    .slice(0, 3)
    .map((id) => {
      const o = options.find((x) => x.id === id);
      const pack = byOption[id];
      const issues = [...(pack?.completeness.issues ?? []), ...(pack?.wishes.issues ?? [])].filter(
        (i) => i.severity === 'hard',
      );
      return `${o?.placeName || id}: ${issues.map((i) => i.label).slice(0, 2).join(', ')}`;
    })
    .filter(Boolean);

  const summary = pass
    ? `Kontrolle ok — ${passingIds.length}/${options.length} Finalisten komplett & wunschfit`
    : `Kontrolle fail — ${passingIds.length}/${options.length} ok, nachziehen: ${hardBits.join(' · ') || 'zu dünn'}`;

  return {
    pass,
    minPassing: need,
    passingIds,
    failingIds,
    byOption,
    summary,
  };
}

/** Score-Strafe für Hard-Fails, damit Nachzieh-Kandidaten hochkommen. */
export function applyGateScorePenalty(
  opt: ReiseOption,
  report: EndControlsReport,
): ReiseOption {
  const pack = report.byOption[opt.id];
  if (!pack) return opt;
  const hardN =
    pack.completeness.issues.filter((i) => i.severity === 'hard').length +
    pack.wishes.issues.filter((i) => i.severity === 'hard').length;
  if (!hardN) return opt;
  const next = { ...opt };
  next.matchScore = Math.max(40, next.matchScore - Math.min(28, hardN * 10));
  const labels = [...pack.completeness.issues, ...pack.wishes.issues]
    .filter((i) => i.severity === 'hard')
    .map((i) => i.label)
    .slice(0, 3);
  next.decisionNotes = [...(next.decisionNotes ?? []), ...labels.map((l) => `Kontrolle: ${l}`)];
  return next;
}
