/**
 * Reboot-Szenario-Gate: Classifier + Intent-Routing + Lane-Heuristik.
 * Run: npm run test:reboot-scenarios
 *
 * Keine RN-/Agent-Imports (nur Jobs + leichte Regex-Spiegelung der Fact-Lanes).
 */

import {
  formatLiveQualityReport,
  getLiveQualitySuite,
  runLiveQualityHarness,
} from '../src/module2/jobs/liveQualityHarness';
import { classifyJob, getJobContract } from '../src/module2/jobs';
import type { FindusJobId } from '../src/module2/jobs/types';
import type { AgentIntent } from '../src/module2/types';

type LaneExpect =
  | 'amenity_nav'
  | 'combo_cluster'
  | 'pack_match'
  | 'parking_care'
  | 'agent_fallback';

function intentForJob(jobId: FindusJobId): AgentIntent {
  switch (jobId) {
    case 'dining_open':
    case 'dining_hard_match':
      return 'gastro';
    case 'nav_route':
    case 'transit_live':
    case 'taxi_rideshare':
    case 'parking_ev':
      return 'mobility';
    case 'stay_search':
    case 'luggage_practical':
    case 'mobility_rent':
      return 'booking';
    case 'weather_outfit':
      return 'umwelt';
    case 'emergency_care':
    case 'safety_lost':
    case 'friction_now':
      return 'emergency';
    case 'smalltalk_general':
      return 'smalltalk';
    default:
      return 'knowledge';
  }
}

function detectAmenity(text: string): boolean {
  return /\b(aldi|lidl|rewe|edeka|kaufland|netto|penny|supermarkt)\b/i.test(
    text,
  );
}

function isParking(text: string): boolean {
  return (
    /\bparkticket\b/i.test(text) ||
    (/\b(parkplatz|geparkt)\b/i.test(text) &&
      /\b(bis|gilt|uhr|\d{1,2}[:.]\d{2})\b/i.test(text))
  );
}

function isCombo(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  return (
    /\b(parken|parkplatz|kostenlos\s+parken|gratis\s+parken)\b/iu.test(t) &&
    /\b(pizza|takeaway|imbiss)\b/iu.test(t) &&
    /\b(förde|foerde|sonnenuntergang|aussicht)\b/iu.test(t)
  );
}

function isDeictic(text: string): boolean {
  return /\b(was\s+ist\s+das|was\s+für\s+ein\s+(?:ding|gebäude|denkmal)|hier\s+vor\s+(?:mir|uns))\b/iu.test(
    text,
  );
}

function previewLane(jobId: FindusJobId, text: string): LaneExpect {
  if (isParking(text)) return 'parking_care';
  if (detectAmenity(text)) return 'amenity_nav';
  if (
    isCombo(text) ||
    (jobId === 'day_plan_budget' &&
      /\b(parken|pizza|förde|foerde)\b/i.test(text))
  ) {
    return 'combo_cluster';
  }
  if (
    isDeictic(text) ||
    jobId === 'poi_identify' ||
    jobId === 'museum_theme' ||
    (jobId === 'fact_number' &&
      /\b(elbe|breite|hoch|meter|stufen|turm|denkmal)\b/i.test(text)) ||
    /\b(warum\s+(wurde|ist|steht)|erzähl\s+mir\s+(mehr|etwas|von))\b/i.test(
      text,
    )
  ) {
    return 'pack_match';
  }
  return 'agent_fallback';
}

function expectedLane(jobId: FindusJobId, text: string): LaneExpect | 'any' {
  if (detectAmenity(text)) return 'amenity_nav';
  if (isParking(text)) return 'parking_care';
  if (isCombo(text)) return 'combo_cluster';
  if (isDeictic(text) || jobId === 'poi_identify') return 'pack_match';
  if (jobId === 'fact_number' && /\bpunkte\b/i.test(text)) {
    return 'agent_fallback';
  }
  if (
    (jobId === 'sight_recommend' ||
      /\b(eine\s+stunde|noch\s+nicht\s+gesehen)\b/i.test(text)) &&
    /\b(stunde|gesehen|hafen)\b/i.test(text)
  ) {
    // Live-Lane hour_tour — Gate zählt sie unter agent_fallback-Äquivalent „nicht Pack/Amenity“
    return 'any';
  }
  if (
    [
      'dining_open',
      'dining_hard_match',
      'stay_search',
      'tonight_live',
      'nightlife_vibe',
      'weather_outfit',
      'activity_sport',
      'emergency_care',
      'transit_live',
      'sight_recommend',
      'nav_route',
      'safety_lost',
      'friction_now',
      'mobility_rent',
      'day_plan_budget',
    ].includes(jobId) &&
    !isCombo(text)
  ) {
    return 'agent_fallback';
  }
  return 'any';
}

const suite = getLiveQualitySuite();
const classifyReport = runLiveQualityHarness({ tier: 'all' });

let laneFails = 0;
let intentFails = 0;
const lines: string[] = ['=== Reboot Scenario Gate ===', ''];

for (const s of suite.scenarios) {
  const hit = classifyJob(s.question);
  const contract = getJobContract(hit.jobId);
  const intentOk = intentForJob(hit.jobId) === contract.agentIntent;
  const lane = previewLane(hit.jobId, s.question);
  const want = expectedLane(hit.jobId as FindusJobId, s.question);
  const laneOk = want === 'any' || lane === want;
  const classRow = classifyReport.scenarios.find((r) => r.id === s.id);
  const classOk = classRow?.ok ?? false;

  if (!intentOk) intentFails += 1;
  if (!laneOk) laneFails += 1;

  const ok = classOk && intentOk && laneOk;
  lines.push(
    `${ok ? 'OK  ' : 'FAIL'} ${s.id} · job=${hit.jobId} · lane=${lane}` +
      (want !== 'any' ? ` (expect ${want})` : '') +
      ` · intent=${contract.agentIntent}`,
  );
  if (!classOk) {
    lines.push(`     classify: ${classRow?.notes.join('; ') || 'fail'}`);
  }
  if (!intentOk) {
    lines.push(
      `     intent mismatch: ${intentForJob(hit.jobId)} vs ${contract.agentIntent}`,
    );
  }
  if (!laneOk) {
    lines.push(`     lane ${lane} ≠ ${want}`);
  }
}

const classOk = classifyReport.gateOk;
const totalLane = suite.scenarios.length;
const passedLane = totalLane - laneFails;
const passedIntent = totalLane - intentFails;

lines.push('');
lines.push(formatLiveQualityReport(classifyReport));
lines.push('');
lines.push(
  `Lane-Heuristik: ${passedLane}/${totalLane} · Intent↔Contract: ${passedIntent}/${totalLane}`,
);
lines.push(
  classOk && laneFails === 0 && intentFails === 0
    ? 'REBOOT GATE GRÜN'
    : 'REBOOT GATE ROT',
);

console.log(lines.join('\n'));

if (!classOk || laneFails > 0 || intentFails > 0) process.exit(1);
