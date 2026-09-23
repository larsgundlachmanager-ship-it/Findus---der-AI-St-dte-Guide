/**
 * Call-1 Denkrahmen + Autonomy-Szenarien smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1ThinkFrame.smoke.test.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CALL1_AUTONOMY_JSON_CHECKS,
  FINDUS_CALL1_THINK_FRAME,
} from './call1ThinkFrame';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  assert(/ORDER-TICKET|EINZIGER PLANER/i.test(FINDUS_CALL1_THINK_FRAME), 'think frame header');
  assert(/ZIEL/i.test(FINDUS_CALL1_THINK_FRAME), 'ziel');
  assert(/order\.must|must\[\]/i.test(FINDUS_CALL1_THINK_FRAME), 'order must');
  assert(/forbidSoftFill|Soft-Fill gegen must/i.test(FINDUS_CALL1_THINK_FRAME), 'no soft fill');
  assert(/GELÄNDER/i.test(FINDUS_CALL1_THINK_FRAME), 'geländer');
  assert(
    /Keine Preise\/Venues|keine Preise\/Venues/i.test(FINDUS_CALL1_THINK_FRAME),
    'no venues in bridge',
  );
  assert(!/nur diese 12 Familien/i.test(FINDUS_CALL1_THINK_FRAME), 'no closed catalog');
  assert(/Mode-Switch|nav_execute/i.test(FINDUS_CALL1_THINK_FRAME), 'mode-switch geländer');
  assert(/FRAGE-ART|Reise an sich|vor Ort/i.test(FINDUS_CALL1_THINK_FRAME), 'trip vs whats-on');
  assert(/GOLD|Situations-Geländer|selectedGoldKeys/i.test(FINDUS_CALL1_THINK_FRAME), 'gold');
  assert(/COMPOUND Essen|Prioritätsfrage|transit-Einzeiler/i.test(FINDUS_CALL1_THINK_FRAME), 'dining+taxi');
  assert(/order\.act|actions\[\]/i.test(FINDUS_CALL1_THINK_FRAME), 'intent act contract');
  assert(CALL1_AUTONOMY_JSON_CHECKS.includes('order_ticket_complete'), 'order check');
  assert(CALL1_AUTONOMY_JSON_CHECKS.length === 7, '7 checks');
}

{
  const path = join(
    process.cwd(),
    'src/assets/data/call1AutonomyScenarios.v1.json',
  );
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    scenarios: Array<{ id: string; question: string }>;
    checks: string[];
  };
  assert(raw.scenarios.length === 6, '6 autonomy scenarios');
  // JSON may still list 6 legacy checks — align subset
  assert(
    raw.checks.every((c) =>
      (CALL1_AUTONOMY_JSON_CHECKS as readonly string[]).includes(c),
    ),
    'checks align (subset)',
  );
  for (const s of raw.scenarios) {
    assert(s.id && s.question.length > 20, `scenario ${s.id}`);
  }
}

console.log('call1ThinkFrame.smoke.test.ts ok');
