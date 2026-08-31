/**
 * Travel ETA spike + landmark open follow-up.
 */
import assert from 'node:assert/strict';
import {
  bufferedTravelMinutesToHour,
  arrivalHmAfterTravel,
} from './planTravelEtaSpike';
import {
  setOpenLandmarkTicket,
  markLandmarkTicketResolved,
  peekOpenLandmarkTicket,
  openLandmarkFollowUpSpeech,
  clearOpenLandmarkTicket,
} from './planLandmarkOpen';

assert.equal(bufferedTravelMinutesToHour(48), 60, '48→60');
assert.equal(bufferedTravelMinutesToHour(65), 60, '65→60');
assert.equal(bufferedTravelMinutesToHour(80), 120, '80→120');
assert.equal(bufferedTravelMinutesToHour(55), 60, '55→60');
assert.equal(arrivalHmAfterTravel('09:00', 60), '10:00');
assert.equal(arrivalHmAfterTravel('09:00', 120), '11:00');

clearOpenLandmarkTicket();
setOpenLandmarkTicket('Michel');
assert.ok(peekOpenLandmarkTicket()?.ticketPending);
assert.ok(/Ticket|Michel|Uhrzeit/i.test(openLandmarkFollowUpSpeech() || ''));
markLandmarkTicketResolved({ bought: true, timeHm: '14:00' });
assert.equal(peekOpenLandmarkTicket(), null);

console.log('planTravelEtaSpike+landmarkOpen.smoke: ok');
