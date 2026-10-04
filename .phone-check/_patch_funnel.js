const fs = require('fs');
const p = 'src/reisebuero/research/funnel.ts';
let s = fs.readFileSync(p, 'utf8');

const oldFlight = `  let flightUrl: string | null = null;
  let flightPrice: number | null = null;
  if (ledger.mode?.value === 'fly' && place.iata && ledger.airportIata?.value) {
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
  }`;

const newFlight = `  let flightUrl: string | null = null;
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
  }`;

if (!s.includes('originAirports')) {
  console.error('originAirports missing');
  process.exit(1);
}
if (!s.includes(oldFlight)) {
  console.error('old flight block missing');
  // try softer
  if (!s.includes('let originUsed')) {
    console.error('and no originUsed');
    process.exit(1);
  }
} else {
  s = s.replace(oldFlight, newFlight);
}

// Fix rank boost to use new score style
s = s.replace(
  'o.matchScore = Math.max(0, Math.min(100, o.matchScore + patch.boost * 4));',
  'o.matchScore = Math.max(0, Math.min(100, o.matchScore + Math.round(patch.boost * 3)));',
);

// Inject theater seeding at start of funnel
if (!s.includes('seedResearchTheater()')) {
  s = s.replace(
    'store.setSearching(true);\n  const log: FunnelLogLine[] = [];',
    `store.setSearching(true);
  seedResearchTheater();
  emitStep({ stage: 'climate', title: 'Klima & Zeitraum', detail: 'Wo passt das Wetter?', status: 'active', progress: 0.08 });
  const log: FunnelLogLine[] = [];`,
  );
  s = s.replace(
    "log.push({\n    stage: '0b',",
    `finishStep('climate', 'Zeitraum ok');
  emitStep({ stage: 'discover', title: 'Orte finden', detail: 'Kandidaten suchen', progress: 0.2 });
  log.push({
    stage: '0b',`,
  );
  s = s.replace(
    "log.push({ stage: '1', detail: `Seed-Geografie ${pool.length}` });",
    `finishStep('discover', \`Seed ${pool.length}\`);
  emitStep({ stage: 'soft', title: 'Wünsche matchen', detail: 'Prefs & Soft-Fit', progress: 0.35 });
  log.push({ stage: '1', detail: \`Seed-Geografie \${pool.length}\` });`,
  );
  s = s.replace(
    "log.push({\n    stage: '2',\n    detail: `Pool ${sliced.length} (Seed+Pro+Named) — parallele Stay22/Flug`,\n  });",
    `finishStep('soft', \`Pool \${sliced.length}\`);
  emitStep({ stage: 'flights', title: 'Flüge prüfen', detail: 'Multi-Start & Preise', progress: 0.5 });
  emitStep({ stage: 'stay', title: 'Unterkünfte', detail: 'Live-Preise', progress: 0.55 });
  log.push({
    stage: '2',
    detail: \`Pool \${sliced.length} (Seed+Pro+Named) — parallele Stay22/Flug\`,
  });`,
  );
  s = s.replace(
    "log.push({\n    stage: '3',\n    detail: `Live-Backend fertig:",
    `finishStep('flights', 'Flug-Links gesetzt');
  finishStep('stay', 'Stay22 fertig');
  emitStep({ stage: 'compare', title: 'Vergleich', detail: 'Top-Optionen', progress: 0.85 });
  log.push({
    stage: '3',
    detail: \`Live-Backend fertig:`,
  );
  // fix the broken replace - read carefully
}

fs.writeFileSync(p + '.tmp', s);
fs.renameSync(p + '.tmp', p);
console.log('funnel patched', s.includes('originUsed'), s.includes('seedResearchTheater'));
