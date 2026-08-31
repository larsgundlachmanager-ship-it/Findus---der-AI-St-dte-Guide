/**
 * Buchungs-Buttons nach belegter Günstig-Recherche (Kiwi vorgefüllt, optional Airline).
 */

import type { QuickAction } from '../../types/concierge';
import {
  buildKiwiSearchPageUrl,
  buildKiwiTravelpayoutsUrl,
  buildAviasalesSearchUrl,
} from '../affiliate/travelpayoutsPartners';
import {
  pickAffiliateOffer,
  type AffiliateOfferCandidate,
} from '../affiliate/affiliatePickOffer';
import { flightIdentity, userWantsCheapest } from '../affiliate/quoteIdentity';
import { preferredIataIdent } from './flightIdent';

export function parseResearchDateKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return iso?.[1] ?? null;
}

export function isAirlineBookUrl(url: string): boolean {
  if (!/^https:\/\//i.test(url)) return false;
  return !/google\.com\/travel\/flights|skyscanner\.|accounts\.google|kiwi\.com|aviasales|travelpayouts|tpx\.li/i.test(
    url,
  );
}

function flightSpreadOver(cheapest: number, other: number): boolean {
  if (!(cheapest > 0)) return false;
  return (other - cheapest) / cheapest > 0.15 + 1e-9;
}

export function buildCheapFlightBookActions(opts: {
  originIata: string;
  destIata: string;
  dateKey: string | null;
  ident?: string | null;
  clockHm?: string | null;
  airlineUrl?: string | null;
  airlineName?: string | null;
  adults?: number;
  userText?: string | null;
  kiwiPriceEur?: number | null;
  aviasalesPriceEur?: number | null;
}): QuickAction[] {
  const actions: QuickAction[] = [];
  const ident = opts.ident ? preferredIataIdent(opts.ident) : null;
  const adults = opts.adults && opts.adults > 0 ? opts.adults : 1;
  if (ident && opts.clockHm) {
    actions.push({
      type: 'SHOW_MORE',
      label: `${ident} ${opts.clockHm}`.slice(0, 22),
      payload: { textPrompt: `Nimm Flug ${ident} um ${opts.clockHm}` },
    });
  } else if (ident) {
    actions.push({
      type: 'SHOW_MORE',
      label: ident.slice(0, 22),
      payload: { textPrompt: `Nimm Flug ${ident}` },
    });
  }
  if (
    opts.dateKey &&
    /^[A-Z]{3}$/.test(opts.originIata) &&
    /^[A-Z]{3}$/.test(opts.destIata)
  ) {
    const page = buildKiwiSearchPageUrl({
      fromIata: opts.originIata,
      toIata: opts.destIata,
      dateKey: opts.dateKey,
      adults,
    });
    const kiwiTracked = buildKiwiTravelpayoutsUrl(page, {
      subId: 'cheapflight',
    });
    const aviasales = buildAviasalesSearchUrl({
      fromIata: opts.originIata,
      toIata: opts.destIata,
      dateKey: opts.dateKey,
      adults,
    });
    const identity = flightIdentity({
      fromIata: opts.originIata,
      toIata: opts.destIata,
      dateIso: opts.dateKey,
      adults,
    });
    const cheapestAsk = userWantsCheapest(opts.userText);
    const wantCompare = /\b(vergleich|alternativ|zweite?\s+quelle)\b/iu.test(
      String(opts.userText || ''),
    );
    const candidates: AffiliateOfferCandidate[] = [
      {
        id: 'kiwi',
        label: 'Bei Kiwi buchen',
        url: kiwiTracked,
        commissionScore: 64,
        deepLinkLevel: 'search',
        partnerPriceEur: opts.kiwiPriceEur,
        identity,
      },
      {
        id: 'aviasales',
        label: 'Aviasales vergleichen',
        url: aviasales,
        commissionScore: 58,
        deepLinkLevel: 'search',
        partnerPriceEur: opts.aviasalesPriceEur,
        identity,
      },
    ];
    const winner = pickAffiliateOffer(candidates, {
      userWantsCheapest: cheapestAsk,
    });
    const primary = winner ?? candidates[0]!;
    const other = candidates.find((c) => c.id !== primary.id) ?? candidates[1]!;
    const pPrimary = primary.partnerPriceEur;
    const pOther = other.partnerPriceEur;
    const spreadWide =
      typeof pPrimary === 'number' &&
      typeof pOther === 'number' &&
      flightSpreadOver(Math.min(pPrimary, pOther), Math.max(pPrimary, pOther));

    const kiwiIsPrimary = primary.id === 'kiwi';
    actions.push({
      type: 'OPEN_URL',
      label: kiwiIsPrimary ? 'Bei Kiwi buchen' : 'Bei Aviasales buchen',
      payload: { url: primary.url },
    });
    if (wantCompare || cheapestAsk || spreadWide || pPrimary == null) {
      actions.push({
        type: 'OPEN_URL',
        label: kiwiIsPrimary ? 'Aviasales vergleichen' : 'Kiwi vergleichen',
        payload: { url: other.url },
      });
    }
  }
  if (opts.airlineUrl && isAirlineBookUrl(opts.airlineUrl)) {
    const name = (opts.airlineName || 'Airline').trim().slice(0, 18);
    actions.push({
      type: 'OPEN_URL',
      label: `Bei ${name}`,
      payload: { url: opts.airlineUrl },
    });
  }
  return actions.slice(0, 5);
}
