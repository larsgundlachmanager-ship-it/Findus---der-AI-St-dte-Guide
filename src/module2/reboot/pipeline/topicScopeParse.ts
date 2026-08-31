/**
 * topicScope — Call 1 wählt 0–10 Turn-Paare für Call 2 (ohne RN-Deps).
 */

export type TopicScope = {
  mode: 'new' | 'followup';
  turnsForCall2: number;
  inheritLiveInventory?: boolean;
};

export function parseTopicScope(raw: unknown): TopicScope {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'new', turnsForCall2: 2 };
  }
  const o = raw as Record<string, unknown>;
  const mode =
    String(o.mode || 'new').toLowerCase() === 'followup' ? 'followup' : 'new';
  let turns =
    typeof o.turnsForCall2 === 'number' ? Math.round(o.turnsForCall2) : 2;
  turns = Math.max(0, Math.min(10, turns));
  if (mode === 'new') turns = Math.min(turns, 2);
  return {
    mode,
    turnsForCall2: turns,
    inheritLiveInventory: o.inheritLiveInventory === true,
  };
}
