/**
 * Belegter Preis aus Fließtext — nichts erfinden, Range behalten.
 * SSOT für Event-Speech und Stichpunkte (gleiche Zahl).
 */

function normAmount(raw: string): string {
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 10_000) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace('.', ',');
}

/** "ca. 25,00 bis 29,37 Euro" → "25–29,37 €". Unlesbar → null. */
export function extractSpokenPriceEur(
  blob: string | null | undefined,
): string | null {
  const t = String(blob ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const range = t.match(
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:bis|-|–|—)\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur(?:o)?s?)/iu,
  );
  if (range) {
    const a = normAmount(range[1]!);
    const b = normAmount(range[2]!);
    if (a && b) return `${a}–${b} €`;
  }
  const one = t.match(
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur(?:o)?s?)/iu,
  );
  if (one) {
    const a = normAmount(one[1]!);
    if (a) return `${a} €`;
  }
  const prefix = t.match(/€\s*(\d{1,4}(?:[.,]\d{1,2})?)/u);
  if (prefix) {
    const a = normAmount(prefix[1]!);
    if (a) return `${a} €`;
  }
  return null;
}
