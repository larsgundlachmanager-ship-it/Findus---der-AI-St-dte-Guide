/**
 * Compound → Plan-Kalender Skelett + Fanout-Enrich (Phase 2).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/compoundPlanIngest.smoke.test.ts
 */

import {
  shouldIngestCompoundPlan,
  buildCompoundPlanFromUtterance,
} from './compoundPlanIngestCore';
import {
  wishMatchesCompoundFact,
  applyCompoundFactHintsToWishes,
  extractFactNotes,
  hintFromFactSource,
  hintsFromMergedDraft,
} from './compoundPlanEnrichCore';
import { orchestrateUtterance } from '../reboot/pipeline/orchestrateSlots';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const HAMBURG =
  'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang.';

assert(shouldIngestCompoundPlan(HAMBURG), 'hamburg should ingest');
assert(
  !shouldIngestCompoundPlan('Wie alt ist der Papst?'),
  'pope should not ingest',
);
assert(
  !shouldIngestCompoundPlan(
    'Wie wird das Wetter und wie lange brauche ich da hin?',
  ),
  'weather+eta no ingest',
);

const plan = buildCompoundPlanFromUtterance({
  userText: HAMBURG,
  dayKeyHint: '2026-08-28',
  gpsCity: 'Prisdorf',
  lat: 53.68,
  lng: 9.76,
});

assert(plan != null, 'plan built');
assert(plan!.destinationCity === 'Hamburg', `dest=${plan!.destinationCity}`);
assert(
  plan!.openWishesQueue.length >= 4,
  `wishes=${plan!.openWishesQueue.length} ${plan!.openWishesQueue.map((w) => w.title).join(' | ')}`,
);
assert(
  plan!.openWishesQueue.some((w) =>
    /frühstück|fruehstueck/i.test(`${w.title} ${w.context}`),
  ),
  'breakfast wish',
);
assert(
  plan!.openWishesQueue.some((w) =>
    /pann|fisch|elbblick|michel/i.test(`${w.title} ${w.context}`),
  ),
  'meal/michel wish',
);
assert(
  plan!.openWishesQueue.some((w) =>
    /anreise|hamburg|los/i.test(`${w.title} ${w.context}`),
  ),
  'travel wish',
);
assert(plan!.tasks.length >= 3, `tasks=${plan!.tasks.length}`);

assert(
  wishMatchesCompoundFact(
    {
      title: 'Abendessen',
      priority: 5,
      context: 'Pannfisch mit Elbblick',
    },
    {
      placeName: 'Restaurant Elbblick',
      factText: 'Pannfisch mit Blick auf die Elbe',
      userText: HAMBURG,
    },
  ),
  'pannfisch wish matches dining fact',
);
assert(
  wishMatchesCompoundFact(
    { title: 'Michel', priority: 5, context: 'Michel rauf' },
    {
      placeName: 'St. Michaelis',
      factText: 'Der Michel ist 132m hoch',
      userText: HAMBURG,
    },
  ),
  'michel wish matches poi fact',
);

{
  const notes = extractFactNotes(
    'Der Michel ist ca. 132 m hoch. Eintritt: 6 Euro.',
  );
  assert(notes.some((n) => /132/.test(n)), `height note ${notes.join('|')}`);
  assert(notes.some((n) => /6/.test(n)), `price note ${notes.join('|')}`);
}

{
  const dining = hintFromFactSource({
    draftText: 'Pannfisch mit Elbblick am Hafen',
    meta: {
      destName: 'Fischrestaurant Elbblick',
      destLat: 53.546,
      destLng: 9.973,
      address: 'Elbchaussee 1',
    },
    lane: 'dining',
    jobHint: 'dining_hard_match',
    buttons: [
      {
        payload: {
          kind: 'navigate',
          lat: 53.546,
          lng: 9.973,
          label: 'Fischrestaurant Elbblick',
        },
      },
    ],
  });
  assert(dining != null && dining.lat != null, 'dining hint coords');

  const michel = hintFromFactSource({
    draftText: 'St. Michaelis — ca. 132 m, Eintritt 6 €',
    bullets: ['132 m', 'Eintritt 6 €'],
    lane: 'pack',
    jobHint: 'poi_identify',
    meta: {
      placeName: 'St. Michaelis Kirche',
      destLat: 53.5485,
      destLng: 9.978,
    },
  });
  assert(michel?.note && /132|6/.test(michel.note), 'michel note');

  const applied = applyCompoundFactHintsToWishes(
    plan!.openWishesQueue,
    [dining!, michel!],
    HAMBURG,
  );
  assert(applied.changed, 'enrich changed wishes');
  const meal = applied.wishes.find((w) =>
    /pann|fisch|elbblick|essen|abend/i.test(`${w.title} ${w.context}`),
  );
  const mic = applied.wishes.find((w) =>
    /michel/i.test(`${w.title} ${w.context}`),
  );
  assert(meal?.lat != null && meal?.lng != null, 'meal got coords');
  assert(
    /elbblick|fisch/i.test(meal!.context),
    `meal context ${meal!.context}`,
  );
  assert(
    mic?.lat != null || /132|6|michaelis/i.test(mic?.context ?? ''),
    'michel enriched',
  );
  if (mic?.lat != null && meal?.lat != null) {
    assert(
      Math.abs((mic.lat ?? 0) - (meal.lat ?? 0)) > 0.0005,
      'michel coords ≠ meal spray',
    );
  }
}

{
  const fromDraft = hintsFromMergedDraft(
    `### dining_hard_match (dining)\nPannfisch 24 € am Hafen\n\n### poi_identify (pack)\nMichel ca. 132 m, Eintritt 6 Euro`,
    null,
  );
  assert(fromDraft.length >= 2, `draft sections ${fromDraft.length}`);
  assert(
    fromDraft.some((h) =>
      /dining|pann|fisch/i.test(`${h.lane} ${h.factText}`),
    ),
    'dining section',
  );
  assert(
    fromDraft.some((h) =>
      /132|michel|poi|pack/i.test(`${h.lane} ${h.factText} ${h.note}`),
    ),
    'michel section',
  );
}

const orch = orchestrateUtterance(HAMBURG);
assert(orch.weaveDayPlan, 'still weaves');

console.log('[compound-plan-ingest] ok');
