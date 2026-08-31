/**
 * Kategorie-Farben & Labels für Stempelkarte / Stadt-Map.
 */

export type StampMapCategory =
  | 'modul1'
  | 'essen'
  | 'cafe'
  | 'kultur'
  | 'natur'
  | 'kirche'
  | 'transport'
  | 'hotel'
  | 'einkaufen'
  | 'service'
  | 'freizeit'
  | 'sonstiges';

export type StampMapLegendItem = {
  id: StampMapCategory;
  label: string;
  color: string;
};

export const STAMP_MAP_LEGEND: StampMapLegendItem[] = [
  {
    id: 'modul1',
    label: 'Erkunden',
    /** Legenden-Chip; Pin-Farben kommen bei Aktivierung aus Interest-Tönen */
    color: '#C4A86A',
  },
  { id: 'essen', label: 'Essen', color: '#C4785E' },
  { id: 'cafe', label: 'Café', color: '#B08948' },
  { id: 'kultur', label: 'Kultur', color: '#7A6FB0' },
  { id: 'natur', label: 'Natur / Aussicht', color: '#5FA88A' },
  { id: 'kirche', label: 'Kirche', color: '#8F9893' },
  { id: 'transport', label: 'Bahn / Transport', color: '#5B84C4' },
  { id: 'hotel', label: 'Übernachtung', color: '#A889A0' },
  { id: 'einkaufen', label: 'Einkaufen', color: '#C4A86A' },
  { id: 'service', label: 'Service / Geld', color: '#6A9E98' },
  { id: 'freizeit', label: 'Freizeit', color: '#6F9A82' },
  { id: 'sonstiges', label: 'Sonstiges', color: '#8B9290' },
];

const COLOR_BY_ID = Object.fromEntries(
  STAMP_MAP_LEGEND.map((x) => [x.id, x.color]),
) as Record<StampMapCategory, string>;

const LABEL_BY_ID = Object.fromEntries(
  STAMP_MAP_LEGEND.map((x) => [x.id, x.label]),
) as Record<StampMapCategory, string>;

export function resolveStampMapCategory(input: {
  category?: string | null;
  name?: string | null;
  kind?: string | null;
  tags?: string | null;
}): StampMapCategory {
  const blob =
    `${input.category ?? ''} ${input.name ?? ''} ${input.kind ?? ''} ${input.tags ?? ''}`.toLowerCase();

  if (/(geldautomat|bankomat|sparkasse|atm|apotheke|polizei|praxis|service)/i.test(blob))
    return 'service';
  if (/(café|cafe|kaffee|tea|teestube)/i.test(blob)) return 'cafe';
  if (/(restaurant|gastro|fisch|imbiss|pizzeria|essen|bäck|baeck)/i.test(blob))
    return 'essen';
  if (/(museum|galerie|kunst|denkmal|kultur|ort\b)/i.test(blob)) return 'kultur';
  if (/(strand|düne|natur|watt|park|aussicht|meer)/i.test(blob)) return 'natur';
  if (/(kirche|kapelle|kloster)/i.test(blob)) return 'kirche';
  if (/(bahnhof|transport|fähre|faehre|hafen|bus)/i.test(blob)) return 'transport';
  if (/(hotel|pension|unterkunft)/i.test(blob)) return 'hotel';
  if (/(einkauf|laden|shop|markt|supermarket)/i.test(blob)) return 'einkaufen';
  if (/(freizeit|sport|spiel|bad)/i.test(blob)) return 'freizeit';
  return 'sonstiges';
}

export function colorForStampCategory(cat: StampMapCategory): string {
  return COLOR_BY_ID[cat] ?? COLOR_BY_ID.sonstiges;
}

export function labelForStampCategory(cat: StampMapCategory): string {
  return LABEL_BY_ID[cat] ?? LABEL_BY_ID.sonstiges;
}
