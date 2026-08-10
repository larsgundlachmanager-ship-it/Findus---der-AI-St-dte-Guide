/**
 * Filter + Rank: open_at visitAt, Soft-Dish, Soft-Fail + Out-of-box, immer ≤2.
 */

import { closingTimeAllowsStay } from '../../services/concierge/closingHours';
import type { PitchCandidate, PitchRequest, PitchWish } from './types';

function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

function defaultStayMin(req: PitchRequest): number {
  if (req.stayMin != null) return req.stayMin;
  if (req.kind === 'food') return 75;
  if (req.kind === 'sight') return 90;
  return 45;
}

/** Lokal (ohne placeHoursFit/RN-Graph) — open_at Zielzeit. */
function fitsVisit(c: PitchCandidate, req: PitchRequest): boolean {
  const stayMin = defaultStayMin(req);
  const arrivalMin = minutesOfDay(req.visitAtMs);
  const nearNow = Math.abs(req.visitAtMs - Date.now()) < 20 * 60_000;
  if (c.openNow === false && nearNow) return false;
  if (c.closesAtMin != null) {
    return closingTimeAllowsStay(arrivalMin, c.closesAtMin, stayMin);
  }
  return true;
}

function softMatchWish(c: PitchCandidate, w: PitchWish): number {
  const blob = `${c.name} ${(c.softTags ?? []).join(' ')} ${c.address ?? ''}`.toLowerCase();
  const wt = w.text.toLowerCase();
  if (blob.includes(wt)) return w.hardness === 'must' ? 3 : 2;
  // cuisine heuristics
  if (w.kind === 'cuisine') {
    if (/italien|pizza|pasta|trattoria|osteria/.test(wt) && /pizza|pasta|italia|trattoria|osteria/.test(blob)) {
      return 2;
    }
    if (/griech/.test(wt) && /griech|gyro|souvlaki|hellas/.test(blob)) return 2;
  }
  if (w.kind === 'dish') {
    // unsicher → weich 0 (nicht killen)
    return 0;
  }
  return 0;
}

function prefsOk(c: PitchCandidate, req: PitchRequest): boolean {
  const blob = `${c.name}`.toLowerCase();
  for (const a of req.prefs.avoidCategories ?? []) {
    if (blob.includes(a.toLowerCase())) return false;
  }
  return true;
}

export type RankOutcome = {
  top: PitchCandidate[];
  softFail: boolean;
  outOfBox: PitchCandidate | null;
  reason?: string;
};

export function filterAndRank(
  req: PitchRequest,
  pool: PitchCandidate[],
): RankOutcome {
  const visitAt = req.visitAtMs;
  const stayMin = req.stayMin ?? (req.kind === 'food' ? 75 : 45);

  let open = pool.filter((c) => {
    if (!prefsOk(c, req)) return false;
    return fitsVisit(c, req);
  });

  // Soft wish boost
  const musts = req.wishes.filter((w) => w.hardness === 'must');
  const scored = open.map((c) => {
    let wishScore = 0;
    for (const w of req.wishes) wishScore += softMatchWish(c, w);
    return { c, wishScore };
  });

  // Must cuisine: filter wenn mindestens ein Treffer
  if (musts.some((w) => w.kind === 'cuisine' || w.kind === 'amenity')) {
    const hard = scored.filter((s) => s.wishScore >= 2);
    if (hard.length >= 1) {
      open = hard.map((s) => s.c);
    }
  } else {
    open = scored
      .sort((a, b) => b.wishScore - a.wishScore)
      .map((s) => s.c);
  }

  const rankKey = (c: PitchCandidate) => {
    const prio = c.detourPrio ?? 6;
    const rating = c.rating ?? 0;
    const dist = c.distFromAnchorM ?? 99_000;
    // näher schlägt ~0.1 Stern: dist in 100m-Blöcken
    return prio * 1_000_000 - rating * 1000 + dist / 100;
  };

  open = [...open].sort((a, b) => rankKey(a) - rankKey(b));

  if (open.length === 0) {
    // Soft-fail: nimm beste aus Roh-Pool die visit passen (locker Wünsche)
    const fallback = [...pool]
      .filter((p) => fitsVisit(p, req) && prefsOk(p, req))
      .sort((a, b) => rankKey(a) - rankKey(b));
    const alt = fallback.slice(0, 2);
    const oob = fallback[2] ?? null;
    return {
      top: alt,
      softFail: true,
      outOfBox: oob,
      reason: 'Nichts wirklich Passendes — Alternativen mit besseren Chancen.',
    };
  }

  if (open.length === 1) {
    const rest = pool
      .filter((p) => p.name !== open[0]!.name && fitsVisit(p, req) && prefsOk(p, req))
      .sort((a, b) => rankKey(a) - rankKey(b));
    const alt = rest[0];
    return {
      top: alt ? [open[0]!, alt] : [open[0]!],
      softFail: !alt,
      outOfBox: rest[1] ?? null,
      reason: alt
        ? undefined
        : 'Nur eine klare Option — Alternative unsicher.',
    };
  }

  return {
    top: open.slice(0, 2),
    softFail: false,
    outOfBox: open[2] ?? null,
  };
}
