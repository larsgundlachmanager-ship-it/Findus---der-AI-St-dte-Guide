/**
 * Smoke: Gap-Engine Presence + Surprise-Anchor.
 */
import assert from 'node:assert/strict';
import {
  detectPresenceGap,
  detectSurpriseAnchorGap,
  detectMissionGaps,
  planFromGaps,
  applyGapPlan,
  buildDestAccessWorkChain,
  blocksExploreDriftForPresenceGap,
  hasOpenSurpriseAnchor,
} from './missionGapEngine';
import { applyMissionGapsToWork } from './applyMissionGaps';
import { formatAuftragStickyBlock, buildAuftragMemory } from './missionAuftragMemory';
import { clearFollowThroughGoal } from './missionFollowThrough';
import { finalizeCall1Execution } from './call1Dispatch';

clearFollowThroughGoal();

// --- Presence ---
assert.ok(
  detectPresenceGap({
    userText: 'Morgen in London Theater und Abendessen',
    gpsCity: 'Hamburg',
  }),
  'HAM→LON presence',
);
assert.equal(
  detectPresenceGap({
    userText: 'Morgen in London Theater',
    gpsCity: 'London',
  }),
  null,
  'same city no presence',
);
assert.ok(
  blocksExploreDriftForPresenceGap({
    userText: 'London erkunden und essen',
    gpsCity: 'Hamburg',
  }),
);

const presence = detectPresenceGap({
  userText: 'Morgen in London Theater und Abendessen',
  gpsCity: 'Hamburg',
})!;
const access = buildDestAccessWorkChain({ gap: presence });
assert.equal(access[0]?.id, 'access_to_dest');
assert.equal(access[0]?.executeWhen, 'now');

const gappedPresence = applyMissionGapsToWork({
  userText: 'Morgen in London Theater und Abendessen',
  gpsCity: 'Hamburg',
  work: [
    {
      id: 'local_dining',
      worker: 'dining',
      brief: 'Abendessen',
      proximity: 'city_best',
      executeWhen: 'now',
    },
  ],
});
assert.ok(gappedPresence.work.some((w) => w.id === 'access_to_dest'));
assert.equal(
  gappedPresence.work.find((w) => w.id === 'local_dining')?.executeWhen,
  'later',
);
assert.equal(
  gappedPresence.work.find((w) => w.id === 'local_dining')?.dependsOn,
  'access_to_dest',
);

// --- Surprise Anchor ---
const surprise = detectSurpriseAnchorGap({
  userText:
    'Ich hab Karten für Hamlet im Schauspielhaus, was essen wir danach?',
});
assert.ok(surprise, 'surprise theater');
assert.match(surprise!.venueHint, /Schauspielhaus|Theater/i);
assert.ok(hasOpenSurpriseAnchor({ userText: surprise ? 'Karten Theater' : '' }));

const gappedAnchor = applyMissionGapsToWork({
  userText:
    'Ich hab Karten für Hamlet im Schauspielhaus, was essen wir danach?',
  gpsCity: 'Hamburg',
  work: [],
});
assert.ok(gappedAnchor.work.some((w) => w.id === 'anchor_resolve'));
assert.ok(
  gappedAnchor.work.some(
    (w) =>
      (w.worker === 'dining' || w.id.includes('dining')) &&
      w.executeWhen === 'later' &&
      w.dependsOn === 'anchor_resolve',
  ),
  'dining after anchor',
);
assert.ok(gappedAnchor.plan.setAnchor?.name);

// Negativ: kein Ticket-Cue
assert.equal(
  detectSurpriseAnchorGap({ userText: 'Was geht heute Abend im Theater?' }),
  null,
  'program ask without booked cue is not surprise anchor',
);

// Combined Presence + Surprise
const both = detectMissionGaps({
  userText:
    'Morgen in London, ich hab Karten für Hamlet im Schauspielhaus, danach essen',
  gpsCity: 'Hamburg',
});
assert.ok(both.some((g) => g.kind === 'presence'));
assert.ok(both.some((g) => g.kind === 'surprise_anchor'));
const plan = planFromGaps({
  gaps: both,
  existingWork: [
    {
      id: 'd1',
      worker: 'dining',
      brief: 'essen danach',
      proximity: 'here_now',
      executeWhen: 'now',
    },
  ],
});
const merged = applyGapPlan(
  [
    {
      id: 'd1',
      worker: 'dining',
      brief: 'essen danach',
      proximity: 'here_now',
      executeWhen: 'now',
    },
  ],
  plan,
);
assert.ok(merged.some((w) => w.id === 'access_to_dest'));
assert.ok(merged.some((w) => w.id === 'anchor_resolve'));
const anc = merged.find((w) => w.id === 'anchor_resolve');
assert.equal(anc?.dependsOn, 'access_to_dest');

// Auftrag sticky format
const mem = buildAuftragMemory({
  kind: 'open_quest',
  rootLabel: 'London Theater + Essen',
  slots: {},
  work: merged,
  needBookingLink: false,
  presence: plan.presence,
  anchor: plan.setAnchor,
  gaps: both.map((g) => ({
    kind: g.kind,
    summary: g.kind === 'presence' ? 'GPS≠Zielstadt' : 'Ticket/Theater',
  })),
});
const sticky = formatAuftragStickyBlock('open_quest', mem);
assert.match(sticky, /Gap=/);
assert.match(sticky, /Presence=/);
assert.match(sticky, /Anchor=/);

// Dispatch: Presence-Gap mit gpsCity via detect (belt unit)
assert.ok(
  blocksExploreDriftForPresenceGap({
    userText: 'Morgen in London erkunden und essen',
    gpsCity: 'Hamburg',
  }),
  'presence blocks explore drift',
);
assert.equal(
  finalizeCall1Execution(
    {
      intentSummary: 'Theater Karten',
      session: 'new',
      chatLane: 'pitch',
      execution: 'pitch_module',
      bridge: 'Ok',
    } as any,
    'Ich hab Karten für Hamlet im Schauspielhaus, was essen wir danach?',
  ),
  'events_research',
  'surprise anchor → events_research not pitch',
);

clearFollowThroughGoal();
console.log('missionGapEngine.smoke.ts OK');
