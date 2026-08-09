/**
 * Laboe-Batterie — Classifier/Contract-Gate für die Laboe-device_must Szenarien.
 * Run: npm run test:laboe-battery
 *
 * Gerät: die deviceChecks bleiben manuell (GPS/Nav/Speech).
 */

import {
  formatLiveQualityReport,
  runLiveQualityHarness,
} from '../src/module2/jobs/liveQualityHarness';

const LABOE_IDS = new Set([
  'lq_laboe_fischbroetchen',
  'lq_laboe_what_is_this',
  'lq_laboe_story_followup',
  'lq_laboe_aldi_unique_nav',
  'lq_kiel_combo_park_pizza_foerde',
  'lq_ostsee_spikeball_compare',
  'lq_parking_ticket_statement',
  'lq_outfit_plan_weather',
  'lq_hotel_pool_stay22_prefill',
  'lq_kiel_party_tonight_links',
  'lq_tour_hour_prefs',
  'lq_veg_no_steakhouse',
  'lq_menu_links_required',
  'lq_spikeball',
  'lq_pannfisch_elb',
]);

const report = runLiveQualityHarness();
const rows = report.scenarios.filter((s) => LABOE_IDS.has(s.id));
const passed = rows.filter((s) => s.ok).length;
const total = rows.length;

console.log('=== Laboe-Batterie (Classifier-Gate) ===\n');
for (const s of rows) {
  const mark = s.ok ? 'OK  ' : 'FAIL';
  console.log(
    `${mark} ${s.id}\n     Q: ${s.question}\n     job ${s.gotJob} (expect ${s.expectJob}) conf=${s.confidence.toFixed(2)}`,
  );
  if (s.notes.length) console.log(`     notes: ${s.notes.join('; ')}`);
  if (s.deviceChecks.length) {
    console.log(`     device: ${s.deviceChecks.slice(0, 3).join(' · ')}`);
  }
  console.log('');
}

console.log(`Laboe gate: ${passed}/${total}`);
console.log(
  passed === total
    ? 'Classifier-Gate GRÜN — Gerätetests (deviceChecks) noch manuell.'
    : 'Classifier-Gate ROT — Jobs/Must-Haves zuerst fixen.',
);

// Full suite summary for context
console.log('\n--- Full suite ---');
console.log(formatLiveQualityReport(report));

if (passed < total) process.exit(1);
