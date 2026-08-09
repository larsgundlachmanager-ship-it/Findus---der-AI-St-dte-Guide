/**
 * Speisekarte / Getränkekarte — tiefstmöglicher Direktlink.
 *
 * Strategie:
 * 1. Anchor-Texte der Startseite
 * 2. Speisekarte/Menü/Karte/Food → auch kryptische PDFs
 * 3. HTML-Unterseiten /speisekarte|/menu
 * 4. One-Pager-Anker /#menu
 * 5. Immer tiefstmöglichen Link zurückgeben
 */

import { fetchPublicDocument } from '../research/webFetch';

export type MenuDeepKind = 'food' | 'drinks';

const FOOD_LABEL_RE =
  /\b(speisekarte|speisen(?:karte)?|menü(?:karte)?|menue(?:karte)?|menu(?:karte)?|food\s*menu|karte(?!\s*fahren)|essenskarte)\b/iu;
const DRINKS_LABEL_RE =
  /\b(getränkekarte|getraenkekarte|getränke|getraenke|drinks?(?:\s*menu)?|beverage|wein\s*karte|bier\s*karte|cocktailkarte)\b/iu;
const FOOD_PATH_RE =
  /\/(speisekarte|speisen|menu|menue|menü|food|karte)(\/|\.|\?|#|$)/i;
const DRINKS_PATH_RE =
  /\/(getraenk|getränk|drinks?|beverage|bar-?karte)(\/|\.|\?|#|$)/i;
const ANCHOR_FOOD_RE = /#+(?:speisekarte|menu|menue|menü|food|karte)\b/i;
const ANCHOR_DRINKS_RE = /#+(?:getraenk|getränk|drinks?|beverage)\b/i;

type Cand = { url: string; score: number; label: string };

function scoreCandidate(
  href: string,
  label: string,
  kind: MenuDeepKind,
): number {
  const blob = `${href} ${label}`;
  let score = 0;
  if (kind === 'food') {
    if (FOOD_LABEL_RE.test(label) || FOOD_LABEL_RE.test(href)) score += 50;
    if (FOOD_PATH_RE.test(href)) score += 35;
    if (ANCHOR_FOOD_RE.test(href)) score += 25;
    if (/\.pdf(\?|$)/i.test(href) && FOOD_LABEL_RE.test(blob)) score += 40;
    if (DRINKS_LABEL_RE.test(blob) && !FOOD_LABEL_RE.test(blob)) score -= 30;
  } else {
    if (DRINKS_LABEL_RE.test(label) || DRINKS_LABEL_RE.test(href)) score += 50;
    if (DRINKS_PATH_RE.test(href)) score += 35;
    if (ANCHOR_DRINKS_RE.test(href)) score += 25;
    if (/\.pdf(\?|$)/i.test(href) && DRINKS_LABEL_RE.test(blob)) score += 40;
  }
  if (/\.pdf(\?|$)/i.test(href)) score += 10;
  return score;
}

function absUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/i.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Findet den direktmöglichsten Speise-/Getränke-Link auf einer Website.
 * Timeout über AbortSignal (typisch 45s Budget außen).
 */
export async function findDeepestMenuLink(opts: {
  websiteUrl: string;
  kind: MenuDeepKind;
  signal?: AbortSignal;
}): Promise<{ url: string; label: string } | null> {
  const base = opts.websiteUrl.trim();
  if (!/^https?:\/\//i.test(base)) return null;
  if (opts.signal?.aborted) return null;

  const doc = await fetchPublicDocument(base);
  if (!doc.ok) return null;

  const cands: Cand[] = [];
  const push = (url: string, label: string) => {
    const score = scoreCandidate(url, label, opts.kind);
    if (score < 20) return;
    cands.push({ url, score, label: label.slice(0, 80) });
  };

  for (const l of doc.links ?? []) {
    push(l.href, l.label);
  }

  // Roh-HTML ggf. nicht verfügbar — Text+Links reichen oft
  const htmlBlob = `${doc.text}\n${(doc.links ?? [])
    .map((l) => `${l.label} ${l.href}`)
    .join('\n')}`;

  try {
    // Wenn fetchPublicDocument nur Text liefert: path-Heuristik aus bekannten Mustern
    const pathGuess =
      opts.kind === 'food'
        ? ['speisekarte', 'menu', 'menue', 'speisen', 'karte']
        : ['getraenkekarte', 'getraenke', 'drinks', 'bar'];
    for (const p of pathGuess) {
      const guess = absUrl(base, `/${p}`);
      if (guess) push(guess, p);
      const hash = absUrl(base, `/#${p}`);
      if (hash) push(hash, `#${p}`);
    }
  } catch {
    /* soft */
  }

  // PDF-URLs im Text
  const pdfRe = /https?:\/\/[^\s"'<>]+\.pdf[^\s"'<>]*/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pdfRe.exec(htmlBlob))) {
    push(pm[0].replace(/[),.;]+$/, ''), 'PDF');
  }

  // Re-extract from original if we can get HTML via second fetch — already in links

  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best || best.score < 25) {
    // Fallback: Startseite behalten ist NICHT tief — lieber null → Pending fail
    return null;
  }

  // Optional: eine Ebene folgen wenn Treffer nur Verzeichnis
  if (
    !/\.pdf(\?|$)/i.test(best.url) &&
    !ANCHOR_FOOD_RE.test(best.url) &&
    !ANCHOR_DRINKS_RE.test(best.url) &&
    best.score < 60 &&
    !opts.signal?.aborted
  ) {
    try {
      const sub = await fetchPublicDocument(best.url);
      if (sub.ok && sub.links?.length) {
        for (const l of sub.links) {
          const s = scoreCandidate(l.href, l.label, opts.kind);
          if (s > best.score) {
            return {
              url: l.href,
              label:
                opts.kind === 'drinks' ? 'Getränkekarte' : 'Speisekarte',
            };
          }
        }
      }
    } catch {
      /* soft */
    }
  }

  return {
    url: best.url,
    label: opts.kind === 'drinks' ? 'Getränkekarte' : 'Speisekarte',
  };
}

/** Qualitätsgate: Text sieht nach Gerichten + Preisen aus. */
export function looksLikeRealMenu(text: string): boolean {
  const t = text.slice(0, 12_000);
  const priceHits = (t.match(/(?:€|eur|euro)\s*\d|[0-9]+[,\.]\d{2}\s*€/gi) ?? [])
    .length;
  const dishHints =
    (t.match(
      /\b(vorspeise|hauptgericht|dessert|pizza|pasta|salat|suppe|steak|burger|wein|bier|cocktail|gericht)\b/giu,
    ) ?? []).length;
  return priceHits >= 2 && dishHints >= 1;
}

export async function validateMenuUrl(
  url: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (/\.pdf(\?|$)/i.test(url)) return true; // PDF mit Speisekarte-Label akzeptieren
  if (signal?.aborted) return false;
  try {
    const doc = await fetchPublicDocument(url);
    if (!doc.ok || !doc.text) return true; // Link existiert — soft pass
    return looksLikeRealMenu(doc.text) || FOOD_LABEL_RE.test(doc.text) || DRINKS_LABEL_RE.test(doc.text);
  } catch {
    return true;
  }
}
