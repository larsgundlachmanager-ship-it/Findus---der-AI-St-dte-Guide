/**
 * Compound Step-by-Step-Loop — Detect + soft entry (Node-smoke, kein RN).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/planStepLoop.smoke.test.ts
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const {
  looksLikePlanWalkthroughUtterance,
  looksLikeChaoticDayPlanUtterance,
  looksLikeSequencedMultiStopPlan,
  looksLikeModul5PlanUtterance,
  looksLikeSingleJustDoItRequest,
} = require('./planUtteranceGate') as typeof import('./planUtteranceGate');

const {
  shouldIngestCompoundPlan,
  buildCompoundPlanFromUtterance,
} = require('./compoundPlanIngestCore') as typeof import('./compoundPlanIngestCore');

const {
  shouldForceModul5Handoff,
} = require('./planHandoffGuard') as typeof import('./planHandoffGuard');

assert(
  looksLikePlanWalkthroughUtterance('Lass uns jeden Punkt durchgehen'),
  'jeden punkt',
);
assert(
  looksLikePlanWalkthroughUtterance('Punkte durchgehen'),
  'punkte durchgehen',
);
assert(
  looksLikePlanWalkthroughUtterance('Stück für Stück den Plan'),
  'stück für stück',
);
assert(
  looksLikePlanWalkthroughUtterance('__START_PLAN_STEP_LOOP__'),
  'chip token',
);
assert(
  !looksLikePlanWalkthroughUtterance('Wie wird das Wetter?'),
  'not weather',
);
assert(
  !looksLikePlanWalkthroughUtterance('Navigiere mich zum Hafen'),
  'not nav',
);

const HAMBURG =
  'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang.';

assert(shouldIngestCompoundPlan(HAMBURG), 'compound ingest');
const plan = buildCompoundPlanFromUtterance({
  userText: HAMBURG,
  frame: null,
  dayKeyHint: null,
  gpsCity: 'Hamburg',
  lat: 53.55,
  lng: 10,
});
assert(Boolean(plan?.openWishesQueue?.length), 'has wishes');
assert(
  (plan!.openWishesQueue.length ?? 0) >= 3,
  `wish count ${plan!.openWishesQueue.length}`,
);

// Spoken multi-slot without exact „planen“ verb still ingests
assert(
  shouldIngestCompoundPlan(
    'Morgen nach Hamburg, frühstücken, abends Pannfisch, Michel rauf, Must-Haves zwischendurch',
  ),
  'spoken multi-slot without plan-verb still ingests',
);

// Viele Abschnitte + Aufgaben → Planung (auch ohne „planen“)
assert(
  looksLikeChaoticDayPlanUtterance(
    'Morgens frühstücken, danach eine Tour, zwischendurch Must-Haves, abends essen gehen',
  ),
  'many sections + tasks = chaotic day plan',
);
assert(
  shouldIngestCompoundPlan(
    'Morgens frühstücken, danach eine Tour, zwischendurch Must-Haves, abends essen gehen',
  ),
  'many sections still ingest',
);

// Without active session, walkthrough alone must not force full M5 ingest path
assert(
  !shouldForceModul5Handoff('Punkte durchgehen'),
  'walkthrough alone no force without session',
);

// Abendplanung: erst essen, dann Theater → Modul 5 (nicht Single Just-Do-It)
const EVENING_SEQ = [
  'erst essen, dann theater',
  'Abendplanung erst essen dann Theater',
  'Heute Abend erst essen gehen, dann ins Theater',
] as const;
for (const q of EVENING_SEQ) {
  assert(looksLikeSequencedMultiStopPlan(q), `sequenced: ${q}`);
  assert(looksLikeChaoticDayPlanUtterance(q), `chaotic via sequenced: ${q}`);
  assert(looksLikeModul5PlanUtterance(q), `modul5: ${q}`);
  assert(shouldForceModul5Handoff(q), `force m5: ${q}`);
  assert(shouldIngestCompoundPlan(q), `compound ingest: ${q}`);
  assert(!looksLikeSingleJustDoItRequest(q), `not single jdi: ${q}`);
}

console.log('planStepLoop.smoke OK');
