/**
 * Run: npx --yes tsx src/module2/timeline/syncLiveNavToPlan.smoke.test.ts
 */

import {
  LIVE_NAV_DEST_ID,
  LIVE_NAV_LEG_ID,
  TOUR_STOP_PREFIX,
  buildLiveTourSchedule,
  dwellMinForLiveTourStop,
  pathTitleForLeg,
  upcomingIndexForLiveId,
} from './liveTourSchedule';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  pathTitleForLeg('walk', 210, 3).includes('zu Fuß'),
  'Wegzeile nennt den Modus, nicht den Ortsnamen',
);
assert(
  pathTitleForLeg('walk', 210, 3).includes('210 m'),
  'Wegzeile hat Distanz',
);
assert(
  !pathTitleForLeg('walk', 210, 3).toLowerCase().includes('briefkasten'),
  'kein doppelter Ortsname in der Wegzeile',
);

assert(dwellMinForLiveTourStop({ name: 'Briefkasten', lat: 0, lng: 0 }) === 3, 'Briefkasten kurz');
assert(dwellMinForLiveTourStop({ name: 'Eisenbahnbrücke', lat: 0, lng: 0 }) === 8, 'Ort grob 8 Min');
assert(
  dwellMinForLiveTourStop({
    name: 'Museum',
    lat: 0,
    lng: 0,
    durationSec: 15 * 60,
  }) === 15,
  'Tour-Dauer gewinnt',
);

const now = Date.UTC(2026, 7, 18, 20, 0, 0);
const rows = buildLiveTourSchedule({
  upcoming: [
    { name: 'Briefkasten', lat: 53.68, lng: 9.76, poiId: 1 },
    { name: 'Eisenbahnbrücke', lat: 53.681, lng: 9.762, poiId: 2 },
    { name: 'Dorfplatz', lat: 53.682, lng: 9.764, poiId: 3 },
    { name: 'Gemeinschaftszeichen', lat: 53.683, lng: 9.766, poiId: 4 },
  ],
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.6795, lng: 9.759 },
  liveDistanceM: 210,
  liveEtaMin: 4,
  destName: 'Briefkasten',
  destLat: 53.68,
  destLng: 9.76,
});

assert(rows.length === 8, `4 Wege + 4 Stopps, got ${rows.length}`);
assert(rows[0]!.id === LIVE_NAV_LEG_ID, 'erstes Bein = Live-Route');
assert(rows[0]!.kind === 'nav_leg', 'dazwischen Navigation');
assert(rows[0]!.title.includes('210 m'), 'Live-Distanz in der ersten Wegzeile');
assert(!rows[0]!.title.includes('Briefkasten'), 'Stopp-Name nicht in der Wegzeile');
assert(rows[1]!.kind === 'stop', 'erster Stopp ist eine Karte');
assert(rows[1]!.title.startsWith('1 · Briefkasten'), 'erstens');
assert(rows[3]!.title.startsWith('2 · Eisenbahnbrücke'), 'zweitens');
assert(rows[5]!.title.startsWith('3 · Dorfplatz'), 'drittens');
assert(rows[7]!.title.startsWith('4 · Gemeinschaftszeichen'), 'viertens');
assert(rows[7]!.kind === 'stop', 'letzter Stopp gleiche Karten-Art');
assert(
  (rows[7]!.notes ?? '').includes('Tour fertig'),
  'letzter Stopp sagt, wann die Tour durch ist',
);

for (const r of rows) {
  assert(
    (r.plannedStartMs ?? 0) >= now,
    `${r.title} darf nicht in der Vergangenheit hängen`,
  );
}

assert((rows[0]!.plannedStartMs ?? 0) > now, 'erster Weg unterhalb von Jetzt');
assert(
  (rows[1]!.plannedStartMs ?? 0) === (rows[0]!.plannedEndMs ?? 0),
  'Ankunft Stop 1 = Ende des ersten Wegs',
);
assert(
  (rows[2]!.plannedStartMs ?? 0) === (rows[1]!.plannedEndMs ?? 0),
  'nächster Weg startet nach der Pause',
);
assert(rows[1]!.id.startsWith(TOUR_STOP_PREFIX), 'Tour-Stop-ID');
assert(rows[2]!.id.startsWith(`${TOUR_STOP_PREFIX}leg_`), 'Zwischenbein');

const messyHalt = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Haltestelle Prisdorf, Pinnau, Kreis Pinneberg, Schleswig-Holstein, 25497, Deutschland',
      lat: 53.677,
      lng: 9.764,
      role: 'walk',
    },
  ],
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.676, lng: 9.763 },
  liveDistanceM: 80,
  liveEtaMin: 2,
  destName: 'Prisdorf',
});
assert(
  messyHalt.some((r) => (r.title ?? '').includes('Prisdorf')),
  'kurzer Halt-Name bleibt',
);
assert(
  !messyHalt.some((r) => /Kreis Pinneberg|25497|Schleswig/i.test(r.title ?? '')),
  'Nominatim-Müll nicht im Stop-Titel',
);

const single = buildLiveTourSchedule({
  upcoming: [],
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.68, lng: 9.76 },
  liveDistanceM: 300,
  liveEtaMin: 6,
  destName: 'Goldschätzchen',
  destLat: 53.681,
  destLng: 9.761,
});
assert(single[0]!.id === LIVE_NAV_LEG_ID, 'Einzelziel: Weg');
assert(single[1]!.id === LIVE_NAV_DEST_ID, 'Einzelziel: Stopp-Karte');
assert(single[1]!.title.startsWith('1 · Goldschätzchen'), 'Einzelziel nummeriert');

assert(!rows[0]!.notes, 'Wegzeile ohne doppelten Untertitel');
assert(!rows[0]!.journeyDetail, 'Wegzeile ohne aufgeklappten Duplikat-Text');
assert((rows[1]!.notes ?? '').includes('Min vor Ort'), 'Stopp-Karte hat Pause');

const upcoming = [
  { name: 'Briefkasten', lat: 53.68, lng: 9.76, poiId: 1 },
  { name: 'Kindergarten Lütte', lat: 53.681, lng: 9.762, poiId: 2 },
  { name: 'Eisenbahnbrücke', lat: 53.682, lng: 9.764, poiId: 3 },
];
assert(upcomingIndexForLiveId(LIVE_NAV_LEG_ID, upcoming) === 0, 'Wegzeile = Ziel 1');
assert(upcomingIndexForLiveId(`${TOUR_STOP_PREFIX}0_1`, upcoming) === 0, 'erster Stop');
assert(upcomingIndexForLiveId(`${TOUR_STOP_PREFIX}1_2`, upcoming) === 1, 'Kindergarten');
assert(upcomingIndexForLiveId(`${TOUR_STOP_PREFIX}leg_2`, upcoming) === 2, 'Weg zu Stop 3');

const rest = upcoming.slice(1);
const restRows = buildLiveTourSchedule({
  upcoming: rest,
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.6795, lng: 9.759 },
  liveDistanceM: 180,
  liveEtaMin: 3,
  destName: 'Kindergarten Lütte',
  destLat: 53.681,
  destLng: 9.762,
});
const restStops = restRows.filter((r) => r.kind === 'stop');
assert(restStops[0]!.title.startsWith('1 · Kindergarten'), 'nach Skip wird Kindergarten 1');
assert(restStops[1]!.title.startsWith('2 · Eisenbahnbrücke'), 'Brücke wird 2');
assert(restStops.length === 2, 'nur Rest-Stopps');

const withLinks = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Osteria',
      lat: 53.55,
      lng: 10.0,
      poiId: 9,
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Osteria',
      menuUrl: 'https://osteria.example/speisekarte',
      websiteUrl: 'https://osteria.example',
    },
  ],
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.55, lng: 9.99 },
  liveDistanceM: 120,
  liveEtaMin: 2,
  destName: 'Osteria',
  destLat: 53.55,
  destLng: 10.0,
});
const gastro = withLinks.find((r) => r.kind === 'stop');
assert(gastro?.mapsUrl?.includes('google.com/maps'), 'Maps bleibt am Stop');
assert(gastro?.menuUrl?.includes('speisekarte'), 'Speisekarte bleibt am Stop');
assert(gastro?.websiteUrl === 'https://osteria.example', 'Website bleibt am Stop');

const railPath = [
  { lat: 53.677, lng: 9.764 },
  { lat: 53.592, lng: 9.798 },
];
const transitRows = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Prisdorf',
      lat: 53.677,
      lng: 9.764,
      role: 'walk',
      durationSec: 240,
      distanceM: 280,
      line: 'RB 61',
      headsign: 'Pinneberg',
      vehicleStartMs: now + 11 * 60_000,
    },
    {
      name: 'Pinneberg',
      lat: 53.592,
      lng: 9.798,
      role: 'alight',
      line: 'RB 61',
      headsign: 'Pinneberg',
      durationSec: 9 * 60,
      distanceM: 47_300,
      path: railPath,
      startMs: now + 11 * 60_000,
      endMs: now + 20 * 60_000,
      stationCount: 2,
    },
    {
      name: 'Alsterhaus',
      lat: 53.553,
      lng: 9.991,
      role: 'dest',
      durationSec: 180,
      distanceM: 500,
    },
  ],
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.676, lng: 9.763 },
  liveDistanceM: 280,
  liveEtaMin: 4,
  destName: 'Alsterhaus',
  destLat: 53.553,
  destLng: 9.991,
});
const transitLegs = transitRows.filter((r) => r.kind === 'nav_leg');
assert(
  transitLegs.some((r) => r.transport === 'transit' && /RB 61/.test(r.title)),
  'Bahnbein heißt nicht zu Fuß',
);
assert(
  !transitLegs.some((r) => /47/.test(r.title) && /zu Fuß/.test(r.title)),
  'keine 47-km-Fußzeile aus der Bahn-Polyline',
);
assert(
  !transitLegs.some((r) => /9 Std/.test(r.title)),
  'keine 9-Stunden-Fuß-ETA auf dem Bahnbein',
);
const prisdorf = transitRows.find((r) => (r.title ?? '').includes('Prisdorf'));
assert(
  (prisdorf?.notes ?? '').includes('warten'),
  'Warten auf die Bahn, nicht vor Ort',
);
assert(!prisdorf?.mapsUrl, 'Haltestelle ohne Maps-Link');

const leaveNow = Date.parse('2026-08-19T12:00:00+02:00');
const leaveBy = Date.parse('2026-08-19T13:30:00+02:00');
const leaveRows = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Haltestelle Prisdorf',
      lat: 53.676,
      lng: 9.763,
      role: 'walk',
      durationSec: 240,
    },
    {
      name: 'Pinneberg',
      lat: 53.655,
      lng: 9.797,
      role: 'alight',
      line: 'RB 61',
      headsign: 'Pinneberg',
      startMs: Date.parse('2026-08-19T13:40:00+02:00'),
      endMs: Date.parse('2026-08-19T13:49:00+02:00'),
      durationSec: 540,
    },
    {
      name: 'Café Johanna',
      lat: 53.546,
      lng: 9.968,
      role: 'dest',
    },
  ],
  nowMs: leaveNow,
  transport: 'walk',
  origin: { lat: 53.677, lng: 9.764 },
  liveDistanceM: 280,
  liveEtaMin: 4,
  destName: 'Café Johanna',
  leaveByMs: leaveBy,
  tripTitle: 'Reise zum Café Johanna',
});
assert(
  !leaveRows.some((r) => (r.title ?? '').startsWith('Losgehen')),
  'kein extra Losgehen — Erinnerung sitzt am Akkordeon',
);
assert(
  leaveRows.some((r) => (r.groupLabel ?? '').includes('Café Johanna')),
  'Gruppe heißt Fahrt/Reise zum Ziel',
);
assert(
  (leaveRows.find((r) => r.kind === 'nav_leg' && r.id === LIVE_NAV_LEG_ID)
    ?.plannedStartMs ?? 0) === leaveBy,
  'erster Fußweg startet am Leave-by',
);
const firstWalkArrive =
  leaveRows.find((r) => r.kind === 'nav_leg' && r.id === LIVE_NAV_LEG_ID)
    ?.plannedEndMs ?? 0;
const trainStart = Date.parse('2026-08-19T13:40:00+02:00');
assert(
  firstWalkArrive > 0 && firstWalkArrive <= trainStart - 3 * 60_000,
  'am Bahnsteig 3–4 Min vor der Abfahrt',
);
assert(
  leaveRows.find((r) => r.kind === 'nav_leg' && r.id === LIVE_NAV_LEG_ID)
    ?.routeEstimate === 'routed',
  'erster Fußweg ist geroutet, kein Fragezeichen',
);

const namelessHalt = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Haltestelle',
      lat: 53.675,
      lng: 9.76,
      role: 'walk',
      line: 'RB71',
      headsign: 'Hamburg Hbf',
      vehicleMode: 'RAIL',
    },
    {
      name: 'Haltestelle',
      lat: 53.55,
      lng: 10.0,
      role: 'alight',
      line: 'RB71',
      headsign: 'Hamburg Hbf',
      vehicleMode: 'RAIL',
    },
  ],
  nowMs: now,
  transport: 'transit',
  origin: { lat: 53.676, lng: 9.759 },
  liveDistanceM: 120,
  liveEtaMin: 3,
  destName: 'Hamburg',
});
assert(
  namelessHalt.some((r) => r.kind === 'stop' && /RB71|Hamburg/i.test(r.title ?? '')),
  'Halt ohne Ortsname bekommt Linie/Richtung',
);
assert(
  !namelessHalt.some(
    (r) => r.kind === 'stop' && /^\d+\s*·\s*Haltestelle$/i.test(r.title ?? ''),
  ),
  'kein nacktes „Haltestelle“ als Stop-Titel',
);

console.log('liveTourSchedule.smoke.test.ts OK');
