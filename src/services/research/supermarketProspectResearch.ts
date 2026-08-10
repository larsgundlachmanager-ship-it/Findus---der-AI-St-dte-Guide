/**
 * Supermarkt-Prospekt / Wochenangebote — Just-Do-It.
 * Mehrere Produkte, nahe Märkte vergleichen, Preis + Ersparnis + Distanz.
 * Keine Stadt-/Ketten-Scripts als Speech — nur belegte Treffer.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { searchPlacesExpanding } from '../navigation/expandingPlaceSearch';
import {
  searchPlacesByText,
  type DiscoveredPlace,
} from '../navigation/googleMapsNav';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import type { Module2ActionButton } from '../../module2/types';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';

export type SupermarketVenue = {
  name: string;
  chain: string | null;
  lat: number;
  lng: number;
  distanceM: number;
  websiteUri: string | null;
};

export type ProspectOfferHit = {
  productLabel: string;
  priceLabel: string | null;
  /** Normalpreis laut Prospekt, wenn belegt */
  regularPriceLabel: string | null;
  /** z. B. „0,40 € günstiger“ / „−30 %“ — nur belegt */
  savingsLabel: string | null;
  /** z. B. „diese Woche“, „bis Sonntag“ */
  validityLabel: string | null;
  storeLabel: string;
  detail: string | null;
  prospectUrl: string | null;
  /** Distanz zum gematchten nahen Markt, wenn zuordenbar */
  distanceM: number | null;
};

export type SupermarketProspectResult = {
  productHint: string | null;
  productHints: string[];
  chainHint: string | null;
  cityHint: string | null;
  venue: SupermarketVenue | null;
  venues: SupermarketVenue[];
  offers: ProspectOfferHit[];
  promptBlock: string;
  buttons: Module2ActionButton[];
  notes: string;
  offersPending?: boolean;
};

const CHAIN_PATTERNS: Array<{ id: string; re: RegExp; query: string }> = [
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

const PRODUCTISH_RE =
  /\b(bier|pils|weizen|helles|cola|wasser|milch|butter|käse|kaese|joghurt|brot|eier|kaffee|schokolade|chips|nudeln|pasta|reis|fleisch|wurst|hack|hähnchen|haehnchen|pizza|eis|wein|sekt|spirituosen|waschmittel|klopapier|toilettenpapier|shampoo|sahne|quark|apfelsaft|orangensaft|olivenöl|olivenoel|nudeln|tomaten|gurke|bananen?|äpfel|aepfel)\b/giu;

/** User fragt nach aktuellen Supermarkt-Angeboten / Prospekt. */
export function isSupermarketOfferQuery(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (OFFER_SIGNAL_RE.test(t)) {
    if (CHAIN_PATTERNS.some((c) => c.re.test(t))) return true;
    if (PRODUCTISH_RE.test(t)) return true;
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
    CHAIN_PATTERNS.some((c) => c.re.test(t)) &&
    PRODUCTISH_RE.test(t) &&
    /\b(preis|kostet|günstig|guenstig|billig|aktion)\b/iu.test(t)
  ) {
    return true;
  }
  // „Wir wollen Bier und Milch — ist das irgendwo im Angebot?“
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
  for (const c of CHAIN_PATTERNS) {
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
  for (const m of t.matchAll(PRODUCTISH_RE)) {
    const p = (m[0] || '').trim().toLowerCase();
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
        .map((x) => x.replace(/^(eine?|einen|ein|noch|mal|das|die|den)\s+/iu, '').trim())
        .filter((x) => x.length >= 2 && x.length <= 32 && !/angebot|prospekt/i.test(x));
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

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
}

function detectChainFromName(name: string): string | null {
  for (const c of CHAIN_PATTERNS) {
    if (c.re.test(name)) return c.query;
  }
  return null;
}

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toVenue(p: DiscoveredPlace): SupermarketVenue {
  const name = (p.name || 'Supermarkt').trim();
  return {
    name,
    chain: detectChainFromName(name),
    lat: p.lat,
    lng: p.lng,
    distanceM: p.distanceM,
    websiteUri: p.websiteUri?.trim() || null,
  };
}

function navButton(v: SupermarketVenue, i = 0): Module2ActionButton {
  return {
    id: `market_nav_${i}`,
    label: shortenActionLabel(`📍 ${v.name}`),
    payload: {
      kind: 'navigate',
      lat: v.lat,
      lng: v.lng,
      label: v.name,
    },
  };
}

function urlButton(
  id: string,
  label: string,
  url: string,
): Module2ActionButton {
  return {
    id,
    label: shortenActionLabel(label),
    payload: { kind: 'deep_link', url, destName: label },
  };
}

function matchVenueForStore(
  storeLabel: string,
  venues: SupermarketVenue[],
): SupermarketVenue | null {
  const n = storeLabel.toLowerCase();
  for (const v of venues) {
    if (v.name.toLowerCase().includes(n) || n.includes(v.name.toLowerCase().slice(0, 6))) {
      return v;
    }
    if (v.chain && n.includes(v.chain.toLowerCase())) return v;
  }
  return venues[0] ?? null;
}

async function findNearbySupermarkets(opts: {
  lat: number;
  lng: number;
  chainHint: string | null;
  cityHint: string | null;
  signal?: AbortSignal;
}): Promise<SupermarketVenue[]> {
  const keyword = opts.chainHint || 'Supermarkt';
  const expanding = await searchPlacesExpanding({
    lat: opts.lat,
    lng: opts.lng,
    placeType: 'supermarket',
    keyword,
    openNow: false,
    minResults: 2,
    rings: [1_500, 4_000, 10_000, 25_000],
  });

  let candidates = expanding.places.map(toVenue);
  if (opts.chainHint) {
    const chainRe = new RegExp(opts.chainHint, 'i');
    const filtered = candidates.filter(
      (v) => chainRe.test(v.name) || v.chain === opts.chainHint,
    );
    if (filtered.length) candidates = filtered;
  }

  const queries = [
    opts.chainHint && opts.cityHint
      ? `${opts.chainHint} ${opts.cityHint}`
      : null,
    opts.chainHint ? `${opts.chainHint} Supermarkt` : null,
    opts.cityHint ? `Supermarkt ${opts.cityHint}` : null,
    'Aldi',
    'Lidl',
    'REWE',
    'Supermarkt',
  ].filter(Boolean) as string[];
  for (const q of queries) {
    if (opts.signal?.aborted) break;
    try {
      const hits = await searchPlacesByText({
        query: q,
        lat: opts.lat,
        lng: opts.lng,
        radiusM: 25_000,
        includedType: 'supermarket',
      });
      for (const p of hits) {
        const v = toVenue(p);
        if (
          opts.chainHint &&
          !new RegExp(opts.chainHint, 'i').test(v.name) &&
          v.chain !== opts.chainHint
        ) {
          continue;
        }
        candidates.push(v);
      }
    } catch {
      /* soft */
    }
    if (candidates.length >= 8) break;
  }

  const byKey = new Map<string, SupermarketVenue>();
  for (const v of candidates) {
    const key = `${v.name.toLowerCase()}|${v.lat.toFixed(4)}|${v.lng.toFixed(4)}`;
    if (!byKey.has(key)) byKey.set(key, v);
  }
  return [...byKey.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 5);
}

async function researchProspectOffers(opts: {
  userText: string;
  productHints: string[];
  chainHint: string | null;
  cityHint: string | null;
  venues: SupermarketVenue[];
  signal?: AbortSignal;
}): Promise<{ offers: ProspectOfferHit[]; notes: string }> {
  if (!hasGeminiApiKey()) return { offers: [], notes: 'no_gemini' };
  const offline = await isDeviceOffline();
  if (offline) return { offers: [], notes: 'offline' };

  const now = new Date();
  const today = now.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const nearbyList = opts.venues
    .slice(0, 5)
    .map(
      (v) =>
        `${v.name}${v.chain ? ` (${v.chain})` : ''} · ${formatDist(v.distanceM)}`,
    )
    .join('; ');
  const products =
    opts.productHints.length > 0
      ? opts.productHints.join(', ')
      : 'aus der User-Frage ableiten';

  const prompt = [
    'Du recherchierst aktuelle Supermarkt-Wochenangebote / Prospekte (Google Search).',
    `HEUTE: ${today}.`,
    `User: „${opts.userText.trim().slice(0, 320)}“`,
    `Gesuchte Produkte: ${products}.`,
    opts.chainHint ? `Bevorzugte Kette: ${opts.chainHint}.` : '',
    opts.cityHint ? `Ort: ${opts.cityHint}.` : '',
    nearbyList
      ? `Nahe Märkte (GPS): ${nearbyList}`
      : 'Keine GPS-Märkte — regionale Ketten der Umgebung nutzen.',
    '',
    'AUFGABE:',
    '- Prüfe für JEDES gesuchte Produkt, ob es DIESE WOCHE irgendwo in der Nähe im Prospekt ist.',
    '- Wenn ja: welcher Laden/Kette, Angebotspreis, ggf. Normalpreis + Ersparnis (nur wenn im Prospekt/Quelle steht), Packung, Gültigkeit, Prospekt-URL.',
    '- Mehrere Produkte → pro Produkt bester belegter Treffer (gern verschiedene Märkte).',
    '- Quellen: offizielle Prospekte, Marktjagd, Kaufda, MeinProspekt, Filial-Seiten.',
    '- Nicht gefunden → ehrlich, keine Fake-Preise.',
    'VERBOTEN: erfundene Preise/Ersparnisse, Fake-URLs, veraltete Angebote als aktuell.',
    FINDUS_FEW_SHOT_DISCLAIMER,
    '',
    'Nur JSON:',
    '{',
    '  "researchNotes": "kurz",',
    '  "offers": [',
    '    { "productLabel":"…", "priceLabel":"0,79 €"|null, "regularPriceLabel":"1,19 €"|null, "savingsLabel":"0,40 € günstiger"|null, "validityLabel":"diese Woche"|null, "storeLabel":"Lidl", "detail":"0,5 l"|null, "prospectUrl":"https://…"|null }',
    '  ]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      enableGoogleSearch: true,
      maxTokens: 1100,
      temperature: 0.2,
      useFindusSystem: false,
      signal: opts.signal,
    });
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { offers: [], notes: 'parse_fail' };
    }
    const root = parsed as Record<string, unknown>;
    const notes =
      typeof root.researchNotes === 'string' ? root.researchNotes : '';
    const rows = Array.isArray(root.offers) ? root.offers : [];
    const offers: ProspectOfferHit[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const productLabel = String(r.productLabel ?? r.name ?? '').trim();
      if (!productLabel) continue;
      const storeLabel = String(r.storeLabel ?? opts.venues[0]?.name ?? 'Markt')
        .trim()
        .slice(0, 60);
      const matched = matchVenueForStore(storeLabel, opts.venues);
      const prospectUrl =
        typeof r.prospectUrl === 'string' &&
        /^https?:\/\//i.test(r.prospectUrl)
          ? r.prospectUrl
          : null;
      offers.push({
        productLabel: productLabel.slice(0, 80),
        priceLabel:
          typeof r.priceLabel === 'string' && r.priceLabel.trim()
            ? r.priceLabel.trim().slice(0, 40)
            : null,
        regularPriceLabel:
          typeof r.regularPriceLabel === 'string' && r.regularPriceLabel.trim()
            ? r.regularPriceLabel.trim().slice(0, 40)
            : null,
        savingsLabel:
          typeof r.savingsLabel === 'string' && r.savingsLabel.trim()
            ? r.savingsLabel.trim().slice(0, 48)
            : null,
        validityLabel:
          typeof r.validityLabel === 'string' && r.validityLabel.trim()
            ? r.validityLabel.trim().slice(0, 40)
            : null,
        storeLabel,
        detail:
          typeof r.detail === 'string' && r.detail.trim()
            ? r.detail.trim().slice(0, 60)
            : null,
        prospectUrl,
        distanceM: matched?.distanceM ?? null,
      });
    }
    return { offers: offers.slice(0, 6), notes };
  } catch {
    return { offers: [], notes: 'research_fail' };
  }
}

/**
 * Nahe Märkte + Prospekt-Angebote (mit Budget für Web).
 */
export async function researchSupermarketProspect(opts: {
  userText: string;
  lat: number;
  lng: number;
  signal?: AbortSignal;
  /** Max. Wartezeit Prospekt-Web (Default 10s) */
  offerBudgetMs?: number;
}): Promise<SupermarketProspectResult> {
  const { productHint, productHints, chainHint, cityHint } =
    extractSupermarketOfferHints(opts.userText);

  const venues = await findNearbySupermarkets({
    lat: opts.lat,
    lng: opts.lng,
    chainHint,
    cityHint,
    signal: opts.signal,
  });
  const venue = venues[0] ?? null;

  const buttons: Module2ActionButton[] = [];
  for (let i = 0; i < Math.min(2, venues.length); i++) {
    buttons.push(navButton(venues[i]!, i));
  }

  let offers: ProspectOfferHit[] = [];
  let notes = '';
  let offersPending = false;

  const budget = Math.max(3_000, opts.offerBudgetMs ?? 10_000);
  const webP = researchProspectOffers({
    userText: opts.userText,
    productHints,
    chainHint: venue?.chain || chainHint,
    cityHint,
    venues,
    signal: opts.signal,
  });
  const raced = await Promise.race([
    webP.then((w) => ({ ok: true as const, w })),
    new Promise<{ ok: false }>((resolve) =>
      setTimeout(() => resolve({ ok: false }), budget),
    ),
  ]);
  if (raced.ok) {
    offers = raced.w.offers;
    notes = raced.w.notes;
  } else {
    offersPending = true;
    notes = 'offers_pending';
    void webP;
  }

  // Nav zum besten Angebots-Markt zuerst
  if (offers[0]) {
    const best = matchVenueForStore(offers[0].storeLabel, venues);
    if (best && buttons[0]?.payload.kind === 'navigate') {
      const rest = buttons.filter((b) => b.id !== 'market_nav_0');
      buttons.length = 0;
      buttons.push(navButton(best, 0), ...rest);
    }
  }

  for (let i = 0; i < offers.length && buttons.length < 4; i++) {
    const o = offers[i]!;
    if (o.prospectUrl) {
      buttons.push(
        urlButton(
          `prospect_${i}`,
          i === 0 ? '📄 Prospekt' : `📄 ${o.productLabel.slice(0, 18)}`,
          o.prospectUrl,
        ),
      );
    }
  }

  const storeLabel = venue?.name || chainHint || 'Supermarkt';
  const promptBlock = [
    '=== SUPERMARKT-PROSPEKT JUST-DO-IT (Struktur-Hints, Wortlaut frei) ===',
    productHints.length
      ? `Produkte: ${productHints.join(', ')}`
      : 'Produkt: allgemein / Top-Angebote',
    `Nahe Märkte:\n${venues
      .slice(0, 4)
      .map((v, i) => `${i + 1}) ${v.name} · ${formatDist(v.distanceM)}`)
      .join('\n') || storeLabel}`,
    notes ? `Research: ${notes}` : '',
    offers.length
      ? `Angebote (belegt):\n${offers
          .map(
            (o) =>
              `• ${o.productLabel}` +
              `${o.priceLabel ? ` · ${o.priceLabel}` : ''}` +
              `${o.regularPriceLabel ? ` (statt ${o.regularPriceLabel})` : ''}` +
              `${o.savingsLabel ? ` · ${o.savingsLabel}` : ''}` +
              `${o.detail ? ` · ${o.detail}` : ''}` +
              ` @ ${o.storeLabel}` +
              `${o.distanceM != null ? ` · ${formatDist(o.distanceM)}` : ''}` +
              `${o.prospectUrl ? ` · ${o.prospectUrl}` : ''}`,
          )
          .join('\n')}`
      : offersPending
        ? 'Prospekt noch in Recherche — Märkte nennen, Angebote/Links kommen nach.'
        : 'Keine belegten Prospekt-Treffer — ehrlich halten.',
    '',
    'ANTWORT-FLOW:',
    '1) Ja/Nein vorne: Produkt X bei Laden Y — Distanz — Preis — Ersparnis nur wenn belegt.',
    '2) Mehrere Produkte nacheinander, klar getrennt.',
    '3) Buttons: Route zum besten Markt, Prospekt-URL.',
    '4) Nichts erfinden.',
    FINDUS_FEW_SHOT_DISCLAIMER,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    productHint,
    productHints,
    chainHint: venue?.chain || chainHint,
    cityHint,
    venue,
    venues,
    offers,
    promptBlock,
    buttons: buttons.slice(0, 4),
    notes,
    offersPending,
  };
}
