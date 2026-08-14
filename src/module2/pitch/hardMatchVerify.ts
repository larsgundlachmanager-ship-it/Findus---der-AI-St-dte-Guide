/**
 * Hard-Match Verify — Must-Wünsche (Gericht/Amenity) nur mit Beleg behalten.
 * Länger recherchieren ok: lieber 2 perfekte Optionen als schnelle Fakes.
 */

import type { PitchCandidate, PitchRequest, PitchWish } from './types';

function blobOf(c: PitchCandidate, extra = ''): string {
  return `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')} ${c.address ?? ''} ${extra}`
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mustWishes(req: PitchRequest): PitchWish[] {
  return req.wishes.filter((w) => w.hardness === 'must');
}

function dishNeedles(w: PitchWish): string[] {
  const t = w.text.toLowerCase().replace(/\s+/g, ' ').trim();
  const out = new Set<string>([t]);
  if (/spaghetti/.test(t) && /eis/.test(t)) {
    out.add('spaghetti-eis');
    out.add('spaghettieis');
    out.add('spaghetti eis');
  }
  if (/\beis\b/.test(t) || /eisbecher|gelato|ice\s*cream/.test(t)) {
    out.add('eis');
    out.add('gelato');
    out.add('eisdiele');
  }
  return [...out].filter((x) => x.length >= 2);
}

function amenityNeedle(w: PitchWish): RegExp {
  const t = w.text.trim();
  if (/takeaway|mitnehmen|to[-\s]?go/i.test(t)) {
    return /\b(takeaway|take[-\s]?away|to[-\s]?go|mitnehmen|zum\s+mitnehmen|meal_takeaway|delivery|abholen|pizzeria|imbiss)\b/i;
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
  const needles = dishNeedles(wish);
  let score = 0;
  for (const n of needles) {
    if (blob.includes(n)) score += n.length >= 8 ? 4 : 2;
  }
  // Kategorie-Signal allein reicht nicht für Gericht-Must
  if (score === 0 && /eisdiele|gelater|ice.?cream|parfait/.test(blob)) {
    score = 0;
  }
  return score;
}

function scoreAmenityEvidence(blob: string, wish: PitchWish): number {
  return amenityNeedle(wish).test(blob) ? 3 : 0;
}

function scoreWishEvidence(blob: string, wish: PitchWish): number {
  if (wish.kind === 'dish') return scoreDishEvidence(blob, wish);
  if (wish.kind === 'amenity' || wish.kind === 'vibe') {
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
    if (blob.includes(t)) return 3;
    return 0;
  }
  return blob.includes(wish.text.toLowerCase()) ? 1 : 0;
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
    const hooks = [
      details.editorialSummary,
      details.generativeSummary,
      ...(details.reviews ?? []).slice(0, 3).map((r) => r.text),
    ]
      .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
      .filter((x) => x.length >= 16 && x.length <= 280)
      .slice(0, 4);
    const next: PitchCandidate = {
      ...c,
      hookNotes: [...(c.hookNotes ?? []), ...hooks].slice(0, 6),
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
  softFail: boolean;
  reason?: string;
}> {
  const musts = mustWishes(opts.req).filter(
    (w) =>
      w.kind === 'dish' ||
      w.kind === 'amenity' ||
      w.kind === 'vibe' ||
      w.kind === 'cuisine',
  );
  const pool = opts.candidates.slice(0, 10);
  if (!pool.length) {
    return {
      top: [],
      softFail: true,
      reason: 'Keine passenden Orte gefunden.',
    };
  }
  if (!musts.length) {
    return { top: pool.slice(0, 2), softFail: false };
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
          evidence.push(w.text);
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
        softFail: true,
        reason: `Kein Hotel mit belegt: ${labels}.`,
      };
    }
    return { top: use.map((x) => x.c).slice(0, 2), softFail: false };
  }

  // Food/Bar/etc.: Details nachziehen, dann hart filtern
  const enriched = await Promise.all(
    pool.map((c) => enrichCandidateEvidence(c, opts.req)),
  );

  // Optional: Menü-Deep nur für Dish-Musts (teuer, aber präzise)
  const dishMusts = musts.filter((w) => w.kind === 'dish');
  if (dishMusts.length && (opts.req.kind === 'food' || opts.req.kind === 'bar')) {
    try {
      const { runGastroMenuDeepResearch } = await import(
        '../agents/gastroMenuDeepResearch'
      );
      const dishBit = dishMusts.map((w) => w.text).join(' ');
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
          c.dishPriceHint = `${dishBit} ~${pm[1]}`;
          const n = Number(
            String(pm[1]).replace(/[^\d.,]/g, '').replace(',', '.'),
          );
          if (Number.isFinite(n) && n > 0) {
            c.priceTotalEur = c.priceTotalEur ?? n;
          }
        }
        c.hookNotes = [...(c.hookNotes ?? []), draft.slice(0, 220)].slice(0, 6);
        for (const w of dishMusts) {
          if (scoreDishEvidence(draft.toLowerCase(), w) > 0) {
            c.hardEvidence = [
              ...(c.hardEvidence ?? []),
              `Menü: ${w.text}`,
            ].slice(0, 6);
          }
        }
      }
    } catch {
      /* soft — Details reichen manchmal */
    }
  }

  const scored = enriched.map((c) => {
    const blob = blobOf(c);
    let score = 0;
    const evidence = [...(c.hardEvidence ?? [])];
    let allMust = true;
    for (const w of musts) {
      const s = scoreWishEvidence(blob, w);
      if (s <= 0) allMust = false;
      score += s;
      if (s > 0) evidence.push(w.text);
    }
    // Preis/Rating/Distanz als Tie-Breaker (niedriger dist besser)
    const priceBias =
      c.dishPriceHint || c.priceTotalEur != null ? 1.5 : 0;
    const ratingBias = (c.rating ?? 0) * 0.4;
    const distBias = Math.max(0, 3 - (c.distFromAnchorM ?? 5000) / 2000);
    return {
      c: { ...c, hardEvidence: [...new Set(evidence)].slice(0, 6) },
      score: score + priceBias + ratingBias + distBias,
      allMust,
    };
  });

  const hard = scored.filter((s) => s.allMust).sort((a, b) => b.score - a.score);
  if (hard.length >= 1) {
    return {
      top: hard.map((x) => x.c).slice(0, 2),
      softFail: hard.length < 2,
      reason:
        hard.length < 2
          ? 'Nur eine Option mit klarem Beleg für deinen Wunsch.'
          : undefined,
    };
  }

  const labels = musts.map((w) => w.text).join(', ');
  return {
    top: [],
    softFail: true,
    reason: `Nichts mit Beleg für „${labels}“ gefunden — ich pitche keine Fake-Treffer.`,
  };
}
