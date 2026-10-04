/**
 * Taxi-before-flight Uber deep links + timeline reserveUrl shape.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/affiliate/uberTaxiBeforeFlight.smoke.test.ts
 *
 * Mirrors getUberRideUrl / buildUberRideAction (affiliateService) via buildUberGoUrl —
 * full affiliateService cannot load under Node (RN + circular concierge deps).
 * Source wiring for flightTimeline + affiliateService + presentToUi is asserted from disk.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildUberGoUrl,
  localPickupFormattedTime,
  uberPlaceFromAddress,
} from './partnerBookingDeepLink';
import { roundClockHmmDownTo5 } from './partnerDeepPrefill';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

function tomorrowLocalIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function decodeUberUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** Same default as affiliateService.UBER_CLIENT_ID */
const UBER_CLIENT_ID = '4a6yecXWLriTzMd4uqp41cVz2dDdlpSB';

/** Mirrors getUberRideUrl (affiliateService) without RN. */
function getUberRideUrl(
  destLat: number,
  destLng: number,
  destName: string,
  opts?: {
    dropoffFormattedAddress?: string | null;
    pickupTimeLabel?: string | null;
    pickupDateIso?: string | null;
    pickupMyLocation?: boolean;
  },
): string {
  const dropAddr = (opts?.dropoffFormattedAddress || destName || 'Ziel').trim();
  return buildUberGoUrl({
    clientId: UBER_CLIENT_ID,
    dropoff: uberPlaceFromAddress(destLat, destLng, dropAddr),
    pickupMyLocation: opts?.pickupMyLocation !== false,
    pickupTimeHm: opts?.pickupTimeLabel
      ? roundClockHmmDownTo5(opts.pickupTimeLabel)
      : null,
    pickupDateIso: opts?.pickupDateIso,
  });
}

/**
 * Mirrors buildUberRideAction URL/label/payload (no GPS pickup).
 * 4th arg is targetPoiId — never used as dropoff address.
 */
function buildUberRideAction(
  destLat: number,
  destLng: number,
  destName: string,
  targetPoiId?: string | number,
  opts?: {
    dropoffFormattedAddress?: string | null;
    pickupTimeLabel?: string | null;
    pickupDateIso?: string | null;
  },
): {
  type: 'BOOK_UBER';
  label: string;
  payload: {
    destLat: number;
    destLng: number;
    destName: string;
    targetPoiId?: string | number;
    url: string;
    dropoffFormattedAddress?: string;
    pickupTimeLabel?: string;
    pickupDateIso?: string;
  };
} {
  const name = (destName || 'Ziel').trim() || 'Ziel';
  const timeRaw = opts?.pickupTimeLabel?.trim();
  const time = timeRaw ? roundClockHmmDownTo5(timeRaw) : '';
  const url = getUberRideUrl(destLat, destLng, name, {
    dropoffFormattedAddress: opts?.dropoffFormattedAddress ?? name,
    pickupTimeLabel: time,
    pickupDateIso: opts?.pickupDateIso ?? null,
  });
  return {
    type: 'BOOK_UBER',
    label: time ? `🚗 Uber · ${time}` : '🚗 Fahrt mit Uber buchen',
    payload: {
      destLat,
      destLng,
      destName: name,
      targetPoiId,
      url,
      dropoffFormattedAddress: opts?.dropoffFormattedAddress ?? name,
      pickupTimeLabel: time || undefined,
      pickupDateIso: opts?.pickupDateIso?.trim() || undefined,
    },
  };
}

const HAM = { lat: 53.63, lng: 9.99, name: 'Flughafen Hamburg (HAM)' };
const DROP_ADDR = 'Flughafen Hamburg, 22335 Hamburg';
const tomorrowIso = tomorrowLocalIso();

// --- 1) buildUberGoUrl future reserve (tomorrow 07:00 → HAM) ---
const goReserve = buildUberGoUrl({
  clientId: UBER_CLIENT_ID,
  dropoff: uberPlaceFromAddress(HAM.lat, HAM.lng, DROP_ADDR),
  pickupMyLocation: true,
  pickupTimeHm: '07:00',
  pickupDateIso: tomorrowIso,
});
assert(/m\.uber\.com\/go\/reserve\?/.test(goReserve), `future /go/reserve`);
assert(!/product-selection/.test(goReserve), 'future not product-selection');
assert(!/setPickup/.test(goReserve), 'no legacy setPickup');
assert(!/\/go\/reserve\/select-time/.test(goReserve), 'no white-screen select-time');
assert(
  new RegExp(`pickup_time=${tomorrowIso}T07(?:%3A|:)00`).test(goReserve),
  'pickup_time date+07:00',
);
assert(new RegExp(`client_id=${UBER_CLIENT_ID}`).test(goReserve), 'client_id');
assert(
  /Flughafen Hamburg|22335|53\.63/.test(decodeUberUrl(goReserve)),
  'dropoff near airport',
);

// --- 2) NOW / no time → product-selection ---
const goNow = buildUberGoUrl({
  clientId: 'TESTCLIENT',
  dropoff: uberPlaceFromAddress(HAM.lat, HAM.lng, DROP_ADDR),
  pickupMyLocation: true,
});
assert(/\/go\/product-selection\?/.test(goNow), 'now product-selection');
assert(!/\/go\/reserve\?/.test(goNow), 'now not reserve');

// --- 3) getUberRideUrl / buildUberRideAction (mirrored) ---
const rideUrl = getUberRideUrl(HAM.lat, HAM.lng, HAM.name, {
  pickupTimeLabel: '07:00',
  pickupDateIso: tomorrowIso,
  dropoffFormattedAddress: DROP_ADDR,
});
assert(/\/go\/reserve\?/.test(rideUrl), 'getUberRideUrl reserve');
assert(
  new RegExp(`pickup_time=${tomorrowIso}T07(?:%3A|:)00`).test(rideUrl),
  'getUberRideUrl pickup_time 07:00',
);
assert(/client_id=/.test(rideUrl), 'getUberRideUrl client_id');
assert(/Flughafen|22335|53\.63/.test(decodeUberUrl(rideUrl)), 'getUberRideUrl dropoff');

const nowRide = getUberRideUrl(HAM.lat, HAM.lng, HAM.name, {
  dropoffFormattedAddress: DROP_ADDR,
});
assert(/\/go\/product-selection\?/.test(nowRide), 'getUberRideUrl now = product-selection');

// 4th arg is targetPoiId — must NOT become dropoff address
const act = buildUberRideAction(
  HAM.lat,
  HAM.lng,
  HAM.name,
  'poi-should-not-be-street',
  {
    pickupTimeLabel: '07:02',
    pickupDateIso: tomorrowIso,
    dropoffFormattedAddress: DROP_ADDR,
  },
);
assert(act.type === 'BOOK_UBER', 'BOOK_UBER type');
assert(act.payload.targetPoiId === 'poi-should-not-be-street', '4th arg = targetPoiId');
assert(/\/go\/reserve\?/.test(act.payload.url), 'buildUberRideAction reserve');
assert(
  !/poi-should-not-be-street/.test(decodeUberUrl(act.payload.url)),
  'poi id not in dropoff JSON',
);
assert(/Flughafen Hamburg|22335/.test(decodeUberUrl(act.payload.url)), 'dropoff via opts');
assert(roundClockHmmDownTo5('07:02') === '07:00', 'round 07:02→07:00');
assert(
  new RegExp(`pickup_time=${tomorrowIso}T07(?:%3A|:)00`).test(act.payload.url),
  'rounded pickup_time :00',
);
assert(/07:00/.test(act.label), `label shows time: ${act.label}`);
assert(!/jetzt bestellen/i.test(act.label), 'label not pure jetzt bestellen');

// flightTimeline path: destName only (no dropoffFormattedAddress)
const flightStyle = buildUberRideAction(HAM.lat, HAM.lng, HAM.name, undefined, {
  pickupTimeLabel: '07:00',
  pickupDateIso: tomorrowIso,
});
assert(/\/go\/reserve\?/.test(flightStyle.payload.url), 'flight-style reserveUrl');
assert(
  /Flughafen Hamburg/.test(decodeUberUrl(flightStyle.payload.url)),
  'flight-style dropoff from destName',
);

// --- 4) <15 min → product-selection ---
const soon = new Date(Date.now() + 8 * 60_000);
const soonHm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
const soonIso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
const goSoon = buildUberGoUrl({
  clientId: 'TESTCLIENT',
  dropoff: uberPlaceFromAddress(HAM.lat, HAM.lng, DROP_ADDR),
  pickupTimeHm: soonHm,
  pickupDateIso: soonIso,
});
assert(/\/go\/product-selection\?/.test(goSoon), '<15min → product-selection');
assert(/pickup_time=/.test(goSoon), 'still includes pickup_time when clock given');

// --- 5) Timezone: localPickupFormattedTime uses local date ---
const local = localPickupFormattedTime('07:00', tomorrowIso);
assert(local === `${tomorrowIso}T07:00:00`, `local time iso: ${local}`);
assert(!/Z$/.test(local), 'no UTC Z suffix');
const localNoDate = localPickupFormattedTime('07:00');
assert(/^\d{4}-\d{2}-\d{2}T07:00:00$/.test(localNoDate), `local no-date: ${localNoDate}`);

// --- 6) Timeline stop shape (mirrors flightTimeline taxi leave writer) ---
const taxiLeaveMs = (() => {
  const [y, m, d] = tomorrowIso.split('-').map(Number);
  return new Date(y, m - 1, d, 7, 0, 0, 0).getTime();
})();
const clockLeave = `${String(new Date(taxiLeaveMs).getHours()).padStart(2, '0')}:${String(
  new Date(taxiLeaveMs).getMinutes(),
).padStart(2, '0')}`;
const leaveDateIso = `${new Date(taxiLeaveMs).getFullYear()}-${String(
  new Date(taxiLeaveMs).getMonth() + 1,
).padStart(2, '0')}-${String(new Date(taxiLeaveMs).getDate()).padStart(2, '0')}`;
assert(leaveDateIso === tomorrowIso, 'leave date local consistency');
assert(clockLeave === '07:00', `leave clock local 07:00 got ${clockLeave}`);

const leaveAct = buildUberRideAction(HAM.lat, HAM.lng, HAM.name, undefined, {
  pickupTimeLabel: clockLeave,
  pickupDateIso: leaveDateIso,
});
const planStop = {
  id: 'ft:LH123:leave',
  title: `Taxi · Los ${clockLeave}`,
  kind: 'nav_leg' as const,
  transport: 'taxi' as const,
  plannedStartMs: taxiLeaveMs,
  reserveUrl: leaveAct.payload.url,
  lat: HAM.lat,
  lng: HAM.lng,
};
assert(planStop.kind === 'nav_leg' && planStop.transport === 'taxi', 'stop kind/transport taxi');
assert(/Taxi/.test(planStop.title) && /Los/.test(planStop.title), `title: ${planStop.title}`);
assert(planStop.plannedStartMs === taxiLeaveMs, 'plannedStartMs matches leave');
assert(/\/go\/reserve\?/.test(planStop.reserveUrl || ''), 'timeline reserveUrl /go/reserve');
assert(/uber\.com|m\.uber/i.test(planStop.reserveUrl || ''), 'PlanCalendarModal Uber match');

// --- 7) Source wiring: flightTimeline + buildUberRideAction signature ---
const root = path.resolve(__dirname, '../..');
const ftSrc = fs.readFileSync(
  path.join(root, 'services/flights/flightTimeline.ts'),
  'utf8',
);
assert(
  /buildUberRideAction\(\s*[\s\S]*?pickupTimeLabel:\s*clock\(taxiLeaveMs\)/.test(ftSrc) ||
    /pickupTimeLabel:\s*clock\(taxiLeaveMs\)/.test(ftSrc),
  'flightTimeline upsert passes pickupTimeLabel',
);
assert(
  /pickupDateIso:\s*dateKeyFromMs\(taxiLeaveMs\)/.test(ftSrc),
  'flightTimeline upsert passes pickupDateIso',
);
assert(/reserveUrl:\s*uberReserveUrl/.test(ftSrc), 'flightTimeline writes reserveUrl');
assert(
  /title:\s*`Taxi · Los \$\{clock\(taxiLeaveMs\)\}`/.test(ftSrc) ||
    /Taxi · Los \$\{clock\(/.test(ftSrc),
  'flightTimeline taxi leave title',
);
assert(/transport:\s*'taxi'/.test(ftSrc), 'flightTimeline transport taxi');

const affSrc = fs.readFileSync(
  path.join(root, 'services/affiliate/affiliateService.ts'),
  'utf8',
);
assert(
  /export function buildUberRideAction\(/.test(affSrc),
  'affiliateService exports buildUberRideAction',
);
assert(
  /targetPoiId\?:\s*string\s*\|\s*number/.test(affSrc),
  '4th arg typed as targetPoiId not address',
);
assert(
  /dropoffFormattedAddress:\s*opts\?\.dropoffFormattedAddress\s*\?\?\s*name/.test(
    affSrc,
  ),
  'dropoff from opts or destName',
);
assert(
  /label:\s*time\s*\?\s*`🚗 Uber · \$\{time\}`\s*:\s*'🚗 Fahrt mit Uber buchen'/.test(
    affSrc,
  ),
  'label uses time when scheduled',
);
assert(/pickupTimeHm:\s*opts\.pickupTimeLabel/.test(affSrc) || /pickupTimeLabel/.test(affSrc), 'getUberRideUrl passes time');
assert(/buildUberGoUrl/.test(affSrc), 'getUberRideUrl uses buildUberGoUrl not setPickup');

// --- 8) presentToUi: book_uber must forward pickupTimeLabel into buildUberRideAction ---
const presentSrc = fs.readFileSync(
  path.join(root, 'module2/pipeline/presentToUi.ts'),
  'utf8',
);
assert(
  /kind === 'uber' \|\| p\.kind === 'book_uber'/.test(presentSrc) ||
    /kind === 'book_uber'/.test(presentSrc),
  'presentToUi handles book_uber/uber',
);
assert(
  /buildUberRideAction\(\s*uberLat,\s*uberLng,\s*destName,\s*undefined,\s*\{[\s\S]*?pickupTimeLabel/.test(
    presentSrc,
  ),
  'presentToUi passes pickupTimeLabel into buildUberRideAction',
);
assert(
  /pickupDateIso:\s*pickupDateIso/.test(presentSrc) ||
    /pickupDateIso:\s*pickupDateIso\s*\|\|/.test(presentSrc),
  'presentToUi passes pickupDateIso into buildUberRideAction',
);
assert(
  /dropoffFormattedAddress:\s*destName/.test(presentSrc),
  'presentToUi passes dropoffFormattedAddress',
);
assert(
  /existingIsScheduledUber|\/go\/reserve|pickup_time=/.test(presentSrc),
  'presentToUi prefers/merges prebuilt reserve URL',
);
assert(
  /setPickup/.test(presentSrc) && /!pickupTimeLabel/.test(presentSrc),
  'presentToUi setPickup only when no scheduled time',
);

const goSrc = fs.readFileSync(
  path.join(root, 'services/affiliate/partnerBookingDeepLink.ts'),
  'utf8',
);
assert(/future \? 'reserve' : 'product-selection'/.test(goSrc), '15min future gate in buildUberGoUrl');
assert(/Date\.now\(\) \+ 15 \* 60_000/.test(goSrc), '15min threshold');

console.log('\n--- sample reserve URL ---');
console.log(flightStyle.payload.url);
console.log('uberTaxiBeforeFlight.smoke.test.ts: all ok');
