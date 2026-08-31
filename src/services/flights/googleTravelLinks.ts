/**
 * Google Flights / Skyscanner — Deep-Links für Web-Recherche (kein Button, keine Preis-API).
 */

export function buildGoogleFlightsSearchUrl(opts: {
  originIata: string;
  destIata: string;
  dateKey?: string | null;
  returnDateKey?: string | null;
}): string | null {
  const from = opts.originIata.trim().toUpperCase();
  const to = opts.destIata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const date = (opts.dateKey || '').trim();
  const back = (opts.returnDateKey || '').trim();
  const q =
    date && back
      ? `Flights from ${from} to ${to} on ${date} through ${back}`
      : date
        ? `Flights from ${from} to ${to} on ${date}`
        : `Flights from ${from} to ${to}`;
  return `https://www.google.com/travel/flights?hl=de&curr=EUR&q=${encodeURIComponent(q)}`;
}

export function buildSkyscannerSearchUrl(opts: {
  originIata: string;
  destIata: string;
  dateKey?: string | null;
}): string | null {
  const from = opts.originIata.trim().toLowerCase();
  const to = opts.destIata.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(from) || !/^[a-z]{3}$/.test(to)) return null;
  const date = (opts.dateKey || '').trim();
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const yy = m ? `${m[1]!.slice(2)}${m[2]}${m[3]}` : '';
  return yy
    ? `https://www.skyscanner.de/transport/flights/${from}/${to}/${yy}/`
    : `https://www.skyscanner.de/transport/flights/${from}/${to}/`;
}

export function buildGoogleHotelsSearchUrl(opts: {
  city: string;
  dateKey?: string | null;
}): string | null {
  const city = opts.city.trim();
  if (city.length < 2) return null;
  const date = (opts.dateKey || '').trim();
  const q = date ? `Hotels in ${city} ${date}` : `Hotels in ${city}`;
  return `https://www.google.com/travel/hotels?hl=de&q=${encodeURIComponent(q)}`;
}
