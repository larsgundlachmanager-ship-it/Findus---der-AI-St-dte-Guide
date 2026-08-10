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
    label: 'Modul 1',
    /** Legenden-Chip; Pin-Farben kommen bei Aktivierung aus Interest-Tönen */
    color: '#5B8DEF',
  },
  { id: 'essen', label: 'Essen', color: '#E07A5F' },
  { id: 'cafe', label: 'Café', color: '#C4A35A' },
  { id: 'kultur', label: 'Kultur', color: '#7B68EE' },
  { id: 'natur', label: 'Natur / Aussicht', color: '#3DCF7A' },
  { id: 'kirche', label: 'Kirche', color: '#A8B5AE' },
  { id: 'transport', label: 'Bahn / Transport', color: '#5B8DEF' },
  { id: 'hotel', label: 'Übernachtung', color: '#D4A0C4' },
  { id: 'einkaufen', label: 'Einkaufen', color: '#F2CC8F' },
  { id: 'service', label: 'Service / Geld', color: '#6EC6C0' },
  { id: 'freizeit', label: 'Freizeit', color: '#81B29A' },
  { id: 'sonstiges', label: 'Sonstiges', color: '#9CA3AF' },
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
