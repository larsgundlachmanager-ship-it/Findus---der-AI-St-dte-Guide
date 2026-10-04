/**
 * Wish-/Event-Preise: Auswahl = Spanne „von … bis …“, nach Entscheidung = konkreter € + Direktlink.
 * Nie erfinden — nur belegte Zahlen.
 */

export type WishPriceQuote = {
  priceEur: number | null;
  priceMinEur: number | null;
  priceMaxEur: number | null;
  eventUrl: string | null;
  note: string | null;
  evidenced: boolean;
};

/** „von 12 bis 25 €“ — stadt-agnostisch, kein Fake. */
export function formatVonBisEur(min: number, max: number): string {
  const a = Math.round(Math.min(min, max));
  const b = Math.round(Math.max(min, max));
  if (a === b) return `${a}€`;
  return `von ${a} bis ${b} €`;
}

export function formatWishPriceLabel(opts: {
  priceEur?: number | null;
  priceMinEur?: number | null;
  priceMaxEur?: number | null;
  costHint?: string | null;
}): string | null {
  if (opts.priceEur != null && opts.priceEur > 0) {
    return `${Math.round(opts.priceEur)}€`;
  }
  if (
    opts.priceMinEur != null &&
    opts.priceMaxEur != null &&
    opts.priceMinEur > 0 &&
    opts.priceMaxEur > 0
  ) {
    return formatVonBisEur(opts.priceMinEur, opts.priceMaxEur);
  }
  const hint = (opts.costHint || '').trim();
  if (hint) return hint;
  return null;
}

/** Parse einzelne € oder Spanne aus Text. */
export function parseCostRange(text: string): {
  min: number | null;
  max: number | null;
  exact: number | null;
  label: string | null;
} {
  const t = (text || '').replace(/\s+/g, ' ');
  const range =
    t.match(
      /(?:von\s+)?(\d{1,3})\s*(?:€|euro)?\s*(?:–|-|bis|to)\s*(\d{1,3})\s*€?/i,
    ) || t.match(/(\d{1,3})\s*–\s*(\d{1,3})\s*€/i);
  if (range?.[1] && range?.[2]) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min > 0 && max > 0 && min <= 500 && max <= 500) {
      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
        exact: min === max ? min : null,
        label: formatVonBisEur(min, max),
      };
    }
  }
  const one = t.match(
    /(?:ab\s+)?(\d{1,3})\s*€(?:\s*(?:\/|pro)\s*(?:h|std|stunde|court|platz|eintritt))?/i,
  );
  if (one?.[1]) {
    const n = Number(one[1]);
    if (n > 0 && n <= 500) {
      return { min: null, max: null, exact: n, label: `${n}€` };
    }
  }
  return { min: null, max: null, exact: null, label: null };
}

export function mergePriceIntoLabel(name: string, priceLabel: string | null | undefined): string {
  const n = (name || '').trim();
  const p = (priceLabel || '').trim();
  if (!n) return p || '';
  if (!p) return n;
  if (n.includes(p) || /\d\s*€/.test(n)) return n;
  return `${n} · ${p}`;
}

/**
 * Belegter Venue-/Event-Preis + Direktlink (Gemini Search).
 * Auswahl: Spanne; Entscheidung: priceEur + eventUrl wenn belegt.
 */
export async function lookupVenueLivePrice(opts: {
  venueName: string;
  city: string;
  dateKey?: string | null;
  kind?: string | null;
}): Promise<WishPriceQuote> {
  const empty: WishPriceQuote = {
    priceEur: null,
    priceMinEur: null,
    priceMaxEur: null,
    eventUrl: null,
    note: null,
    evidenced: false,
  };
  const name = (opts.venueName || '').trim();
  const city = (opts.city || '').trim();
  if (name.length < 2 || city.length < 2) return empty;

  try {
    const { hasGeminiApiKey, generateGeminiText } = await import('../../services/geminiService');
    if (!hasGeminiApiKey()) return empty;
    const { FINDUS_FEW_SHOT_DISCLAIMER } = await import(
      '../../services/concierge/findusResponsePolicy'
    );
    const when = opts.dateKey ? `am/um ${opts.dateKey}` : 'im Reisezeitraum';
    const kind = opts.kind || 'venue';
    const prompt = [
      FINDUS_FEW_SHOT_DISCLAIMER,
      `Belegter Eintritt/Ticket-Preis für „${name}“ in ${city} (${kind}), ${when}.`,
      'Google Search. Nur konkrete € von Ticket-/Venue-Seite.',
      'Wenn Spanne belegt: priceMinEur + priceMaxEur. Wenn ein Preis: priceEur.',
      'eventUrl = direkte Event-/Ticket-URL wenn gefunden (nicht nur Startseite der Stadt).',
      'JSON: {"priceEur":null,"priceMinEur":null,"priceMaxEur":null,"eventUrl":null,"note":"kurz","evidenced":false}',
    ].join('\n');
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      costModule: 'research',
      tier: 'lite',
      enableGoogleSearch: true,
      maxTokens: 360,
      temperature: 0.15,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
    });
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw || '') as Record<string, unknown>;
    } catch {
      const m = (raw || '').match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }
    }
    if (!parsed || parsed.evidenced !== true) return empty;
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 2000 ? Math.round(v) : null;
    let priceEur = num(parsed.priceEur);
    let priceMinEur = num(parsed.priceMinEur);
    let priceMaxEur = num(parsed.priceMaxEur);
    if (priceMinEur != null && priceMaxEur == null) priceMaxEur = priceMinEur;
    if (priceMaxEur != null && priceMinEur == null) priceMinEur = priceMaxEur;
    if (priceEur == null && priceMinEur != null && priceMaxEur != null && priceMinEur === priceMaxEur) {
      priceEur = priceMinEur;
    }
    const eventUrl =
      typeof parsed.eventUrl === 'string' && /^https?:\/\//i.test(parsed.eventUrl)
        ? parsed.eventUrl.trim()
        : null;
    const note = typeof parsed.note === 'string' ? parsed.note.slice(0, 80) : null;
    if (priceEur == null && priceMinEur == null && !eventUrl) return empty;
    return {
      priceEur,
      priceMinEur,
      priceMaxEur,
      eventUrl,
      note,
      evidenced: true,
    };
  } catch {
    return empty;
  }
}
