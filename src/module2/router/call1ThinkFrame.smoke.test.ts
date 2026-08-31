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
  assert(/DENKRAHMEN/i.test(FINDUS_CALL1_THINK_FRAME), 'think frame header');
  assert(/ZIELZUSTAND/i.test(FINDUS_CALL1_THINK_FRAME), 'ziel');
  assert(/RECHERCHE/i.test(FINDUS_CALL1_THINK_FRAME), 'research');
  assert(/GELÄNDER/i.test(FINDUS_CALL1_THINK_FRAME), 'geländer');
  assert(/Keine Restaurant/i.test(FINDUS_CALL1_THINK_FRAME) || /keine Restaurant/i.test(FINDUS_CALL1_THINK_FRAME), 'no venues');
  assert(!/nur diese 12 Familien/i.test(FINDUS_CALL1_THINK_FRAME), 'no closed catalog');
  assert(CALL1_AUTONOMY_JSON_CHECKS.length === 6, '6 checks');
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
  assert(raw.scenarios.length === 5, '5 autonomy scenarios');
  assert(
    raw.checks.every((c) =>
      (CALL1_AUTONOMY_JSON_CHECKS as readonly string[]).includes(c),
    ),
    'checks align',
  );
  for (const s of raw.scenarios) {
    assert(s.id && s.question.length > 20, `scenario ${s.id}`);
  }
}

console.log('call1ThinkFrame.smoke.test.ts ok');
