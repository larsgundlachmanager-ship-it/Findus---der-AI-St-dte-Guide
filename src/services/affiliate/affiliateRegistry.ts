/**
 * Affiliate-Registry — commissionScore, deepLinkLevel, Partner-Priorität.
 * ActionBoard Partner active/inactive: siehe `actionBoard/partnerRouter.ts`
 * (Sales24 = inactive bis Credentials).
 *
 * Preis vs. Provision: `affiliatePickOffer.ts`
 */

import type { TravelpayoutsPartner } from './travelpayoutsPartners';
import { TRAVELPAYOUTS_PARTNERS } from './travelpayoutsPartners';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';
import type { AffiliateOfferCandidate } from './affiliatePickOffer';

export type { AffiliateOfferCandidate, DeepLinkLevel } from './affiliatePickOffer';
export {
  AFFILIATE_COMMISSION_TIE_BAND,
  AFFILIATE_MAX_PRICE_DELTA,
  pickAffiliateOffer,
} from './affiliatePickOffer';

const COMMISSION_SCORE: Partial<Record<string, number>> = {
  bounce: 72,
  expedia: 82,
  tiqets: 74,
  camping_info: 71,
  camping_and_co: 88,
  solmar: 69,
  magic_life: 80,
  aida: 85,
  lidl_reisen: 74,
  weg_de: 73,
  check24: 78,
  ab_in_den_urlaub: 70,
  konfetti: 68,
  reservix: 72,
  economybookings_tpx: 76,
  travsim: 70,
  stay22: 68,
  kiwi: 64,
  getyourguide: 65,
  musement: 62,
  viator: 60,
  aviasales: 58,
  discovercars: 58,
  uber: 40,
  klook: 55,
  airalo: 50,
};

export function commissionScoreForId(id: string): number {
  return COMMISSION_SCORE[id] ?? 45;
}

function scoreForPartnerId(id: string): number {
  return commissionScoreForId(id);
}

export function enrichPartnerCandidate(
  partner: TravelpayoutsPartner,
): AffiliateOfferCandidate {
  return {
    id: partner.id,
    label: partner.label,
    url: partner.url,
    commissionScore: scoreForPartnerId(partner.id),
    deepLinkLevel: 'category',
  };
}

export function travelpayoutsCandidates(): AffiliateOfferCandidate[] {
  return TRAVELPAYOUTS_PARTNERS.map(enrichPartnerCandidate);
}

/** Struktur-Hilfe für Buchungs-CTAs — Provision nie ansagen. */
export function buildAffiliateSpeechBlueprint(input: {
  userNeed: string;
  offerLabel: string;
  reasonFromFacts?: string;
}): string {
  return [
    'BOOKING-CTA (Struktur — Wortlaut frei):',
    `1) Bedarf spiegeln: ${input.userNeed}`,
    input.reasonFromFacts
      ? `2) Warum passt: ${input.reasonFromFacts}`
      : '2) Nutzen aus belegten Fakten — nichts erfinden.',
    `3) Button-Label klar (${input.offerLabel}) — nie Affiliate/Provision/Tracking/„unser Partner“ in der Speech.`,
    '4) Deep-Link = finales Produkt/Zimmer/Ticket wenn belegt; Suche nur mit ehrlichem Such-Label.',
    FINDUS_FEW_SHOT_DISCLAIMER,
  ].join('\n');
}
