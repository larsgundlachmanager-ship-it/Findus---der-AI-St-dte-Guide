/**
 * Discover-Intents → Such-Hints für Pro/Light (Party, Spa, Geheimtipp…).
 */

import type { ReiseLedger } from '../types';
import { intentArcFromLedger, shortlistSearchBrief } from './shortlistFunnel';

export type DiscoverHint = {
  intent: string;
  searchQuery: string;
  tags: string[];
};

export function discoverHintsFromLedger(ledger: ReiseLedger): DiscoverHint | null {
  const intent = ledger.discoverIntent?.value;
  const dest = ledger.destinationHint?.value || ledger.corridor?.value || '';
  if (intent === 'lonely_beach') {
    return {
      intent,
      searchQuery: `einsame Strände wenig touristisch ${dest}`.trim(),
      tags: ['lonely', 'beach', 'low_tourist'],
    };
  }
  if (intent === 'low_tourist') {
    return {
      intent,
      searchQuery: `wenig touristisch Geheimtipp ${dest}`.trim(),
      tags: ['low_tourist', 'geheim'],
    };
  }
  if (intent === 'exclusive') {
    return {
      intent,
      searchQuery: `exklusiv besonderes Erlebnis wenig Masse ${dest}`.trim(),
      tags: ['exclusive', 'geheim'],
    };
  }
  if (intent === 'bargain' || intent === 'deal') {
    return {
      intent: 'bargain',
      searchQuery: `Schnäppchen günstige Flüge Off-Season ${dest}`.trim(),
      tags: ['deal', 'bargain'],
    };
  }
  if (intent) {
    return {
      intent,
      searchQuery: `${intent} ${dest}`.trim(),
      tags: [intent],
    };
  }

  // Kein expliziter Slot → aus Trip-Arc ableiten (Party/Spa/Kulisse/Roadtrip)
  const arc = intentArcFromLedger(ledger);
  if (arc === 'open') return null;
  return {
    intent: arc,
    searchQuery: shortlistSearchBrief(ledger),
    tags:
      arc === 'party'
        ? ['party', 'nightlife']
        : arc === 'spa'
          ? ['spa', 'wellness']
          : arc === 'scenic'
            ? ['scenic', 'geheim', 'viewpoint']
            : arc === 'roadtrip'
              ? ['roadtrip', 'must_see']
              : arc === 'beach'
                ? ['beach', 'sand']
                : [arc],
  };
}
