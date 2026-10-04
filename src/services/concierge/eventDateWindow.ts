/**
 * Event-Zeitfenster aus User-Text — „vom 16. bis 20. Oktober“, STT „BSI“≈bis.
 * Stadt-agnostisch, kein Script.
 */

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  marz: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

export type EventDateWindow = {
  fromIso: string;
  toIso: string;
  /** Deutsch für Speech/Prompt, z. B. „16. September bis 20. Oktober“ */
  labelDe: string;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function labelDe(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  return `${fmt(from)} bis ${fmt(to)}`;
}

function monthNum(raw: string): number | null {
  const k = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue');
  return MONTHS[k] ?? MONTHS[raw.toLowerCase()] ?? null;
}

function buildDate(
  day: number,
  month: number,
  year: number,
): Date | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * Normalisiert STT-Rauschen: „BSI“ / „bis hin“ → bis.
 */
export function normalizeEventRangeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\bBSI\b/gi, 'bis')
    .replace(/\bbis\s+hin\b/gi, 'bis')
    .replace(/\bbis\s+zum\b/gi, 'bis')
    .replace(/\bbis\s+am\b/gi, 'bis')
    .trim();
}

/**
 * Extrahiert explizites Datumsfenster (Reise/Aufenthalt/Events).
 * Ohne Treffer → null (Caller bleibt bei „heute“).
 */
export function parseEventDateWindow(
  text: string,
  nowMs: number = Date.now(),
): EventDateWindow | null {
  const t = normalizeEventRangeText(text).toLowerCase();
  const now = new Date(nowMs);
  const year = now.getFullYear();

  // „vom 16. bis 20. Oktober“ / „16. bis 20 Oktober“ (ein Monat)
  let m = t.match(
    /\b(?:vom?\s+)?(\d{1,2})\.?\s*(?:bis|[-–])\s*(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sept|sep|okt|nov|dez)\b/iu,
  );
  if (m) {
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    const mo = monthNum(m[3]!);
    if (mo) {
      let y = year;
      let from = buildDate(d1, mo, y);
      let to = buildDate(d2, mo, y);
      if (from && to && to.getTime() < now.getTime() - 2 * 864e5) {
        y += 1;
        from = buildDate(d1, mo, y);
        to = buildDate(d2, mo, y);
      }
      if (from && to && to.getTime() >= from.getTime()) {
        return {
          fromIso: ymd(from),
          toIso: ymd(to),
          labelDe: labelDe(from, to),
        };
      }
    }
  }

  // „vom 16. September bis 20. Oktober“
  m = t.match(
    /\b(?:vom?\s+)?(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sept|sep|okt|nov|dez)\s*(?:bis|[-–])\s*(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sept|sep|okt|nov|dez)\b/iu,
  );
  if (m) {
    const d1 = Number(m[1]);
    const mo1 = monthNum(m[2]!);
    const d2 = Number(m[3]);
    const mo2 = monthNum(m[4]!);
    if (mo1 && mo2) {
      let y1 = year;
      let y2 = year;
      if (mo2 < mo1 || (mo2 === mo1 && d2 < d1)) y2 = year + 1;
      let from = buildDate(d1, mo1, y1);
      let to = buildDate(d2, mo2, y2);
      if (from && to && to.getTime() < now.getTime() - 2 * 864e5) {
        y1 += 1;
        y2 += 1;
        from = buildDate(d1, mo1, y1);
        to = buildDate(d2, mo2, y2);
      }
      if (from && to && to.getTime() >= from.getTime()) {
        return {
          fromIso: ymd(from),
          toIso: ymd(to),
          labelDe: labelDe(from, to),
        };
      }
    }
  }

  // „16.09.–20.10.“ / „16.9. bis 20.10.2026“
  m = t.match(
    /\b(?:vom?\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s*(?:bis|[-–])\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/,
  );
  if (m) {
    const d1 = Number(m[1]);
    const mo1 = Number(m[2]);
    const y1raw = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : year;
    const d2 = Number(m[4]);
    const mo2 = Number(m[5]);
    let y2 = m[6]
      ? Number(m[6].length === 2 ? `20${m[6]}` : m[6])
      : y1raw;
    if (!m[6] && (mo2 < mo1 || (mo2 === mo1 && d2 < d1))) y2 = y1raw + 1;
    let from = buildDate(d1, mo1, y1raw);
    let to = buildDate(d2, mo2, y2);
    if (from && to && to.getTime() < now.getTime() - 2 * 864e5 && !m[3]) {
      from = buildDate(d1, mo1, y1raw + 1);
      to = buildDate(d2, mo2, y2 + 1);
    }
    if (from && to && to.getTime() >= from.getTime()) {
      return {
        fromIso: ymd(from),
        toIso: ymd(to),
        labelDe: labelDe(from, to),
      };
    }
  }

  return null;
}

/** Offene „was geht“-Frage (nicht Named-Sport), ggf. mit Zeitraum. */
export function isOpenWhatsOnAsk(text: string): boolean {
  const t = normalizeEventRangeText(text).toLowerCase();
  return /\b(was\s+geht|was\s+[\s\S]{0,100}?\bgeht\b|was\s+ist\s+los|was\s+(?:da\s+)?los|was\s+läuft|was\s+laeuft|events?|veranstaltung|programm|unternehm|machen)\b/iu.test(
    t,
  );
}

/**
 * Datumsspanne / Stadt + „was geht / Events / was los“ —
 * Event-Recherche, kein Reisebüro (keine Buchungsreise).
 */
export function looksLikeDateWindowWhatsOnAsk(text: string): boolean {
  const t = normalizeEventRangeText(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Explizite Reise-Buchung → nicht Events-Only
  if (
    /\b(flug|fliegen|flieger|mietwagen|hotel\s+suchen|plane\s+mir|buch(?:e|en|ung)|reisebüro|reisebuero|urlaub\s+planen|wochenendurlaub\s+nach|kurztrip\s+nach)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  const hasWindow = Boolean(parseEventDateWindow(t));
  const hasCity =
    /\b(?:in|nach|bei)\s+[A-ZÄÖÜ][\p{L}'\-]{2,}/u.test(t) ||
    /\b[A-ZÄÖÜ][\p{L}'\-]{3,}(?:\s+[A-ZÄÖÜ][\p{L}'\-]{2,})?\b/u.test(t);
  const whatsOn =
    isOpenWhatsOnAsk(t) ||
    /\b(events?|veranstaltungen?|programm|festival|konzert|ausflug|sehensw(?:ürdigkeit|uerdigkeit)?)\b/iu.test(
      t,
    );
  if (whatsOn && (hasWindow || hasCity)) return true;
  // „wir sind vom 16. bis 20. in X“ + los/events oft in Folgesatz — Window+City reicht mit los/geht
  if (hasWindow && hasCity && /\b(los|geht|machen|unternehm|wissen)\b/iu.test(t)) {
    return true;
  }
  return false;
}
