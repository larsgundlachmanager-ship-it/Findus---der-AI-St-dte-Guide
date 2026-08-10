/**
 * Live-Qualität Runner — echte Fragen gegen Job-Contracts.
 *
 *   npx tsx scripts/run-live-quality.ts
 *   npx tsx scripts/run-live-quality.ts --must
 *   npm run test:live-quality
 *
 * Schreibt Report nach data/liveQuality/last-report.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  runLiveQualityHarness,
  formatLiveQualityReport,
  listDeviceMustQuestions,
} from '../src/module2/jobs/liveQualityHarness';

const mustOnly = process.argv.includes('--must');
const report = runLiveQualityHarness({
  tier: mustOnly ? 'device_must' : 'all',
});

const text = formatLiveQualityReport(report);
console.log(text);
console.log('');
console.log('— Device: diese Fragen jetzt in der App stellen —');
for (const q of listDeviceMustQuestions()) {
  console.log(`• ${q}`);
}

const outDir = join(process.cwd(), 'data', 'liveQuality');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'last-report.json');
writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`\nReport: ${outPath}`);

if (!report.gateOk) {
  process.exitCode = 1;
}
