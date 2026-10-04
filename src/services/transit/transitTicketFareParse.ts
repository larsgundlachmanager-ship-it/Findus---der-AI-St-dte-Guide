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
  if (
    /\b(buchen|buchung|sparpreis|flexpreis|bahnticket|zugticket)\b/iu.test(t) &&
    /\b(bahn|zug|ice|ic\b|ticket|fahrkarte|nach)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /\b(tageskarte|tagesticket|9-?\s*uhr-?karte|deutschlandticket)\b/iu.test(t) &&
    /\b(preis|kostet|kaufen|lösen|loesen|brauche|brauch|welche)\b/iu.test(t)
  ) {
    return true;
  }
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

/** Bahncard → bahn.de `bc` (2. Klasse, weil `kl=2`). */
function bahncardParam(raw?: string | null): string | null {
  const t = (raw || '').trim().toLowerCase();
  if (t === '25') return '2';
  if (t === '50') return '4';
  if (t === '100') return '10';
  return null;
}

/**
 * Bahn-Suche mit Datum, Uhrzeit, Rückfahrt und optional Bahncard —
 * nicht nur Start/Ziel (sonst landet der Tap auf einem leeren Formular).
 */
export function buildDbJourneySearchUrl(opts: {
  from: string;
  to: string;
  dateKey?: string | null;
  /** Abfahrt HH:MM oder Date — füllt `hd` genauer. */
  departAt?: string | Date | null;
  returnDateKey?: string | null;
  bahncard?: string | null;
}): string | null {
  const so = (opts.from || '').replace(/\s+/g, ' ').trim();
  const zo = (opts.to || '').replace(/\s+/g, ' ').trim();
  if (so.length < 2 || zo.length < 2) return null;
  const u = new URL('https://www.bahn.de/buchung/fahrplan/suche');
  u.searchParams.set('so', so);
  u.searchParams.set('zo', zo);
  u.searchParams.set('kl', '2');

  let hdDate = (opts.dateKey || '').slice(0, 10);
  let hm = '08:00:00';
  if (opts.departAt instanceof Date && Number.isFinite(opts.departAt.getTime())) {
    const d = opts.departAt;
    hdDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
  } else if (typeof opts.departAt === 'string') {
    const m = opts.departAt.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) {
      hm = `${String(m[1]).padStart(2, '0')}:${m[2]}:00`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(hdDate)) {
    u.searchParams.set('hd', `${hdDate}T${hm}`);
    u.searchParams.set('hza', 'D');
  }
  const ret = (opts.returnDateKey || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ret) && ret !== hdDate) {
    u.searchParams.set('ar', 'true');
    u.searchParams.set('h2d', `${ret}T16:00:00`);
  }
  const bc = bahncardParam(opts.bahncard);
  if (bc) u.searchParams.set('bc', bc);
  return u.toString();
}

export function dbJourneySearchUrl(fromName: string, toName: string): string | null {
  return buildDbJourneySearchUrl({ from: fromName, to: toName });
}

/** ICE/IC/Fernverkehr oder klare A→B-Bahn → Buchungs-Deep-Link sinnvoll. */
export function looksLikeLongDistanceRailBooking(
  text: string,
  line?: string | null,
): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const ln = String(line || '');
  if (/\b(ice|ic\b|ece|railjet|nightjet|sparpreis|flexpreis|sitzplatz)\b/iu.test(t)) {
    return true;
  }
  if (/\b(ice|ic|ece|rj)\s*\d*/iu.test(ln)) return true;
  if (
    /\b(bahn|zug)\b/iu.test(t) &&
    /\bnach\b/iu.test(t) &&
    /\b(hamburg|berlin|münchen|muenchen|köln|koeln|frankfurt|stuttgart|dresden|leipzig|hannover|bremen|kiel|nürnberg|nuernberg)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Buchungs-Button für Live-Verbindung (bahn.de Suche mit Uhrzeit).
 * Kein Preis erfinden — nur Deep-Link.
 */
export function buildDbBookingOpenUrl(opts: {
  fromName: string;
  toName: string;
  departAt?: Date | null;
  userText?: string | null;
  line?: string | null;
}): { url: string; label: string } | null {
  const from = (opts.fromName || '').replace(/\s+/g, ' ').trim();
  const to = (opts.toName || '').replace(/\s+/g, ' ').trim();
  if (from.length < 2 || to.length < 2) return null;
  const text = opts.userText || '';
  const line = opts.line || '';
  const long =
    looksLikeLongDistanceRailBooking(text, line) ||
    looksLikeLongDistanceRailBooking(`${from} Bahn nach ${to}`, line);
  // Ziel-Journey mit klarem A→B: Link auch ohne ICE-Keyword
  if (!long && !(to.length >= 3 && (/\bnach\b/iu.test(text) || Boolean(opts.departAt)))) {
    return null;
  }
  const url = buildDbJourneySearchUrl({
    from,
    to,
    departAt: opts.departAt ?? null,
  });
  if (!url) return null;
  const ice = /\bice\b/iu.test(text) || /\bice\b/iu.test(line);
  return {
    url,
    label: ice ? 'ICE buchen' : 'Bahn ticket',
  };
}
