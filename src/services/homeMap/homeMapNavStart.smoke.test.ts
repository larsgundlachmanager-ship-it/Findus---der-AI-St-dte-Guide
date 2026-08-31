/**
 * Run: npx --yes tsx src/services/homeMap/homeMapNavStart.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUsableHomeMapNavCoord } from './homeMapNavCoord';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(isUsableHomeMapNavCoord(53.6769, 9.7633), 'Prisdorf ok');
assert(isUsableHomeMapNavCoord(52.52, 13.405), 'Berlin ok');
assert(!isUsableHomeMapNavCoord(0, 0), 'Null Island kein Ziel');
assert(!isUsableHomeMapNavCoord(Number(''), Number('')), 'leerer String → 0,0');
assert(!isUsableHomeMapNavCoord(Number.NaN, 9.76), 'NaN');
assert(!isUsableHomeMapNavCoord(53.67, Number.POSITIVE_INFINITY), 'Infinity');
assert(!isUsableHomeMapNavCoord(91, 10), 'lat außerhalb');
assert(!isUsableHomeMapNavCoord(53, 190), 'lng außerhalb');

const popup = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomeMapPlacePopup.tsx'),
  'utf8',
);
assert(
  /onPressIn=\{\(\) => runNav\(\)\}/.test(popup) &&
    /onPress=\{\(\) => runNav\(\)\}/.test(popup),
  'Navigation: Press-In und Press (Android + a11y)',
);
assert(
  popup.includes('dismissInstant') && popup.includes('setPlacePopup(null)'),
  'Tap: Popup sofort zu, Mic nicht kleben',
);
assert(
  popup.includes("speakFail('nav_failed')") || popup.includes('.catch('),
  'Nav-Fehler nicht still schlucken',
);
assert(popup.includes("runNav('add')"), 'Stopp hinzu verdrahtet');
assert(popup.includes("runNav('transit')") || popup.includes("mode === 'transit'"), 'ÖPNV-Button');
assert(popup.includes('setIsGenerating(false)'), 'Thinking/Mic nach Tap zurück');

const navStart = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapNavStart.ts'),
  'utf8',
);
assert(!navStart.includes('openUberRide'), 'Map-Tap nicht über Uber zuerst');
assert(
  navStart.includes("commitMode === 'bike'") ||
    navStart.includes("source === 'speed'"),
  'Rad unterwegs: sofort Radroute',
);
assert(
  navStart.includes('skipMobilityAsk: false') ||
    navStart.includes('const skipMobilityAsk = false'),
  'Kurze Luftlinie: Live-Guard nach Route-ETA falls OSRM länger ist',
);
assert(
  navStart.includes('presentMapNavMobilityAsk'),
  'Luftlinie ≥1,4 km: ÖPNV-Ask, kein 4h-OSRM zuerst',
);
assert(
  navStart.includes('decideAirMobility'),
  'Karten-Tap nutzt die Luftlinien-Entscheidung',
);
assert(
  navStart.includes('skipDestVerify: true'),
  'Map-Tap wie Ort-Suche: sofort starten',
);
assert(
  navStart.includes('forceTravelMode: mode'),
  'Explizite Fuß-/Rad-Route nicht von GPS-lastMode überschreiben',
);
assert(
  navStart.includes('startTransitHandsFree'),
  'Ab 3 km Luftlinie ÖPNV direkt, wenn Pref kein Taxi',
);
assert(
  navStart.includes('Popup-Koordinaten sind SSOT') ||
    navStart.includes('Pin-Koordinaten sind SSOT'),
  'Navigation nutzt die Pin-Koordinaten, nicht ein anderes POI-GPS',
);

const ask = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapNavMobilityAsk.ts'),
  'utf8',
);
assert(ask.includes('preferWalk: true'), 'Live-Guard: Fuß-Wahl');
assert(ask.includes('preferTransit: true'), 'Live-Guard: ÖPNV-Wahl');
assert(ask.includes('journeyNav: true'), 'ÖPNV-Wahl füllt Journey');
assert(
  !ask.includes('Willst du die gehen'),
  'Kein hartes User-Skript in der Speech',
);
assert(
  !ask.includes('Unten: zu Fuß'),
  'Kein Meta-„unten auswählen“ in der Speech',
);
assert(
  ask.includes('klingt gut'),
  'Live-Guard nennt den Ort und die Zeiten, nicht die UI',
);

const pitchNav = readFileSync(
  join(process.cwd(), 'src/module2/pitch/pitchStartNav.ts'),
  'utf8',
);
assert(pitchNav.includes('preferWalk'), 'Pitch-Tap ehrt Fuß-Wahl');
assert(pitchNav.includes('preferTransit'), 'Pitch-Tap ehrt ÖPNV-Wahl');
assert(
  pitchNav.includes("commitMode: mode"),
  'Fuß/Rad-Wahl geht über denselben Map-Commit',
);

const slot = readFileSync(
  join(process.cwd(), 'src/components/PitchChoiceSlot.tsx'),
  'utf8',
);
assert(
  slot.includes('pitchNavIntentFromPayload'),
  'Karten-Tap übergibt preferWalk/preferTransit',
);
assert(
  slot.includes('skipCannedAck') && slot.includes('map_nav_'),
  'ÖPNV-Wahl ohne „Gute Wahl, Route startet“',
);

const follow = readFileSync(
  join(process.cwd(), 'src/services/navigation/navLeaveByFollowUp.ts'),
  'utf8',
);
assert(
  follow.includes('presentMapNavMobilityAsk'),
  'Route-Ready fragt statt Auto-ÖPNV',
);
assert(
  !follow.includes('tryStartTransit'),
  'Kein stilles ÖPNV-Umschalten nach Route-Ready',
);

const jr = readFileSync(
  join(process.cwd(), 'src/services/navigation/startJourneyNavigation.ts'),
  'utf8',
);
assert(jr.includes('startNav: !defer'), 'ÖPNV nicht loslaufen wenn die Bahn noch wartet');
assert(!jr.includes('requestOpenPlanCalendar'), 'Karte bleibt, Timeline nicht auto-auf');
assert(jr.includes('stationPlaceName'), 'Haltestelle/Bahnhof im Namen');
assert(jr.includes('foldTinyTransfers'), 'Mini-Umstieg nicht als zweites Pinneberg');
assert(jr.includes('path: pathFromJourneyLeg(leg)'), 'Fuß- und Bahn-Pfad auf die Karte');

const leave = readFileSync(
  join(process.cwd(), 'src/services/navigation/journeyLeaveBy.ts'),
  'utf8',
);
assert(leave.includes('shouldDeferJourneyNav'), 'Leave-by statt sofort Navigation');
assert(leave.includes('In 5 Minuten müssen wir aufbrechen'), '5-Min-Ansage kurz');
assert(leave.includes('In 30 Minuten müssen wir los'), '30-Min-Ansage kurz');

console.log('homeMapNavStart.smoke.test.ts OK');
