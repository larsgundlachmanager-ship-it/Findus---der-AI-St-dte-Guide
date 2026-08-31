/**
 * Stadt-Chat Partition Gate — ohne RN.
 * Run: npx --yes tsx scripts/run-city-chat-partition-gate.ts
 */

import { foldCityKey } from '../src/services/navigation/landmarkAliases';
import {
  computeCityChatScope,
  keepCityStickyForFollowUp,
} from '../src/module2/context/cityChatScope';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(foldCityKey('Lübeck') === foldCityKey('Luebeck'), 'fold Lübeck');
assert(foldCityKey('Prisdorf') !== foldCityKey('Lübeck'), 'fold distinct');

// Explicit sidequest
{
  const s = computeCityChatScope({
    userText: 'Hotel in Hamburg',
    activeCity: 'Lübeck',
    stickyCity: 'Prisdorf',
    explicitCity: 'Hamburg',
  });
  assert(s.cityKey === foldCityKey('Hamburg'), 'explicit Hamburg');
  assert(s.source === 'explicit', 'explicit source');
}

// Fremder Sticky + neues Thema → Active
{
  const s = computeCityChatScope({
    userText: 'Wo kann man gut essen?',
    activeCity: 'Lübeck',
    stickyCity: 'Prisdorf',
  });
  assert(s.cityKey === foldCityKey('Lübeck'), 'no prisdorf leak on new ask');
  assert(s.source === 'active', 'forced active');
}

// Fremder Sticky + Follow-up → Sticky behalten (Hotel-Sidequest)
{
  assert(keepCityStickyForFollowUp('wie teuer'), 'follow-up detector');
  const s = computeCityChatScope({
    userText: 'wie teuer ist das',
    activeCity: 'Lübeck',
    stickyCity: 'Hamburg',
    liveInventoryOpen: true,
  });
  assert(s.cityKey === foldCityKey('Hamburg'), 'keep hamburg follow-up');
}

// Gleicher Sticky
{
  const s = computeCityChatScope({
    userText: 'Restaurant?',
    activeCity: 'Lübeck',
    stickyCity: 'Lübeck',
  });
  assert(s.cityKey === foldCityKey('Lübeck'), 'same-city sticky');
}

// Stadtwechsel-Simulation: Active wechselt, Sticky fremd, neues Thema
{
  const s = computeCityChatScope({
    userText: 'Zeig mir ein Café',
    activeCity: 'Lübeck',
    stickyCity: 'Prisdorf',
  });
  assert(s.cityHint === 'Lübeck', 'hint luebeck after switch');
}

console.log('city-chat-partition: OK');
