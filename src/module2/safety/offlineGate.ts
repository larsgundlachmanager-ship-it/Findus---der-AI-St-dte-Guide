/**
 * Offline Graceful Degradation — Pipeline-Einstieg.
 */

import { readRucksackSync } from '../rucksack/rucksackStore';
import type { LogicNodeOutput } from '../types';

export const OFFLINE_SPEECH =
  'Entschuldige, mein Netz ist gerade weg. Dein letzter Planungsstand ist lokal gespeichert, ich melde mich, sobald wir wieder online sind.';

export function isRucksackOffline(): boolean {
  return readRucksackSync().connectivity.offline === true;
}

export function offlineLogicFallback(): LogicNodeOutput {
  const plan = readRucksackSync().futurePlan;
  const stopHint =
    plan.stops[0]?.title != null
      ? `Als Nächstes war ${plan.stops[0].title} geplant.`
      : 'Dein Plan bleibt lokal erhalten.';
  return {
    spokenDraft: `${OFFLINE_SPEECH} ${stopHint}`,
    bullets: ['Offline — lokaler Cache', stopHint].slice(0, 3),
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
