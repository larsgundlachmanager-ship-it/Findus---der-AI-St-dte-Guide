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

// Museum → Öffnungszeiten + Tickets (Partner-Link).
{
  const m = ids('Heimatmuseum', 'Museum', 'museum ausstellung');
  assert(m.includes('hours'), 'Museum hat Öffnungszeiten');
  assert(m.includes('ticket'), 'Museum hat Tickets');
  assert(!m.includes('menu') && !m.includes('book'), 'Museum ohne Menü/Buchen');
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
  const { departureLine, departureSpeakFirst } = require('./mapPlaceLiveActions') as typeof import('./mapPlaceLiveActions');
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
  const speak = departureSpeakFirst({
    line: 'RB 61',
    direction: 'Itzehoe',
    when,
  });
  assert(/1:39|01:39/.test(speak), 'Speech mit Uhrzeit');
  assert(/Itzehoe/.test(speak), 'Speech mit Ziel');
  assert(!/Nächste Abfahrten/i.test(speak), 'Speech nur erste Verbindung');
}

console.log('mapPlaceLiveActions.smoke.test.ts OK');
