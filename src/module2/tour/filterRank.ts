/**
 * Filter + Rank für Tour-Kandidaten.
 */

import type { TourCandidate, TourRequest } from './types';

function blobOf(c: TourCandidate): string {
  return `${c.name} ${c.category} ${c.tags.join(' ')}`.toLowerCase();
}

function themeHit(c: TourCandidate, themes: string[]): boolean {
  if (!themes.length) return true;
  const b = blobOf(c);
  return themes.some((t) => b.includes(t.toLowerCase()));
}

function avoidHit(c: TourCandidate, avoid: string[]): boolean {
  if (!avoid.length) return false;
  const b = blobOf(c);
  return avoid.some((a) => b.includes(a.toLowerCase()));
}

function baseSightScore(c: TourCandidate): number {
  const b = blobOf(c);
  let s = 1;
  if (/denkmal|museum|kirche|schloss|rathaus|platz|markt|histor|hafen|aussicht|turm|promenade|strand/.test(b)) {
    s += 8;
  }
  if (/park|natur|brücke|bruecke|teich|see/.test(b)) s += 5;
  if (/sport|schule|feuerwehr|gewerbe/.test(b)) s -= 3;
  // Services / Alltag ≠ Sightseeing-Tour
  if (
    /coiffeur|friseur|frisör|frisoer|hair|nagelstudio|physiother|arzt|zahn|apotheke|bäcker|baecker|supermarkt|aldi|lidl|tankstelle|büro|buero|verwaltung/.test(
      b,
    )
  ) {
    s -= 12;
  }
  // Nähe belohnen
  s += Math.max(0, 4 - c.distanceM / 800);
  return s;
}

export function filterAndRankCandidates(
  req: TourRequest,
  pool: TourCandidate[],
): TourCandidate[] {
  const themes = req.categoryMust.length
    ? req.categoryMust
    : req.themeFilters;
  const avoid = [
    ...(req.categoryAvoid ?? []),
    ...(req.prefs.avoidCategories ?? []),
  ];

  let list = pool.filter((c) => !avoidHit(c, avoid));
  // Hard drop: Dienstleister/Shops nicht als Tour-Stops
  list = list.filter(
    (c) =>
      !/coiffeur|friseur|frisör|frisoer|hairdresser|nagelstudio|physiother|zahnarzt|arztpraxis|apotheke|supermarkt|aldi|lidl|tankstelle/.test(
        blobOf(c),
      ),
  );
  if (themes.length) {
    const themed = list.filter((c) => themeHit(c, themes));
    if (themed.length >= 2) list = themed;
  }

  const ranked = list
    .map((c) => {
      let score = baseSightScore(c);
      let priority: TourCandidate['priority'] = 'soft';
      if (themes.length && themeHit(c, themes)) {
        score += 6;
        priority = 'high';
      }
      if (/must|highlight|wahrzeichen|ikon/i.test(blobOf(c))) {
        score += 4;
        priority = 'must';
      }
      if (req.prefs.loveCategories?.some((l) => blobOf(c).includes(l))) {
        score += 5;
        priority = priority === 'soft' ? 'high' : priority;
      }
      return { ...c, score, priority };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.distanceM - b.distanceM;
    });

  return ranked;
}
