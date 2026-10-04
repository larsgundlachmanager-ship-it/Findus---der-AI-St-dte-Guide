import { parseBriefSlots } from './parseBriefSlots';
import { extraNearbyFromLedger } from './research/wishEvidenceHarvest';
import { wishChapterBookUrl } from './research/wishBookLink';
import { buildDayPlans, buildBookingChecklist } from './research/composePlan';
import { mergeLedger, cloneEmptyLedger, entry } from './slotLedger';
import type { ReiseOption } from './types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const hell = parseBriefSlots('Wir brauchen noch eine eSIM und wollen zum Hellfest, plus ein Museum');
assert(hell.needEsim?.value === true, 'need esim');
assert((hell.mustActivities?.value ?? []).some((a) => /Hellfest|hellfest/i.test(a)), `acts ${hell.mustActivities?.value}`);
assert((hell.mustActivities?.value ?? []).some((a) => /Museum/i.test(a)), 'museum act');
assert((hell.intentNotes?.value ?? []).some((x) => /Hellfest|Event-Hook/i.test(x)), 'event hook');

const led = mergeLedger(cloneEmptyLedger(), hell);
const extras = extraNearbyFromLedger(led);
assert(extras.some((e) => e.id === 'concert'), `concert extra ${extras.map((e) => e.id)}`);
assert(extras.some((e) => e.id === 'museum'), 'museum extra');

const stub = { placeName: 'Clisson', comboWindows: [{ checkin: '2026-06-18', checkout: '2026-06-22' }], transports: [] } as ReiseOption;
const url = wishChapterBookUrl('concert', { mustHaveId: 'concert', name: 'Hellfest', met: false, onProperty: false }, stub, led);
assert(url && /getyourguide|tiqets/i.test(url), `ticket url ${url}`);

const days = buildDayPlans({
  checkin: '2026-06-18',
  checkout: '2026-06-22',
  placeName: 'Clisson',
  activities: ['Hellfest', 'Museum'],
  activityBookByTitle: { Hellfest: url! },
});
assert(days.length >= 3, `day count ${days.length}`);
assert(days.every((d) => (d.blocks?.length ?? 0) >= 1), 'every day ≥1 planpunkt');
assert(days.every((d) => (d.blocks?.length ?? 0) <= 20), 'every day ≤20 planpunkte');
const mid = days[1];
assert(mid?.blocks.some((b) => b.title === 'Hellfest' && b.bookUrl === url), `day block ${JSON.stringify(mid)}`);

const cl = buildBookingChecklist({
  activityUrls: [
    { label: 'Hellfest', url: url! },
    { label: 'eSIM Airalo', url: 'https://www.airalo.com/france' },
  ],
});
assert(cl.some((c) => c.kind === 'activity' && /Hellfest/i.test(c.label)), 'checklist ticket');
assert(cl.some((c) => /eSIM/i.test(c.label)), 'checklist esim');

console.log('briefExtras.smoke ok');
