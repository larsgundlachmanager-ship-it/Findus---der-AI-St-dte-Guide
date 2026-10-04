import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const advisor = readFileSync(
  join(process.cwd(), 'src/services/alarms/wakeAlarmAdvisor.ts'),
  'utf8',
);
assert(advisor.includes("wakeMode: forceAdd ? 'add' : 'replace'"), 'explicit time replaces by default');
assert(advisor.includes('parseGermanClockHm'), 'wake uses German clock parser');
assert(!/wakeMode: forceReplace \? 'replace' : forceAdd \? 'add' : undefined/.test(advisor), 'no choice-default on explicit');

console.log('wakeExplicitReplace.smoke.test.ts: ok');
