/**
 * Run: npx --yes tsx src/services/diagnostics/costRates.smoke.test.ts
 */

import {
  CONS_GEMINI_IN_PER_M,
  geminiEur,
  mapGeminiTaskToModule,
  mapsEur,
  ttsEur,
} from './costRates';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function almost(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function run(): void {
  assert(mapGeminiTaskToModule('nav_parse') === 'nav', 'nav task');
  assert(mapGeminiTaskToModule('research') === 'research', 'research task');
  assert(mapGeminiTaskToModule('local_qa') === 'followup', 'followup task');
  assert(mapGeminiTaskToModule('story') === 'story', 'story task');
  assert(mapGeminiTaskToModule('generic') === 'other', 'generic stays other');

  const cons = geminiEur(1_000_000, 1_000_000, 'conservative');
  assert(
    almost(cons, CONS_GEMINI_IN_PER_M + 10),
    `conservative gemini 1M/1M = ${cons}`,
  );
  const lite = geminiEur(1_000_000, 1_000_000, 'efficient', 'lite');
  assert(almost(lite, 0.1 + 0.4), `efficient lite = ${lite}`);
  const pro = geminiEur(1_000_000, 0, 'efficient', 'pro');
  assert(pro > lite, 'pro ceiling beats lite even on efficient mode');

  assert(almost(mapsEur(10, 'conservative'), 0.3), '10 maps conservative');
  assert(almost(ttsEur(1000, 'conservative'), 0.065), '1k tts conservative');
  assert(almost(ttsEur(1000, 'efficient'), 0.065), '1k tts efficient = Pro overage');
  console.log('costRates.smoke.test.ts OK');
}

run();
