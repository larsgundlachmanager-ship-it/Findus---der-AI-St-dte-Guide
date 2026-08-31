/**
 * Call-3 Rethink-Once smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/reboot/pipeline/call3Rethink.smoke.test.ts
 */
import {
  FINDUS_CALL3_RETHINK_ONCE,
  resolveRethinkTail,
  shouldRunCall3Rethink,
} from './call3Rethink';
import type { CompletenessReport } from '../../jobs/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(/RETHINK/i.test(FINDUS_CALL3_RETHINK_ONCE), 'doc block');

assert(
  shouldRunCall3Rethink({
    bullets: [],
    followUp: { needed: true, reason: 'menu_prices', delegateTo: 'call3' },
  }),
  'explicit call3',
);
assert(
  !shouldRunCall3Rethink({
    bullets: [],
    followUp: { needed: true, reason: 'x', delegateTo: 'none' },
  }),
  'delegate none skips',
);

const report: CompletenessReport = {
  jobId: 'dining_hard_match',
  ok: false,
  missing: [
    {
      key: 'hard_match_evidence',
      lane: 'fast',
      severity: 'must',
      note: 'no evidence',
    },
  ],
  pendingActionHints: [],
};

const fromGap = resolveRethinkTail({ existing: null, completeness: report });
assert(fromGap?.followUp?.needed === true, 'completeness triggers rethink');
assert(fromGap?.followUp?.delegateTo === 'call3', 'delegate call3');
assert(
  fromGap?.followUp?.reason === 'missing_must_fact',
  `reason=${fromGap?.followUp?.reason}`,
);

const keep = resolveRethinkTail({
  existing: {
    bullets: [],
    followUp: { needed: true, reason: 'speisekarte_url', delegateTo: 'call3' },
  },
  completeness: report,
});
assert(keep?.followUp?.reason === 'speisekarte_url', 'existing tail wins');

const noop = resolveRethinkTail({
  existing: null,
  completeness: { jobId: 'fact_number', ok: true, missing: [], pendingActionHints: [] },
});
assert(noop === null, 'no gap no rethink');

{
  const { shouldQueueAutoDeepFill } = require('./call3Rethink') as typeof import('./call3Rethink');
  assert(
    !shouldQueueAutoDeepFill({
      call3DeepFillRan: true,
      skipAutoDeep: false,
      completenessForce: true,
      silentSlowPending: true,
    }),
    'no double deep after call3',
  );
  assert(
    shouldQueueAutoDeepFill({
      call3DeepFillRan: false,
      skipAutoDeep: false,
      completenessForce: true,
      silentSlowPending: false,
    }),
    'auto deep when call3 skipped',
  );
  assert(
    !shouldQueueAutoDeepFill({
      call3DeepFillRan: false,
      skipAutoDeep: true,
      completenessForce: true,
      silentSlowPending: false,
    }),
    'live skip auto deep',
  );
}

console.log('call3Rethink.smoke.test.ts ok');
