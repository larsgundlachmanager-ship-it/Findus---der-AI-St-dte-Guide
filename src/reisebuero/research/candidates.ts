export type SeedPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  wiki: string;
  iata?: string;
};

/** Kandidaten-Geografie — keine Speech-Scripts. */
export const SEED_PLACES: readonly SeedPlace[] = [
  { id: 'timmendorf', name: 'Timmendorfer Strand', lat: 54.0006, lng: 10.7764, tags: ['ostsee', 'sand', 'sea', 'daytrip'], wiki: 'Timmendorfer Strand' },
  { id: 'scharbeutz', name: 'Scharbeutz', lat: 54.025, lng: 10.743, tags: ['ostsee', 'sand', 'sea', 'daytrip'], wiki: 'Scharbeutz' },
  { id: 'pelzerhaken', name: 'Pelzerhaken', lat: 54.075, lng: 10.861, tags: ['ostsee', 'sand', 'sea', 'daytrip'], wiki: 'Pelzerhaken' },
  { id: 'travemuende', name: 'Travemünde', lat: 53.961, lng: 10.871, tags: ['ostsee', 'sand', 'sea', 'daytrip'], wiki: 'Travemünde' },
  { id: 'laboe', name: 'Laboe', lat: 54.407, lng: 10.231, tags: ['ostsee', 'sand', 'sea', 'daytrip'], wiki: 'Laboe' },
  { id: 'schoenberg', name: 'Schönberg (Holstein)', lat: 54.396, lng: 10.372, tags: ['ostsee', 'sand', 'sea', 'daytrip'], wiki: 'Schönberg (Holstein)' },
  { id: 'heiligenhafen', name: 'Heiligenhafen', lat: 54.371, lng: 10.98, tags: ['ostsee', 'sand', 'sea', 'daytrip'], wiki: 'Heiligenhafen' },
  { id: 'sankt-peter', name: 'Sankt Peter-Ording', lat: 54.304, lng: 8.627, tags: ['nordsee', 'sand', 'sea'], wiki: 'Sankt Peter-Ording' },
  { id: 'amsterdam', name: 'Amsterdam', lat: 52.3676, lng: 4.9041, tags: ['niederlande', 'bike', 'city', 'party'], wiki: 'Amsterdam', iata: 'AMS' },
  { id: 'utrecht', name: 'Utrecht', lat: 52.0907, lng: 5.1214, tags: ['niederlande', 'bike', 'city'], wiki: 'Utrecht' },
  { id: 'haarlem', name: 'Haarlem', lat: 52.3874, lng: 4.6462, tags: ['niederlande', 'bike', 'city'], wiki: 'Haarlem' },
  { id: 'prag', name: 'Prag', lat: 50.0755, lng: 14.4378, tags: ['city', 'party', 'train', 'drive'], wiki: 'Prag', iata: 'PRG' },
  { id: 'budapest', name: 'Budapest', lat: 47.4979, lng: 19.0402, tags: ['city', 'party', 'spa', 'fly', 'train'], wiki: 'Budapest', iata: 'BUD' },
  { id: 'krakow', name: 'Krakau', lat: 50.0647, lng: 19.945, tags: ['city', 'party', 'fly', 'train'], wiki: 'Krakau', iata: 'KRK' },
  { id: 'berlin', name: 'Berlin', lat: 52.52, lng: 13.405, tags: ['city', 'party', 'train', 'drive'], wiki: 'Berlin', iata: 'BER' },
  { id: 'koeln', name: 'Köln', lat: 50.9375, lng: 6.9603, tags: ['city', 'party', 'train', 'drive'], wiki: 'Köln', iata: 'CGN' },
  { id: 'wroclaw', name: 'Breslau', lat: 51.1079, lng: 17.0385, tags: ['city', 'drive', 'train'], wiki: 'Breslau', iata: 'WRO' },
  { id: 'palma', name: 'Palma', lat: 39.5696, lng: 2.6502, tags: ['sea', 'sand', 'warm', 'fly', 'party'], wiki: 'Palma de Mallorca', iata: 'PMI' },
  { id: 'ibiza', name: 'Ibiza', lat: 38.9067, lng: 1.4206, tags: ['sea', 'sand', 'warm', 'fly', 'party'], wiki: 'Ibiza', iata: 'IBZ' },
  { id: 'malta', name: 'Malta', lat: 35.8989, lng: 14.5146, tags: ['sea', 'sand', 'warm', 'fly', 'party'], wiki: 'Malta', iata: 'MLA' },
  { id: 'valletta', name: 'Valletta', lat: 35.8989, lng: 14.5146, tags: ['sea', 'city', 'warm', 'fly', 'party'], wiki: 'Valletta', iata: 'MLA' },
  { id: 'barcelona', name: 'Barcelona', lat: 41.3874, lng: 2.1686, tags: ['sea', 'city', 'warm', 'fly', 'party'], wiki: 'Barcelona', iata: 'BCN' },
  { id: 'nizza', name: 'Nizza', lat: 43.7102, lng: 7.262, tags: ['sea', 'warm', 'fly', 'city'], wiki: 'Nizza', iata: 'NCE' },
  { id: 'split', name: 'Split', lat: 43.5081, lng: 16.4402, tags: ['sea', 'warm', 'fly', 'party'], wiki: 'Split', iata: 'SPU' },
  { id: 'lisbon', name: 'Lissabon', lat: 38.7223, lng: -9.1393, tags: ['city', 'party', 'warm', 'fly'], wiki: 'Lissabon', iata: 'LIS' },
  { id: 'antalya', name: 'Antalya', lat: 36.8969, lng: 30.7133, tags: ['sea', 'warm', 'fly', 'sand'], wiki: 'Antalya', iata: 'AYT' },
  { id: 'baden-baden', name: 'Baden-Baden', lat: 48.7606, lng: 8.2397, tags: ['spa', 'city', 'drive', 'train'], wiki: 'Baden-Baden' },
  { id: 'korfu', name: 'Korfu', lat: 39.6243, lng: 19.9217, tags: ['griechenland', 'sea', 'sand', 'warm', 'fly'], wiki: 'Korfu', iata: 'CFU' },
  { id: 'naxos', name: 'Naxos', lat: 37.1036, lng: 25.3767, tags: ['griechenland', 'sea', 'sand', 'warm', 'fly'], wiki: 'Naxos (Insel)', iata: 'JNX' },
  { id: 'kreta', name: 'Kreta', lat: 35.2401, lng: 24.8093, tags: ['griechenland', 'sea', 'sand', 'warm', 'fly', 'villa', 'pool'], wiki: 'Kreta', iata: 'HER' },
  { id: 'luebeck', name: 'Lübeck', lat: 53.8655, lng: 10.6866, tags: ['ostsee', 'city', 'daytrip'], wiki: 'Lübeck' },
  { id: 'oberstdorf', name: 'Oberstdorf', lat: 47.407, lng: 10.278, tags: ['hike', 'alpen', 'train', 'eco', 'hut'], wiki: 'Oberstdorf' },
  { id: 'garmisch', name: 'Garmisch-Partenkirchen', lat: 47.4917, lng: 11.0955, tags: ['hike', 'alpen', 'train', 'eco'], wiki: 'Garmisch-Partenkirchen' },
  { id: 'trier', name: 'Trier', lat: 49.7568, lng: 6.6413, tags: ['bike', 'wine', 'train', 'eco'], wiki: 'Trier' },
  { id: 'cochem', name: 'Cochem', lat: 50.145, lng: 7.167, tags: ['bike', 'wine', 'train', 'eco'], wiki: 'Cochem' },
  { id: 'alcudia', name: 'Alcúdia', lat: 39.8532, lng: 3.124, tags: ['sea', 'sand', 'warm', 'fly', 'tennis', 'pool', 'villa'], wiki: 'Alcúdia', iata: 'PMI' },
  { id: 'bukarest', name: 'Bukarest', lat: 44.4268, lng: 26.1025, tags: ['city', 'party', 'fly', 'spa'], wiki: 'Bukarest', iata: 'OTP' },
  { id: 'rugen', name: 'Rügen', lat: 54.4167, lng: 13.4, tags: ['ostsee', 'sand', 'sea', 'drive'], wiki: 'Rügen' },
  { id: 'allgau', name: 'Allgäu', lat: 47.55, lng: 10.25, tags: ['hike', 'alpen', 'drive', 'train'], wiki: 'Allgäu' },
  { id: 'albufeira', name: 'Albufeira', lat: 37.0889, lng: -8.245, tags: ['sea', 'sand', 'warm', 'fly', 'party'], wiki: 'Albufeira', iata: 'FAO' },
  { id: 'stjulians', name: "St. Julian's", lat: 35.9182, lng: 14.4898, tags: ['sea', 'party', 'warm', 'fly'], wiki: "St. Julian's (Malta)", iata: 'MLA' },
  { id: 'prisdorf', name: 'Prisdorf', lat: 53.6833, lng: 9.7667, tags: ['home', 'daytrip'], wiki: 'Prisdorf' },
];

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function driveHours(km: number): number {
  return km / 72;
}
