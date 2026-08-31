/**
 * Smoke: timeCareIntent Klassifikation + Transit-Anker.
 * Run: npx --yes tsx src/services/concierge/timeCareIntent.smoke.ts
 */
import {
  classifyTimeCareIntent,
  extractTransitDepartureMs,
  extractWakeMsExcludingTransit,
  isParkingSearchIntent,
} from './timeCareIntent';

let failed = 0;

function expect(text: string, kind: string): void {
  const r = classifyTimeCareIntent(text);
  if (r?.kind !== kind) {
    console.error(`FAIL "${text}" → ${r?.kind ?? 'null'} (want ${kind})`);
    failed += 1;
  }
}

function expectTransitNotWake(text: string): void {
  const dep = extractTransitDepartureMs(text);
  const wake = extractWakeMsExcludingTransit(text);
  if (dep == null) {
    console.error(`FAIL transit dep missing: "${text}"`);
    failed += 1;
    return;
  }
  if (wake != null && Math.abs(wake - dep) < 90_000) {
    console.error(
      `FAIL wake==dep for "${text}" wake=${wake} dep=${dep}`,
    );
    failed += 1;
  }
}

{
  if (isParkingSearchIntent('wo ist ein Parkplatz bitte')) {
    /* ok */
  } else {
    console.error('FAIL plain parkplatz should be parking search');
    failed += 1;
  }
  if (isParkingSearchIntent('wir wollen essen gehen, steak essen, ein parkplatz')) {
    console.error('FAIL steak + parkplatz must not be parking search');
    failed += 1;
  }
}

expect('Weck mich um 8', 'wake');
expect('Wecker auf 7:30', 'wake');
expect('Erinner mich um 10 anzurufen', 'reminder');
expect('Erinner mich morgen früh um 7', 'wake');
expect('Mein Auto, ich darf nur 3 Stunden parken', 'parking');
expect('Parkticket bis 17:42', 'parking');
expect('Bahn um 8:45 — weck mich früh genug', 'compound_wake_transit');
expect('muss um 8:45 zur Bahn, weck mich früh genug', 'compound_wake_transit');
expect('Ich muss um 8:45 zur Bahn', 'transit_leave');
expect('Sag Bescheid wenn ich zum Zug muss', 'transit_leave');
expect('Timer 10 Minuten', 'timer');
expect('Bahn um 8:45, weck mich um 6', 'compound_wake_transit');

{
  const fly = classifyTimeCareIntent(
    'Ich muss nach Wien fliegen. Wann muss ich los, damit ich pünktlich den Flieger bekommen kann?',
  );
  if (fly != null) {
    console.error(`FAIL flight trip classified as ${fly.kind}`);
    failed += 1;
  }
}

expectTransitNotWake('Bahn um 8:45 — weck mich früh genug');
expectTransitNotWake('muss um 8:45 zur Bahn, weck mich früh genug');

{
  const wake = extractWakeMsExcludingTransit('Bahn um 8:45, weck mich um 6');
  const dep = extractTransitDepartureMs('Bahn um 8:45, weck mich um 6');
  if (wake == null || dep == null) {
    console.error('FAIL dual clock extract');
    failed += 1;
  } else if (new Date(wake).getHours() !== 6) {
    console.error(`FAIL wake should be 6, got ${new Date(wake).getHours()}`);
    failed += 1;
  } else if (new Date(dep).getHours() !== 8) {
    console.error(`FAIL dep should be 8, got ${new Date(dep).getHours()}`);
    failed += 1;
  }
}

if (failed) {
  console.error(`timeCareIntent smoke: ${failed} failed`);
  process.exit(1);
}
console.log('timeCareIntent smoke: ok');
