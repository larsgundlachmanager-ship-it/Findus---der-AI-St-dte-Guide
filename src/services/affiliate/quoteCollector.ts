/**
 * QuoteCollector: 2–3 Quellen parallel, Timeout = kein Preis, kein Blocker.
 * Nur Produkt-URLs (GYG-Slug, Tiqets -p, Viator, konfetti /e/) — keine /search?q=.
 */

import {
  pickAffiliateOffer,
  type AffiliateOfferCandidate,
} from './affiliatePickOffer';
import { ticketIdentity, ticketProductKey } from './quoteIdentity';
import { parseOfferPriceFromHtml } from './quotePriceParse';

export const QUOTE_TIMEOUT_MS = 1000;
export const QUOTE_CACHE_TTL_MS = 8 * 60 * 1000;

export type QuoteSeed = {
  id: string;
  url: string;
  commissionScore: number;
  priceEur?: number | null;
  html?: string | null;
  identity?: string | null;
  deepLinkLevel?: AffiliateOfferCandidate['deepLinkLevel'];
};

const quoteCache = new Map<string, { at: number; price: number | null }>();

export function classifyTicketPartner(url: string): {
  id: string;
  commissionScore: number;
} {
  if (/getyourguide/i.test(url)) return { id: 'getyourguide', commissionScore: 65 };
  if (/tiqets/i.test(url)) return { id: 'tiqets', commissionScore: 74 };
  if (/viator|tripadvisor/i.test(url)) return { id: 'viator', commissionScore: 60 };
  if (/musement|tui\.com/i.test(url)) return { id: 'musement', commissionScore: 62 };
  if (/klook/i.test(url)) return { id: 'klook', commissionScore: 55 };
  if (/gokonfetti|konfetti/i.test(url)) return { id: 'konfetti', commissionScore: 68 };
  if (/reservix\.(de|at|ch)/i.test(url)) return { id: 'reservix', commissionScore: 72 };
  if (/kkday/i.test(url)) return { id: 'kkday', commissionScore: 50 };
  return { id: 'direct', commissionScore: 0 };
}

export async function fetchHtmlWithTimeout(
  url: string,
  timeoutMs = QUOTE_TIMEOUT_MS,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 180_000);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function cacheGet(url: string): number | null | undefined {
  const hit = quoteCache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > QUOTE_CACHE_TTL_MS) {
    quoteCache.delete(url);
    return undefined;
  }
  return hit.price;
}

function cacheSet(url: string, price: number | null): void {
  quoteCache.set(url, { at: Date.now(), price });
}

export async function collectQuotes(
  seeds: QuoteSeed[],
  opts?: {
    timeoutMs?: number;
    fetchHtml?: (url: string, ms: number) => Promise<string | null>;
    dateIso?: string | null;
    adults?: number | null;
  },
): Promise<AffiliateOfferCandidate[]> {
  const timeoutMs = opts?.timeoutMs ?? QUOTE_TIMEOUT_MS;
  const fetchHtml = opts?.fetchHtml ?? fetchHtmlWithTimeout;
  const sliced = seeds.slice(0, 3);
  const out: AffiliateOfferCandidate[] = [];

  await Promise.all(
    sliced.map(async (seed) => {
      const identity =
        seed.identity ||
        ticketIdentity({
          url: seed.url,
          dateIso: opts?.dateIso,
          adults: opts?.adults,
        });
      let price =
        typeof seed.priceEur === 'number' && seed.priceEur > 0
          ? seed.priceEur
          : null;
      if (price == null && seed.html) {
        price = parseOfferPriceFromHtml(seed.html);
      }
      if (price == null && ticketProductKey(seed.url)) {
        const cached = cacheGet(seed.url);
        if (cached !== undefined) {
          price = cached;
        } else {
          const html = await Promise.race([
            fetchHtml(seed.url, timeoutMs),
            new Promise<string | null>((resolve) => {
              setTimeout(() => resolve(null), timeoutMs);
            }),
          ]);
          price = parseOfferPriceFromHtml(html);
          cacheSet(seed.url, price);
        }
      }
      out.push({
        id: seed.id,
        label: seed.id,
        url: seed.url,
        commissionScore: seed.commissionScore,
        deepLinkLevel: seed.deepLinkLevel ?? (identity ? 'deep' : 'search'),
        partnerPriceEur: price,
        identity,
      });
    }),
  );
  return out;
}

export async function pickQuotedTicket(
  urls: Array<{ url: string; priceEur?: number | null; html?: string | null }>,
  opts?: {
    userWantsCheapest?: boolean;
    dateIso?: string | null;
    adults?: number | null;
    fetchHtml?: (url: string, ms: number) => Promise<string | null>;
    timeoutMs?: number;
  },
): Promise<AffiliateOfferCandidate | null> {
  const seeds: QuoteSeed[] = urls
    .filter((u) => String(u.url || '').trim())
    .slice(0, 3)
    .map((src, i) => {
      const url = src.url.trim();
      const meta = classifyTicketPartner(url);
      return {
        id: `${meta.id}:${i}`,
        url,
        commissionScore: meta.commissionScore,
        priceEur: src.priceEur,
        html: src.html,
        identity: ticketIdentity({
          url,
          dateIso: opts?.dateIso,
          adults: opts?.adults,
        }),
      };
    });
  if (!seeds.length) return null;
  const quotes = await collectQuotes(seeds, {
    timeoutMs: opts?.timeoutMs,
    fetchHtml: opts?.fetchHtml,
    dateIso: opts?.dateIso,
    adults: opts?.adults,
  });
  return pickAffiliateOffer(quotes, {
    userWantsCheapest: opts?.userWantsCheapest,
  });
}
