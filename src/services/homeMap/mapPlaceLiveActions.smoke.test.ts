/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/mapPlaceLiveActions.smoke.test.ts
 *
 * Reine Logik (kein react-native): Live-Action-Ableitung, Öffnungszeiten-Prettify
 * und der TS-Spiegel des Facet-Lexikons.
 */

import {
  deriveMapPlaceLiveActions,
  prettyOpeningHours,
} from './mapPlaceLiveActions';
import { extractReviewFacetTags } from '../../module2/pitch/gastroFacetTags';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function ids(name: string, category: string, tags = ''): string[] {
  return deriveMapPlaceLiveActions({ name, category, tagsBlob: tags }).map(
    (a) => a.id,
  );
}

// Gastro → Öffnungszeiten + Speisekarte (keine Buchung/Abfahrten).
{
  const g = ids('Hoyers Gasthof', 'Restaurant', 'restaurant steak');
  assert(g.includes('hours'), 'Gastro hat Öffnungszeiten');
  assert(g.includes('menu'), 'Gastro hat Speisekarte');
  assert(!g.includes('departures'), 'Gastro hat keine Abfahrten');
}

// Hotel → Öffnungszeiten + Buchen.
{
  const h = ids('Strandhotel Nordsee', 'Hotel', 'hotel spa parkplatz');
  assert(h.includes('book'), 'Hotel hat Buchen');
  assert(h.includes('hours'), 'Hotel hat Öffnungszeiten');
  assert(!h.includes('departures'), 'Hotel hat keine Abfahrten');
}

// Museum → Öffnungszeiten; Ausstellung/Tickets nur mit belegten Links.
{
  const m = ids('Heimatmuseum', 'Museum', 'museum ausstellung');
  assert(m.includes('hours'), 'Museum hat Öffnungszeiten');
  assert(!m.includes('ticket'), 'Museum ohne Ticket-URL → kein Tickets-Button');
  assert(
    !m.includes('museum_program'),
    'Museum ohne Website → kein Ausstellung-Button',
  );
  assert(!m.includes('menu') && !m.includes('book'), 'Museum ohne Menü/Buchen');
}
{
  const withSite = deriveMapPlaceLiveActions({
    name: 'Kunsthalle',
    category: 'Museum',
    tagsBlob: 'museum',
    websiteUrl: 'https://example.org/ausstellung',
  }).map((a) => a.id);
  assert(withSite.includes('museum_program'), 'Museum mit Website → Ausstellung');
  assert(!withSite.includes('ticket'), 'Website allein → noch kein Ticket');
}
{
  const withTicket = deriveMapPlaceLiveActions({
    name: 'Kunsthalle',
    category: 'Museum',
    tagsBlob: 'museum',
    websiteUrl: 'https://example.org/ausstellung',
    ticketUrl: 'https://www.getyourguide.com/hamburg-l17/museum-tour-t123/',
  }).map((a) => a.id);
  assert(withTicket.includes('ticket'), 'Echter Ticket-Deep-Link → Tickets-Button');
}

// Echter Halt → nur Abfahrten (keine Öffnungszeiten).
{
  const t = ids('Bushaltestelle Marktplatz', 'Bushaltestelle', 'bus_stop');
  assert(t.includes('departures'), 'Halt hat Abfahrten');
  assert(!t.includes('hours'), 'Halt ohne Öffnungszeiten');
  assert(!t.includes('menu'), 'Halt ohne Menü');
}

// "Bahnhofstraße 5" ist Adresse, kein Halt → keine Abfahrten.
{
  const street = ids('Café Bahnhofstraße 5', 'Café', 'cafe');
  assert(!street.includes('departures'), 'Straßenname erzeugt keine Abfahrten');
  assert(street.includes('menu'), 'Café bleibt Gastro');
}

// prettyOpeningHours: OSM-Tokens eindeutschen.
{
  assert(prettyOpeningHours('24/7').includes('24/7'), '24/7 erkannt');
  const p = prettyOpeningHours('Mo-Fr 09:00-18:00; Sa 09:00-14:00');
  assert(/Mo–?Fr|Mo-Fr/.test(p) && /Sa/.test(p), 'Wochentage übernommen');
  assert(!/We|Su|Th/.test(p), 'keine englischen Tages-Codes mehr');
  assert(p.includes(' · '), 'Semikolon → Mittelpunkt-Trenner');
}

// Facet-Lexikon (TS-Spiegel) deckt neue Tags ab.
{
  const drinks = extractReviewFacetTags(
    'Weißbier vom Fass, Cocktails und Craft Beer aus der Hausbrauerei.',
  );
  for (const t of ['weißbier', 'cocktail', 'craftbeer']) {
    assert(drinks.includes(t), `Getränke-Tag ${t} fehlt`);
  }
  const hotel = extractReviewFacetTags(
    'Zentrale Lage, eigener Parkplatz, Sauna/Spa, hundefreundlich.',
  );
  for (const t of ['zentral', 'parkplatz', 'spa', 'hundefreundlich']) {
    assert(hotel.includes(t), `Hotel-Tag ${t} fehlt`);
  }
  const park = extractReviewFacetTags(
    'Spielplatz, Liegewiese zum Picknicken, Hundewiese, toller Ausblick.',
  );
  for (const t of ['spielplatz', 'picknick', 'hundewiese', 'aussicht']) {
    assert(park.includes(t), `Park-Tag ${t} fehlt`);
  }
  const activity = extractReviewFacetTags(
    'Schnupperkurs für Einsteiger, Ausrüstung gestellt, online buchbar.',
  );
  for (const t of ['anfaenger', 'ausruestung', 'buchbar']) {
    assert(activity.includes(t), `Aktivität-Tag ${t} fehlt`);
  }
  const labskaus = extractReviewFacetTags('Norddeutsch mit Labskaus.');
  assert(labskaus.includes('labskaus'), 'labskaus-Tag fehlt');
}

// Abfahrten: Live-Zeit ohne verwirrendes „+20 Min“; Verspätung = Plan → Live.
{
  const {
    departureLine,
    departureSpeakFirst,
    lineLabelForSpeech,
  } = require('./mapPlaceLiveActions') as typeof import('./mapPlaceLiveActions');
  const when = new Date(2026, 8, 3, 1, 39, 0);
  const planned = new Date(2026, 8, 3, 1, 19, 0);
  const delayed = departureLine({
    line: 'RB 61',
    direction: 'Itzehoe',
    when,
    plannedWhen: planned,
    delaySec: 20 * 60,
    cancelled: false,
  });
  assert(!/\+\s*\d+\s*Min/i.test(delayed), 'kein +Min bei Verspätung');
  assert(/01:39/.test(delayed), 'Live-Zeit 01:39');
  assert(/01:19/.test(delayed.replace(/\u0336/g, '')), 'Plan-Zeit erkennbar');
  const onTime = departureLine({
    line: 'RB 61',
    direction: 'Itzehoe',
    when,
    plannedWhen: when,
    delaySec: 0,
    cancelled: false,
  });
  assert(onTime === 'RB 61 → Itzehoe 01:39', `pünktlich: ${onTime}`);
  assert(
    lineLabelForSpeech('RB61') === 'RB einundsechzig' ||
      lineLabelForSpeech('RB61').includes('einundsechzig'),
    `Linie TTS: ${lineLabelForSpeech('RB61')}`,
  );
  assert(
    lineLabelForSpeech('RB 71') === 'RB einundsiebzig',
    `RB71 TTS: ${lineLabelForSpeech('RB 71')}`,
  );
  const speak = departureSpeakFirst({
    line: 'RB 61',
    direction: 'Pinneberg',
    when: new Date(2026, 8, 3, 10, 40, 0),
  });
  assert(/10:40/.test(speak), 'Speech mit Uhrzeit');
  assert(/Pinneberg/.test(speak), 'Speech mit Ziel');
  assert(/Richtung Pinneberg/.test(speak), 'Richtung statt nur nach');
  assert(/mit der RB/i.test(speak), 'Linie in der Ansage');
  assert(/einundsechzig/.test(speak), 'Liniennummer als Wort');
  assert(/Die nächste Abfahrt ist um/i.test(speak), 'flüssige Einstiegsformel');
  assert(!/Nächste Abfahrten/i.test(speak), 'Speech nur erste Verbindung');
  assert(!/Der nächste Zug fährt/i.test(speak), 'alte Zug-Formel weg');
}

{
  const src = require('node:fs').readFileSync(
    require('node:path').join(
      process.cwd(),
      'src/services/transit/adapters/transitousAdapter.ts',
    ),
    'utf8',
  );
  assert(src.includes('polishStreetDirection'), 'Wrist-style polish');
  assert(src.includes('tripTo'), 'uses Motis tripTo');
  assert(src.includes('directionLabel'), 'direction helpers imported');
}


{
  const { departureBulletsCompact } = require('./mapPlaceLiveActions') as typeof import('./mapPlaceLiveActions');
  const compact = departureBulletsCompact([
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 10, 18, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 18, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 71',
      direction: 'Wrist',
      when: new Date(2026, 8, 3, 10, 22, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 22, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 61',
      direction: 'Hamburg Altona',
      when: new Date(2026, 8, 3, 10, 28, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 28, 0),
      delaySec: 0,
      cancelled: false,
    },
  ]);
  assert(compact.length === 3, 'Abfahrten: eine Zeile pro Verbindung');
  assert(compact[0] === 'RB 61 → Pinneberg  🕐 10:18', `Zeile1: ${compact[0]}`);
  assert(compact[1] === 'RB 71 → Wrist  🕐 10:22', `Zeile2: ${compact[1]}`);
  assert(compact[2] === 'RB 61 → Hamburg Altona  🕐 10:28', `Zeile3: ${compact[2]}`);
}


// Kino → Kinoprogramm; Café nicht.
{
  const k = ids('CinemaxX', 'Kino', 'cinema');
  assert(k.includes('cinema_program'), 'Kino hat Kinoprogramm');
  assert(!k.includes('theater_program'), 'Kino ohne Theaterprogramm');
}
{
  const th = ids('Stadttheater', 'Theater', 'theater');
  assert(!th.includes('theater_program'), 'Theater ohne Website → kein Programm');
}
{
  const thSite = deriveMapPlaceLiveActions({
    name: 'Stadttheater',
    category: 'Theater',
    tagsBlob: 'theater',
    websiteUrl: 'https://theater.example/',
  }).map((a) => a.id);
  assert(thSite.includes('theater_program'), 'Theater mit Website → Programm');
}
{
  const c = ids('Café Sonne', 'Café', 'cafe');
  assert(!c.includes('cinema_program') && !c.includes('theater_program'), 'Café ohne Programm-Buttons');
}


{
  const m = ids('Heimatmuseum', 'Museum', 'museum ausstellung');
  assert(!m.includes('museum_program'), 'ohne Website kein Ausstellung-Button');
  assert(m.includes('hours'), 'Museum hat Öffnungszeiten');
}
{
  const withSite = deriveMapPlaceLiveActions({
    name: 'Heimatmuseum',
    category: 'Museum',
    websiteUrl: 'https://heimatmuseum.example/',
  }).map((a) => a.id);
  assert(withSite.includes('museum_program'), 'mit Website: Ausstellung-Button');
}
{
  const c = ids('Elbphilharmonie', 'Konzerthaus', 'konzert philharmonie');
  assert(!c.includes('concert_program'), 'Konzert ohne Website → kein Programm-Button');
  assert(!c.includes('cinema_program'), 'Konzert ohne Kino');
}
{
  const cSite = deriveMapPlaceLiveActions({
    name: 'Elbphilharmonie',
    category: 'Konzerthaus',
    tagsBlob: 'konzert philharmonie',
    websiteUrl: 'https://www.elbphilharmonie.de/',
  }).map((a) => a.id);
  assert(cSite.includes('concert_program'), 'Konzert mit Website → Programm');
}

{
  const {
    filterLiveActionsWithEvidence,
  } = require('./mapPlaceLiveActions') as typeof import('./mapPlaceLiveActions');
  const gastro = deriveMapPlaceLiveActions({
    name: 'Hoyers Gasthof',
    category: 'Restaurant',
  });
  assert(
    filterLiveActionsWithEvidence(gastro, { probing: true }).every(
      (a) => a.id !== 'hours' && a.id !== 'menu',
    ),
    'während Probe: keine Hours/Menu-Ghosts',
  );
  assert(
    filterLiveActionsWithEvidence(gastro, {
      probing: false,
      evidence: {
        hoursOk: false,
        hoursBullet: null,
        menuUrl: null,
        statusLine: 'Keine Öffnungszeiten gefunden',
      },
    }).every((a) => a.id !== 'hours' && a.id !== 'menu'),
    'ohne Evidenz: keine Hours/Menu',
  );
  const withEv = filterLiveActionsWithEvidence(gastro, {
    probing: false,
    evidence: {
      hoursOk: true,
      hoursBullet: 'Öffnungszeiten: Mo–Fr 11–22',
      menuUrl: 'https://example.org/speisekarte',
      statusLine: 'Öffnungszeiten gefunden · Speisekarte gefunden',
    },
  }).map((a) => a.id);
  assert(withEv.includes('hours') && withEv.includes('menu'), 'mit Evidenz: Hours+Menu');
}

{
  const { prettyGoogleHoursPeriods } = require('./mapPlaceLiveActions') as {
    prettyGoogleHoursPeriods: typeof import('./mapPlaceLiveActions').prettyGoogleHoursPeriods;
  };
  const line = prettyGoogleHoursPeriods([
    { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 20, minute: 0 } },
    { open: { day: 4, hour: 8, minute: 0 }, close: { day: 4, hour: 21, minute: 0 } },
  ]);
  assert(/Mo 08:00–20:00/.test(line), `Mo hours ${line}`);
  assert(/Do 08:00–21:00/.test(line), `Do hours ${line}`);
}

console.log('mapPlaceLiveActions.smoke.test.ts OK');
