/**
 * Kaltstart-Stadtcheck: gleiche Stadt → skip, andere Stadt → Prompt.
 * Run: npx --yes tsx scripts/run-city-session-open-gate.ts
 */

import {
  CITY_SWITCH_PROMPT_COOLDOWN_MS,
  decideSessionOpenCitySwitch,
  isSameCity,
  pickSelectedCityKm,
  shouldHoldCitySwitchPrompt,
} from '../src/services/cityProximityDecision';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  isSameCity({ id: 'prisdorf', name: 'Prisdorf' }, { id: 'prisdorf', name: 'Prisdorf' }),
  'same id',
);
assert(
  !isSameCity({ id: 'prisdorf', name: 'Prisdorf' }, { id: 'luebeck', name: 'Lübeck' }),
  'prisdorf ≠ lübeck',
);
assert(
  isSameCity({ id: 'berlin-zentral', name: 'Berlin Zentral' }, { name: 'Berlin' }) ===
    false,
  'zentral id ≠ bare Berlin name without family',
);

const prisdorf = { id: 'prisdorf', name: 'Prisdorf' };

assert(
  decideSessionOpenCitySwitch({
    selected: { id: 'berlin-zentral', name: 'Berlin Zentral' },
    selectedKm: 4,
    nearest: { id: 'berlin-zentral', name: 'Berlin Zentral', km: 4 },
    locality: { name: 'Berlin', km: 0.5 },
  }).action === 'skip_same',
  'berlin family skip on cold start',
);

{
  const d = decideSessionOpenCitySwitch({
    selected: prisdorf,
    selectedKm: 55,
    nearest: { id: 'hamburg', name: 'Hamburg', km: 18 },
    locality: { name: 'Hamburg', km: 0.4 },
  });
  assert(d.action === 'prompt' && d.via === 'catalog', 'hamburg outskirts still prompt');
}

{
  const d = decideSessionOpenCitySwitch({
    selected: prisdorf,
    selectedKm: 3.2,
    nearest: { id: 'prisdorf', name: 'Prisdorf', km: 3.2 },
    locality: { name: 'Prisdorf', km: 0.4 },
  });
  assert(d.action === 'skip_same', 'cold start same city skips');
}

{
  const d = decideSessionOpenCitySwitch({
    selected: prisdorf,
    selectedKm: 78,
    nearest: { id: 'luebeck', name: 'Lübeck', km: 1.4 },
    locality: { name: 'Lübeck', km: 0.3 },
  });
  assert(d.action === 'prompt' && d.via === 'catalog', 'cold start other pack city prompts');
}

{
  const d = decideSessionOpenCitySwitch({
    selected: prisdorf,
    selectedKm: 22,
    nearest: { id: 'hamburg', name: 'Hamburg', km: 28 },
    locality: { name: 'Wedel', km: 0.2 },
  });
  assert(d.action === 'prompt' && d.via === 'soft', 'cold start soft city prompts');
}

{
  const d = decideSessionOpenCitySwitch({
    selected: prisdorf,
    selectedKm: 4,
    nearest: { id: 'pinneberg', name: 'Pinneberg', km: 11 },
    locality: { name: 'Prisdorf', km: 0.5 },
  });
  assert(d.action === 'skip_same', 'still in selected even if neighbor < 12km');
}

{
  const d = decideSessionOpenCitySwitch({
    selected: prisdorf,
    selectedKm: 9.5,
    nearest: { id: 'pinneberg', name: 'Pinneberg', km: 2.1 },
    locality: { name: 'Pinneberg', km: 0.4 },
  });
  assert(d.action === 'prompt' && d.via === 'catalog', 'now in neighbor city prompts');
}

{
  const d = decideSessionOpenCitySwitch({
    selected: prisdorf,
    selectedKm: 55,
    nearest: { id: 'hamburg', name: 'Hamburg', km: 40 },
    locality: null,
  });
  assert(d.action === 'no_target', 'far away without locality → no prompt');
}

{
  assert(
    shouldHoldCitySwitchPrompt({ lastPromptAtMs: 0 }) === false,
    'kein Prompt bisher → nicht halten',
  );
  const now = 1_700_000_000_000;
  assert(
    shouldHoldCitySwitchPrompt({
      lastPromptAtMs: now - 10 * 60_000,
      nowMs: now,
    }) === true,
    '10 Min nach Prompt noch halten',
  );
  assert(
    shouldHoldCitySwitchPrompt({
      lastPromptAtMs: now - CITY_SWITCH_PROMPT_COOLDOWN_MS + 1,
      nowMs: now,
    }) === true,
    'knapp unter 1 h noch halten',
  );
  assert(
    shouldHoldCitySwitchPrompt({
      lastPromptAtMs: now - CITY_SWITCH_PROMPT_COOLDOWN_MS,
      nowMs: now,
    }) === false,
    'nach 1 h wieder erlauben',
  );
}

{
  // Sticky „Athen“ mit Soft-Pin am User in Prisdorf → Airport-Fallback, nicht 0.4 km
  assert(
    pickSelectedCityKm({
      catalogKm: null,
      softKm: 0.4,
      softIsGluedAwayFromLocality: true,
      fallbackKm: 2100,
    }) === 2100,
    'glued soft Athen → fallback distance',
  );
  assert(
    pickSelectedCityKm({
      catalogKm: 3.2,
      softKm: 0.4,
      softIsGluedAwayFromLocality: true,
      fallbackKm: 2100,
    }) === 3.2,
    'catalog wins over glued soft',
  );
  assert(
    pickSelectedCityKm({
      catalogKm: null,
      softKm: 0.3,
      softIsGluedAwayFromLocality: false,
      fallbackKm: 2100,
    }) === 0.3,
    'soft ok when it matches locality',
  );
}

console.log('city-session-open: OK');
