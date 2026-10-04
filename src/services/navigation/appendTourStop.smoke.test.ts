/**
 * Stopp hinzu = wie Speech: Tour-SSOT + Live-Timeline-Spiegel.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/appendTourStop.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tour = readFileSync(
  join(process.cwd(), 'src/services/navigation/multiStopTour.ts'),
  'utf8',
);
const homeNav = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapNavStart.ts'),
  'utf8',
);
const resolve = readFileSync(
  join(process.cwd(), 'src/services/navigation/resolveNavTarget.ts'),
  'utf8',
);
const edits = readFileSync(
  join(process.cwd(), 'src/module2/timeline/planLiveEdits.ts'),
  'utf8',
);
const sync = readFileSync(
  join(process.cwd(), 'src/module2/timeline/syncLiveNavToPlan.ts'),
  'utf8',
);

assert(tour.includes('export async function addOptimizedTourStop'), 'optimize');
assert(tour.includes('mirrorTourToLiveTimeline'), 'Tour → Timeline Spiegel');
assert(
  /if \(opts\?\.addStop\)[\s\S]{0,500}addOptimizedTourStop/.test(homeNav),
  'HomeMap → optimized',
);
assert(!homeNav.includes('addPlanStop'), 'Map ohne Plan-Duplikat');
assert(
  /if \(addStop\)[\s\S]{0,400}addOptimizedTourStop/.test(resolve),
  'resolve → optimized',
);
assert(!/if \(addStop\)[\s\S]{0,500}addPlanStop/.test(resolve), 'resolve ohne Plan-Duplikat');
assert(
  edits.includes('addOptimizedTourStop') &&
    edits.includes('syncPlanAddToTourMap'),
  'Timeline-Add → optimized Tour',
);
assert(sync.includes('upsertLiveNavFromStore'), 'Live-Nav Spiegel');

console.log('appendTourStop.smoke.test.ts OK');
