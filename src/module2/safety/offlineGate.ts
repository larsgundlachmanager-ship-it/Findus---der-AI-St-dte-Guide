/**
 * Offline Graceful Degradation — Pipeline-Einstieg.
 */

import { readRucksackSync } from '../rucksack/rucksackStore';
import type { LogicNodeOutput } from '../types';

export const OFFLINE_SPEECH =
  'Die Frage kann ich gerade nicht beantworten. Geh wieder online, dann hake ich nach.';

export function isRucksackOffline(): boolean {
  return readRucksackSync().connectivity.offline === true;
}

export function offlineLogicFallback(): LogicNodeOutput {
  return {
    spokenDraft: OFFLINE_SPEECH,
    bullets: ['Frage so nicht beantwortbar', 'Wieder online gehen'].slice(0, 3),
    buttons: [
      {
        id: 'retry_online',
        label: '🔄 Später erneut',
        payload: { kind: 'ui', action: 'retry_when_online' },
      },
    ],
    moneyEur: [],
    warnings: ['offline'],
    offline: true,
  };
}
