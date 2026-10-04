/**
 * Verleih-Preise aus Website-/PDF-Text — nur belegte €-Muster, nichts erfinden.
 * Stadt-agnostisch: SUP, Surfbrett, Fahrrad, … gleiche Dauer-/Preis-Struktur.
 */

export type RentalPriceHit = {
  /** Kurzer Stichpunkt, z. B. „20 € / 2 Std.“ */
  label: string;
  amountEur: number;
  hours: number | null;
  /** Roh-Snippet zur Transparenz (max. ~80 Zeichen) */
  evidence: string;
};

function parseEur(raw: string): number | null {
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 3 || n > 400) return null;
  return Math.round(n * 10) / 10;
}

function fmtEur(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}

function pushHit(
  out: RentalPriceHit[],
  seen: Set<string>,
  amountEur: number,
  hours: number | null,
  evidence: string,
): void {
  const label =
    hours != null && hours > 0
      ? `${fmtEur(amountEur)} € / ${hours} Std.`
      : `${fmtEur(amountEur)} € / Std.`;
  const key = `${amountEur}|${hours ?? 'h'}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    label,
    amountEur,
    hours,
    evidence: evidence.replace(/\s+/g, ' ').trim().slice(0, 80),
  });
}

function focusBlob(raw: string): string {
  const chunks =
    raw.match(
      /(?:preis|tarif|verleih|miete|sup|paddle|board|stunden?)[\s\S]{0,2500}/giu,
    ) ?? [];
  if (chunks.length) return chunks.join('\n').slice(0, 14_000);
  return raw.slice(0, 12_000);
}

/**
 * Extrahiert bis zu 3 Verleih-Preise aus Seiten-/PDF-Text.
 * Ohne klaren €-Treffer → leeres Array (ehrlich, kein Fake).
 */
export function extractRentalPricesFromText(text: string): RentalPriceHit[] {
  const raw = String(text || '');
  if (raw.length < 20) return [];
  const focus = focusBlob(raw);
  const out: RentalPriceHit[] = [];
  const seen = new Set<string>();

  // 20 € / 2 Stunden
  {
    const re =
      /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)\s*(?:\/|pro|für|fuer|je)\s*(\d{1,2})\s*(?:stunden?|std\.?|h\b)/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(focus))) {
      const amount = parseEur(m[1]!);
      const hours = Number(m[2]);
      if (amount != null && hours >= 1 && hours <= 12) {
        pushHit(out, seen, amount, hours, m[0]);
      }
    }
  }

  // 2 Stunden 20 €
  {
    const re =
      /(\d{1,2})\s*(?:stunden?|std\.?|h)\s*(?:ab\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(focus))) {
      const hours = Number(m[1]);
      const amount = parseEur(m[2]!);
      if (amount != null && hours >= 1 && hours <= 12) {
        pushHit(out, seen, amount, hours, m[0]);
      }
    }
  }

  // ab 15 € / Stunde
  {
    const re =
      /(?:ab\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)\s*(?:\/|pro)\s*(?:stunde|std\.?|h\b)/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(focus))) {
      const amount = parseEur(m[1]!);
      if (amount != null) pushHit(out, seen, amount, 1, m[0]);
    }
  }

  // SUP / Verleih … 20 € (nur mit Verleih-Kontext im Match)
  {
    const re =
      /(?:sup|stand[-\s]?up|paddle|verleih|miete|board)[^.\n]{0,60}?(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(focus))) {
      const amount = parseEur(m[1]!);
      if (amount != null) pushHit(out, seen, amount, null, m[0]);
    }
  }

  out.sort((a, b) => {
    const ua = a.hours && a.hours > 0 ? a.amountEur / a.hours : a.amountEur;
    const ub = b.hours && b.hours > 0 ? b.amountEur / b.hours : b.amountEur;
    return ua - ub;
  });
  return out.slice(0, 3);
}

export function bestRentalPriceLabel(text: string): string | null {
  return extractRentalPricesFromText(text)[0]?.label ?? null;
}

/** Website laden und besten Verleih-Preis zurückgeben (oder null). */
export async function fetchRentalPriceFromWebsite(opts: {
  url: string;
  signal?: AbortSignal;
}): Promise<RentalPriceHit | null> {
  const url = String(opts.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (opts.signal?.aborted) return null;
  try {
    const { fetchPublicDocument } = await import('./webFetch');
    const doc = await fetchPublicDocument(url);
    if (opts.signal?.aborted) return null;
    if (!doc?.ok || !doc.text) return null;
    let text = doc.text;
    const priceLink = (doc.links ?? []).find((l) =>
      /\b(preis|tarif|preisliste|preise|verleih|miete|sup|paddle|buchen)\b/i.test(
        `${l.href} ${l.label}`,
      ),
    );
    if (priceLink?.href && priceLink.href !== url) {
      try {
        if (opts.signal?.aborted) return null;
        const deep = await fetchPublicDocument(priceLink.href);
        if (deep?.ok && deep.text && deep.text.length > 80) {
          text = `${deep.text}\n${text}`;
        }
      } catch {
        /* soft */
      }
    }
    return extractRentalPricesFromText(text)[0] ?? null;
  } catch {
    return null;
  }
}
