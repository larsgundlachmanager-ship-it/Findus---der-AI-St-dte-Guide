/**
 * ÖPNV-Ticket: Intent, Produktname, Shop-URL-Score — kein RN.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */

const PRICE_RE =
  /\b(wie\s+teuer|was\s+kostet|preis|kostet|teuer)\b/iu;
const TICKET_RE =
  /\b(tickets?|fahrkarte|fahrschein|einzelfahr|tagesticket)\b/iu;
const RIDE_RE =
  /\b(dafür|dafuer|für\s+die\s+(?:fahrt|bahn|route|verbindung)|öpnv|oepnv|hvv|bahn|bus)\b/iu;
const BUY_RE = /\b(kaufen|shop|buchen|lösen|loesen)\b/iu;

export function wantsTransitTicketFare(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\bparkticket\b/iu.test(t)) return false;
  if (/\b(kino|eintritt|museum|konzert|eventim)\b/iu.test(t) && !RIDE_RE.test(t)) {
    return false;
  }
  const price = PRICE_RE.test(t);
  const ticket = TICKET_RE.test(t);
  if (price && ticket) return true;
  if (price && RIDE_RE.test(t)) return true;
  if (ticket && BUY_RE.test(t)) return true;
  return false;
}

export function extractTicketProductName(blob: string): string | null {
  const t = String(blob || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(
    /\b((?:anonymes\s+)?(?:einzelkarte|einzelticket|einzelfahrschein|tageskarte|tagesticket|9-?\s*uhr-?karte|kurzstreckenkarte|streifenkarte|gruppenticket)(?:\s+(?:erwachsene[rn]?|kind))?)\b/iu,
  );
  const raw = (m?.[1] || '').replace(/\s+/g, ' ').trim();
  return raw || null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Verbund-/Bahn-Shop, nicht Wikipedia und nicht hohle Bahn-Startseite. */
export function scoreTransitTicketShopUrl(
  url: string,
  title?: string | null,
): number {
  if (!/^https?:\/\//i.test(url)) return -99;
  const host = hostOf(url);
  if (!host) return -99;
  const blob = `${url} ${title ?? ''}`.toLowerCase();
  let score = 0;
  if (
    /\/(fahrkarten|tickets?|ticketshop|shop|buchung|check-?in|einzelticket)/i.test(
      url,
    )
  ) {
    score += 12;
  }
  if (/ticket|fahrkarte|fahrschein|einzelkarte|e-?ticket/i.test(blob)) {
    score += 8;
  }
  if (/\bbahn\.de\b/i.test(host) && /buchung|fahrplan\/suche/i.test(url)) {
    score += 10;
  }
  if (/\bbahn\.de\b/i.test(host) && !/buchung|fahrplan/i.test(url)) {
    score -= 10;
  }
  if (
    /wikipedia|tripadvisor|facebook|instagram|google\.(com|de)$/i.test(host)
  ) {
    score -= 14;
  }
  return score;
}

export function pickTransitTicketShopUrls(opts: {
  sources?: Array<{ url: string; title?: string | null }>;
  extraUrls?: string[];
  minScore?: number;
  limit?: number;
}): Array<{ url: string; title?: string | null; score: number }> {
  const seen = new Set<string>();
  const scored: Array<{ url: string; title?: string | null; score: number }> =
    [];
  const push = (url: string, title?: string | null) => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    const score = scoreTransitTicketShopUrl(u, title);
    if (score < (opts.minScore ?? 6)) return;
    scored.push({ url: u, title, score });
  };
  for (const s of opts.sources ?? []) push(s.url, s.title);
  for (const u of opts.extraUrls ?? []) push(u, null);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 2);
}

export function dbJourneySearchUrl(fromName: string, toName: string): string | null {
  const so = fromName.replace(/\s+/g, ' ').trim();
  const zo = toName.replace(/\s+/g, ' ').trim();
  if (so.length < 2 || zo.length < 2) return null;
  const u = new URL('https://www.bahn.de/buchung/fahrplan/suche');
  u.searchParams.set('so', so);
  u.searchParams.set('zo', zo);
  u.searchParams.set('kl', '2');
  return u.toString();
}
