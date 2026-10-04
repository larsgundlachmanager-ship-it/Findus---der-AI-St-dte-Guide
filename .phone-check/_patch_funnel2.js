const fs = require('fs');
const p = 'src/reisebuero/research/funnel.ts';
let s = fs.readFileSync(p, 'utf8');

if (!s.includes('let originUsed')) {
  const marker = '  let flightUrl: string | null = null;\n  let flightPrice: number | null = null;';
  const idx = s.indexOf(marker);
  if (idx < 0) {
    console.error('flight marker missing');
    process.exit(1);
  }
  // Replace until photo fetch
  const end = s.indexOf('  const photo = await fetchWikiThumb', idx);
  if (end < 0) {
    console.error('photo marker missing');
    process.exit(1);
  }
  const replacement = `  let flightUrl: string | null = null;
  let flightPrice: number | null = null;
  const froms = originAirports(ledger);
  let originUsed: string | null = froms[0] ?? ledger.airportIata?.value ?? null;
  if (ledger.mode?.value === 'fly' && place.iata && froms.length) {
    originUsed = froms[0]!;
    try {
      flightUrl = buildKiwiTravelpayoutsUrl(
        buildKiwiSearchPageUrl({
          fromIata: originUsed,
          toIata: place.iata,
          dateKey: checkin,
        }),
        { subId: 'reisebuero' },
      );
    } catch {
      flightUrl = null;
    }
  } else if (ledger.mode?.value === 'fly' && place.iata && ledger.airportIata?.value) {
    originUsed = ledger.airportIata.value;
    try {
      flightUrl = buildKiwiTravelpayoutsUrl(
        buildKiwiSearchPageUrl({
          fromIata: ledger.airportIata.value,
          toIata: place.iata,
          dateKey: checkin,
        }),
        { subId: 'reisebuero' },
      );
    } catch {
      flightUrl = null;
    }
  }

`;
  s = s.slice(0, idx) + replacement + s.slice(end);
}

s = s.replace(
  'o.matchScore = Math.max(0, Math.min(100, o.matchScore + patch.boost * 4));',
  'o.matchScore = Math.max(0, Math.min(100, o.matchScore + Math.round(patch.boost * 3)));',
);

if (!s.includes('seedResearchTheater()')) {
  s = s.replace(
    'store.setSearching(true);\n  const log: FunnelLogLine[] = [];',
    `store.setSearching(true);
  seedResearchTheater();
  emitStep({ stage: 'climate', title: 'Klima & Zeitraum', detail: 'Wo passt das Wetter?', status: 'active', progress: 0.08 });
  const log: FunnelLogLine[] = [];`,
  );
}

if (!s.includes("finishStep('climate'")) {
  s = s.replace(
    '  // Parallel: Discover (Pro nur 1×) + Named-Geocode\n',
    `  finishStep('climate', 'Zeitraum ok');
  emitStep({ stage: 'discover', title: 'Orte finden', detail: 'Kandidaten suchen', progress: 0.2 });
  // Parallel: Discover (Pro nur 1×) + Named-Geocode
`,
  );
}

if (!s.includes("finishStep('discover'")) {
  s = s.replace(
    '  let pool = SEED_PLACES.filter((p) => tagMatch(p, ledger));\n',
    `  finishStep('discover', 'Kandidaten geladen');
  emitStep({ stage: 'soft', title: 'Wünsche matchen', detail: 'Prefs & Soft-Fit', progress: 0.35 });
  let pool = SEED_PLACES.filter((p) => tagMatch(p, ledger));
`,
  );
}

if (!s.includes("finishStep('soft'")) {
  s = s.replace(
    '  const must = new Set(ledger.mustHaves?.value ?? []);\n',
    `  finishStep('soft', 'Soft-Fit gesetzt');
  emitStep({ stage: 'flights', title: 'Flüge prüfen', detail: 'Multi-Start & Preise', progress: 0.5 });
  emitStep({ stage: 'stay', title: 'Unterkünfte', detail: 'Live-Preise', progress: 0.55 });
  const must = new Set(ledger.mustHaves?.value ?? []);
`,
  );
}

if (!s.includes("finishStep('stay'")) {
  s = s.replace(
    '  // Flug-Hints: Pro nur erste Auswahl; Korrektur = Lite, max 4\n',
    `  finishStep('flights', 'Flug-Links');
  finishStep('stay', 'Unterkünfte live');
  emitStep({ stage: 'compare', title: 'Vergleich', detail: 'Top-Optionen', progress: 0.85 });
  // Flug-Hints: Pro nur erste Ausgabe; Korrektur = Lite, max 4
`,
  );
}

if (!s.includes("finishStep('compare'")) {
  s = s.replace(
    '  store.setOptions(top, log);\n}',
    `  finishStep('compare', top.length + ' Optionen');
  store.appendDecision('result', speechTopTwoSummary(top));
  store.setOptions(top, log);
}
`,
  );
}

// Ensure speechTopTwoSummary imported
if (!s.includes('speechTopTwoSummary')) {
  s = s.replace(
    '  tripNickname,\n  whyBlurb,\n} from \'./optionCard\';',
    '  speechTopTwoSummary,\n  tripNickname,\n  whyBlurb,\n} from \'./optionCard\';',
  );
}

fs.writeFileSync(p + '.tmp', s);
fs.renameSync(p + '.tmp', p);
console.log('ok', {
  originUsed: s.includes('originUsed'),
  theater: s.includes('seedResearchTheater'),
  compare: s.includes("finishStep('compare'"),
});
