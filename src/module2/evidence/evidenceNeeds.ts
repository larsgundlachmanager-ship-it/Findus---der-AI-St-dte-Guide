/**
 * Evidence-Needs — abstrakte Fähigkeit, was die Antwort belegen muss.
 *
 * Kein Gericht-/Ort-Hardcode: aus Frage + Job + LearnedRules ableiten,
 * dann generische Filler (Menü-Deeplink, Preis-Scrape, Review-Beleg).
 * Dynamic-Structure: Struktur ja, Wortlaut/Ort nein.
 */

import type { LearnedRuleExpect } from '../../types/learnedRules';
import type { FindusJobId } from '../jobs/types';

export type EvidenceNeedKey =
  | 'menu_deeplink'
  | 'item_price'
  | 'review_item_evidence'
  | 'two_options'
  | 'booking_deeplink'
  | 'website_button'
  | 'route_button'
  | 'date_window'
  | 'place_options'
  | 'empty_calendar_fallback'
  | 'deep_link_verify';

export type EvidenceNeeds = {
  needs: EvidenceNeedKey[];
  /** Freitext-Items aus der Frage (Gericht, Verleih, Produkt) — stadt-agnostisch */
  items: string[];
  /** Kurz warum (Debug / Prompt) */
  reasons: string[];
};

const RENTAL_RE =
  /\b(verleih|miete|leihen|ausleihen|sup\b|stand[-\s]?up|paddle|surfbrett|fahrradverleih|scooter|boot\s*verleih)\b/iu;

const DINING_RE =
  /\b(essen|restaurant|pizzeria|pizza|steak|café|cafe|imbiss|hunger|speisekarte|menü|menu|lecker|lust\s+auf|bock\s+auf|bistro|bäckerei|baeckerei|bakery)\b/iu;

const PRICE_ASK_RE =
  /\b(wie\s+teuer|was\s+kostet|preis(?:e)?|euro|€|budget|günstig|guenstig)\b/iu;

const BEST_ITEM_RE =
  /\b(?:beste[rn]?|leckere[rn]?|geile[rn]?|gute[rn]?|richtige[rn]?|perfekte[rn]?)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]{2,28}(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]{2,20})?)/giu;

const STOP_ITEM_TAIL =
  /^(heute|abend|morgen|mittag|nacht|in|bei|für|fuer|mit|ohne|und|oder)$/i;

const ITEM_DISH_RE =
  /\b([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]{2,20})\s*[- ]?(?:pizza|steak|burger|pasta|sushi|bowl|teller|menü|menue)\b/giu;

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase().trim();
    if (!k || k.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim().slice(0, 48));
  }
  return out;
}

function cleanItem(raw: string): string | null {
  let s = raw.replace(/\s+/g, ' ').trim();
  const parts = s.split(/\s+/);
  while (parts.length > 1 && STOP_ITEM_TAIL.test(parts[parts.length - 1]!)) {
    parts.pop();
  }
  s = parts.join(' ').trim();
  if (s.length < 2 || STOP_ITEM_TAIL.test(s)) return null;
  return s.slice(0, 48);
}

/** Extrahiert Produkt-/Gericht-Items aus Freitext — ohne Orts-/Gericht-Whitelist. */
export function extractEvidenceItems(userText: string): string[] {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const items: string[] = [];
  for (const m of t.matchAll(BEST_ITEM_RE)) {
    const cleaned = m[1] ? cleanItem(m[1]) : null;
    if (cleaned) items.push(cleaned);
  }
  for (const m of t.matchAll(ITEM_DISH_RE)) {
    const cleaned = m[0] ? cleanItem(m[0]) : null;
    if (cleaned) items.push(cleaned);
  }
  // „X essen / X bestellen“
  const eat = t.match(
    /\b([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]{3,24})\s+(?:essen|bestellen|probieren|holen)\b/iu,
  );
  if (eat?.[1] && !/^(heute|abend|morgen|etwas|was|gut|lecker)$/i.test(eat[1])) {
    const cleaned = cleanItem(eat[1]);
    if (cleaned) items.push(cleaned);
  }
  // „Lust/Bock auf (Adj) X“ — Specialty ohne Restaurant-Keyword
  const craving = t.match(
    /\b(?:lust|bock|appetit|hunger)\s+auf\s+(?:einen?|eine|ein|das|die|den)?\s*(?:leckere[rnms]?|geile[rnms]?|gute[rnms]?|beste[rn]?|richtige[rnms]?|perfekte[rnms]?)?\s*([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]{2,28})\b/iu,
  );
  if (
    craving?.[1] &&
    !/^(heute|abend|etwas|was|mehr|mich|dich|museum|dinosaur|zoo|aussicht)$/i.test(
      craving[1],
    )
  ) {
    const cleaned = cleanItem(craving[1]);
    if (cleaned) items.push(cleaned);
  }
  return uniq(items).slice(0, 4);
}

function fromLearnedExpects(expects: LearnedRuleExpect[] | undefined): EvidenceNeedKey[] {
  if (!expects?.length) return [];
  const out: EvidenceNeedKey[] = [];
  if (expects.includes('menu')) out.push('menu_deeplink');
  if (expects.includes('prices')) out.push('item_price');
  if (expects.includes('booking_url')) out.push('booking_deeplink');
  if (expects.includes('website')) out.push('website_button');
  if (expects.includes('route_button')) out.push('route_button');
  if (expects.includes('alternatives')) out.push('two_options');
  return out;
}

/**
 * Leitet ab, welche Belege diese Antwort braucht — stadt- und gericht-agnostisch.
 */
export function deriveEvidenceNeeds(opts: {
  userText: string;
  jobId?: FindusJobId | string | null;
  /** Bereits geparste Must-Items (z. B. Pitch-Wishes) */
  knownItems?: string[] | null;
  learnedExpects?: LearnedRuleExpect[] | null;
}): EvidenceNeeds {
  const t = opts.userText.replace(/\s+/g, ' ').trim();
  const job = String(opts.jobId || '').toLowerCase();
  const needs = new Set<EvidenceNeedKey>();
  const reasons: string[] = [];
  const items = uniq([
    ...(opts.knownItems ?? []),
    ...extractEvidenceItems(t),
  ]);

  const dining =
    DINING_RE.test(t) ||
    /dining|food|gastro/.test(job) ||
    job === 'dining_open' ||
    job === 'dining_hard_match';
  const activity =
    RENTAL_RE.test(t) ||
    job === 'activity_sport' ||
    /\b(bouldern|surf|sport|aktivität|aktivitaet)\b/iu.test(t);
  const rental = RENTAL_RE.test(t) || (activity && PRICE_ASK_RE.test(t));

  if (dining) {
    needs.add('menu_deeplink');
    needs.add('two_options');
    needs.add('route_button');
    reasons.push('dining→menu+options+route');
  }
  if (items.length && dining) {
    needs.add('review_item_evidence');
    needs.add('item_price');
    reasons.push('named_item→review+price');
  }
  if (PRICE_ASK_RE.test(t) || rental) {
    needs.add('item_price');
    reasons.push('price_ask_or_rental');
  }
  if (activity || rental) {
    needs.add('two_options');
    needs.add('website_button');
    needs.add('route_button');
    reasons.push('activity→options+web+route');
  }
  if (/\b(buch|reserv|ticket)\b/iu.test(t)) {
    needs.add('booking_deeplink');
    reasons.push('booking_ask');
  }
  if (
    /\b(vom\s+\d|bis\s+\d|\d{1,2}\.\s*(?:bis|[-–])|oktober|september|zeitraum|zwischen)\b/iu.test(
      t,
    ) ||
    /\b(was\s+geht|events?|veranstaltung)\b/iu.test(t)
  ) {
    needs.add('date_window');
    needs.add('place_options');
    needs.add('empty_calendar_fallback');
    reasons.push('events_or_range→window+options+fallback');
  }
  if (/\b(wo\s+kann\s+ich|was\s+machen|unternehm|ausflug)\b/iu.test(t)) {
    needs.add('place_options');
    reasons.push('open_whats_on→options');
  }
  if (
    needs.has('menu_deeplink') ||
    needs.has('booking_deeplink') ||
    needs.has('website_button')
  ) {
    needs.add('deep_link_verify');
  }

  for (const n of fromLearnedExpects(opts.learnedExpects ?? undefined)) {
    needs.add(n);
  }
  if (opts.learnedExpects?.length) {
    reasons.push('learned_rules');
  }

  // Default soft: konkrete Frage ohne Job → wenigstens Answer-First-Belege nicht erzwingen
  return {
    needs: [...needs],
    items,
    reasons,
  };
}

export function needsKey(
  needs: EvidenceNeeds,
  key: EvidenceNeedKey,
): boolean {
  return needs.needs.includes(key);
}

/** Prompt-Zeile für Call-2 / Pitch — Struktur, kein Script. */
export function formatEvidenceNeedsPromptBlock(needs: EvidenceNeeds): string {
  if (!needs.needs.length) return '';
  const itemBit = needs.items.length
    ? ` Items: ${needs.items.join(', ')}.`
    : '';
  return (
    `EVIDENCE-NEEDS (nur belegt liefern): ${needs.needs.join(', ')}.${itemBit} ` +
    `Fehlt Beleg → ehrlich weglassen, nichts erfinden.`
  );
}
