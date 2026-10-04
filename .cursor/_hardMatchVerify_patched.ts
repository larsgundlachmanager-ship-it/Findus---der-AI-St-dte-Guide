/**
 * Hard-Match Verify — Must-Wünsche (Gericht/Amenity) nur mit Beleg behalten.
 * Länger recherchieren ok: lieber 2 perfekte Optionen als schnelle Fakes.
 */

import type { PitchCandidate, PitchRequest, PitchWish } from './types';
import {
  scoreSpecializedFoodWish,
  specializedFoodNeedles,
  isOppositeDietVenue,
  looksLikeSpokenMeatOrFish,
  looksLikeSpokenVeganOrVeg,
  hasStrongVeganEvidence,
  canonicalCattleBreed,
} from './specializedFoodMatch';
import { inferGastroFacetTags } from './gastroFacetTags';
import { PITCH_SHORTLIST_SIZE } from './candidateRank';
import { rankCandidatesForUser } from './candidateRank';

function blobOf(c: PitchCandidate, extra = ''): string {
  return `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')} ${c.address ?? ''} ${extra}`
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mustWishes(req: PitchRequest): PitchWish[] {
  return req.wishes.filter((w) => {
    if (w.hardness !== 'must') return false;
    // Atmosphäre/Terrasse/View: nie Hard-Wipe — nur Ranking-Boost
    try {
      const { isAtmosphereVibeLabel } = require('./searchBrief') as {
        isAtmosphereVibeLabel: (s: string) => boolean;
      };
      if (w.kind === 'vibe' || isAtmosphereVibeLabel(w.text)) return false;
    } catch {
      if (w.kind === 'vibe') return false;
    }
    return true;
  });
}

function dishNeedles(w: PitchWish): string[] {
  const t = w.text.toLowerCase().replace(/\s+/g, ' ').trim();
  const out = new Set<string>([t]);
  if (/spaghetti/.test(t) && /eis/.test(t)) {
    out.add('spaghetti-eis');
    out.add('spaghettieis');
    out.add('spaghetti eis');
  }
  if (/rucola|ruccola|arugula/.test(t)) {
    out.add('rucola');
    out.add('ruccola');
    out.add('arugula');
    out.add('rucola-pizza');
    out.add('pizza rucola');
  }
  if (/\beis\b/.test(t) || /eisbecher|gelato|ice\s*cream/.test(t)) {
    out.add('eis');
    out.add('gelato');
    out.add('eisdiele');
  }
  for (const n of specializedFoodNeedles(t)) out.add(n);
  return [...out].filter((x) => x.length >= 2);
}

function amenityNeedle(w: PitchWish): RegExp {
  const t = w.text.trim();
  if (/takeaway|mitnehmen|to[-\s]?go/i.test(t)) {
    return /\b(takeaway|take[-\s]?away|to[-\s]?go|mitnehmen|zum\s+mitnehmen|meal_takeaway|delivery|abholen|pizzeria|imbiss)\b/i;
  }
  if (/all_you_can_eat|ayce|buffet|schlemmer/i.test(t)) {
    return /\b(all[\s-]*(?:you|xou|jou|ju|yo|u|iu)[\s-]*can[\s-]*eat|ayce|buffet|schlemmer[\s-]*buffet|unlimited|flatrate|all\s*inclusive\s*essen)\b/i;
  }
  // „Spa oder Sauna“: eines reicht
  if (/spa_or_sauna|spa\s*oder\s*sauna/i.test(t)) {
    return /\b(spa|wellness|sauna|dampfbad|steam|jacuzzi|whirlpool|thermal)\b/i;
  }
  if (/frühstück|fruehstueck|breakfast|brunch/i.test(t)) {
    return /\b(frühstück|fruehstueck|breakfast|brunch|morgenbuffet)\b/i;
  }
  if (/wlan|wifi|wi-?fi|internet/i.test(t)) {
    return /\b(wlan|wifi|wi-?fi|internet|internet_access|free\s+wifi)\b/i;
  }
  if (/steckdose|socket|power_outlet|strom/i.test(t)) {
    return /\b(steckdose|socket|power.?outlet|usb|outlet|strom|laptop)\b/i;
  }
  if (/ruhig|quiet|ruhe/i.test(t)) {
    return /\b(ruhig|quiet|ruhe|arbeitsfreundlich|entspannt)\b/i;
  }
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/blick|view|aussicht/i.test(t)) {
    const stem = t.replace(/blick$/i, '').trim();
    return new RegExp(
      `\\b(${esc}|${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*|aussicht|blick|view)\\b`,
      'i',
    );
  }
  return new RegExp(`\\b${esc}\\b`, 'i');
}

function scoreDishEvidence(blob: string, wish: PitchWish): number {
  const spec = scoreSpecializedFoodWish(blob, wish);
  // Breed: nur harter Rasse-Treffer zählt als Evidence; 1 = Soft-Fail-Familie
  if (canonicalCattleBreed(wish.text)) {
    return spec >= 3 ? spec : 0;
  }
  // 1 = nur Gastro-Kategorie, kein Gericht-Beleg
  if (spec >= 2) return spec;
  const needles = dishNeedles(wish);
  let score = 0;
  for (const n of needles) {
    if (blob.includes(n)) score += n.length >= 8 ? 4 : 2;
  }
  if (score === 0 && /eisdiele|gelater|ice.?cream|parfait/.test(blob)) {
    score = 0;
  }
  return score;
}

function scoreAmenityEvidence(blob: string, wish: PitchWish): number {
  if (/zugrestaurant|speisewagen|dining/.test(wish.text.toLowerCase())) {
    const spec = scoreSpecializedFoodWish(blob, wish);
    if (spec >= 0) return spec;
  }
  if (isAyceWishText(wish.text)) {
    return scoreAyceEvidence(blob);
  }
  return amenityNeedle(wish).test(blob) ? 3 : 0;
}

/** AYCE-Must unabhaengig von kind (Call-1 mapped oft faelschlich -> dish). */
function isAyceWishText(text: string): boolean {
  const t = String(text || '');
  if (/all_you_can_eat|\bayce\b|must_ayce|schlemmer|buffet/i.test(t)) return true;
  try {
    const { looksLikeAyceQuery } = require('./ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    return looksLikeAyceQuery(t);
  } catch {
    return /all[\s_-]*(?:you|xou)[\s_-]*can[\s_-]*eat/i.test(t);
  }
}

function requestLooksLikeAyce(req: PitchRequest): boolean {
  if (req.wishes.some((w) => w.hardness === 'must' && isAyceWishText(w.text))) {
    return true;
  }
  try {
    const { looksLikeAyceQuery } = require('./ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    return looksLikeAyceQuery(`${req.title} ${req.context}`);
  } catch {
    return /all[\s_-]*(?:you|xou)[\s_-]*can[\s_-]*eat|\bayce\b/i.test(
      `${req.title} ${req.context}`,
    );
  }
}

/** AYCE-Härte: „buffet“ allein reicht nicht — sonst Soft-Fill (Rösterei etc.). */
export function scoreAyceEvidence(blob: string): number {
  const b = (blob || '').toLowerCase();
  if (
    /all[\s-]*(?:you|xou|jou|ju|yo|u|iu)[\s-]*can[\s-]*eat|allyoucaneat|\bayce\b|unbegrenzt\s+essen|schlemmer[\s-]*buffet|unlimited\s+(?:buffet|eat|sushi)|flatrate\s+(?:essen|buffet|sushi)|essen\s+so\s+viel/i.test(
      b,
    )
  ) {
    return 4;
  }
  if (
    /\bbuffet\b/i.test(b) &&
    /mongol|grill\s*buffet|hot\s*pot|shabu|running\s*sushi|sushi\s*(?:boot|boat|gürtel|guertel)|asiat|asian|chines|japan|korea|thai|vietnam/i.test(
      b,
    )
  ) {
    return 3;
  }
  // Nacktes „Buffet“ / Frühstücksbuffet = zu schwach für AYCE-Must
  if (/\bbuffet\b/i.test(b)) return 1;
  return 0;
}

function scoreWishEvidence(blob: string, wish: PitchWish): number {
  if (wish.kind === 'venue') {
    try {
      const { venueNameMatches } = require('./namedVenueIntent') as {
        venueNameMatches: (n: string, v: string) => boolean;
      };
      return venueNameMatches(blob, wish.text) ? 4 : 0;
    } catch {
      return blob.includes(wish.text.toLowerCase()) ? 4 : 0;
    }
  }
  if (isAyceWishText(wish.text)) return scoreAyceEvidence(blob);
  if (wish.kind === 'dish') return scoreDishEvidence(blob, wish);
  if (wish.kind === 'amenity' || wish.kind === 'vibe') {
    if (
      /authentisch|heimisch|dorf|homestyle|gemütlich|gemuetlich|traditionell|rustikal|hausgemacht|cozy/i.test(
        wish.text,
      )
    ) {
      // Atmosphäre: Reviews/Editorial — Soft-Beleg, nie leere Shortlist erzwingen
      if (
        /authent|heimisch|homestyle|gemütlich|gemuetlich|cozy|tradition|family|rustikal|hausgemacht|homemade|dorf|ländlich|laendlich/i.test(
          blob,
        )
      ) {
        return 2;
      }
      return 1;
    }
    return scoreAmenityEvidence(blob, wish);
  }
  if (wish.kind === 'cuisine') {
    const t = wish.text.toLowerCase();
    if (/italien|pizza|pasta/.test(t)) {
      try {
        const { isBeachLeisureWithoutPizza, hasPizzaVenueSignal } = require('./pizzaVenueGate') as {
          isBeachLeisureWithoutPizza: (b: string) => boolean;
          hasPizzaVenueSignal: (b: string) => boolean;
        };
        if (isBeachLeisureWithoutPizza(blob)) return 0;
        if (hasPizzaVenueSignal(blob) || blob.includes(t)) return 3;
        if (/pasta|italia/.test(blob)) return 2;
        return 0;
      } catch {
        if (blob.includes(t)) return 3;
        if (/pizza|pasta|italia|trattoria|osteria/.test(blob)) return 2;
        return 0;
      }
    }
    if (/frühstück|fruehstueck|breakfast|brunch/.test(t)) {
      if (/\b(verein|museum|kirche|denkmal|schule)\b/.test(blob)) return 0;
      if (
        /frühstück|fruehstueck|breakfast|brunch|bakery|bäck|baeck|café|cafe|coffee/.test(
          blob,
        )
      ) {
        return 3;
      }
      return 0;
    }
    {
      const spec = scoreSpecializedFoodWish(blob, wish);
      if (spec >= 2) return spec;
      if (spec === 0) return 0;
    }
    if (blob.includes(t)) return 3;
    return 0;
  }
  return 0;
}

async function enrichCandidateEvidence(
  c: PitchCandidate,
  req: PitchRequest,
): Promise<PitchCandidate> {
  try {
    const { fetchPlacePitchDetails } = await import(
      '../../services/navigation/placePitchDetails'
    );
    const details = await fetchPlacePitchDetails({
      query: c.name,
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId ?? undefined,
      signal: req.signal,
      includeAtmosphere: true,
    });
    if (!details) return c;
    const reviewTexts = (details.reviews ?? [])
      .map((r) => String(r.text ?? '').replace(/\s+/g, ' ').trim())
      .filter((x) => x.length >= 12);
    const hooks = [
      details.editorialSummary,
      details.generativeSummary,
      ...reviewTexts.slice(0, 5),
    ]
      .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
      .filter((x) => x.length >= 12)
      .map((x) => (x.length > 280 ? `${x.slice(0, 277)}…` : x))
      .slice(0, 6);
    let softTags = [...(c.softTags ?? [])];
    for (const f of inferGastroFacetTags(
      c.name,
      `${softTags.join(' ')} ${reviewTexts.join(' ')} ${details.editorialSummary ?? ''}`,
    )) {
      if (!softTags.includes(f)) softTags.push(f);
    }

    // Gericht-Wunsch: Review-Snippets als hardEvidence (Rucola/Steak/…)
    const dishMusts = mustWishes(req).filter((w) => w.kind === 'dish');
    const dishEvidence: string[] = [...(c.hardEvidence ?? [])];
    for (const w of dishMusts) {
      const needles = dishNeedles(w);
      for (const r of reviewTexts) {
        const low = r.toLowerCase();
        const hit = needles.find((n) => low.includes(n));
        if (!hit) continue;
        const praise =
          /\b(lecker|beste|beste[nr]?|perfekt|mega|hammer|empfehl|empfehle|riesig|groß|gross|steinofen|frisch|kruste|knusprig|genial|wunderbar|top)\b/iu.test(
            r,
          );
        // Nie mittendrin mit „…“ anschneiden — Chip bleibt lesbar (max ~2 Zeilen).
        const label = praise
          ? `${w.text}: gelobt`
          : `${w.text} in Reviews`;
        if (!dishEvidence.some((e) => e.toLowerCase().includes(hit))) {
          dishEvidence.push(label.slice(0, 48));
        }
        if (dishEvidence.length >= 6) break;
      }
    }

    const next: PitchCandidate = {
      ...c,
      softTags,
      hookNotes: [...(c.hookNotes ?? []), ...hooks].slice(0, 8),
      hardEvidence: dishEvidence.slice(0, 6),
      websiteUrl: c.websiteUrl || details.websiteUri || null,
      rating: c.rating ?? details.rating,
      ratingCount: c.ratingCount ?? details.ratingCount,
    };
    return next;
  } catch {
    return c;
  }
}

/**
 * Prüft die besten Kandidaten gegen Must-Wishes; behält nur Belegte.
 * Ranking danach: Belegstärke → Preis → Bewertung → Nähe.
 */
export async function verifyHardMatches(opts: {
  req: PitchRequest;
  candidates: PitchCandidate[];
}): Promise<{
  top: PitchCandidate[];
  shortlist?: PitchCandidate[];
  softFail: boolean;
  reason?: string;
  /** Cascade: was erfüllt / soft-miss — für Call-2 Ehrlichkeit */
  criteriaChecklist?: Array<{
    key: string;
    label: string;
    status: string;
    remaining: number;
  }>;
}> {
  const musts = mustWishes(opts.req).filter(
    (w) =>
      w.kind === 'dish' ||
      w.kind === 'amenity' ||
      w.kind === 'vibe' ||
      w.kind === 'cuisine',
  );
  const n = opts.req.shortlistSize ?? PITCH_SHORTLIST_SIZE;
  const pool = opts.candidates.slice(0, 12);
  if (!pool.length) {
    return {
      top: [],
      shortlist: [],
      softFail: true,
      reason: 'Keine passenden Orte gefunden.',
    };
  }
  if (!musts.length) {
    const ranked = rankCandidatesForUser(opts.req, pool).map((r) => r.c);
    const shortlist = ranked.slice(0, n);
    return { top: shortlist, shortlist, softFail: false };
  }

  // Hotels: Stay22 hat Amenities schon hart gefiltert — nur anreichern/ranken
  if (opts.req.kind === 'hotel') {
    const scored = pool.map((c) => {
      const blob = blobOf(c);
      let score = 0;
      const evidence: string[] = [...(c.hardEvidence ?? [])];
      for (const w of musts) {
        const s = scoreWishEvidence(blob, w);
        score += s;
        if (s > 0 && !evidence.some((e) => e.toLowerCase() === w.text.toLowerCase())) {
          const label = String(w.text || '').trim();
          // Nie interne Facet-Keys in Speech/Bullets
          if (label && !/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/u.test(label)) {
            evidence.push(label);
          } else if (label.includes('_')) {
            const last = label.split('_').pop();
            if (last && last.length >= 3) {
              evidence.push(last.charAt(0).toUpperCase() + last.slice(1));
            }
          }
        }
      }
      return {
        c: { ...c, hardEvidence: evidence.length ? evidence : c.hardEvidence },
        score,
      };
    });
    const hard = scored.filter((s) =>
      musts.every((w) => scoreWishEvidence(blobOf(s.c), w) > 0),
    );
    const use = (hard.length ? hard : []).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const pa = a.c.priceTotalEur ?? 1e9;
      const pb = b.c.priceTotalEur ?? 1e9;
      if (pa !== pb) return pa - pb;
      return (b.c.rating ?? 0) - (a.c.rating ?? 0);
    });
    if (!use.length) {
      const labels = musts.map((w) => w.text).join(', ');
      return {
        top: [],
        shortlist: [],
        softFail: true,
        reason: `Kein Hotel mit belegt: ${labels}.`,
      };
    }
    const shortlist = use.map((x) => x.c).slice(0, n);
    return { top: shortlist, shortlist, softFail: false };
  }

  // Food/Bar/etc.: Details nachziehen, dann hart filtern
  const enriched = await Promise.all(
    pool.map((c) => enrichCandidateEvidence(c, opts.req)),
  );

  // Optional: Menü/Preise für Gericht- oder Küchen-Wunsch (nicht erfinden)
  const priceMusts = musts.filter((w) => w.kind === 'dish' || w.kind === 'cuisine' || w.kind === 'venue');
  if (priceMusts.length && (opts.req.kind === 'food' || opts.req.kind === 'bar')) {
    try {
      const { runGastroMenuDeepResearch } = await import(
        '../agents/gastroMenuDeepResearch'
      );
      const dishBit = priceMusts.map((w) => w.text).join(' ');
      const res = await runGastroMenuDeepResearch({
        userText: `${opts.req.title} ${opts.req.context} Speisekarte ${dishBit} Preis`,
        venues: enriched.slice(0, 6).map((c) => ({
          name: c.name,
          websiteUrl: c.websiteUrl ?? null,
          menuUrl: null,
        })),
        alreadySaid: '',
      });
      const draft = String(res.draftText ?? '');
      for (const c of enriched) {
        const nameHit = draft.toLowerCase().includes(c.name.toLowerCase().slice(0, 12));
        if (!nameHit && !draft.toLowerCase().includes(c.name.toLowerCase().slice(0, 6))) {
          continue;
        }
        const priceRe = new RegExp(
          `${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]{0,100}?(\\d+[.,]\\d{2}\\s*€|\\d+\\s*€)`,
          'i',
        );
        const pm =
          draft.match(priceRe) ||
          draft.match(
            new RegExp(
              `${dishBit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]{0,40}?(\\d+[.,]\\d{2}\\s*€|\\d+\\s*€)`,
              'i',
            ),
          );
        if (pm?.[1]) {
          // Ein Preis-Stichpunkt — kein paralleles „Menü: Gericht“
          c.dishPriceHint = `${dishBit}: ${pm[1]}`.replace(/\s+/g, ' ');
          const n = Number(
            String(pm[1]).replace(/[^\d.,]/g, '').replace(',', '.'),
          );
          if (Number.isFinite(n) && n > 0) {
            c.priceTotalEur = c.priceTotalEur ?? n;
          }
        }
        c.hookNotes = [...(c.hookNotes ?? []), draft.slice(0, 220)].slice(0, 6);
        for (const w of priceMusts) {
          if (scoreDishEvidence(draft.toLowerCase(), w) >= 2) {
            // Nur wenn kein Preis-Hint — sonst doppelte Gericht-Stichpunkte
            if (!c.dishPriceHint) {
              c.hardEvidence = [
                ...(c.hardEvidence ?? []),
                w.text,
              ].slice(0, 6);
            }
          }
        }
      }
    } catch {
      /* soft — Details reichen manchmal */
    }
  }

  // Cascade: Dish → View → Outdoor → offen → Rating → Budget (Checkliste)
  let cascadeHonesty: string | null = null;
  let cascadeChecklist: Array<{
    key: string;
    label: string;
    status: string;
    remaining: number;
  }> = [];
  let cascadePool = enriched;
  if (opts.req.kind === 'food' || opts.req.kind === 'bar') {
    try {
      const { applyCriteriaCascade } = require('./criteriaCascade') as {
        applyCriteriaCascade: (
          req: PitchRequest,
          pool: PitchCandidate[],
        ) => {
          pool: PitchCandidate[];
          perfectPool: PitchCandidate[];
          checklist: typeof cascadeChecklist;
          honestyLine: string | null;
          relaxedLabels: string[];
        };
      };
      const cascaded = applyCriteriaCascade(opts.req, enriched);
      cascadeChecklist = cascaded.checklist;
      cascadeHonesty = cascaded.honestyLine;
      if (cascaded.pool.length >= 1) {
        cascadePool = cascaded.pool;
      }
      // Nur eine Perfect-Option + Soft gelockert → softFail mit ehrlicher Nachfrage
      if (
        cascaded.perfectPool.length === 1 ||
        cascaded.relaxedLabels.length > 0
      ) {
        cascadeHonesty =
          cascaded.honestyLine ||
          'Nicht alles perfekt belegt — Option ehrlich pitchen und nachfragen.';
      }
    } catch {
      /* soft */
    }
  }

  const scored = cascadePool.map((c) => {
    const blob = blobOf(c);
    let score = 0;
    const evidence = [...(c.hardEvidence ?? [])];
    let allMust = true;
    for (const w of musts) {
      const s = scoreWishEvidence(blob, w);
      // AYCE: Score ≥2 (asiatisches Buffet+); nacktes „Buffet“=1 reicht nicht
      const min =
        isAyceWishText(w.text)
        ? 2
          : (w.kind === 'cuisine' || w.kind === 'dish') &&
              /vegan|vegetar/i.test(w.text)
            ? 3
            : 1;
      if (s < min) allMust = false;
      score += s;
      if (s > 0) {
        const label = String(w.text || '').trim();
        if (label && !/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/u.test(label)) {
          evidence.push(label);
        } else if (label.includes('_')) {
          const last = label.split('_').pop();
          if (last && last.length >= 3) {
            evidence.push(last.charAt(0).toUpperCase() + last.slice(1));
          }
        }
      }
    }
    // Preis/Rating/Distanz als Tie-Breaker.
    // city_best (Metro-Datensatz): Nähe zum Stadtzentrum, nicht GPS-Heimat bestrafen.
    const priceBias =
      c.dishPriceHint || c.priceTotalEur != null ? 1.5 : 0;
    const ratingBias = (c.rating ?? 0) * 0.4;
    const distM = c.distFromAnchorM ?? 5000;
    const cityBest = opts.req.searchMode === 'city_best';
    const distBias = cityBest
      ? Math.max(0, 6 - distM / 2500)
      : Math.max(0, 8 - distM / 1500) + (distM < 10_000 ? 2 : 0);
    return {
      c: { ...c, hardEvidence: [...new Set(evidence)].slice(0, 6) },
      score: score + priceBias + ratingBias + distBias,
      allMust,
    };
  });

  const hard = scored.filter((s) => s.allMust).sort((a, b) => b.score - a.score);
  const diversify = (list: typeof scored) => {
    const out: typeof scored = [];
    for (const s of list) {
      const dup = out.some((o) => {
        if (o.c.placeId && s.c.placeId && o.c.placeId === s.c.placeId) return true;
        const na = o.c.name.toLowerCase().replace(/\s+/g, ' ').trim();
        const nb = s.c.name.toLowerCase().replace(/\s+/g, ' ').trim();
        if (na && nb && (na === nb || na.includes(nb) || nb.includes(na))) return true;
        const dlat = Math.abs((o.c.lat ?? 0) - (s.c.lat ?? 0));
        const dlng = Math.abs((o.c.lng ?? 0) - (s.c.lng ?? 0));
        // ~100 m bei DE-Breite
        if (dlat < 0.0009 && dlng < 0.0013) return true;
        return false;
      });
      if (!dup) out.push(s);
    }
    return out;
  };
  if (hard.length >= 1) {
    const distinct = diversify(hard);
    return {
      top: distinct.map((x) => x.c).slice(0, n),
      shortlist: distinct.map((x) => x.c).slice(0, n),
      softFail:
        distinct.length < 2 ||
        cascadeChecklist.some(
          (s) =>
            (s.status === 'soft_miss' || s.status === 'only_one') &&
            !/^(open_at_visit|rating_floor|budget)$/i.test(s.key),
        ),
      reason:
        cascadeHonesty ||
        (distinct.length < 2
          ? 'Nur eine Option mit klarem Beleg für deinen Wunsch — passt das, oder weiter suchen?'
          : undefined),
      criteriaChecklist: cascadeChecklist.length ? cascadeChecklist : undefined,
    };
  }

  const labels = musts.map((w) => w.text).join(', ');
  if (musts.some((w) => w.kind === 'venue')) {
    return {
      top: [],
      softFail: true,
      reason: 'Genannten Ort nicht belegt — ich ersetze ihn nicht durch Nearby.',
      criteriaChecklist: cascadeChecklist.length ? cascadeChecklist : undefined,
    };
  }
  if (
    (opts.req.kind === 'food' || opts.req.kind === 'bar') &&
    scored.length
  ) {
    const mustFood = musts
      .filter((w) => w.kind === 'dish' || w.kind === 'cuisine')
      .map((w) => w.text)
      .join(' ');
    const wishBlob = mustFood || `${opts.req.title} ${opts.req.context}`;
    let live = [...scored];
    const ayceMust = requestLooksLikeAyce(opts.req);
    // AYCE: nie Soft-Fill mit Rösterei/Café — nur Belege ≥2 oder ehrlich leer
    if (ayceMust) {
      const ayceFamily = live.filter((s) => scoreAyceEvidence(blobOf(s.c)) >= 2);
      if (!ayceFamily.length) {
        return {
          top: [],
          softFail: true,
          reason:
            'Kein belegtes All-you-can-eat / Buffet hier — nächste größere Stadt und Web weiter prüfen, keine normalen Restaurants als Ersatz.',
          criteriaChecklist: cascadeChecklist.length ? cascadeChecklist : undefined,
        };
      }
      live = ayceFamily;
    } else if (looksLikeSpokenMeatOrFish(wishBlob) || looksLikeSpokenVeganOrVeg(wishBlob)) {
      const veganMust = looksLikeSpokenVeganOrVeg(wishBlob);
      // score ≥ 2 = echter Gericht-/Specialty-Beleg; 1 = nur Fisch-/Fleisch-Familie
      let family = live.filter((s) =>
        musts.some(
          (w) =>
            (w.kind === 'dish' || w.kind === 'cuisine') &&
            scoreSpecializedFoodWish(blobOf(s.c), w) >= 2,
        ),
      );
      if (veganMust) {
        family = family.filter(
          (s) =>
            hasStrongVeganEvidence(blobOf(s.c)) &&
            !isOppositeDietVenue(blobOf(s.c), wishBlob),
        );
      }
      // Keine Familie → ehrlich leer (Steak ≠ Top-Döner nach Rating)
      if (!family.length) {
        return {
          top: [],
          softFail: true,
          reason: `Dazu finde ich gerade keinen belegten Treffer für „${labels}“.`,
          criteriaChecklist: cascadeChecklist.length ? cascadeChecklist : undefined,
        };
      }
      live = family.filter((s) => !isOppositeDietVenue(blobOf(s.c), wishBlob));
      if (veganMust) {
        live = live.filter(
          (s) =>
            hasStrongVeganEvidence(blobOf(s.c)) &&
            musts.some(
              (w) =>
                (w.kind === 'dish' || w.kind === 'cuisine') &&
                scoreSpecializedFoodWish(blobOf(s.c), w) >= 3,
            ),
        );
      }
    }
    // Nähe: bei here_now lokale Treffer bevorzugen; city_best = Score/Rating im Metro-Anker
    const cityBest = opts.req.searchMode === 'city_best';
    live.sort((a, b) => {
      if (!cityBest) {
        const da = a.c.distFromAnchorM ?? 99_000;
        const db = b.c.distFromAnchorM ?? 99_000;
        const nearA = da < 12_000 ? 1 : 0;
        const nearB = db < 12_000 ? 1 : 0;
        if (nearA !== nearB) return nearB - nearA;
      }
      if (b.score !== a.score) return b.score - a.score;
      const da = a.c.distFromAnchorM ?? 99_000;
      const db = b.c.distFromAnchorM ?? 99_000;
      if (da !== db) return da - db;
      return (b.c.rating ?? 0) - (a.c.rating ?? 0);
    });
    if (!live.length) {
      return {
        top: [],
        softFail: true,
        reason: `Dazu finde ich gerade keinen belegten Treffer für „${labels}“.`,
        criteriaChecklist: cascadeChecklist.length ? cascadeChecklist : undefined,
      };
    }
    const distinctLive = diversify(live);
    return {
      top: distinctLive.map((x) => x.c).slice(0, n),
      shortlist: distinctLive.map((x) => x.c).slice(0, n),
      softFail: true,
      reason:
        cascadeHonesty ||
        `Kein klarer Beleg für „${labels}“ im Namen — Live-Suche, stärkste Treffer.`,
      criteriaChecklist: cascadeChecklist.length ? cascadeChecklist : undefined,
    };
  }
  return {
    top: [],
    softFail: true,
    reason: `Dazu finde ich gerade keinen belegten Treffer für „${labels}“.`,
    criteriaChecklist: cascadeChecklist.length ? cascadeChecklist : undefined,
  };
}
