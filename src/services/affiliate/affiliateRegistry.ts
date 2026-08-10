/**
 * Affiliate-Registry — commissionScore, deepLinkLevel, Partner-Priorität.
 * ActionBoard Partner active/inactive: siehe `actionBoard/partnerRouter.ts`
 * (Sales24 = inactive bis Credentials).
 */

import type { TravelpayoutsPartner } from './travelpayoutsPartners';
import { TRAVELPAYOUTS_PARTNERS } from './travelpayoutsPartners';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';

export type DeepLinkLevel = 'search' | 'category' | 'deep';

export type AffiliateOfferCandidate = {
  id: string;
  label: string;
  url: string;
  /** 0–100 — höher = attraktiver für Findus */
  commissionScore: number;
  deepLinkLevel: DeepLinkLevel;
  /** Live-Preis wenn bekannt (EUR) */
  partnerPriceEur?: number | null;
};

const COMMISSION_SCORE: Partial<Record<string, number>> = {
  bounce: 72,
  expedia: 82,
  tiqets: 74,
  travsim: 70,
  stay22: 68,
  getyourguide: 65,
  musement: 62,
  viator: 60,
  discovercars: 58,
  uber: 40,
  klook: 55,
  airalo: 50,
};

function scoreForPartnerId(id: string): number {
  return COMMISSION_SCORE[id] ?? 45;
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

/**
 * Partner bevorzugen wenn Preis ≤ bestNonPartner × 1.10 (Masterbook soft affiliate).
 */
export function pickAffiliateOffer(candidates: AffiliateOfferCandidate[]): AffiliateOfferCandidate | null {
  if (!candidates.length) return null;
  const withPrice = candidates.filter(
    (c) => typeof c.partnerPriceEur === 'number' && c.partnerPriceEur > 0,
  );
  if (withPrice.length >= 2) {
    const sorted = [...withPrice].sort(
      (a, b) => (a.partnerPriceEur ?? 0) - (b.partnerPriceEur ?? 0),
    );
    const best = sorted[0]!;
    const partner = sorted.find(
      (c) => c.commissionScore >= 50 && c.id !== best.id,
    );
    if (
      partner &&
      partner.partnerPriceEur != null &&
      best.partnerPriceEur != null &&
      partner.partnerPriceEur <= best.partnerPriceEur * 1.1
    ) {
      return partner;
    }
    return best;
  }
  return [...candidates].sort((a, b) => b.commissionScore - a.commissionScore)[0] ?? null;
}

export function travelpayoutsCandidates(): AffiliateOfferCandidate[] {
  return TRAVELPAYOUTS_PARTNERS.map(enrichPartnerCandidate);
}

/** Struktur-Hilfe für gesprochene Partner-Erwähnung — keine Stadt-Scripts. */
export function buildAffiliateSpeechBlueprint(input: {
  userNeed: string;
  offerLabel: string;
  reasonFromFacts?: string;
}): string {
  return [
    'AFFILIATE-SPEECH (Struktur — Wortlaut frei):',
    `1) Bedarf spiegeln: ${input.userNeed}`,
    input.reasonFromFacts
      ? `2) Warum passt: ${input.reasonFromFacts}`
      : '2) Nutzen aus belegten Fakten — nichts erfinden.',
    `3) Natürlich Partner nennen: ${input.offerLabel} — kein „Affiliate-Link“-Jargon.`,
    '4) Button/Deep-Link nur bei klarem Buchungswunsch oder User-Zustimmung.',
    FINDUS_FEW_SHOT_DISCLAIMER,
  ].join('\n');
}
