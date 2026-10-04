/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/cityCommitProgress.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  beginCityCommitProgress,
  clearCityCommitProgress,
  endCityCommitProgress,
  getCityCommitProgress,
  setCityCommitProgress,
  subscribeCityCommitProgress,
} from './cityCommitProgress';

clearCityCommitProgress();
assert.equal(getCityCommitProgress(), null);

let seen = 0;
const unsub = subscribeCityCommitProgress(() => {
  seen += 1;
});

beginCityCommitProgress({ cityId: 'pinneberg', cityName: 'Pinneberg' });
assert.equal(getCityCommitProgress()?.cityId, 'pinneberg');
assert.ok((getCityCommitProgress()?.progress ?? 0) > 0);
assert.equal(getCityCommitProgress()?.phase, 'welcome');
assert.ok(seen >= 1);

setCityCommitProgress(0.5);
assert.equal(getCityCommitProgress()?.progress, 0.5);

// Zweites begin gleiche Stadt → kein Reset auf 8 %
beginCityCommitProgress({ cityId: 'pinneberg', cityName: 'Pinneberg' });
assert.equal(getCityCommitProgress()?.progress, 0.5);

endCityCommitProgress();
assert.equal(getCityCommitProgress()?.phase, 'done');
assert.equal(getCityCommitProgress()?.progress, 1);

// Nach done: begin darf nicht sofort auf 8 % zurückspringen
beginCityCommitProgress({ cityId: 'pinneberg', cityName: 'Pinneberg' });
assert.equal(getCityCommitProgress()?.progress, 1);
assert.equal(getCityCommitProgress()?.phase, 'done');

unsub();
clearCityCommitProgress();
assert.equal(getCityCommitProgress(), null);

console.log('cityCommitProgress.smoke: ok');
