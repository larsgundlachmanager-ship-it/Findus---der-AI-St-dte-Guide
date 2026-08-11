/**
 * Filter + Rank: open_at visitAt, Soft-Dish, Soft-Fail + Out-of-box, immer ≤2.
 */

import { closingTimeAllowsStay } from '../../services/concierge/closingHours';
import type { PitchCandidate, PitchRequest, PitchWish } from './types';
import { isWegweiserOrApproachName } from './candidatePool';

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
  const deltaMs = Math.abs(req.visitAtMs - Date.now());
  // Bis ~3h: „jetzt / heute Abend noch“ — geschlossen raus
  const nearNow =
    deltaMs < 3 * 60 * 60_000 || req.searchMode === 'here_now';
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
    if (
      /italien|pizza|pasta|trattoria|osteria/.test(wt) &&
      /pizza|pasta|italia|trattoria|osteria|restaurant|\bfood\b/.test(blob)
    ) {
      return /pizza|pizzeria|italia|trattoria|osteria/.test(blob) ? 3 : 2;
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
  if (isWegweiserOrApproachName(c.name, (c.softTags ?? []).join(' '))) {
    return false;
  }
  const blob = `${c.name} ${(c.softTags ?? []).join(' ')}`.toLowerCase();
  for (const a of req.prefs.avoidCategories ?? []) {
    if (blob.includes(a.toLowerCase())) return false;
  }
  return kindFitsCandidate(c, req);
}

/** Hard: Pizza-Pitch nie mit Friseur etc. füllen */
function kindFitsCandidate(c: PitchCandidate, req: PitchRequest): boolean {
  const blob = `${c.name} ${(c.softTags ?? []).join(' ')} ${c.address ?? ''}`.toLowerCase();
  if (
    /coiffeur|friseur|frisör|frisoer|hair|nagelstudio|physiother|zahnarzt|apotheke|büro|buero|verwaltung|supermarkt|aldi|lidl/.test(
      blob,
    )
  ) {
    return req.kind !== 'food' && req.kind !== 'bar' && req.kind !== 'hotel';
  }
  if (req.kind === 'food' || req.kind === 'bar') {
    const wishBlob = `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`.toLowerCase();
    // Event-Locations / reine Veranstaltungsorte sind kein Frühstück/Snack
    if (
      /event\s*location|eventlocation|veranstaltungsort|hochzeitssaal|konferenzzentrum|tagungszentrum/.test(
        blob,
      ) &&
      !/restaurant|café|cafe|bistro|frühstück|fruehstueck|imbiss/.test(blob)
    ) {
      return false;
    }
    // Pizza-Wunsch: Bäcker reicht nicht; Places-Hits tragen oft nur softTag „food“
    if (/pizza/.test(wishBlob)) {
      if (/bäck|baeck|bakery|brot/.test(blob) && !/pizza|pizzeria/.test(blob)) {
        return false;
      }
      return /pizza|pizzeria|trattoria|osteria|italia|restaurant|\bfood\b/.test(
        blob,
      );
    }
    // Spät-Snacks: Bäckerei/Café tagsüber oft zu — Imbiss/Döner/Spätkauf bevorzugen
    if (
      /\b(snack|snacks|spät|spaet|döner|doener|kebab|imbiss)\b/.test(wishBlob) ||
      (req.searchMode === 'here_now' &&
        new Date(req.visitAtMs).getHours() >= 20)
    ) {
      if (
        /bäck|baeck|bakery|brotchen|brötchen|konditor/.test(blob) &&
        !/imbiss|döner|doener|kebab|spät|spaet|24\s*h|open\s*late|nacht/.test(
          blob,
        )
      ) {
        // nur behalten wenn openNow explizit true
        if (c.openNow !== true) return false;
      }
    }
    // Frühstück: reine Biergärten/Bars ohne Café-Signal raus
    if (/frühstück|fruehstueck|breakfast/.test(wishBlob)) {
      if (
        /biergarten|weinbar|cocktailbar|nachtclub|disco/.test(blob) &&
        !/café|cafe|frühstück|fruehstueck|breakfast|bistro|restaurant|bäck|baeck/.test(
          blob,
        )
      ) {
        return false;
      }
    }
    return /food|restaurant|pizza|pasta|café|cafe|imbiss|trattoria|osteria|bistro|gastro|bar|pub|biergarten|grill|burger|sushi|griech|döner|doener|kebab|snack/.test(
      blob,
    );
  }
  if (req.kind === 'hotel') {
    return /hotel|pension|hostel|airbnb|unterkunft/.test(blob);
  }
  if (req.kind === 'cinema') {
    return /kino|cinema|filmtheater/.test(blob);
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
    // Soft-fail: nur kind-passende Alternativen — nie Friseur für Pizza
    const fallback = [...pool]
      .filter((p) => fitsVisit(p, req) && prefsOk(p, req))
      .sort((a, b) => rankKey(a) - rankKey(b));
    if (fallback.length === 0) {
      return {
        top: [],
        softFail: true,
        outOfBox: null,
        reason:
          'In der Nähe nichts Passendes gefunden — sag Ort/Stadtteil oder wir suchen weiter.',
      };
    }
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
    const alt = rest.find((p) => !sameBrandFamily(open[0]!.name, p.name)) ?? rest[0];
    return {
      top: alt ? [open[0]!, alt] : [open[0]!],
      softFail: !alt,
      outOfBox: rest.find((p) => p !== alt) ?? null,
      reason: alt
        ? undefined
        : 'Nur eine klare Option — Alternative unsicher.',
    };
  }

  const first = open[0]!;
  const second =
    open.slice(1).find((c) => !sameBrandFamily(first.name, c.name)) ?? open[1]!;
  return {
    top: [first, second].filter(Boolean).slice(0, 2),
    softFail: false,
    outOfBox: open.find((c) => c !== first && c !== second) ?? null,
  };
}

/** „Goldhütchen Event“ + „Goldhütchen Biergarten“ = dieselbe Marke → zweite Option diversifizieren */
function sameBrandFamily(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-zäöüß0-9\s]/gi, ' ')
      .replace(/\b(event|location|wein|biergarten|restaurant|café|cafe|bar|hotel)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tokA = na.split(' ').filter((t) => t.length >= 4);
  const tokB = new Set(nb.split(' ').filter((t) => t.length >= 4));
  if (tokA.length === 0) return false;
  const hit = tokA.filter((t) => tokB.has(t)).length;
  return hit >= 1 && hit >= Math.min(tokA.length, 2);
}
