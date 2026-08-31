/**
 * Karten-Vertrag: max 3 Stichpunkte aus der Speech, Buttons 1:1, Short-Answers nur Gabeln.
 */

import { clampVisualBullets } from '../../../services/concierge/visualBullets';
import { speakablePartnerUrl, type LinkCheck } from './partnerLinkCheck';
import { isTrueForkNotPermission } from './optionForks';

export type CardButton = {
  id: string;
  label: string;
  url?: string | null;
  spokenAnchor: string;
};

export type UiCard = {
  bullets: string[];
  buttons: CardButton[];
  shortAnswers: string[];
  offlineOnCard: false;
};

export function buildUiCard(opts: {
  speech: string;
  candidateBullets: string[];
  buttons: Array<{ id: string; label: string; url?: string | null; spokenAnchor: string }>;
  forkLabels?: string[];
  askedAddress?: boolean;
  partnerChecks?: LinkCheck[];
}): UiCard {
  const bullets = clampVisualBullets(opts.candidateBullets, {
    speechText: opts.speech,
    allowAddress: Boolean(opts.askedAddress),
  }).slice(0, 3);

  const buttons: CardButton[] = [];
  for (const b of opts.buttons) {
    const speechHas = opts.speech.toLowerCase().includes(b.spokenAnchor.toLowerCase());
    if (!speechHas) continue;
    if (b.url) {
      const check = (opts.partnerChecks ?? []).find((c) => c.url === b.url);
      if (check && !speakablePartnerUrl(check)) continue;
    }
    buttons.push({
      id: b.id,
      label: b.label.slice(0, 28),
      url: b.url ?? null,
      spokenAnchor: b.spokenAnchor,
    });
  }

  const shortAnswers = (opts.forkLabels ?? [])
    .filter((l) => isTrueForkNotPermission(l))
    .slice(0, 2);

  return { bullets, buttons, shortAnswers, offlineOnCard: false };
}
