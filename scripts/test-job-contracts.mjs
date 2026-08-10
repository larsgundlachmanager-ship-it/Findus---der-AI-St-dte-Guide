/**
 * Offline smoke: Job-Classifier + Bridges + Completeness-Heuristik.
 * Run: node scripts/test-job-contracts.mjs
 *
 * Hinweis: nutzt die gleichen Regex-Ideen wie classifyJob.ts (Spiegel-Test).
 * Bei Drift classifyJob.ts anpassen und hier nachziehen.
 */

let pass = 0;
let fail = 0;

function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

/** Minimalspiegel der Launch-Job-Heuristik */
function classifyLite(text) {
  const t = text.toLowerCase();
  if (
    /\b(notfall|verletzt|verstaucht|gebrochen|zahnschmerz|apotheke|notaufnahme)\b/u.test(
      t,
    ) ||
    /\b(fu[sß]|knöchel).{0,20}\b(gebrochen|verstaucht)\b/u.test(t)
  ) {
    return 'emergency_care';
  }
  if (
    /\b(kino|cinema|vorstellung)\b/u.test(t) ||
    (/\bfilm\b/u.test(t) && /\b(schauen|laufen|heute)\b/u.test(t))
  ) {
    return 'tonight_live';
  }
  if (/\b(pannfisch|elbblick).*\b(pannfisch|elbblick)\b/u.test(t) ||
      (/\bpannfisch\b/u.test(t) && /\belbblick\b/u.test(t))) {
    return 'dining_hard_match';
  }
  if (/\b(spikeball|bouldern|surfen)\b/u.test(t)) return 'activity_sport';
  if (
    /\b(wie\s+viele\s+punkte|gewonnen|einwohner|wie\s+breit)\b/u.test(t)
  ) {
    return 'fact_number';
  }
  if (/\b(hotel|hostel|pool|sauna)\b/u.test(t) && /\b(nacht|wochenende|zimmer)\b/u.test(t)) {
    return 'stay_search';
  }
  if (/\b(u-bahn|tagesticket|letzter\s+zug|gleis)\b/u.test(t)) {
    return 'transit_live';
  }
  return 'other';
}

const cases = [
  ['Ich möchte heute Abend ins Kino', 'tonight_live'],
  ['Spider-Man im Kino heute', 'tonight_live'],
  ['Hamburger Pannfisch mit Elbblick', 'dining_hard_match'],
  ['Mein Freund hat den Fuß gebrochen', 'emergency_care'],
  ['Ich habe Lust auf Spikeball in Laboe', 'activity_sport'],
  ['Ich habe die erste Runde gewonnen, wie viele Punkte bekomme ich?', 'fact_number'],
  ['Hotel Wochenende mit Pool und Sauna', 'stay_search'],
  ['Wie viel kostet ein Tagesticket?', 'transit_live'],
  ['Wo ist die nächste Notaufnahme?', 'emergency_care'],
];

console.log('Job-Contract Classifier Spiegel');
for (const [q, expect] of cases) {
  const got = classifyLite(q);
  ok(got === expect, `"${q.slice(0, 48)}…" → ${got} (expect ${expect})`);
}

// Completeness: Kino ohne Showtimes = incomplete fast
function cinemaComplete(speech, hasUrl) {
  const showtimes = /\b(\d{1,2}[:.]\d{2}|uhr|heute)\b/i.test(speech);
  return showtimes && hasUrl;
}
ok(
  !cinemaComplete('Es gibt Kinos in der Nähe.', false),
  'Kino ohne Zeiten/URL incomplete',
);
ok(
  cinemaComplete('Spider-Man heute 22:00 im UCI.', true),
  'Kino mit Zeit + URL complete',
);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
