/**
 * Festival type hard-match + deepen follow-ups (city-agnostic).
 * Run: npx --yes tsx src/services/concierge/eventFestivalHardMatch.smoke.test.ts
 */

import {
  clearLastLiveInventory,
  noteLastLiveInventory,
} from '../../module2/context/shortTermContext';
import {
  isInventoryFollowUp,
  resolveLiveInventoryUserText,
  detectLiveInventoryKind,
} from '../../module2/router/liveInventoryGate';
import {
  detectAskedFestivalType,
  eventMatchesFestivalType,
  isEventFestivalDeepenQuery,
  wantsEventBriefingActions,
} from './eventFestivalType';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

clearLastLiveInventory();

assert(detectAskedFestivalType('Gibt es ein Weinfest im Viertel?') === 'wine', 'wine type');
assert(
  detectAskedFestivalType('Wann ist das Landstraßenfest?') === 'street',
  'street type',
);
assert(detectAskedFestivalType('Was geht heute Abend?') === null, 'generic events null type');

const wineFest = {
  title: 'Stadtteil-Weinfest',
  venue: 'Marktplatz',
  summary:
    'Ab 16 Uhr mit Winzerständen, Glühwein und Live-Musik bis 22 Uhr. Eintritt frei.',
};
const streetFest = {
  title: 'Eppendorfer Landstraßenfest',
  venue: 'Eppendorfer Landstraße',
  summary: 'Klassisches Straßenfest meist im Mai mit Buden und Fahrgeschäften.',
};

assert(eventMatchesFestivalType(wineFest, 'wine'), 'wine matches wine');
assert(!eventMatchesFestivalType(streetFest, 'wine'), 'street does not match wine');
assert(eventMatchesFestivalType(streetFest, 'street'), 'street matches street');

assert(isEventFestivalDeepenQuery('wann gehts los?'), 'wann deepen');
assert(isEventFestivalDeepenQuery('läuft das jetzt noch?'), 'laeuft deepen');
assert(isEventFestivalDeepenQuery('erzähl mehr darüber'), 'erzaehl deepen');
assert(isEventFestivalDeepenQuery('gibt es wirklich ein Weinfest?'), 'wirklich deepen');
assert(
  isEventFestivalDeepenQuery(
    'ich mache eben gerade beim Eppendorfer weinfest kannst du mir darüber ein bisschen mehr Programm erzählen',
  ),
  'am fest + programm deepen',
);
assert(wantsEventBriefingActions('Weinfest in der Nähe — wann startet es?'), 'briefing wants');

noteLastLiveInventory({
  kind: 'events',
  query: 'Gibt es ein Weinfest im Stadtteil?',
});
assert(isInventoryFollowUp('wann gehts los'), 'inventory follow wann');
assert(isInventoryFollowUp('erzähl mehr'), 'inventory follow erzaehl');

const merged = resolveLiveInventoryUserText('wann gehts los');
assert(merged.inherited && merged.kind === 'events', 'inherit events on wann');
assert(/Weinfest/i.test(merged.text), 'merged keeps wine fest');

assert(detectLiveInventoryKind('Weinfest heute Abend') === 'events', 'weinfest is events');

clearLastLiveInventory();
console.log('eventFestivalHardMatch.smoke.test.ts OK');
