/**
 * Speisekarte / Getränkekarte — tiefstmöglicher Direktlink.
 *
 * Strategie:
 * 1. Anchor-Texte der Startseite
 * 2. Speisekarte/Menü/Karte/Food → auch kryptische PDFs (Wix /_files/ugd)
 * 3. HTML-Unterseiten /speisekarte|/menu
 * 4. One-Pager-Anker /#menu
 * 5. Immer tiefstmöglichen Link zurückgeben — nie nackte Homepage
 */

import { fetchPublicDocument } from '../research/webFetch';

export type MenuDeepKind = 'food' | 'drinks';

const FOOD_LABEL_RE =
  /\b(speisekarte|speisen(?:karte)?|menü(?:karte)?|menue(?:karte)?|menu(?:karte)?|food\s*menu|karte(?!\s*fahren)|essenskarte|tageskarte|mittagskarte|dessertkarte|specialkarte|wochenkarte)\b/iu;
const DRINKS_LABEL_RE =
  /\b(getränkekarte|getraenkekarte|getränke|getraenke|drinks?(?:\s*menu)?|beverage|wein\s*karte|bier\s*karte|cocktailkarte)\b/iu;
const FOOD_PATH_RE =
  /\/(speisekarte|speisen|menu|menue|menü|food|karte|tageskarte|mittagskarte|dessertkarte)(\/|\.|\?|#|$)/i;
const DRINKS_PATH_RE =
  /\/(getraenk|getränk|drinks?|beverage|bar-?karte)(\/|\.|\?|#|$)/i;
const ANCHOR_FOOD_RE = /#+(?:speisekarte|menu|menue|menü|food|karte)\b/i;
const ANCHOR_DRINKS_RE = /#+(?:getraenk|getränk|drinks?|beverage)\b/i;

/** CMS-Hashes ohne „speisekarte“ im Pfad (Wix ugd, ähnliche Document-CDNs). */
export const HASHED_CMS_PDF_RE =
  /\/_files\/ugd\/|\/ugd\/[a-f0-9_]+|\.wixstatic\.com\/|\/documents\/[^/?#]+\.pdf/i;

export type MenuLinkCand = { url: string; score: number; label: string };

export function isHashedCmsPdf(url: string): boolean {
  return HASHED_CMS_PDF_RE.test(url) && /\.pdf(\?|$)/i.test(url);
}

export function scoreMenuCandidate(
  href: string,
  label: string,
  kind: MenuDeepKind,
  pageHasMenuLabel = false,
): number {
  const blob = `${href} ${label}`;
  let score = 0;
  if (kind === 'food') {
    if (FOOD_LABEL_RE.test(label) || FOOD_LABEL_RE.test(href)) score += 50;
    if (FOOD_PATH_RE.test(href)) score += 35;
    if (ANCHOR_FOOD_RE.test(href)) score += 25;
    if (/\.pdf(\?|$)/i.test(href) && FOOD_LABEL_RE.test(blob)) score += 40;
    if (isHashedCmsPdf(href) && FOOD_LABEL_RE.test(label)) score += 55;
    if (isHashedCmsPdf(href) && pageHasMenuLabel && FOOD_LABEL_RE.test(label)) {
      score += 10;
    }
    if (DRINKS_LABEL_RE.test(blob) && !FOOD_LABEL_RE.test(blob)) score -= 30;
  } else {
    if (DRINKS_LABEL_RE.test(label) || DRINKS_LABEL_RE.test(href)) score += 50;
    if (DRINKS_PATH_RE.test(href)) score += 35;
    if (ANCHOR_DRINKS_RE.test(href)) score += 25;
    if (/\.pdf(\?|$)/i.test(href) && DRINKS_LABEL_RE.test(blob)) score += 40;
    if (isHashedCmsPdf(href) && DRINKS_LABEL_RE.test(label)) score += 55;
    if (FOOD_LABEL_RE.test(blob) && !DRINKS_LABEL_RE.test(blob)) score -= 30;
  }
  if (/\.pdf(\?|$)/i.test(href)) score += 10;
  if (isHashedCmsPdf(href) && pageHasMenuLabel && score < 25) {
    // Eine Speisekarte-Seite + 1–2 Hash-PDFs: PDF vor Homepage
    score += 20;
  }
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

function isHomepageUrl(url: string, base: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(base);
    if (a.hostname.replace(/^www\./i, '') !== b.hostname.replace(/^www\./i, '')) {
      return false;
    }
    const path = a.pathname.replace(/\/+$/, '') || '/';
    return path === '/' || path === '';
  } catch {
    return false;
  }
}

/**
 * Kandidaten aus Links + optionalem HTML (ohne Netz) — Tests und Live-Harvest.
 */
export function collectMenuLinkCandidates(opts: {
  baseUrl: string;
  kind: MenuDeepKind;
  links: Array<{ href: string; label: string }>;
  htmlOrText?: string;
}): MenuLinkCand[] {
  const pageBlob = `${opts.htmlOrText ?? ''}\n${opts.links
    .map((l) => `${l.label} ${l.href}`)
    .join('\n')}`;
  const pageHasMenuLabel =
    opts.kind === 'food'
      ? FOOD_LABEL_RE.test(pageBlob)
      : DRINKS_LABEL_RE.test(pageBlob);
  const cands: MenuLinkCand[] = [];
  const seen = new Set<string>();
  const push = (url: string, label: string) => {
    const abs = absUrl(opts.baseUrl, url) ?? url;
    if (!/^https?:\/\//i.test(abs)) return;
    if (seen.has(abs)) return;
    const score = scoreMenuCandidate(abs, label, opts.kind, pageHasMenuLabel);
    if (score < 20) return;
    seen.add(abs);
    cands.push({ url: abs, score, label: label.slice(0, 80) });
  };

  for (const l of opts.links) {
    push(l.href, l.label);
  }

  const pdfRe = /https?:\/\/[^\s"'<>]+(?:\.pdf|_files\/ugd\/[^\s"'<>]+)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pdfRe.exec(pageBlob))) {
    const href = pm[0].replace(/[),.;]+$/, '');
    const around = pageBlob
      .slice(Math.max(0, pm.index - 140), pm.index + 80)
      .toLowerCase();
    const label = /getränk|getraenk|drink/.test(around)
      ? 'Getränkekarte'
      : /speise|food|menu|karte|menü|menue|tageskarte|mittagskarte|dessert/.test(around)
        ? 'Speisekarte'
        : pageHasMenuLabel
          ? 'Speisekarte'
          : 'PDF';
    push(href, label);
  }

  const relPdfRe =
    /(?:href\s*=\s*["'])([^"']*(?:\.pdf|_files\/ugd\/)[^"']*)/gi;
  while ((pm = relPdfRe.exec(opts.htmlOrText ?? ''))) {
    const abs = absUrl(opts.baseUrl, pm[1].trim());
    if (abs) push(abs, pageHasMenuLabel ? 'Speisekarte' : 'PDF');
  }

  cands.sort((a, b) => b.score - a.score);
  return cands;
}

export function pickBestMenuCandidate(
  cands: MenuLinkCand[],
  baseUrl: string,
): MenuLinkCand | null {
  const usable = cands.filter((c) => c.score >= 25 && !isHomepageUrl(c.url, baseUrl));
  return usable[0] ?? null;
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

  const extra: Array<{ href: string; label: string }> = [...(doc.links ?? [])];
  try {
    const pathGuess =
      opts.kind === 'food'
        ? ['speisekarte', 'menu', 'menue', 'speisen', 'karte']
        : ['getraenkekarte', 'getraenke', 'drinks', 'bar'];
    for (const p of pathGuess) {
      const guess = absUrl(base, `/${p}`);
      if (guess) extra.push({ href: guess, label: p });
      const hash = absUrl(base, `/#${p}`);
      if (hash) extra.push({ href: hash, label: `#${p}` });
    }
  } catch {
    /* soft */
  }

  const htmlBlob = `${doc.text}\n${(doc.links ?? [])
    .map((l) => `${l.label} ${l.href}`)
    .join('\n')}`;
  const cands = collectMenuLinkCandidates({
    baseUrl: base,
    kind: opts.kind,
    links: extra,
    htmlOrText: htmlBlob,
  });
  const best = pickBestMenuCandidate(cands, base);
  if (!best) return null;

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
        const subCands = collectMenuLinkCandidates({
          baseUrl: best.url,
          kind: opts.kind,
          links: sub.links,
          htmlOrText: sub.text,
        });
        const deeper = pickBestMenuCandidate(subCands, best.url);
        if (deeper && deeper.score > best.score) {
          return {
            url: deeper.url,
            label: opts.kind === 'drinks' ? 'Getränkekarte' : 'Speisekarte',
          };
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

export function menuPdfPassesKeywordOrLabel(
  url: string,
  label?: string,
): boolean {
  const blob = `${url} ${label ?? ''}`;
  if (FOOD_PATH_RE.test(url) || FOOD_LABEL_RE.test(blob) || DRINKS_PATH_RE.test(url) || DRINKS_LABEL_RE.test(blob)) {
    return true;
  }
  return isHashedCmsPdf(url) && FOOD_LABEL_RE.test(label ?? '');
}

/**
 * Speisekarten-URL nur freigeben wenn belegt (Fail-closed).
 * PDF: Menü-Pfad/Label oder Hash-CMS-PDF mit Speisekarte-Label.
 * HTML muss Menü-Signale haben.
 */
export async function validateMenuUrl(
  url: string,
  signal?: AbortSignal,
  opts?: { label?: string },
): Promise<boolean> {
  if (signal?.aborted) return false;
  if (/\.pdf(\?|$)/i.test(url)) {
    return menuPdfPassesKeywordOrLabel(url, opts?.label);
  }
  try {
    const doc = await fetchPublicDocument(url);
    if (!doc.ok || !doc.text) return false;
    if (looksLikeRealMenu(doc.text)) return true;
    if (FOOD_LABEL_RE.test(doc.text) || DRINKS_LABEL_RE.test(doc.text)) {
      return /(?:€|eur|\d+[,\.]\d{2})/i.test(doc.text.slice(0, 8000));
    }
    return false;
  } catch {
    return false;
  }
}
