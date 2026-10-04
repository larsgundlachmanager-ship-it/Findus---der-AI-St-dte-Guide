/**
 * Regionale Ferien-/Season-/Klima-Tabellen (Europa v1).
 * Batch-Daten — nicht jedes Mal LLM. Nord≠Süd.
 */

export type RegionSeasonRow = {
  regionId: string;
  label: string;
  countryCode: string;
  /** Schulferien-Hinweis DE-Bundesland oder EU */
  schoolHolidayHint?: string;
  /** Beste Reise-Monate 1–12 */
  peakMonths: number[];
  /** Schulferien-Preisspitzen oft */
  priceSpikeMonths?: number[];
  climateNote: string;
};

export const EUROPE_REGION_SEASONS: RegionSeasonRow[] = [
  {
    regionId: 'de-sh-nord',
    label: 'Schleswig-Holstein / Nordsee-Ostsee',
    countryCode: 'DE',
    schoolHolidayHint: 'SH eigene Ferien — nicht BY/NW mischen',
    peakMonths: [6, 7, 8],
    priceSpikeMonths: [7, 8],
    climateNote: 'Kühl-maritim; Badesaison kürzer als Mittelmeer',
  },
  {
    regionId: 'de-by-alpen',
    label: 'Bayern Alpen / Allgäu',
    countryCode: 'DE',
    schoolHolidayHint: 'BY oft länger Sommerferien',
    peakMonths: [6, 7, 8, 9],
    priceSpikeMonths: [7, 8],
    climateNote: 'Alpin; Wanderfenster Jun–Sep, Schnee Winter',
  },
  {
    regionId: 'de-hh',
    label: 'Hamburg / Norddeutschland',
    countryCode: 'DE',
    schoolHolidayHint: 'HH eigene Ferien',
    peakMonths: [5, 6, 7, 8, 9],
    climateNote: 'Wechselhaft; Sommer milder als Süd-DE',
  },
  {
    regionId: 'es-mallorca',
    label: 'Mallorca',
    countryCode: 'ES',
    peakMonths: [5, 6, 9, 10],
    priceSpikeMonths: [7, 8],
    climateNote: 'Hochsommer sehr heiß; günstig oft Nov–Mar / Schulferien-Ränder',
  },
  {
    regionId: 'gr-islands',
    label: 'Griechenland Inseln',
    countryCode: 'GR',
    peakMonths: [5, 6, 9, 10],
    priceSpikeMonths: [7, 8],
    climateNote: 'Saison Apr–Okt; Okt oft noch warm, günstiger',
  },
  {
    regionId: 'pt-lisbon',
    label: 'Lissabon / Küste',
    countryCode: 'PT',
    peakMonths: [4, 5, 6, 9, 10],
    priceSpikeMonths: [7, 8],
    climateNote: 'Mild; Atlantik-Winde',
  },
  {
    regionId: 'hu-budapest',
    label: 'Budapest',
    countryCode: 'HU',
    peakMonths: [4, 5, 9, 10],
    priceSpikeMonths: [7, 8],
    climateNote: 'Kontinental; Thermal ganzjährig',
  },
  {
    regionId: 'cz-prague',
    label: 'Prag',
    countryCode: 'CZ',
    peakMonths: [4, 5, 9, 10],
    priceSpikeMonths: [7, 8, 12],
    climateNote: 'Stadt ganzjährig; Bahn aus DE oft sinnvoll',
  },
];

export function regionSeasonForQuery(q: string): RegionSeasonRow | null {
  const t = q.toLowerCase();
  if (/mallorca|magaluf|alcúdia|alcudia/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'es-mallorca') ?? null;
  }
  if (/griechenland|kreta|rhodes|santorini|kos\b/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'gr-islands') ?? null;
  }
  if (/budapest/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'hu-budapest') ?? null;
  }
  if (/prag|prague/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'cz-prague') ?? null;
  }
  if (/allgäu|allgaeu|alpen|garmisch/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'de-by-alpen') ?? null;
  }
  if (/rügen|ruegen|ostsee|sylt|nordsee/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'de-sh-nord') ?? null;
  }
  if (/hamburg/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'de-hh') ?? null;
  }
  if (/lissabon|lisbon|portugal/i.test(t)) {
    return EUROPE_REGION_SEASONS.find((r) => r.regionId === 'pt-lisbon') ?? null;
  }
  return null;
}

/** DE Schulferien — grobe Bundesland-Hinweise (Detail-Kalender später erweitern). */
export const DE_STATE_HOLIDAY_NOTES: Record<string, string> = {
  SH: 'Schleswig-Holstein — eigene Sommerferien-Lage',
  HH: 'Hamburg — eigene Ferien',
  NI: 'Niedersachsen',
  HB: 'Bremen',
  MV: 'Mecklenburg-Vorpommern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  ST: 'Sachsen-Anhalt',
  SN: 'Sachsen',
  TH: 'Thüringen',
  NW: 'Nordrhein-Westfalen',
  HE: 'Hessen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  BW: 'Baden-Württemberg',
  BY: 'Bayern — oft längere Sommerferien',
};
