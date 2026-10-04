/**
 * Taxi-Transfer-URL mit Flug-Ankunft vorbefüllen wenn nur Maps-Link da war.
 */

import type { ReiseLedger, ReiseOption, TransportChoice } from '../types';

function parseHm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m?.[1] ?? null;
}

function inboundFlight(opt: ReiseOption): TransportChoice | null {
  const tr =
    opt.transports?.find((t) => t.id === opt.selectedTransportId) ||
    opt.transports?.[0] ||
    null;
  if (tr?.kind === 'flight') return tr;
  return opt.transports?.find((t) => t.kind === 'flight') ?? null;
}

export function wireReisebueroTaxiPrefill(
  opt: ReiseOption,
  ledger: ReiseLedger,
): ReiseOption {
  if (ledger.transferPref?.value !== 'taxi' && ledger.transferPref?.value !== 'package') {
    return opt;
  }
  const url = opt.transferBookUrl || '';
  if (url && /uber\.com|welcomepickups|gettransfer|kiwitaxi|tpx\.li/i.test(url)) {
    return opt;
  }
  const flight = inboundFlight(opt);
  const arrive = flight?.arriveAt || flight?.departAt;
  const dateIso = (arrive || flight?.departDateKey || ledger.dateStart?.value || '').slice(
    0,
    10,
  );
  const timeHm = parseHm(arrive);
  if (!dateIso) return opt;

  try {
    const { buildTravelpayoutsCategoryAction } = require('../../services/affiliate/affiliateService') as {
      buildTravelpayoutsCategoryAction: (
        cat: string,
        o?: Record<string, unknown>,
      ) => import('../../types/concierge').QuickAction;
    };
    const city = ledger.destinationHint?.value || opt.placeName || '';
    const act = buildTravelpayoutsCategoryAction('transfer', {
      cityOrQuery: city,
      dateIso,
      timeHm,
      adults: ledger.partySize?.value ?? 2,
      luggage: ledger.bags?.value ?? 2,
    });
    const nextUrl = act.payload?.url;
    if (typeof nextUrl === 'string' && /^https?:\/\//i.test(nextUrl)) {
      return { ...opt, transferBookUrl: nextUrl };
    }
  } catch {
    /* soft */
  }
  return opt;
}
