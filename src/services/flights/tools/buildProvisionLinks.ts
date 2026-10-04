/**
 * Provisions-Deep-Links (Kiwi / Aviasales) für gewähltes Fenster.
 */

import type { QuickAction } from '../../../types/concierge';
import { buildCheapFlightBookActions } from '../cheapFlightBook';
import type { FlightWishCandidate } from './flightWishTypes';

export function buildProvisionLinks(opts: {
  originIata: string;
  destIata: string;
  outboundDateKey: string;
  returnDateKey?: string | null;
  userText?: string | null;
  ranked?: FlightWishCandidate[];
}): QuickAction[] {
  const book = buildCheapFlightBookActions({
    originIata: opts.originIata,
    destIata: opts.destIata,
    dateKey: opts.outboundDateKey,
    returnDateKey: opts.returnDateKey ?? null,
    userText: opts.userText ?? 'günstig vergleichen',
  });
  const urls = new Set(
    book.filter((a) => a.type === 'OPEN_URL').map((a) => a.payload.url),
  );
  const out = [...book];
  for (const r of opts.ranked ?? []) {
    if (r.outboundDateKey === opts.outboundDateKey) continue;
    const extra = buildCheapFlightBookActions({
      originIata: opts.originIata,
      destIata: opts.destIata,
      dateKey: r.outboundDateKey,
      returnDateKey: r.returnDateKey ?? opts.returnDateKey ?? null,
      userText: opts.userText ?? 'Alternative Datum',
    }).filter((a) => a.type === 'OPEN_URL' && !urls.has(a.payload.url));
    for (const a of extra.slice(0, 1)) {
      urls.add(a.payload.url);
      out.push(a);
    }
    if (out.length >= 4) break;
  }
  return out.slice(0, 5);
}
