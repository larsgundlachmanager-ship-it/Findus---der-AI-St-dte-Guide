/**
 * Phase 0B: Call-1 JSON (Gemini Lite + Denkrahmen) ohne RN-Import.
 * Run: npx --yes --package tsx@4.19.4 tsx scripts/phase0bCall1Probe.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { FINDUS_CALL1_THINK_FRAME } from '../src/module2/router/call1ThinkFrame';
import {
  heuristicTurnFrame,
  hardenWhenSlots,
  mergeTurnFrame,
  parseTurnFrameFromLlm,
} from '../src/module2/router/turnFrame';
import {
  mergeCall1Criteria,
  parseCall1Criteria,
} from '../src/module2/pitch/call1Criteria';

config({ path: join(process.cwd(), '.env') });

const SCENARIO_ID = process.env.PHASE0B_ID || 'aut_quiet_desk_outlet';
const OUT_DIR = join(process.cwd(), '.cursor', 'phase0b');
const API_KEY =
  process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
const MODEL =
  process.env.EXPO_PUBLIC_GEMINI_MODEL ||
  process.env.GEMINI_MODEL ||
  'gemini-flash-lite-latest';

type AutonomyFile = {
  scenarios: Array<{
    id: string;
    question: string;
    expectCall1Thinks: string[];
  }>;
};

function buildPrompt(userText: string, city: string): string {
  return [
    'Du bist der Yorro-Planer (Call-1). Antworte NUR als JSON.',
    'JSON-Reihenfolge: bridge, execution, session, lane zuerst.',
    FINDUS_CALL1_THINK_FRAME,
    '',
    'Felder (min): bridge, execution, lane, session, intentSummary, authorIntent, call2Brief,',
    'mustHaves, criteria[{key,role,weight}], when[{kind,at,dateKey,label}], destCity,',
    'work[{id,worker,brief,mustHaves}], needsResearch, pace, cityScope.',
    'execution: chat_lane|pitch_module|flight_advisor|plan_module|events_research|nav_execute|reisebuero|…',
    '',
    `GPS-START: ${city}`,
    `USER: ${userText}`,
  ].join('\n');
}

async function callGemini(prompt: string): Promise<Record<string, unknown>> {
  if (!API_KEY) throw new Error('Missing GEMINI API key in .env');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`No JSON in model output: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const raw = JSON.parse(
    readFileSync(
      join(process.cwd(), 'src/assets/data/call1AutonomyScenarios.v1.json'),
      'utf8',
    ),
  ) as AutonomyFile;
  const scenario =
    raw.scenarios.find((s) => s.id === SCENARIO_ID) || raw.scenarios[0]!;
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('Phase0B scenario:', scenario.id);
  console.log('Q:', scenario.question);

  const city = 'Prisdorf';
  const parsed = await callGemini(buildPrompt(scenario.question, city));
  const heuristic = heuristicTurnFrame(scenario.question, city);
  const llmFrame = parseTurnFrameFromLlm(parsed, city);
  const frame = mergeTurnFrame(llmFrame, heuristic);
  const criteria = mergeCall1Criteria({
    criteria: parseCall1Criteria(parsed.criteria),
    mustHaves: Array.isArray(parsed.mustHaves)
      ? parsed.mustHaves.map((x) => String(x))
      : [],
  });
  // Extra harden mirror (merge already hardens)
  frame.when = hardenWhenSlots(frame.when, heuristic.when);

  const slim = {
    scenarioId: scenario.id,
    question: scenario.question,
    at: new Date().toISOString(),
    model: MODEL,
    bridge: parsed.bridge ?? null,
    execution: parsed.execution ?? null,
    lane: parsed.lane ?? null,
    session: parsed.session ?? null,
    intentSummary: parsed.intentSummary ?? null,
    authorIntent: parsed.authorIntent ?? null,
    call2Brief: parsed.call2Brief ?? null,
    mustHaves: parsed.mustHaves ?? [],
    criteria,
    when: frame.when,
    destCity: frame.destCity,
    work: frame.tasks,
    needsResearch: parsed.needsResearch ?? null,
    pace: parsed.pace ?? null,
    cityScope: parsed.cityScope ?? null,
    rawParsed: parsed,
  };

  const path = join(OUT_DIR, `${scenario.id}-call1.json`);
  writeFileSync(path, JSON.stringify(slim, null, 2), 'utf8');

  const author =
    String(slim.authorIntent || slim.call2Brief || slim.intentSummary || '');
  const checks: Record<string, boolean> = {
    ziel_klar: author.length > 8,
    luecken_ehrlich: !(
      !/\d{1,2}([:.]\d{2})?\s*uhr|\b\d{1,2}:\d{2}\b/i.test(scenario.question) &&
      frame.when.some((w) => w.kind === 'clock' && Boolean(w.at))
    ),
    work_sinnvoll:
      frame.tasks.length > 0 ||
      ['pitch_module', 'chat_lane', 'events_research', 'nav_execute', 'plan_module'].includes(
        String(slim.execution || ''),
      ),
    keine_venues_in_call1: !criteria.some(
      (c) =>
        /\b(restaurant|café|cafe|hotel)\b/i.test(c.key) &&
        /[A-ZÄÖÜ]/.test(c.key),
    ),
    execution_passend: Boolean(slim.execution),
    call2Brief_struktur: author.length > 5,
  };

  const checkPath = join(OUT_DIR, `${scenario.id}-checks.json`);
  writeFileSync(
    checkPath,
    JSON.stringify(
      { scenarioId: scenario.id, checks, expect: scenario.expectCall1Thinks },
      null,
      2,
    ),
    'utf8',
  );

  console.log('Wrote', path);
  console.log('Wrote', checkPath);
  console.log('Checks:', checks);
  console.log('\n--- Call-1 (ohne raw) ---');
  const { rawParsed: _r, ...rest } = slim;
  console.log(JSON.stringify(rest, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
