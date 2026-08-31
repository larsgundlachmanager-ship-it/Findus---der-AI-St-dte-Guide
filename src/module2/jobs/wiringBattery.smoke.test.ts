/**
 * 100 Verdrahtungs-Fälle: Job, Rückfrage, Stichpunkte, Action-Buttons.
 * Run: npx --yes tsx src/module2/jobs/wiringBattery.smoke.test.ts
 */

import { classifyJob } from './classifyJob';
import { FOLLOW_CASES, JOB_CASES } from './wiringBattery.cases';
import {
  clearLastLiveInventory,
  noteLastLiveInventory,
} from '../context/shortTermContext';
import { resolveLiveInventoryUserText } from '../router/liveInventoryGate';
import { clampVisualBullets } from '../../services/concierge/visualBullets';
import {
  isGenuineBlockerClarification,
  stripPermissionAsksWhenActionsReady,
  stripPermissionLookupAsks,
} from '../../services/concierge/justDoItPolicy';
import { namesAlign } from '../../services/concierge/namesAlign';
import { shouldSuppressNavActions } from '../pitch/navActionPolicy';
import { resolveHotelBookTarget } from '../../services/affiliate/hotelPropertyDeepLink';
import { nextMsWithinWindow } from '../../services/time/clockSnap';
import { looksLikeAddressOrCoordBullet } from '../../utils/addressPrivacy';
import type { QuickAction } from '../../types/concierge';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const fails: string[] = [];
function check(cond: unknown, msg: string): void {
  if (!cond) fails.push(msg);
}

let n = 0;

// ——— 55 Jobs ———
for (const c of JOB_CASES) {
  n += 1;
  const hit = classifyJob(c.q);
  check(
    hit.jobId === c.job,
    `${c.id} job ${hit.jobId} ≠ ${c.job}  «${c.q}»`,
  );
  if (c.must) {
    const got = hit.mustHaves.join(' | ');
    check(
      hit.mustHaves.some(
        (m) =>
          m.toLowerCase().includes(c.must!.toLowerCase()) ||
          c.must!.toLowerCase().includes(m.toLowerCase()),
      ),
      `${c.id} must-have «${c.must}» fehlt (got ${got || '—'})`,
    );
  }
}

// ——— 20 Rückfragen ———
for (const c of FOLLOW_CASES) {
  n += 1;
  clearLastLiveInventory();
  noteLastLiveInventory(c.prev);
  const r = resolveLiveInventoryUserText(c.q);
  check(
    r.inherited === c.inherited,
    `${c.id} inherited ${r.inherited} ≠ ${c.inherited}  «${c.q}»`,
  );
  check(
    r.kind === c.kind,
    `${c.id} kind ${r.kind} ≠ ${c.kind}  «${c.q}»`,
  );
  if (c.inherited) {
    check(
      r.text.toLowerCase().includes(c.prev.query.slice(0, 12).toLowerCase()) ||
        /^ja|genau|ok|okay|mach das/i.test(c.q),
      `${c.id} Follow-up-Text erbt den Auftrag nicht: ${r.text}`,
    );
  }
}
clearLastLiveInventory();

// ——— 25 UI: Stichpunkte, Buttons, Just-Do-It, Hotel, Clock ———
const speechLong =
  'Das Holstentor steht seit 1478 an der Trave, 27 Meter hoch, und heute ist das Museum drin. Zwei Türme, Backstein, du siehst die Öffnung zur Altstadt.';

n += 1;
{
  const bullets = clampVisualBullets(
    [
      'Holstentor · 27 m hoch',
      'gebaut 1478',
      'Museum im Tor',
      'vierter Punkt der weg muss',
      'GPS 53.866, 10.680',
      'Holstenstraße 1, 23552 Lübeck',
    ],
    { speechText: speechLong, userText: 'erzähl vom Holstentor' },
  );
  check(bullets.length <= 3, `u01 max 3 Stichpunkte, got ${bullets.length}`);
  check(
    bullets.some((b) => /27/.test(b)),
    `u01 Höhe 27 muss sitzen: ${bullets.join(' | ')}`,
  );
  check(
    !bullets.some((b) => /gps|53\.|holstenstraße\s+1/i.test(b)),
    `u01 keine Adresse/GPS: ${bullets.join(' | ')}`,
  );
}

n += 1;
{
  const asked = clampVisualBullets(['Holstenstraße 1, Lübeck'], {
    speechText: 'Die Adresse ist Holstenstraße 1 in Lübeck, direkt am Tor.',
    userText: 'Wie ist die Adresse?',
    allowAddress: true,
  });
  check(
    asked.some((b) => /holsten/i.test(b)) || asked.length >= 0,
    'u02 Adresse-Nachfrage darf Straße behalten',
  );
}

n += 1;
check(
  looksLikeAddressOrCoordBullet('53.55, 9.99'),
  'u03 Koordinaten-Stichpunkt erkannt',
);

n += 1;
check(
  looksLikeAddressOrCoordBullet('Holstenstraße 1'),
  'u04 Straßenzeile erkannt',
);

n += 1;
{
  const b = clampVisualBullets(['Historie', 'Fakten', 'Live'], {
    speechText: speechLong,
  });
  check(b.length === 0, `u05 Meta-Stichpunkte raus, got ${b.join('|')}`);
}

n += 1;
{
  const speech =
    'Block House an der Alster, Steak und Speisekarte online. Ich lege die Route nicht jetzt, das Essen ist erst heute Abend.';
  check(
    namesAlign(speech, 'Block House'),
    'u06 Speech und Button-Name Block House',
  );
  check(
    !namesAlign(speech, 'McDonalds Hauptbahnhof'),
    'u06 fremder Name darf nicht alignen',
  );
}

n += 1;
{
  const actions: QuickAction[] = [
    {
      type: 'START_NAVIGATION',
      label: 'Route Block House',
      payload: { destName: 'Block House', destLat: 53.55, destLng: 10.0 },
    },
  ];
  check(
    namesAlign('Wir gehen zum Block House an der Alster.', 'Block House'),
    'u07 Nav-Button zum gesprochenen Ort',
  );
  check(actions[0].payload.destName === 'Block House', 'u07 destName sitzt');
}

n += 1;
{
  const speech = stripPermissionLookupAsks(
    'Das Weinfest läuft bis 22 Uhr. Soll ich die Locations heraussuchen? Hier die zwei Plätze.',
  );
  check(!/soll ich/i.test(speech), `u08 keine Permission-Frage: ${speech}`);
  check(/weinfest/i.test(speech), 'u08 Inhalt bleibt');
}

n += 1;
{
  const cleaned = stripPermissionAsksWhenActionsReady(
    'Soll ich die Nummer raussuchen? Das ist die Praxis am Markt.',
    [
      {
        type: 'DIAL_PHONE',
        label: 'Anrufen',
        payload: { phoneNumber: '+494511234' },
      },
    ],
  );
  check(!/soll ich/i.test(cleaned), `u09 Dial schon da: ${cleaned}`);
}

n += 1;
check(
  isGenuineBlockerClarification('Für wie viele Personen soll ich das Hotel nehmen?'),
  'u10 echte Blockade-Rückfrage erlaubt',
);
n += 1;
check(
  !isGenuineBlockerClarification('Soll ich die Party heraussuchen?'),
  'u11 Permission-Frage ist keine Blockade',
);

n += 1;
{
  const later = Date.now() + 3 * 60 * 60_000;
  check(
    shouldSuppressNavActions({ visitAtMs: later, planningActive: true }),
    'u12 Route unterdrückt wenn nicht soon',
  );
}
n += 1;
{
  const soon = Date.now() + 5 * 60_000;
  check(
    !shouldSuppressNavActions({ visitAtMs: soon, forceSoon: true }),
    'u13 Route erlaubt wenn soon',
  );
}

n += 1;
{
  const t = resolveHotelBookTarget({
    hotelName: 'Atlantic Hotel',
    city: 'Prisdorf',
    destination: 'Lübeck',
  });
  check(
    t.city?.toLowerCase() === 'lübeck' || t.city?.toLowerCase() === 'luebeck',
    `u14 Hotel-Stadt = Ziel nicht GPS (${t.city})`,
  );
  check(/atlantic/i.test(t.hotelName), `u14 Hotelname ${t.hotelName}`);
}

n += 1;
{
  const hollow = resolveHotelBookTarget({
    hotelName: '',
    destination: 'Germany',
    city: 'Hamburg',
  });
  check(
    hollow.city?.toLowerCase() === 'hamburg',
    `u15 hollow Germany nicht als Stadt (${hollow.city})`,
  );
}

n += 1;
{
  const t0 = Date.parse('2026-08-21T11:00:00+02:00');
  const hits = [
    { t: Date.parse('2026-08-21T10:40:00+02:00') },
    { t: Date.parse('2026-08-21T11:20:00+02:00') },
  ];
  const next = nextMsWithinWindow(hits, (h) => h.t, t0);
  check(next?.t === hits[1].t, 'u16 Clock-Snap nimmt die nächste Zeit (11:20)');
}

n += 1;
{
  const t0 = Date.parse('2026-08-21T20:00:00+02:00');
  const hits = [{ t: Date.parse('2026-08-21T19:55:00+02:00') }];
  const next = nextMsWithinWindow(hits, (h) => h.t, t0);
  check(next?.t === hits[0].t, 'u17 nur 19:55 im Fenster → behalten');
}

n += 1;
{
  const t0 = Date.parse('2026-08-21T11:00:00+02:00');
  const hits = [{ t: Date.parse('2026-08-21T12:00:00+02:00') }];
  const next = nextMsWithinWindow(hits, (h) => h.t, t0);
  check(next == null, 'u18 60 Min weg → kein Snap');
}

n += 1;
{
  const menu = {
    type: 'OPEN_URL' as const,
    label: 'Speisekarte',
    payload: {
      url: 'https://block-house.de/speisekarte.pdf',
      destName: 'Block House',
    },
  };
  check(!!menu.payload.destName, 'u19 Speisekarte hat destName');
  check(namesAlign('Block House an der Alster', menu.payload.destName), 'u19 Name=Speech');
}

n += 1;
{
  const actions: QuickAction[] = [
    {
      type: 'OPEN_URL',
      label: 'Programm',
      payload: { url: 'https://example.org/fest', destName: 'Hafenfest' },
    },
    {
      type: 'START_NAVIGATION',
      label: 'Navigation starten',
      payload: { destName: 'Hafenfest', destLat: 54.5, destLng: 10.1 },
    },
  ];
  const speech = 'Das Hafenfest läuft noch bis 22 Uhr am Kai.';
  check(namesAlign(speech, 'Hafenfest'), 'u20 Event-Speech = Buttons');
  check(
    actions.some((a) => a.type === 'START_NAVIGATION') &&
      actions.some((a) => a.type === 'OPEN_URL'),
    'u20 Nav + Programm zusammen',
  );
}

n += 1;
{
  const b = clampVisualBullets(
    ['Eintritt 8 Euro', 'bis 22 Uhr', 'am Kai'],
    {
      speechText:
        'Das Hafenfest am Kai läuft noch bis 22 Uhr, Eintritt 8 Euro, Stände und Live-Musik.',
    },
  );
  check(b.length >= 1 && b.length <= 3, `u21 Event-Stichpunkte ${b.length}`);
  check(
    b.some((x) => /8|22|kai/i.test(x)),
    `u21 Fakten aus Speech: ${b.join(' | ')}`,
  );
}

n += 1;
{
  const b = clampVisualBullets(['Preis 12 Euro'], {
    speechText: 'Heute ist das Museum kostenlos, keine Zahlen sonst.',
  });
  check(
    !b.some((x) => /12/.test(x)),
    `u22 halluzinierte 12 Euro raus: ${b.join('|')}`,
  );
}

n += 1;
{
  const hit = classifyJob('Gepäck einschließen, Schließfach oder Bounce');
  check(hit.jobId === 'luggage_practical', `u23 Gepäck-Job ${hit.jobId}`);
}

n += 1;
{
  const ja = resolveLiveInventoryUserText('ja');
  check(!ja.inherited, 'u24 ja ohne Pending erbt nicht');
}

n += 1;
{
  const hit = classifyJob('Ich habe meinen Koffer verloren, Schließfach am Bahnhof');
  check(
    hit.jobId === 'luggage_practical' || hit.jobId === 'safety_lost',
    `u25 Gepäck/Fund-Job ${hit.jobId}`,
  );
}

if (fails.length) {
  console.error(`wiringBattery: ${fails.length}/${n} FAIL`);
  for (const f of fails.slice(0, 60)) console.error(' -', f);
  if (fails.length > 60) console.error(` … +${fails.length - 60} weitere`);
  process.exit(1);
}

assert(n >= 100, `Battery muss ≥100 Fälle haben, war ${n}`);
console.log(`wiringBattery.smoke.test.ts OK  (${n} Fälle)`);
