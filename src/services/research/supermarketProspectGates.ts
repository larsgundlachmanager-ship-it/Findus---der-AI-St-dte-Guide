/**
 * Supermarkt-Prospekt — reine Gates (Query / Hollow-URL).
 * Keine Gemini-/Maps-/RN-Deps — für Smoke-Tests und Research.
 */

export const SUPERMARKET_CHAIN_PATTERNS: Array<{
  id: string;
  re: RegExp;
  query: string;
}> = [
  { id: 'rewe', re: /\brewe\b/iu, query: 'REWE' },
  { id: 'aldi', re: /\baldi(?:\s*süd|\s*sued|\s*nord)?\b/iu, query: 'Aldi' },
  { id: 'lidl', re: /\blidl\b/iu, query: 'Lidl' },
  { id: 'edeka', re: /\bedeka\b/iu, query: 'Edeka' },
  { id: 'kaufland', re: /\bkaufland\b/iu, query: 'Kaufland' },
  { id: 'netto', re: /\bnetto\b/iu, query: 'Netto' },
  { id: 'penny', re: /\bpenny\b/iu, query: 'Penny' },
  { id: 'norma', re: /\bnorma\b/iu, query: 'Norma' },
  { id: 'marktkauf', re: /\bmarktkauf\b/iu, query: 'Marktkauf' },
  { id: 'real', re: /\breal\b/iu, query: 'Real' },
];

const OFFER_SIGNAL_RE =
  /\b(angebot|angebote|aktionspreis|aktion|prospekt|wochenprospekt|handzettel|werbebeilage|reduziert|im\s+sonderangebot|sonderpreis|was\s+(?:ist|gibt'?s|gibt\s+es)\s+(?:gerade\s+)?(?:im\s+)?angebot|welches?.{0,40}angebot|günstig(?:er)?\s+(?:zu\s+haben|im\s+markt)|irgendwo\s+(?:im\s+)?angebot|im\s+angebot\s+(?:hier|irgendwo)|haben\s+wollen|brauchen\s+wir)\b/iu;

/** Produkt-Lexikon nur als Erkennung — nie Speech-Pflicht. */
const PRODUCTISH_RE =
  /\b(bier(?:preis(?:e)?)?|pils|weizen|helles|cola|wasser|milch|butter|käse|kaese|joghurt|brot|eier|kaffee|schokolade|chips|nudeln|pasta|reis|fleisch|wurst|hack|hähnchen|haehnchen|pizza|eis|wein|sekt|spirituosen|waschmittel|klopapier|toilettenpapier|shampoo|sahne|quark|apfelsaft|orangensaft|olivenöl|olivenoel|tomaten|gurke|bananen?|äpfel|aepfel)\b/giu;

function hasProductish(t: string): boolean {
  PRODUCTISH_RE.lastIndex = 0;
  return PRODUCTISH_RE.test(t);
}

/** User fragt nach aktuellen Supermarkt-Angeboten / Prospekt. */
export function isSupermarketOfferQuery(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  OFFER_SIGNAL_RE.lastIndex = 0;
  if (OFFER_SIGNAL_RE.test(t)) {
    if (SUPERMARKET_CHAIN_PATTERNS.some((c) => c.re.test(t))) return true;
    if (hasProductish(t)) return true;
    if (
      /\b(supermarkt|discounter|markt|einkauf|hier\s+im\s+laden|hier\s+im\s+markt|irgendwo|in\s+der\s+nähe|in\s+der\s+naehe)\b/iu.test(
        t,
      )
    ) {
      return true;
    }
    if (
      /\b(?:was|welche[srn]?|gibt'?s|gibt\s+es|ist\s+(?:das|es)|haben\s+wir).{0,40}\bangebot/iu.test(
        t,
      ) ||
      /\bprospekt\b/iu.test(t) ||
      /\b(?:wollen|brauchen)\s+(?:wir|noch).{0,40}\b(?:angebot|günstig|guenstig)/iu.test(
        t,
      )
    ) {
      return true;
    }
  }
  if (
    SUPERMARKET_CHAIN_PATTERNS.some((c) => c.re.test(t)) &&
    hasProductish(t) &&
    /\b(preis(?:e)?|kostet|günstig|guenstig|billig|aktion)\b/iu.test(t)
  ) {
    return true;
  }
  // „Bierpreise im Supermarkt“ / Produkt + Preis + Markt — ohne Wort „Angebot“
  if (
    (hasProductish(t) || /\b\w+preis(?:e)?\b/iu.test(t)) &&
    /\b(\w*preis(?:e)?|kostet|kosten|günstig|guenstig|billig)\b/iu.test(t) &&
    /\b(supermarkt|discounter|markt|einkauf|prospekt|aldi|lidl|rewe|edeka|penny|netto|kaufland|norma)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(wollen|brauchen|haben\s+wollen)\b/iu.test(t) &&
    /\b(angebot|prospekt|günstig|guenstig)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

export function extractSupermarketOfferHints(text: string): {
  productHint: string | null;
  productHints: string[];
  chainHint: string | null;
  cityHint: string | null;
} {
  const t = text.replace(/\s+/g, ' ').trim();
  let chainHint: string | null = null;
  for (const c of SUPERMARKET_CHAIN_PATTERNS) {
    if (c.re.test(t)) {
      chainHint = c.query;
      break;
    }
  }

  let cityHint: string | null = null;
  const cityM = t.match(
    /\b(?:in|bei|nahe)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})?)/u,
  );
  if (
    cityM?.[1] &&
    !/Angebot|Prospekt|Supermarkt|Aldi|Lidl|Rewe|Edeka/i.test(cityM[1])
  ) {
    cityHint = cityM[1].trim();
  }

  const productHints: string[] = [];
  const seen = new Set<string>();
  PRODUCTISH_RE.lastIndex = 0;
  for (const m of t.matchAll(PRODUCTISH_RE)) {
    let p = (m[0] || '').trim().toLowerCase();
    p = p.replace(/preis(?:e)?$/u, '').trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    productHints.push(p);
  }
  if (!productHints.length) {
    const list = t.match(
      /\b(?:wollen|brauchen|haben\s+wollen)\s+(?:wir\s+)?(?:noch\s+)?(.+?)(?:\s*[,—–-]?\s*(?:ist\s+das|irgendwo|im\s+angebot|angeboten)\b|$)/iu,
    );
    if (list?.[1]) {
      const parts = list[1]
        .split(/\s+(?:und|sowie|,)\s+/iu)
        .map((x) =>
          x.replace(/^(eine?|einen|ein|noch|mal|das|die|den)\s+/iu, '').trim(),
        )
        .filter(
          (x) => x.length >= 2 && x.length <= 32 && !/angebot|prospekt/i.test(x),
        );
      for (const p of parts.slice(0, 4)) {
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        productHints.push(p);
      }
    }
  }
  if (!productHints.length) {
    const which = t.match(
      /\b(?:welches?|welche|was\s+für(?:\s+ein(?:e|en)?)?)\s+([a-zäöüß][\wäöüß-]{2,28})\b/iu,
    );
    if (
      which?.[1] &&
      !/angebot|prospekt|supermarkt|laden|markt/i.test(which[1])
    ) {
      productHints.push(which[1].trim());
    }
  }

  return {
    productHint: productHints[0] ?? null,
    productHints,
    chainHint,
    cityHint,
  };
}

/**
 * Ketten-/Portal-Homepage ohne Prospekt-/Produkt-Pfad = flach
 * (analog Speisekarte/Spielplan).
 */
export function isHollowProspectUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return true;
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const blob = `${host}${path}${u.search}`;
    if (
      /\b(prospekt|flyer|leaflet|handzettel|werbebeilage|wochenangebot|aktuelle[-_]?angebote|angebote?|angebot|produkt|product|sku|artikel|brochure)\b/i.test(
        blob,
      )
    ) {
      return false;
    }
    if (/\.pdf(\?|$)/i.test(url)) return false;
    const flyerPortal =
      /\b(kaufda|meinprospekt|marktjagd|prospektangebote|offered\.by|wochenprospekt)\b/i.test(
        host,
      );
    if (flyerPortal && path !== '/' && path !== '') return false;
    if (
      path === '/' ||
      path === '' ||
      /^\/(de|en|home|index|start)(\/|$)/i.test(path)
    ) {
      return true;
    }
    const retail =
      /^(rewe|aldi-sued|aldi-nord|aldi|lidl|edeka|kaufland|penny|netto-online|netto|norma|marktkauf)\./i.test(
        host,
      ) ||
      /\.(rewe|lidl|aldi|edeka|kaufland|penny|netto)\.(de|at|ch)$/i.test(host);
    if (retail) {
      const depth = path.split('/').filter(Boolean).length;
      if (depth <= 1 && !/angebot|prospekt|flyer|produkt/i.test(path)) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function usableProspectUrl(raw: string | null): string | null {
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  if (isHollowProspectUrl(raw)) return null;
  return raw;
}

export function detectChainFromName(name: string): string | null {
  for (const c of SUPERMARKET_CHAIN_PATTERNS) {
    if (c.re.test(name)) return c.query;
  }
  return null;
}
