/**
 * Run: npx --yes tsx src/module2/pitch/pitchChoiceActions.smoke.test.ts
 */
import { pitchChoiceVisibleActions } from './pitchActions';
import type { QuickAction } from '../../types/concierge';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const option = {
  name: 'Chaos Comedy Club',
  lat: 53.86,
  lng: 10.68,
  actions: [
    {
      type: 'OPEN_URL' as const,
      label: 'ℹ️ Chaos Comedy Club',
      payload: {
        url: 'https://rausgegangen.de/events/lubeck-chaos-comedy-club-0/',
        destName: 'Theaterschiff',
      },
    },
    {
      type: 'START_NAVIGATION' as const,
      label: '📍 Theaterschiff',
      payload: { destName: 'Theaterschiff', destLat: 53.86, destLng: 10.68 },
    },
    {
      type: 'OPEN_URL' as const,
      label: '🗺️ Chaos Comedy Club',
      payload: { url: 'https://www.google.com/maps/search/?api=1&query=53.86,10.68' },
    },
  ] satisfies QuickAction[],
};

const before = pitchChoiceVisibleActions(option, false);
assert(
  before.every((a) => a.type !== 'START_NAVIGATION'),
  'no route before select',
);
assert(
  before.some((a) => /rausgegangen/.test(String(a.payload.url ?? ''))),
  'keeps found page',
);
assert(
  !before.some((a) => /maps\.google|🗺️/.test(`${a.label} ${a.payload.url ?? ''}`)),
  'coords-only maps stay hidden until a real place id exists',
);

const after = pitchChoiceVisibleActions(option, true);
assert(
  after.some((a) => a.type === 'START_NAVIGATION'),
  'route after select',
);
assert(
  after.some((a) => /rausgegangen/.test(String(a.payload.url ?? ''))),
  'keeps page after select',
);

const namedBefore = pitchChoiceVisibleActions(
  { ...option, showNavBeforeSelect: true },
  false,
);
assert(
  namedBefore.some((a) => a.type === 'START_NAVIGATION'),
  'named venue shows route before select',
);

console.log('pitchChoiceActions.smoke.test.ts OK');
