/**
 * Gate: Lübeck-Szenario-Battery — Erwartungen an Blaupausen (kein Live-LLM).
 *
 *   npx tsx scripts/run-luebeck-scenario-gate.ts
 *   npm run test:luebeck-scenarios
 */

import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
import {
  expandLuebeckScenarios,
  utteranceImpliesSoonNav,
  utteranceNeedsTennisClarify,
  type ExpandedScenario,
} from '../src/module2/blueprints/luebeckScenarioBattery';
import { shouldSuppressNavActions } from '../src/module2/pitch/navActionPolicy';

function policyBlocksPresent(): void {
  const policy = readFileSync(
    join(REPO_ROOT, 'src/services/concierge/findusResponsePolicy.ts'),
    'utf8',
  );
  assert.ok(
    /FINDUS_ACTION_BOARD_LAW_BLOCK/.test(policy) &&
      /Route\/START_NAVIGATION NUR/i.test(policy),
    'Action-Board Law Block fehlt Route-Regel',
  );
  assert.ok(
    /FINDUS_SPORT_TRIP_THINK_AHEAD_BLOCK/.test(policy) &&
      /Match\/Training/i.test(policy),
    'Sport-Trip Think-Ahead fehlt',
  );
  assert.ok(
    /MITDENKEN vor hartem Morgen-Termin/i.test(policy),
    'Wake-Block ohne Frühstück-Mitdenken',
  );
}

function checkScenario(s: ExpandedScenario): string[] {
  const fails: string[] = [];
  const q = s.question;

  if (s.expect.noRouteUnlessSoon) {
    const soon = utteranceImpliesSoonNav(q);
    const visitAtMs = soon
      ? Date.now() + 5 * 60_000
      : Date.now() + 3 * 60 * 60_000;
    const suppress = shouldSuppressNavActions({
      visitAtMs,
      forceSoon: soon,
      planningActive: !soon,
    });
    if (!soon && !suppress) {
      fails.push('Route müsste unterdrückt sein (nicht soon)');
    }
    if (soon && suppress) {
      fails.push('Route müsste erlaubt sein (soon/explicit)');
    }
  }

  if (s.expect.mustClarifyVenue) {
    if (
      /\b(nahe|nähe).{0,24}tennis|tennis.{0,24}(nahe|nähe|hotel|unterkunft)/i.test(
        q,
      ) &&
      !/\b(phoenix|tc\s+\w+|tennisclub\s+\w+)\b/i.test(q)
    ) {
      if (!utteranceNeedsTennisClarify(q)) {
        fails.push('Tennis-Hotel ohne Club → Clarify-Heuristik muss greifen');
      }
    }
  }

  return fails;
}

policyBlocksPresent();

const scenarios = expandLuebeckScenarios(400);
assert.ok(scenarios.length >= 350, `zu wenige Szenarien: ${scenarios.length}`);

let failCount = 0;
const sampleFails: Array<{ id: string; q: string; fails: string[] }> = [];
for (const s of scenarios) {
  const fails = checkScenario(s);
  if (fails.length) {
    failCount += 1;
    if (sampleFails.length < 15) {
      sampleFails.push({ id: s.id, q: s.question, fails });
    }
  }
}

const byCat: Record<string, number> = {};
for (const s of scenarios) {
  byCat[s.category] = (byCat[s.category] ?? 0) + 1;
}

const report = {
  total: scenarios.length,
  failCount,
  byCategory: byCat,
  sampleFails,
  gateOk: failCount === 0,
};

const outDir = join(REPO_ROOT, 'data', 'liveQuality');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'luebeck-scenario-report.json'),
  JSON.stringify(report, null, 2),
  'utf8',
);
writeFileSync(
  join(outDir, 'luebeck-scenario-questions.json'),
  JSON.stringify(
    scenarios.map((s) => ({
      id: s.id,
      q: s.question,
      cat: s.category,
      expect: s.expect,
    })),
    null,
    2,
  ),
  'utf8',
);

console.log(
  `Lübeck-Szenarien: ${scenarios.length} | fails: ${failCount} | gate: ${
    report.gateOk ? 'OK' : 'FAIL'
  }`,
);
console.log('Kategorien:', byCat);
if (sampleFails.length) {
  console.log('Sample fails:', sampleFails);
}
if (!report.gateOk) process.exitCode = 1;
