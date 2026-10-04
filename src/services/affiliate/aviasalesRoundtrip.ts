/**
 * Aviasales-Suche mit Hin+Rück — eigener Helper, weil Compact-URL sonst nur Hin kennt.
 */

function ymd(raw: string): string {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export function buildAviasalesRoundtripUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  returnDateKey?: string | null;
  adults?: number;
  marker?: string | null;
}): string {
  const from = opts.fromIata.trim().toUpperCase();
  const to = opts.toIata.trim().toUpperCase();
  const date = ymd(opts.dateKey);
  const ret = ymd(opts.returnDateKey || '');
  const adults = Math.max(1, Math.min(9, Math.floor(opts.adults ?? 1)));
  let code = `${from}${to}${adults}`;
  if (date) {
    const dd = date.slice(8, 10);
    const mm = date.slice(5, 7);
    if (ret && ret !== date) {
      const rdd = ret.slice(8, 10);
      const rmm = ret.slice(5, 7);
      code = `${from}${dd}${mm}${to}${rdd}${rmm}${adults}`;
    } else {
      code = `${from}${dd}${mm}${to}${adults}`;
    }
  }
  const u = new URL(`https://www.aviasales.com/search/${code}`);
  if (opts.marker?.trim()) u.searchParams.set('marker', opts.marker.trim());
  return u.toString();
}
