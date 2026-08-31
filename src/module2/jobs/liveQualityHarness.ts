/**
 * Live-Qualität — echte Fragen gegen Job-Contracts scoren.
 * Offline: Routing/Must-Haves/Contract. Device: Playbook-Checks manuell.
 */

import scenariosFile from '../../assets/data/liveQualityScenarios.v1.json';
import { classifyJob } from './classifyJob';
import { getJobContract } from './contracts';
import type { FindusJobId, JobFactKey, JobActionKey } from './types';

export type LiveQualityScenario = {
  id: string;
  tier: 'device_must' | 'device_should' | string;
  question: string;
  expectJob: FindusJobId | string;
  expectCommitment?: string[];
  expectMustHaves?: string[];
  expectSecondary?: string[];
  requireContractFacts?: string[];
  requireActions?: string[];
  deviceChecks?: string[];
};

export type LiveQualitySuite = {
  version: number;
  title: string;
  gpsHint?: string;
  passThreshold: number;
  devicePlaybook: string[];
  scenarios: LiveQualityScenario[];
};

export type ScenarioScore = {
  id: string;
  question: string;
  tier: string;
  ok: boolean;
  score: number;
  expectJob: string;
  gotJob: string;
  confidence: number;
  mustHavesOk: boolean;
  secondaryOk: boolean;
  contractOk: boolean;
  notes: string[];
  deviceChecks: string[];
};

export type LiveQualityReport = {
  atIso: string;
  title: string;
  passThreshold: number;
  passed: number;
  total: number;
  ratio: number;
  gateOk: boolean;
  mustPassed: number;
  mustTotal: number;
  mustGateOk: boolean;
  playbook: string[];
  gpsHint?: string;
  scenarios: ScenarioScore[];
};

const suite = scenariosFile as LiveQualitySuite;

export function getLiveQualitySuite(): LiveQualitySuite {
  return suite;
}

export function listDeviceMustQuestions(): string[] {
  return suite.scenarios
    .filter((s) => s.tier === 'device_must')
    .map((s) => s.question);
}

function scoreScenario(s: LiveQualityScenario): ScenarioScore {
  const notes: string[] = [];
  const hit = classifyJob(s.question);
  let points = 0;
  let max = 0;

  max += 2;
  const jobOk = hit.jobId === s.expectJob;
  if (jobOk) points += 2;
  else notes.push(`Job ${hit.jobId} ≠ ${s.expectJob}`);

  if (s.expectCommitment?.length) {
    max += 1;
    if (s.expectCommitment.includes(hit.commitment)) points += 1;
    else notes.push(`Commitment ${hit.commitment} nicht in [${s.expectCommitment.join(',')}]`);
  }

  const expectMh = s.expectMustHaves ?? [];
  let mustHavesOk = true;
  if (expectMh.length) {
    max += 1;
    const got = hit.mustHaves.map((m) => m.toLowerCase());
    mustHavesOk = expectMh.every((m) =>
      got.some((g) => g.includes(m.toLowerCase()) || m.toLowerCase().includes(g)),
    );
    if (mustHavesOk) points += 1;
    else notes.push(`Must-Haves fehlen: ${expectMh.join(', ')} (got ${hit.mustHaves.join(', ') || '—'})`);
  }

  const expectSec = s.expectSecondary ?? [];
  let secondaryOk = true;
  if (expectSec.length) {
    max += 1;
    secondaryOk = expectSec.every((id) => hit.secondaryJobIds.includes(id as FindusJobId));
    if (secondaryOk) points += 1;
    else
      notes.push(
        `Secondary fehlt: ${expectSec.join(', ')} (got ${hit.secondaryJobIds.join(', ') || '—'})`,
      );
  }

  max += 1;
  let contractOk = true;
  try {
    const c = getJobContract(hit.jobId);
    const needFacts = (s.requireContractFacts ?? []) as JobFactKey[];
    const needActs = (s.requireActions ?? []) as JobActionKey[];
    for (const f of needFacts) {
      if (!c.fastFacts.includes(f) && !c.slowFacts.includes(f)) {
        contractOk = false;
        notes.push(`Contract ohne Fakt ${f}`);
      }
    }
    for (const a of needActs) {
      if (!c.requiredActions.includes(a)) {
        // soft: action may be pending via deep fill — only note
        notes.push(`Contract requiredActions ohne ${a} (Deep-Fill ok)`);
      }
    }
    if (contractOk) points += 1;
  } catch {
    contractOk = false;
    notes.push('Contract fehlt');
  }

  const score = max > 0 ? points / max : 0;
  return {
    id: s.id,
    question: s.question,
    tier: s.tier,
    ok: jobOk && mustHavesOk && secondaryOk && score >= 0.75,
    score,
    expectJob: s.expectJob,
    gotJob: hit.jobId,
    confidence: hit.confidence,
    mustHavesOk,
    secondaryOk,
    contractOk,
    notes,
    deviceChecks: s.deviceChecks ?? [],
  };
}

/**
 * Offline/CI-Gate: Job-Routing + Contracts für alle Szenarien.
 */
export function runLiveQualityHarness(opts?: {
  tier?: 'device_must' | 'device_should' | 'all';
}): LiveQualityReport {
  const tier = opts?.tier ?? 'all';
  const list = suite.scenarios.filter((s) =>
    tier === 'all' ? true : s.tier === tier,
  );
  const scenarios = list.map(scoreScenario);
  const passed = scenarios.filter((s) => s.ok).length;
  const total = scenarios.length;
  const ratio = total ? passed / total : 0;
  const must = scenarios.filter((s) => s.tier === 'device_must');
  const mustPassed = must.filter((s) => s.ok).length;
  const mustTotal = must.length;
  const mustRatio = mustTotal ? mustPassed / mustTotal : 1;

  return {
    atIso: new Date().toISOString(),
    title: suite.title,
    passThreshold: suite.passThreshold,
    passed,
    total,
    ratio,
    gateOk: ratio >= suite.passThreshold && mustPassed === mustTotal,
    mustPassed,
    mustTotal,
    mustGateOk: mustPassed === mustTotal,
    playbook: suite.devicePlaybook,
    gpsHint: suite.gpsHint,
    scenarios,
  };
}

export function formatLiveQualityReport(report: LiveQualityReport): string {
  const lines = [
    report.title,
    `Gate: ${report.gateOk ? 'PASS' : 'FAIL'} · ${report.passed}/${report.total} (${Math.round(report.ratio * 100)}%)`,
    `device_must: ${report.mustPassed}/${report.mustTotal} · ${report.mustGateOk ? 'PASS' : 'FAIL'}`,
    report.gpsHint ? `GPS: ${report.gpsHint}` : '',
    '',
    '— Device Playbook —',
    ...report.playbook.map((p, i) => `${i + 1}. ${p}`),
    '',
    '— Szenarien —',
  ];
  for (const s of report.scenarios) {
    lines.push(
      `${s.ok ? '✓' : '✗'} [${s.tier}] ${s.id} → ${s.gotJob} (expect ${s.expectJob}) score=${s.score.toFixed(2)}`,
    );
    lines.push(`   Q: ${s.question}`);
    if (s.notes.length) lines.push(`   notes: ${s.notes.join('; ')}`);
    if (s.deviceChecks.length) {
      lines.push(`   device: ${s.deviceChecks.join(' · ')}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}
