/**
 * Filter + Rank: open_at visitAt, Hard-Wishes, Multi-Faktor-Score → Shortlist 5 → Speak Top-2.
 * Dish-/Amenity-Beleg-Finale läuft in hardMatchVerify (runPitchModule).
 */

import { placeFitsPlanVisit } from '../agents/placeHoursFit';
import type { PitchCandidate, PitchRequest, PitchWish } from './types';
import {
  isGroceryOrMarketCounterVenue,
  isParkingOrForestLotVenue,
  isWegweiserOrApproachName,
} from './nonFoodVenueGate';
import { scoreSpecializedFoodWish, isOppositeDietVenue } from './specializedFoodMatch';
import { namedVenueFromWishes, venueNameMatches } from './namedVenueIntent';
import {
  PITCH_SHORTLIST_SIZE,
  rankCandidatesForUser,
} from './candidateRank';

/** Vorläufig Top-N für Hard-Verify (Belege / Menü / Amenities). */
export function filterAndRankPool(
  req: PitchRequest,
  pool: PitchCandidate[],
  limit = 8,
): RankOutcome {
  const full = filterAndRank(req, pool);
  if (full.top.length === 0) return full;
  let visitFiltered = pool.filter((c) => prefsOk(c, req) && fitsVisit(c, req));
  if (!visitFiltered.length && (req.kind === 'food' || req.kind === 'bar')) {
    // Nur wirklich zu (nicht: offen, aber zu knapp bis zur Schließung)
    visitFiltered = pool.filter(
      (c) =>
        prefsOk(c, req) &&
        (c.openNow === false || c.closedOnVisitDay === true),
    );
  }
  const musts = req.wishes.filter((w) => w.hardness === 'must');
  const scored = visitFiltered.map((c) => {
    let wishScore = 0;
    for (const w of req.wishes) wishScore += softMatchWish(c, w);
    return { c, wishScore };
  });
  let open = scored.map((s) => s.c);
  const namedVenuePool = namedVenueFromWishes(musts);
  const hardKinds = namedVenuePool
    ? musts.filter((w) => w.kind === 'venue')
    : musts.filter(
        (w) =>
          w.kind === 'cuisine' ||
          w.kind === 'amenity' ||
          w.kind === 'dish' ||
          w.kind === 'vibe',
      );
  if (hardKinds.length) {
    const hard = scored.filter((s) =>
      hardKinds.every((w) => {
        const part = softMatchWish(s.c, w);
        return w.kind === 'dish' ? part >= 1 : part >= 2;
      }),
    );
    if (hard.length) open = hard.map((s) => s.c);
    else if (namedVenuePool) {
      open = [];
    } else if (
      musts.some(
        (w) =>
          w.kind === 'dish' ||
          w.kind === 'amenity' ||
          w.kind === 'vibe' ||
          w.kind === 'cuisine',
      )
    ) {
      const family = scored.filter((s) =>
        hardKinds.some((w) => softMatchWish(s.c, w) >= 1),
      );
      open =
        req.kind === 'food' || req.kind === 'bar'
          ? (family.length ? family : scored).map((s) => s.c)
          : [];
    }
  }
  const rankKey = (c: PitchCandidate) => {
    const prio = c.detourPrio ?? 6;
    const rating = c.rating ?? 0;
    const dist = c.distFromAnchorM ?? 99_000;
    const specialized = req.wishes.some(
      (w) =>
        w.hardness === 'must' &&
        (w.kind === 'dish' || w.kind === 'cuisine'),
    );
    const ratingW =
      specialized || req.searchMode === 'city_best' ? 8000 : 1000;
    const reviewW = Math.log10(Math.max(10, c.ratingCount ?? 10));
    return prio * 1_000_000 - rating * ratingW * reviewW + dist / 100;
  };
  open = [...open].sort((a, b) => rankKey(a) - rankKey(b));
  if (!open.length) return full;
  return {
    top: open.slice(0, Math.max(limit, 2)),
    softFail: full.softFail,
    outOfBox: full.outOfBox,
    reason: full.reason,
  };
}

function defaultStayMin(req: PitchRequest): number {
  if (req.stayMin != null) return req.stayMin;
  if (req.kind === 'food') return 75;
  if (req.kind === 'sight') return 90;
  return 45;
}

/** open_at Zielzeit inkl. opensAt / closed day. */
function fitsVisit(c: PitchCandidate, req: PitchRequest): boolean {
  if (req.kind === 'hotel' || c.source === 'stay22') return true;
  const stayMin = defaultStayMin(req);
  if (c.closedOnVisitDay === true) return false;
  // Geschlossen laut Live-Hours und Besuch bald (nicht erst nach Mitternacht raten)
  const deltaMs = Math.abs(req.visitAtMs - Date.now());
  if (
    c.openNow === false &&
    (req.searchMode === 'here_now' || deltaMs < 18 * 60 * 60_000) &&
    c.opensAtMin == null
  ) {
    return false;
  }
  return placeFitsPlanVisit(
    {
      openNow: c.openNow === false ? false : true,
      opensAtMin: c.opensAtMin ?? null,
      closesAtMin: c.closesAtMin ?? null,
    },
    {
      arriveAtMs: req.visitAtMs,
      stayMin,
      title: req.title,
      category: req.kind,
    },
  );
}

function softMatchWish(c: PitchCandidate, w: PitchWish): number {
  if (w.kind === 'venue') {
    return venueNameMatches(c.name, w.text) ? 4 : 0;
  }
  const blob = `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')} ${c.address ?? ''}`.toLowerCase();
  const wt = w.text.toLowerCase();
  if (blob.includes(wt)) return w.hardness === 'must' ? 3 : 2;
  // cuisine heuristics
  if (w.kind === 'cuisine') {
    if (/italien|pizza|pasta|trattoria|osteria/.test(wt)) {
      try {
        const { isBeachLeisureWithoutPizza, hasPizzaVenueSignal } = require('./pizzaVenueGate') as {
          isBeachLeisureWithoutPizza: (b: string) => boolean;
          hasPizzaVenueSignal: (b: string) => boolean;
        };
        if (isBeachLeisureWithoutPizza(blob)) return 0;
        if (hasPizzaVenueSignal(blob)) return 3;
        if (/pasta|italia/.test(blob)) return 2;
        return 0;
      } catch {
        return /pizza|pizzeria|italia|trattoria|osteria/.test(blob) ? 3 : 0;
      }
    }
    if (/griech/.test(wt) && /griech|gyro|souvlaki|hellas/.test(blob)) return 2;
    {
      const spec = scoreSpecializedFoodWish(blob, w);
      if (spec >= 0) return spec;
    }
  }
  if (w.kind === 'amenity' && /takeaway|mitnehmen|to[-\s]?go/.test(wt)) {
    try {
      const { hasTakeawaySignal } = require('./pizzaVenueGate') as {
        hasTakeawaySignal: (b: string) => boolean;
      };
      return hasTakeawaySignal(blob) ? 3 : 0;
    } catch {
      return /takeaway|mitnehmen|to[-\s]?go|meal_takeaway/.test(blob) ? 3 : 0;
    }
  }
  if (w.kind === 'amenity' && /zugrestaurant|speisewagen|dining/.test(wt)) {
    const spec = scoreSpecializedFoodWish(blob, w);
    if (spec >= 0) return spec;
  }
  if (w.kind === 'dish') {
    if (/spaghetti/.test(wt) && /eis/.test(wt)) {
      if (/spaghetti[- ]?eis|spaghettieis/.test(blob)) return 4;
      // Kategorie allein = kein Beleg
      return /eisdiele|gelater|eiscafe|eiscafé/.test(blob) ? 1 : 0;
    }
    if (/\beis\b|gelato|ice\s*cream|eisbecher/.test(wt)) {
      if (/eisdiele|gelater|eiscafe|eiscafé|\beis\b/.test(blob)) return 2;
      return 0;
    }
    {
      const spec = scoreSpecializedFoodWish(blob, w);
      if (spec >= 0) return spec;
    }
    if (blob.includes(wt)) return 3;
    return 0;
  }
  if (w.kind === 'amenity' || w.kind === 'vibe') {
    if (blob.includes(wt)) return 3;
    if (/blick|view|aussicht/.test(wt) && /blick|view|aussicht/.test(blob)) {
      return 2;
    }
    if (
      /authentisch|heimisch|dorf|homestyle|gemütlich|gemuetlich|traditionell|rustikal|hausgemacht|cozy/.test(
        wt,
      )
    ) {
      if (
        /authent|heimisch|homestyle|gemütlich|gemuetlich|cozy|tradition|family|rustikal|hausgemacht|homemade|dorf|ländlich|laendlich/.test(
          blob,
        )
      ) {
        return 2;
      }
      return 1;
    }
    return 0;
  }
  return 0;
}

function prefsOk(c: PitchCandidate, req: PitchRequest): boolean {
  if (isWegweiserOrApproachName(c.name, (c.softTags ?? []).join(' '))) {
    return false;
  }
  if (
    (req.kind === 'food' || req.kind === 'bar') &&
    isParkingOrForestLotVenue(c.name, [...(c.softTags ?? []), c.address ?? ''].join(' '))
  ) {
    return false;
  }
  if (
    (req.kind === 'food' || req.kind === 'bar') &&
    isGroceryOrMarketCounterVenue(c.name, [...(c.softTags ?? []), c.address ?? ''])
  ) {
    return false;
  }
  const blob = `${c.name} ${(c.softTags ?? []).join(' ')}`.toLowerCase();
  const mustFood = req.wishes
    .filter((w) => w.hardness === 'must' && (w.kind === 'dish' || w.kind === 'cuisine'))
    .map((w) => w.text)
    .join(' ');
  const wishBlob = mustFood || `${req.title} ${req.context}`;
  if (
    !namedVenueFromWishes(req.wishes) &&
    isOppositeDietVenue(
      `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')}`,
      wishBlob,
    )
  ) {
    return false;
  }
  for (const a of req.prefs.avoidCategories ?? []) {
    if (blob.includes(a.toLowerCase())) return false;
  }
  return kindFitsCandidate(c, req);
}

/** Hard: Pizza-Pitch nie mit Friseur etc. füllen */
function isDinnerOrEveningMeal(req: PitchRequest): boolean {
  const wishBlob =
    `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`.toLowerCase();
  const hour = new Date(req.visitAtMs).getHours();
  return (
    hour >= 17 ||
    /\b(abend|dinner|tonight|abendessen|abendessen|spätessen|spaetessen)\b/.test(
      wishBlob,
    )
  );
}

function isBakeryOnlyBlob(blob: string): boolean {
  return (
    /\b(bäck|baeck|bakery|backstube|bäckerei|baeckerei|konditor|brotladen|brötchen|broetchen)\b/.test(
      blob,
    ) &&
    !/\b(restaurant|bistro|trattoria|osteria|pizzeria|imbiss|bar|pub|abend)\b/.test(
      blob,
    )
  );
}

function isInfraLandmarkName(name: string, blob: string): boolean {
  const n = `${name} ${blob}`.toLowerCase();
  if (
    /(wald)?parkplatz|parkhaus|p\+r\b|park.?and.?ride|parking[_ -]?lot/.test(n) &&
    !/restaurant|gasthof|wirtshaus|hotel|café|cafe|bistro/.test(n)
  ) {
    return true;
  }
  return /\b(brücke|bruecke|bridge|eisenbahn|bahnübergang|bahnuebergang|viadukt|haltestelle|bushaltestelle|bahnhof|route|highway|railway|denkmal|aussichtspunkt|spielplatz)\b/.test(
    n,
  );
}

function kindFitsCandidate(c: PitchCandidate, req: PitchRequest): boolean {
  const namedVenue = namedVenueFromWishes(req.wishes);
  if (namedVenue && venueNameMatches(c.name, namedVenue)) {
    return true;
  }
  const blob = `${c.name} ${(c.softTags ?? []).join(' ')} ${c.address ?? ''}`.toLowerCase();
  if (
    /coiffeur|friseur|frisör|frisoer|hair|nagelstudio|physiother|zahnarzt|apotheke|büro|buero|verwaltung|supermarkt|aldi|lidl|marktkauf|kaufland|edeka|penny|netto|frischecenter|allwörden|allwoerden/.test(
      blob,
    )
  ) {
    return req.kind !== 'food' && req.kind !== 'bar' && req.kind !== 'hotel';
  }
  if (req.kind === 'food' || req.kind === 'bar') {
    const wishBlob = `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`.toLowerCase();
    // Infrastruktur / Landmarken nie als Essen — auch nicht mit Fake-Tag „food“
    if (
      isInfraLandmarkName(c.name, blob) &&
      !/\b(restaurant|café|cafe|bistro|imbiss|trattoria|osteria|pizzeria)\b/.test(
        c.name.toLowerCase(),
      )
    ) {
      return false;
    }
    // Keine Parks/Brücken/Gemeindehäuser/Sehenswürdigkeiten als Essen
    if (
      /\b(park|brücke|bruecke|bridge|denkmal|memorial|aussichtspunkt|viewpoint|tourist_attraction|route|highway|railway|gemeindezentrum|gemeindehaus|rathaus|kirche|church|bahnhof|haltestelle)\b/i.test(
        blob,
      ) &&
      !/restaurant|café|cafe|bistro|imbiss|bakery|bäck|baeck|bar|pub|food|meal/.test(
        blob,
      )
    ) {
      return false;
    }
    // Abendessen: reine Bäckerei/Backstube raus
    if (isDinnerOrEveningMeal(req) && isBakeryOnlyBlob(blob)) {
      return false;
    }
    // Event-Locations / reine Veranstaltungsorte sind kein Frühstück/Snack
    if (
      /event\s*location|eventlocation|veranstaltungsort|hochzeitssaal|konferenzzentrum|tagungszentrum/.test(
        blob,
      ) &&
      !/restaurant|café|cafe|bistro|frühstück|fruehstueck|imbiss/.test(blob)
    ) {
      return false;
    }
    // Pizza-Wunsch: echtes Pizza-/Italien-Signal — kein Strandbad/Beach-Bar/Food-Tag allein
    if (/pizza/.test(wishBlob)) {
      if (/bäck|baeck|bakery|brot/.test(blob) && !/pizza|pizzeria/.test(blob)) {
        return false;
      }
      try {
        const { isCrediblePizzaVenue } = require('./pizzaVenueGate') as {
          isCrediblePizzaVenue: (b: string) => boolean;
        };
        return isCrediblePizzaVenue(blob);
      } catch {
        return /pizza|pizzeria|trattoria|osteria|italia/.test(blob);
      }
    }
    // Eis / Spaghetti-Eis: nur Eisdielen/Cafés mit Eis-Signal
    // Wichtig: \beis\b — sonst matcht „Fleisch“ falsch
    if (/\beis\b|gelato|ice\s*cream|spaghetti/.test(wishBlob)) {
      return /\beis\b|gelat|ice.?cream|parfait|eisdiele|eiscafé|eiscafe|café|cafe|konditor|süß|suess/.test(
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
      try {
        const { isProductionOnlyBakery } = require('../agents/localDiningCatalog') as {
          isProductionOnlyBakery: (n: string, t?: string | null) => boolean;
        };
        if (isProductionOnlyBakery(c.name, blob)) return false;
      } catch {
        /* soft */
      }
      if (
        /biergarten|weinbar|cocktailbar|nachtclub|disco/.test(blob) &&
        !/café|cafe|frühstück|fruehstueck|breakfast|bistro|restaurant|bäck|baeck/.test(
          blob,
        )
      ) {
        return false;
      }
    }
    // Abendessen: echtes Gastro-Lokal — Küchenwort allein reicht nicht (Asia-Regal im Markt)
    if (isDinnerOrEveningMeal(req)) {
      return /\b(restaurant|pizza|pasta|trattoria|osteria|bistro|gastro|imbiss|burger|sushi|döner|doener|kebab|grill|steak|wirtshaus|gasthof|brasserie|steakhouse|ramen|tapas|vietnames|thailänd|thailaend|chinesisch|japanisch|koreanisch|indisch|griech)\b/.test(
        blob,
      );
    }
    return /food|restaurant|pizza|pasta|café|cafe|imbiss|trattoria|osteria|bistro|gastro|bar|pub|biergarten|grill|burger|sushi|griech|döner|doener|kebab|snack/.test(
      blob,
    );
  }
  if (req.kind === 'hotel') {
    if (c.source === 'stay22' || (c.softTags ?? []).includes('hotel')) {
      return true;
    }
    return /hotel|pension|hostel|airbnb|unterkunft/.test(blob);
  }
  if (req.kind === 'cinema') {
    return /kino|cinema|filmtheater/.test(blob);
  }
  if (req.kind === 'sight') {
    const wish = `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`;
    try {
      const { looksLikePicnicQuery, isPicnicUnsuitableVenue } = require('./picnicIntent') as {
        looksLikePicnicQuery: (s: string) => boolean;
        isPicnicUnsuitableVenue: (n: string, e?: string | string[] | null) => boolean;
      };
      if (looksLikePicnicQuery(wish) && isPicnicUnsuitableVenue(c.name, blob)) {
        return false;
      }
    } catch {
      /* soft */
    }
  }
  return true;
}

function pickDiningOutOfBox(
  c: PitchCandidate | null | undefined,
): PitchCandidate | null {
  if (!c) return null;
  if (isGroceryOrMarketCounterVenue(c.name, c.softTags ?? [])) return null;
  return c;
}

export type RankOutcome = {
  top: PitchCandidate[];
  /** Volle Shortlist (bis 5) nach Multi-Faktor-Ranking — Speak nutzt top */
  shortlist?: PitchCandidate[];
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

  let wishSoftFail = false;
  let allClosedNow = false;
  let open = pool.filter((c) => {
    if (!prefsOk(c, req)) return false;
    return fitsVisit(c, req);
  });
  if (open.length === 0 && (req.kind === 'food' || req.kind === 'bar')) {
    const closed = pool.filter((c) => {
      if (!prefsOk(c, req)) return false;
      return c.openNow === false || c.closedOnVisitDay === true;
    });
    if (closed.length) {
      open = closed;
      allClosedNow = true;
    } else {
      open = [];
      wishSoftFail = true;
    }
  }

  // Soft wish boost + Hard must filter (cuisine / amenity / dish / vibe)
  const musts = req.wishes.filter((w) => w.hardness === 'must');
  const namedVenue = namedVenueFromWishes(musts);
  const scored = open.map((c) => {
    let wishScore = 0;
    for (const w of req.wishes) wishScore += softMatchWish(c, w);
    return { c, wishScore };
  });

  const hardKinds = namedVenue
    ? musts.filter((w) => w.kind === 'venue')
    : musts.filter(
        (w) =>
          w.kind === 'cuisine' ||
          w.kind === 'amenity' ||
          w.kind === 'dish' ||
          w.kind === 'vibe',
      );
  if (hardKinds.length) {
    // Cuisine/Amenity/Vibe: Name/Tags-Score reicht als Vorfilter
    // Dish: mind. Kategorie-Signal (Score≥1), Beleg kommt in hardMatchVerify
    const hard = scored.filter((s) => {
      return hardKinds.every((w) => {
        const part = softMatchWish(s.c, w);
        if (w.kind === 'dish') return part >= 1;
        return part >= 2;
      });
    });
    if (hard.length >= 1) {
      open = hard
        .sort((a, b) => b.wishScore - a.wishScore)
        .map((s) => s.c);
    } else if (namedVenue) {
      open = [];
      wishSoftFail = true;
    } else if (musts.some((w) => w.kind === 'dish' || w.kind === 'amenity' || w.kind === 'vibe' || w.kind === 'cuisine')) {
      if (req.kind === 'food' || req.kind === 'bar') {
        const family = scored.filter((s) =>
          hardKinds.some((w) => softMatchWish(s.c, w) >= 1),
        );
        // Must-Filter ohne Familie → leer (kein Rating-Flood mit Döner bei Steak)
        if (!family.length) {
          open = [];
          wishSoftFail = true;
        } else {
          open = family
            .sort((a, b) => b.wishScore - a.wishScore)
            .map((s) => s.c);
          wishSoftFail = true;
        }
      } else {
        open = [];
      }
    } else {
      open = scored
        .sort((a, b) => b.wishScore - a.wishScore)
        .map((s) => s.c);
    }
  } else {
    open = scored
      .sort((a, b) => b.wishScore - a.wishScore)
      .map((s) => s.c);
  }

  const shortlistN = req.shortlistSize ?? PITCH_SHORTLIST_SIZE;
  const speakN = 2;

  const rankKey = (c: PitchCandidate) => {
    // niedriger = besser für legacy Array.sort(a-b) — invertierte Multi-Faktor-Score
    return -rankCandidatesForUser(req, [c])[0]!.score;
  };

  open = rankCandidatesForUser(req, open).map((r) => r.c);

  const cheapAsk =
    req.prefs.budgetHint === 'günstig' ||
    /\b(günstig|guenstig|billig|preiswert|günstigste|guenstigste)\b/i.test(
      `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`,
    );

  if (req.kind === 'hotel' && cheapAsk) {
    open = [...open].sort(
      (a, b) => (a.priceTotalEur ?? 1e9) - (b.priceTotalEur ?? 1e9),
    );
    // Harter Cut: ohne Live-Preis nach hinten, mit Preis nach vorne
    const withPrice = open.filter((c) => c.priceTotalEur != null);
    const without = open.filter((c) => c.priceTotalEur == null);
    if (withPrice.length >= 1) {
      open = [...withPrice, ...without];
    }
  }

  // Gastro: wenn Live-€ aus Menü-Scrape da → günstig nach vorne
  if ((req.kind === 'food' || req.kind === 'bar') && cheapAsk) {
    const priced = open.filter((c) => c.priceTotalEur != null);
    if (priced.length >= 1) {
      open = [
        ...priced.sort(
          (a, b) => (a.priceTotalEur ?? 1e9) - (b.priceTotalEur ?? 1e9),
        ),
        ...open.filter((c) => c.priceTotalEur == null),
      ];
    }
  }

  if (open.length === 0) {
    if (namedVenue) {
      return {
        top: [],
        softFail: true,
        outOfBox: null,
        reason: 'Genannten Ort nicht gefunden — ich ersetze ihn nicht durch Nearby.',
      };
    }
    const hasMustFood = musts.some(
      (w) =>
        w.kind === 'dish' ||
        w.kind === 'amenity' ||
        w.kind === 'vibe' ||
        w.kind === 'cuisine',
    );
    // Must-Filter: keine „irgendeine Gastro“-Flut (Steak ≠ Döner)
    if (hasMustFood) {
      return {
        top: [],
        shortlist: [],
        softFail: true,
        outOfBox: null,
        reason:
          'In der Nähe nichts Passendes gefunden — sag Ort/Stadtteil oder wir suchen weiter.',
      };
    }
    const gastroAlts = [...pool].filter(
      (p) => prefsOk(p, req) && (allClosedNow || fitsVisit(p, req)),
    );
    if ((req.kind === 'food' || req.kind === 'bar') && gastroAlts.length) {
      const alt = rankCandidatesForUser(req, gastroAlts).map((r) => r.c);
      const shortlist = alt.slice(0, shortlistN);
      return {
        top: shortlist.slice(0, speakN),
        shortlist,
        softFail: true,
        outOfBox: pickDiningOutOfBox(shortlist[speakN]),
        reason: allClosedNow
          ? 'Alle Treffer gerade zu — Optionen für morgen.'
          : 'Wunsch nicht hart belegt — ehrliche Alternativen aus der Live-Suche.',
      };
    }
    // Soft-fail: nur kind-passende Alternativen — nie Friseur für Pizza
    const fallback = rankCandidatesForUser(
      req,
      pool.filter((p) => fitsVisit(p, req) && prefsOk(p, req)),
    ).map((r) => r.c);
    if (fallback.length === 0) {
      return {
        top: [],
        shortlist: [],
        softFail: true,
        outOfBox: null,
        reason:
          'In der Nähe nichts Passendes gefunden — sag Ort/Stadtteil oder wir suchen weiter.',
      };
    }
    const shortlist = fallback.slice(0, shortlistN);
    return {
      top: shortlist.slice(0, speakN),
      shortlist,
      softFail: true,
      outOfBox: pickDiningOutOfBox(shortlist[speakN]),
      reason: 'Nichts wirklich Passendes — Alternativen mit besseren Chancen.',
    };
  }

  if (open.length === 1) {
    if (namedVenue) {
      return {
        top: [open[0]!],
        shortlist: [open[0]!],
        softFail: wishSoftFail || allClosedNow,
        outOfBox: null,
        reason: allClosedNow
          ? 'Alle Treffer gerade zu — Optionen für morgen.'
          : undefined,
      };
    }
    const rest = rankCandidatesForUser(
      req,
      pool
        .filter((p) => p.name !== open[0]!.name && fitsVisit(p, req) && prefsOk(p, req))
        .filter((p) => {
          if (!musts.length) return true;
          return musts.every((w) => {
            if (w.kind === 'generic') return true;
            const part = softMatchWish(p, w);
            return w.kind === 'dish' ? part >= 1 : part >= 2;
          });
        }),
    ).map((r) => r.c);
    const alt = rest.find((p) => !sameBrandFamily(open[0]!.name, p.name)) ?? rest[0];
    const top = alt ? [open[0]!, alt] : [open[0]!];
    const shortlist = [open[0]!, ...rest].slice(0, shortlistN);
    return {
      top,
      shortlist,
      softFail: !alt || wishSoftFail || allClosedNow,
      outOfBox: pickDiningOutOfBox(rest.find((p) => p !== alt)),
      reason: allClosedNow
        ? 'Alle Treffer gerade zu — Optionen für morgen.'
        : wishSoftFail
          ? 'Wunsch nicht hart belegt — ehrliche Alternativen aus der Live-Suche.'
          : alt
            ? undefined
            : 'Nur eine klare Option — Alternative unsicher.',
    };
  }

  const first = open[0]!;
  const rest = open.slice(1).filter((c) => !sameBrandFamily(first.name, c.name));
  let second = rest[0] ?? open[1]!;
  // Echtes Ziel weit weg → zweite Karte = nächste Alternative (nicht noch ein Fern-Spot)
  try {
    const { FAR_DEST_M } = require('../router/placeGoQuery') as {
      FAR_DEST_M: number;
    };
    const far = (first.distFromAnchorM ?? 0) >= FAR_DEST_M;
    if (far && rest.length) {
      const nearer = [...rest].sort(
        (a, b) =>
          (a.distFromAnchorM ?? 99_000) - (b.distFromAnchorM ?? 99_000),
      )[0];
      if (
        nearer &&
        (nearer.distFromAnchorM ?? 99_000) + 1500 <
          (first.distFromAnchorM ?? 0)
      ) {
        second = nearer;
      }
    }
  } catch {
    /* soft */
  }
  return {
    top: [first, second].filter(Boolean).slice(0, speakN),
    shortlist: open.slice(0, shortlistN),
    softFail: wishSoftFail || allClosedNow,
    outOfBox: pickDiningOutOfBox(
      open.find((c) => c !== first && c !== second),
    ),
    reason: allClosedNow
      ? 'Alle Treffer gerade zu — Optionen für morgen.'
      : wishSoftFail
        ? 'Wunsch nicht hart belegt — ehrliche Alternativen aus der Live-Suche.'
        : undefined,
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
