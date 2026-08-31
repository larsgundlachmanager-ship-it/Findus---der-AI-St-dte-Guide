/**
 * Multi-Faktor-Ranking für Pitch-Kandidaten.
 * Shortlist Top-5 → Speak Top-2 (Favorit + Alternative).
 *
 * Mit Call-1-criteria/weights: Kriterien steuern den Score (keine Venue-Namen).
 * Ohne Call-1-Gewichte: Legacy-Formel (Evidence, Wish, Rating, Nähe, Preis, Offen).
 */

import type {
  PitchCall1Criterion,
  PitchCandidate,
  PitchRequest,
  PitchWish,
} from './types';
import { isStructuralCriterionKey, criterionAliasKeys } from './call1Criteria';

export type RankedCandidate = {
  c: PitchCandidate;
  score: number;
  factors: {
    evidence: number;
    wish: number;
    rating: number;
    proximity: number;
    price: number;
    open: number;
    call1: number;
  };
};

const SHORTLIST_N = 5;

function candidateBlob(c: PitchCandidate): string {
  return `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')}`
    .toLowerCase();
}

function wishSoftScore(c: PitchCandidate, wishes: PitchWish[]): number {
  const blob = candidateBlob(c);
  let s = 0;
  const weighted = wishes.some((w) => typeof w.weight === 'number');
  for (const w of wishes) {
    const wt = w.text.toLowerCase();
    if (!wt) continue;
    const negRe = new RegExp(
      `\\b(ohne|kein|keine|no|without)\\s+[\\wäöü]*${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i',
    );
    if (negRe.test(blob)) continue;
    const evidenceHit = (c.hardEvidence ?? []).some((e) =>
      e.toLowerCase().includes(wt),
    );
    const full = evidenceHit || blob.includes(wt);
    const parts = wt.split(/\s+/).filter((p) => p.length >= 3);
    const partial = !full && parts.some((p) => blob.includes(p));
    if (!full && !partial) continue;
    if (weighted && typeof w.weight === 'number') {
      // Hard-Evidence zählt voll; nur Name/Tag etwas weniger
      s += evidenceHit ? w.weight : full ? w.weight * 0.85 : w.weight * 0.45;
    } else {
      s += w.hardness === 'must' ? (full ? 4 : 2) : full ? 2 : 1;
    }
  }
  return s;
}

function call1CriteriaBonus(
  c: PitchCandidate,
  criteria: PitchCall1Criterion[],
): number {
  if (!criteria.length) return 0;
  const blob = candidateBlob(c);
  let bonus = 0;
  for (const cr of criteria) {
    const key = cr.key.toLowerCase();
    if (!key) continue;
    if (isStructuralCriterionKey(key)) {
      if (/\b(naehe|nähe|nahe|gps|anker|proximity|fuss|fu[sß]|spaziergang|walk|distanz)\b/i.test(key)) {
        const dist = c.distFromAnchorM ?? 40_000;
        const proxNorm = Math.max(0, Math.min(1, 1 - dist / 5_000));
        bonus += cr.weight * proxNorm;
        continue;
      }
      if (/\b(offen|open|abend_offen|besuchszeit)\b/i.test(key)) {
        if (c.openNow === true) bonus += cr.weight;
        else if (c.openNow === false || c.closedOnVisitDay === true) {
          bonus -= cr.weight * 1.5;
        }
        continue;
      }
      continue;
    }
    // „ohne Terrasse“ / „no pool“ zählt nicht als Treffer
    const negRe = new RegExp(
      `\\b(ohne|kein|keine|no|without)\\s+[\\wäöü]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i',
    );
    if (negRe.test(blob)) {
      if (cr.role === 'must') bonus -= Math.min(12, cr.weight * 0.4);
      continue;
    }
    const aliases = criterionAliasKeys(key);
    const evidenceHit = (c.hardEvidence ?? []).some((e) => {
      const el = e.toLowerCase();
      return aliases.some((a) => el.includes(a));
    });
    const softHit =
      !evidenceHit &&
      (aliases.some(
        (a) =>
          (c.softTags ?? []).some((t) => t.toLowerCase().includes(a)) ||
          blob.includes(a),
      ));
    if (evidenceHit) {
      bonus += cr.role === 'must' ? cr.weight * 1.25 : cr.weight;
    } else if (softHit) {
      bonus += cr.weight * (cr.role === 'must' ? 0.85 : 0.7);
    } else if (cr.role === 'must') {
      bonus -= Math.min(10, cr.weight * 0.35);
    }
  }
  return bonus;
}

/**
 * Score: größer = besser. Call-1-Gewichte dominieren wenn gesetzt.
 */
export function scoreCandidateForUser(
  c: PitchCandidate,
  req: PitchRequest,
): RankedCandidate {
  const wishes = req.wishes ?? [];
  const criteria = req.call1Criteria ?? [];
  const hasCall1Weights =
    criteria.length > 0 || wishes.some((w) => typeof w.weight === 'number');

  const evidenceN = Math.min(4, (c.hardEvidence ?? []).length);
  // Mit Call-1-Auftrag: Evidence leichter, Kriterien tragen
  const evidence = evidenceN * (hasCall1Weights ? 10 : 25);
  const wishRaw = wishSoftScore(c, wishes);
  const wish = hasCall1Weights ? wishRaw : wishRaw * 8;
  const call1 = call1CriteriaBonus(c, criteria);

  const rating = c.rating ?? 0;
  const reviewW = Math.log10(Math.max(10, c.ratingCount ?? 10));
  const ratingPart = rating * (hasCall1Weights ? 3 : 6) * reviewW;

  const dist = c.distFromAnchorM ?? 40_000;
  // 0 m → +20, 5 km → ~0, weiter negativ
  let proximity = Math.max(-30, 20 - dist / 250);
  const proxCrit = criteria.find((cr) =>
    isStructuralCriterionKey(cr.key) &&
    /\b(naehe|nähe|nahe|gps|fuss|fu[sß]|spaziergang|walk)\b/i.test(cr.key),
  );
  if (proxCrit) {
    // Nähe schon in call1 — Legacy-Proximity dämpfen
    proximity *= 0.35;
  }

  let price = 0;
  const cheapAsk =
    req.prefs.budgetHint === 'günstig' ||
    /\b(günstig|guenstig|billig|preiswert)\b/i.test(
      `${req.title} ${req.context}`,
    );
  if (cheapAsk && c.priceTotalEur != null && c.priceTotalEur > 0) {
    price = Math.max(-10, 18 - c.priceTotalEur / 3);
  } else if (c.priceTotalEur != null && c.priceTotalEur > 0) {
    price = 2;
  }

  const closed = c.openNow === false || c.closedOnVisitDay === true;
  const open = closed ? -200 : c.openNow === true ? 12 : 0;

  const detour = (c.detourPrio ?? 6) <= 2 ? 8 : (c.detourPrio ?? 6) <= 4 ? 3 : 0;

  const score =
    evidence + wish + call1 + ratingPart + proximity + price + open + detour;

  return {
    c,
    score,
    factors: {
      evidence,
      wish,
      rating: ratingPart,
      proximity,
      price,
      open,
      call1,
    },
  };
}

/** Sortiert absteigend nach Gesamtscore. */
export function rankCandidatesForUser(
  req: PitchRequest,
  pool: PitchCandidate[],
): RankedCandidate[] {
  return pool
    .map((c) => scoreCandidateForUser(c, req))
    .sort((a, b) => b.score - a.score);
}

/** Top-N Shortlist (Default 5). */
export function shortlistTopN(
  req: PitchRequest,
  pool: PitchCandidate[],
  n = SHORTLIST_N,
): PitchCandidate[] {
  const size = req.shortlistSize ?? n;
  return rankCandidatesForUser(req, pool)
    .slice(0, Math.max(1, Math.min(5, size)))
    .map((r) => r.c);
}

export const PITCH_SHORTLIST_SIZE = SHORTLIST_N;
