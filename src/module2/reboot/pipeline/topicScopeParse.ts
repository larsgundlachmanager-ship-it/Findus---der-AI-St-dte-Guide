/**
 * topicScope — Call 1 wählt 0–10 Turn-Paare für Call 2 (ohne RN-Deps).
 *
 * Hart: mode=new ⇒ turnsForCall2=0 und kein Live-Inventory.
 * Follow-up: Default 3 (reicht), max 10.
 */

export type TopicScope = {
  mode: 'new' | 'followup';
  turnsForCall2: number;
  inheritLiveInventory?: boolean;
};

export function parseTopicScope(raw: unknown): TopicScope {
  if (!raw || typeof raw !== 'object') {
    // Unbekannt → konservativ neu, keine Historie (kein Tennis→Wetter-Leak).
    return { mode: 'new', turnsForCall2: 0, inheritLiveInventory: false };
  }
  const o = raw as Record<string, unknown>;
  const mode =
    String(o.mode || 'new').toLowerCase() === 'followup' ? 'followup' : 'new';

  if (mode === 'new') {
    return {
      mode: 'new',
      turnsForCall2: 0,
      inheritLiveInventory: false,
    };
  }

  let turns =
    typeof o.turnsForCall2 === 'number' ? Math.round(o.turnsForCall2) : 3;
  turns = Math.max(1, Math.min(10, turns));
  return {
    mode: 'followup',
    turnsForCall2: turns,
    inheritLiveInventory: o.inheritLiveInventory === true,
  };
}
