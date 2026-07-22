import type { Poi } from './types';

/**
 * Dummy-POIs mit realen Koordinaten in Prisdorf (Schleswig-Holstein).
 */
export const SEED_POIS: Omit<Poi, 'id'>[] = [
  {
    name: 'Bahnhof Prisdorf',
    lat: 53.675291,
    lng: 9.760216,
    radius_meters: 80,
  },
  {
    name: 'Peiner Hof',
    lat: 53.66929,
    lng: 9.76569,
    radius_meters: 120,
  },
];

export const SEED_FACTS: Record<string, string[]> = {
  'Bahnhof Prisdorf': [
    'Der Bahnhof Prisdorf liegt an der Bahnstrecke Hamburg–Kiel und verbindet das Dorf seit dem 19. Jahrhundert mit der Metropolregion Hamburg.',
    'Mit der Stationsnummer 5039 und der DS100-Abkürzung APD ist Prisdorf ein Haltepunkt der Kategorie 5 im Regionalverkehr Schleswig-Holstein.',
    'Die Bahnsteige sind barrierefrei über höhengleiche Zugänge erreichbar – Gleis 1 misst rund 220 Meter, Gleis 2 etwa 300 Meter.',
    'Nur wenige hundert Meter entfernt beginnt die Allee zum Peiner Hof – ein beliebter Spazierweg zwischen Dorf und Golfpark.',
  ],
  'Peiner Hof': [
    'Der Peiner Hof in Prisdorf ist heute vor allem als Fairway Golf Peiner Hof bekannt: ein 18-Loch-Platz (Par 71) im Pinnau-Tal.',
    'Die Anlage liegt idyllisch zwischen Knicks, Teichen und altem Baumbestand und zählt zu den landschaftlich reizvollen Golfplätzen nordwestlich von Hamburg.',
    'Auf dem Gelände finden sich Clubhaus, Hotel und das Restaurant „Goldschätzchen“ mit Biergarten – nach der Runde oder dem Spaziergang ein typischer Treffpunkt.',
    'Vom Regionalbahnhof Prisdorf sind es zu Fuß nur etwa 800 Meter bis zum Peiner Hof – ideal für eine kleine Dorfrunde ohne Auto.',
  ],
};
