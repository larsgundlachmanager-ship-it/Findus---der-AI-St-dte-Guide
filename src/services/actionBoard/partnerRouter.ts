/**
 * Partner-Router — nur active Registry-Partner, Ranking via commissionScore.
 * Gebote: keine Keys im Prompt, inactive überspringen, ehrliche Labels.
 */

import {
  buildEsimAction,
  buildExpediaAccommodationAction,
  buildPrimaryAccommodationAction,
  buildStay22AccommodationAction,
  getExpediaCamref,
  normalizeAffiliateUrl,
} from '../affiliate/affiliateService';
import {
  pickAffiliateOffer,
  type AffiliateOfferCandidate,
} from '../affiliate/affiliateRegistry';
import type { QuickAction } from '../../types/concierge';
import type { ActionEntity, ActionOpportunityKind } from './types';
import { labelForOpportunity } from './labels';

export type RegistryPartnerStatus = 'active' | 'inactive';

export type RegistryPartner = {
  id: string;
  label: string;
  category:
    | 'hotel'
    | 'esim'
    | 'tickets'
    | 'tour'
    | 'car'
    | 'luggage'
    | 'insurance'
    | 'other';
  status: RegistryPartnerStatus;
  commissionScore: number;
  /** Platzhalter bis Credentials da sind */
  note?: string;
};

/**
 * Zentrale Partner-Liste. Sales24 o.ä. ohne IDs → inactive.
 * Tracking-IDs nur über Env / affiliateService — nie hier hardcoden.
 */
export const ACTION_BOARD_PARTNERS: RegistryPartner[] = [
  {
    id: 'expedia',
    label: 'Expedia',
    category: 'hotel',
    status: 'active',
    commissionScore: 82,
  },
  {
    id: 'stay22',
    label: 'Stay22',
    category: 'hotel',
    status: 'active',
    commissionScore: 68,
  },
  {
    id: 'travsim',
    label: 'travSIM',
    category: 'esim',
    status: 'active',
    commissionScore: 70,
  },
  {
    id: 'airalo',
    label: 'Airalo',
    category: 'esim',
    status: 'active',
    commissionScore: 50,
  },
  {
    id: 'getyourguide',
    label: 'GetYourGuide',
    category: 'tour',
    status: 'active',
    commissionScore: 65,
  },
  {
    id: 'tiqets',
    label: 'Tiqets',
    category: 'tickets',
    status: 'active',
    commissionScore: 74,
  },
  {
    id: 'bounce',
    label: 'Bounce',
    category: 'luggage',
    status: 'active',
    commissionScore: 72,
  },
  {
    id: 'sales24',
    label: 'Sales24',
    category: 'hotel',
    status: 'inactive',
    commissionScore: 0,
    note: 'Kein öffentliches Publisher-Programm gefunden — Slot bis Credentials inactive.',
  },
];

export function listActivePartners(
  category?: RegistryPartner['category'],
): RegistryPartner[] {
  return ACTION_BOARD_PARTNERS.filter(
    (p) =>
      p.status === 'active' &&
      (category == null || p.category === category) &&
      // Expedia nur wenn camref gesetzt
      (p.id !== 'expedia' || Boolean(getExpediaCamref())),
  ).sort((a, b) => b.commissionScore - a.commissionScore);
}

export function rankHotelPartner(): RegistryPartner | null {
  const active = listActivePartners('hotel');
  if (!active.length) return null;
  const candidates: AffiliateOfferCandidate[] = active.map((p) => ({
    id: p.id,
    label: p.label,
    url: '',
    commissionScore: p.commissionScore,
    deepLinkLevel: 'search',
  }));
  const pick = pickAffiliateOffer(candidates);
  return active.find((p) => p.id === pick?.id) ?? active[0] ?? null;
}

function looksLikeHotelBookUrl(url: string): boolean {
  return /expedia|stay22|booking\.com|hotels\.com|vrbo|hoteis\.com|affiliate/i.test(
    url,
  );
}

/** Hotel-Buchungs-Action — Research-Deeplink zuerst, sonst Suche mit Daten. */
export function buildHotelBookAction(
  entity: ActionEntity,
  opts?: {
    multiChoice?: boolean;
    checkin?: string;
    checkout?: string;
    adults?: number;
  },
): QuickAction {
  const dest = entity.name.trim();
  const checkin = opts?.checkin ?? entity.checkin;
  const checkout = opts?.checkout ?? entity.checkout;
  const adults = opts?.adults ?? entity.adults;
  const dateOpts = {
    ...(checkin ? { checkin } : {}),
    ...(checkout ? { checkout } : {}),
    ...(adults != null ? { adults } : {}),
  };
  const direct = (entity.bookUrl || entity.websiteUrl || '').trim();
  const label = labelForOpportunity('hotel_book', entity, {
    multiChoice: opts?.multiChoice,
    affiliate: true,
  });

  if (direct && /^https?:\/\//i.test(direct) && looksLikeHotelBookUrl(direct)) {
    return {
      type: 'OPEN_URL',
      label,
      payload: {
        url: normalizeAffiliateUrl(direct),
        destination: dest,
        destName: dest,
        entityName: dest,
        entityRank: entity.rank,
        affiliateMarked: true,
        actionBoardId: `hotel:${entity.rank}:${dest}`,
        ...dateOpts,
      },
    };
  }

  const winner = rankHotelPartner();
  // Hotelname + Stadt-Daten vorausfüllen — nicht nur generische Stadt-Suche
  let action: QuickAction;
  if (winner?.id === 'expedia' || (!winner && getExpediaCamref())) {
    action = buildExpediaAccommodationAction(dest, dateOpts);
  } else if (winner?.id === 'stay22') {
    action = buildStay22AccommodationAction(dest, dateOpts);
  } else {
    action = buildPrimaryAccommodationAction(dest);
  }
  return {
    ...action,
    label,
    payload: {
      ...action.payload,
      ...dateOpts,
      destination: dest,
      destName: dest,
      entityName: dest,
      entityRank: entity.rank,
      affiliateMarked: true,
      actionBoardId: `hotel:${entity.rank}:${dest}`,
    },
  };
}

export function buildEsimBoardAction(): QuickAction | null {
  const action = buildEsimAction();
  if (!action) return null;
  return {
    ...action,
    label: labelForOpportunity('esim', undefined, { affiliate: true }),
    payload: {
      ...action.payload,
      affiliateMarked: true,
      actionBoardId: 'esim:1',
    },
  };
}

export function partnerSupportsIntent(
  kind: ActionOpportunityKind,
): boolean {
  switch (kind) {
    case 'hotel_book':
      return listActivePartners('hotel').length > 0;
    case 'esim':
      return listActivePartners('esim').length > 0;
    case 'tickets':
    case 'tour_guide':
      return (
        listActivePartners('tickets').length > 0 ||
        listActivePartners('tour').length > 0
      );
    case 'luggage':
      return listActivePartners('luggage').length > 0;
    default:
      return true;
  }
}
