/**
 * Vergleich nur bei gleichem Produkt + Datum + Personen.
 * Ohne Identity kein Quote-Call.
 */

export function userWantsCheapest(text?: string | null): boolean {
  return /\b(günstigst\w*|guenstigst\w*|am\s+günstig\w*|am\s+guenstig\w*|billigst\w*|preiswertest\w*|cheapest|lowest\s+price|so\s+günstig\s+wie\s+möglich)\b/iu.test(
    String(text || ''),
  );
}

export function ticketProductKey(url: string): string | null {
  const raw = String(url || '');
  const gyg = raw.match(/[-/]t(\d{4,})(?:[/?#]|$)/i);
  if (gyg) return `gyg:${gyg[1]}`;
  const tiq = raw.match(/-p(\d{4,})(?:[/?#]|$)/i);
  if (tiq) return `tiqets:${tiq[1]}`;
  const klook = raw.match(/\/activity\/(\d{3,})/i);
  if (klook) return `klook:${klook[1]}`;
  const kkday = raw.match(/\/product\/(\d{4,})/i);
  if (kkday) return `kkday:${kkday[1]}`;
  const konf = raw.match(/\/e\/([a-z0-9-]+)\/?(?:[?#]|$)/i);
  if (konf && /gokonfetti/i.test(raw)) return `konfetti:${konf[1]}`;
  const rxGroup = raw.match(/\/group\/(\d+)/i);
  if (rxGroup && /reservix/i.test(raw)) return `reservix:g${rxGroup[1]}`;
  const rxTicket = raw.match(/reservix\.de\/tickets\/([^/?#]+)/i);
  if (rxTicket) return `reservix:${rxTicket[1]!.toLowerCase()}`;
  const viator = raw.match(/\/d\d+-[^/?#]+/i);
  if (viator && /viator|tripadvisor/i.test(raw)) {
    return `viator:${viator[0].toLowerCase()}`;
  }
  const muse = raw.match(/musement\.com\/[^?\s]+/i);
  if (muse && /\/(\d{4,})/.test(raw)) {
    return `musement:${raw.match(/\/(\d{4,})/)?.[1]}`;
  }
  return null;
}

export function ticketIdentity(opts: {
  url: string;
  dateIso?: string | null;
  adults?: number | null;
}): string | null {
  const product = ticketProductKey(opts.url);
  if (!product) return null;
  const date =
    String(opts.dateIso || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] || '';
  const adults =
    opts.adults != null && opts.adults > 0
      ? Math.min(8, Math.floor(opts.adults))
      : 0;
  return `ticket:${product}:${date}:${adults || ''}`;
}

export function hotelIdentity(opts: {
  propertyId?: string | null;
  name?: string | null;
  city?: string | null;
  checkin?: string | null;
  checkout?: string | null;
  adults?: number | null;
}): string | null {
  const pid = String(opts.propertyId || '').replace(/\D/g, '');
  const name = String(opts.name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const key = pid ? `id:${pid}` : name ? `name:${name}` : null;
  if (!key) return null;
  const city = String(opts.city || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  const inD = String(opts.checkin || '').slice(0, 10);
  const outD = String(opts.checkout || '').slice(0, 10);
  const adults =
    opts.adults != null && opts.adults > 0
      ? Math.min(6, Math.floor(opts.adults))
      : 2;
  return `hotel:${key}:${city}:${inD}:${outD}:${adults}`;
}

export function flightIdentity(opts: {
  fromIata: string;
  toIata: string;
  dateIso?: string | null;
  adults?: number | null;
}): string | null {
  const from = opts.fromIata.trim().toUpperCase();
  const to = opts.toIata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const date =
    String(opts.dateIso || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] || '';
  if (!date) return null;
  const adults =
    opts.adults != null && opts.adults > 0
      ? Math.min(8, Math.floor(opts.adults))
      : 1;
  return `flight:${from}:${to}:${date}:${adults}`;
}

export function carIdentity(opts: {
  pickup?: string | null;
  pickupDate?: string | null;
  dropoffDate?: string | null;
  driverAge?: number | null;
}): string | null {
  const loc = String(opts.pickup || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 16);
  const a = String(opts.pickupDate || '').slice(0, 10);
  const b = String(opts.dropoffDate || '').slice(0, 10);
  if (!loc || !a) return null;
  const age =
    opts.driverAge != null && opts.driverAge >= 18
      ? Math.floor(opts.driverAge)
      : 24;
  return `car:${loc}:${a}:${b}:${age}`;
}

export function sameIdentity(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a === b);
}
