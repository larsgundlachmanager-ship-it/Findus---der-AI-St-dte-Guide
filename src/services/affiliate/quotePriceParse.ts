/**
 * Live-Preis aus JSON-LD / sichtbarem Markup — nichts erfinden.
 */

export function parseEurNumber(raw?: string | null): number | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  const m = t.match(/(\d{1,5}(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  return n;
}

function fromJsonLdNode(node: unknown, out: number[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) fromJsonLdNode(n, out);
    return;
  }
  const o = node as Record<string, unknown>;
  const price = o.price ?? o.lowPrice ?? o.highPrice;
  if (price != null) {
    const n = parseEurNumber(String(price));
    if (n != null) out.push(n);
  }
  const offer = o.offers ?? o.aggregateOffer ?? o.AggregateOffer;
  if (offer) fromJsonLdNode(offer, out);
  if (o['@graph']) fromJsonLdNode(o['@graph'], out);
}

/** Kleinster belegter Angebotspreis aus HTML (JSON-LD Offer). */
export function parseOfferPriceFromHtml(html?: string | null): number | null {
  const raw = String(html || '');
  if (raw.length < 40) return null;
  const blocks = raw.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const prices: number[] = [];
  for (const block of blocks || []) {
    const json = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    try {
      fromJsonLdNode(JSON.parse(json), prices);
    } catch {
      /* skip broken ld+json */
    }
  }
  if (!prices.length) return null;
  return Math.min(...prices);
}
