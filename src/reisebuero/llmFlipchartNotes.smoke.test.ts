/**
 * Smoke: LLM-Flipchart Normalizer — keine Roh-Keys, keine Bullshit-Labels.
 */
import {
  ledgerFactsForFlipchart,
  normalizeLlmFlipchartNotes,
} from './llmFlipchartNotes';
import { cloneEmptyLedger, mergeLedger, entry } from './slotLedger';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const led = mergeLedger(cloneEmptyLedger(), {
  destinationHint: entry('Griechenland', 'user', 'must'),
  energy: entry('active_out', 'user', 'wish'),
  bahncard: entry('25', 'user', 'wish'),
});
const facts = ledgerFactsForFlipchart(led);
assert(facts.energy && (facts.energy as { value: string }).value === 'active_out', 'facts keep raw');
assert(facts.destinationHint, 'dest fact');

const notes = normalizeLlmFlipchartNotes({
  notes: [
    { id: 'dest', tier: 'critical', emoji: '🇬🇷', label: 'Richtung Griechenland' },
    { id: 'energy', tier: 'wish', emoji: '🏃', label: 'eher aktiv draußen' },
    { id: 'bc', tier: 'wish', emoji: '🚆', label: 'Bahncard 25 · eine Person' },
    { id: 'bad', tier: 'wish', emoji: '📌', label: 'active_out' },
    { id: 'bad2', tier: 'wish', emoji: '📌', label: 'cov:energy' },
    { id: 'open_q', tier: 'wish', emoji: '❓', label: 'Wie wichtig ist euch Strandnähe?' },
  ],
});
assert(notes.some((n) => /Griechenland/i.test(n.label)), 'dest label');
assert(notes.some((n) => /aktiv draußen/i.test(n.label)), 'human energy');
assert(notes.some((n) => /Bahncard/i.test(n.label)), 'bahncard');
assert(!notes.some((n) => n.label === 'active_out'), 'reject raw key');
assert(!notes.some((n) => /cov:/i.test(n.label)), 'reject cov');
assert(notes.some((n) => n.id === 'open_q' && /\?/.test(n.label)), 'open question sentence');

// Pins vom LLM → inhaltliche Emojis (nie alle 📌)
const remapped = normalizeLlmFlipchartNotes({
  notes: [
    { id: 'pool', tier: 'critical', emoji: '📌', label: 'Pool muss' },
    { id: 'grp', tier: 'high', emoji: '📌', label: '4 Leute' },
    { id: 'when', tier: 'high', emoji: '📍', label: 'Anreise 11.9.' },
    { id: 'bud', tier: 'critical', emoji: '📌', label: '300 € p.P.' },
    { id: 'fly', tier: 'wish', emoji: '📌', label: 'Flug ab Hamburg' },
    { id: 'keep', tier: 'wish', emoji: '🇬🇷', label: 'Richtung Griechenland' },
  ],
});
assert(remapped.find((n) => n.id === 'pool')?.emoji === '🏊', `pool emoji ${remapped.find((n) => n.id === 'pool')?.emoji}`);
assert(remapped.find((n) => n.id === 'grp')?.emoji === '👥', `grp emoji`);
assert(remapped.find((n) => n.id === 'when')?.emoji === '📅', `when emoji`);
assert(remapped.find((n) => n.id === 'bud')?.emoji === '💶', `bud emoji`);
assert(remapped.find((n) => n.id === 'fly')?.emoji === '✈️', `fly emoji`);
assert(remapped.find((n) => n.id === 'keep')?.emoji === '🇬🇷', 'keep concrete emoji');
assert(!remapped.some((n) => n.emoji === '📌' || n.emoji === '📍'), 'no pin leftovers');

// Extra rematch: Hotel / Strand / Auto / ÖPNV / Schnäppchen
{
  const more = normalizeLlmFlipchartNotes({
    notes: [
      { id: 'h', tier: 'wish', emoji: '📌', label: 'Hotel mit Frühstück' },
      { id: 'b', tier: 'wish', emoji: '📌', label: 'Strandnah' },
      { id: 'c', tier: 'wish', emoji: '📌', label: 'Auto mieten' },
      { id: 't', tier: 'wish', emoji: '📌', label: 'Bahn & ÖPNV' },
      { id: 'd', tier: 'wish', emoji: '📌', label: 'Schnäppchen' },
      { id: 'l', tier: 'wish', emoji: '📌', label: 'Zentrale Lage' },
    ],
  });
  assert(more.find((n) => n.id === 'h')?.emoji === '🥐', `hotel+bf ${more.find((n) => n.id === 'h')?.emoji}`);
  assert(more.find((n) => n.id === 'b')?.emoji === '🏖️', `beach ${more.find((n) => n.id === 'b')?.emoji}`);
  assert(more.find((n) => n.id === 'c')?.emoji === '🚗', `car ${more.find((n) => n.id === 'c')?.emoji}`);
  assert(more.find((n) => n.id === 't')?.emoji === '🚇', `transit ${more.find((n) => n.id === 't')?.emoji}`);
  assert(more.find((n) => n.id === 'd')?.emoji === '🔥', `deal ${more.find((n) => n.id === 'd')?.emoji}`);
  assert(more.find((n) => n.id === 'l')?.emoji === '📍', `lage may use map pin ${more.find((n) => n.id === 'l')?.emoji}`);
  assert(!more.some((n) => n.emoji === '📌'), 'never 📌 needle');
}

console.log('llmFlipchartNotes.smoke.test.ts OK');
