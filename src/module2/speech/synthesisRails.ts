/**
 * Call-2 Synthese-Geländer — analogische Form, keine Pflicht-Slots.
 * Jobs holen Fakten. Diese Rails sagen nur, *wie* die Antwort hängen darf.
 * Call-1 bleibt unberührt.
 */

export type SynthesisRailId = 'conditions_then_examples' | 'fixed_clock_reverse';

export type SynthesisRailHit = {
  id: SynthesisRailId;
  score: number;
  rail: string;
};

const PLACE_HUNT =
  /\b(wo\s+(ist|gibt\s+es|finde\s+ich)|nächste[rsn]?\s+(pizza|döner|doener|restaurant|aldi|lidl)|route\s+nach|navigier(?:en)?\s+mich)\b/iu;

const ADVICE =
  /\b(ideen?|tipps?|vorschläge|vorschlaege|was\s+(soll|kann|muss)\s+ich|womit|welche[sn]?)\b/iu;

const ITEM_CURRENCY =
  /\b(an(?:zieh)|outfit|kleidung|packen|mitbring|mitnehm|schmück|schmueck|dekor|einricht|geschenk|mitbringsel)\b/iu;

const VENUE_ADVICE =
  /\b(restaurant|hotel|museum|stadtbummel|essen\s+gehen)\b/iu;

const WEAR_OR_WEATHER =
  /\b(wetter|anziehen|outfit|kleidung|was\s+soll\s+ich\s+an)\b/iu;

const NEXT_DEPARTURE =
  /\b(nächste[rsn]?\s+(bus|bahn|zug|s-bahn|sbahn)|wann\s+fährt)\b/iu;

const LEAVE_BY_ASK =
  /\b(wann\s+(muss|soll)\s+ich\s+(los|aufbrechen|am\s+flughafen)|wann\s+los\s+zum|leave.?by|aufbrechen)\b/iu;

const FIXED_CLOCK =
  /\b(flug|flughafen|zug|bahn|fähre|faehre|einlass|konzert|training|spiel\s+um|termin)\b/iu;

const CONDITIONS_RAIL = `GELÄNDER (nicht Pflicht) — Lage, dann Beispiele:
Gleiche Frage: erst belegte Lage/Bedingungen, dann konkrete Beispiele in der Währung der Frage.
Ähnlich, andere Währung (Ideen statt Kleidungsteile, Deko statt Outfit, Mitbringsel statt Jacke): dieselbe Reihenfolge, Slots ersetzen. Nie die Beispiel-Slots des Tipps durchdrücken.
Schiefer Fit: nützliche Teile behalten, Rest weglassen.
Wortlaut frei.`;

const CLOCK_RAIL = `GELÄNDER (nicht Pflicht) — fester Halt rückwärts:
Gleiche Frage: erst der Halt (wann los, Ankunft, was wenn er kippt), dann der Rest.
Ähnlich (Bahn, Fähre, Konzert-Einlass, Training): dieselbe Reihenfolge, Uhr und Ort aus der Frage.
Schiefer Fit: kein Leave-by erzwingen, wenn niemand einen Termin hat.
Wortlaut frei.`;

function scoreConditionsThenExamples(text: string): number {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  if (PLACE_HUNT.test(t) && !WEAR_OR_WEATHER.test(t)) return 0;
  if (WEAR_OR_WEATHER.test(t)) return 0.95;
  if (/\bideen?\s+(für|zu)\b/iu.test(t) && !VENUE_ADVICE.test(t)) return 0.84;
  if (ADVICE.test(t) && ITEM_CURRENCY.test(t)) return 0.88;
  if (/\bwas\s+(pack|mitbring|mitnehm)/iu.test(t)) return 0.86;
  return 0;
}

function scoreFixedClockReverse(text: string): number {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  if (NEXT_DEPARTURE.test(t) && !/\b(mein|gebucht|bestätigt|bestaetigt)\b/iu.test(t)) {
    return 0;
  }
  if (LEAVE_BY_ASK.test(t) && FIXED_CLOCK.test(t)) return 0.92;
  if (LEAVE_BY_ASK.test(t)) return 0.8;
  if (/\b(flug|flughafen)\b/iu.test(t) && /\b(wann|los|aufbrechen|leave)\b/iu.test(t)) {
    return 0.88;
  }
  if (
    /\b(einlass|konzert|training|spiel\s+um)\b/iu.test(t) &&
    /\b(wann\s+(los|aufbrechen)|leave.?by)\b/iu.test(t)
  ) {
    return 0.82;
  }
  return 0;
}

/** Analogische Geländer für die aktuelle Frage — 0–2, nie Scripts. */
export function matchSynthesisRails(text: string): SynthesisRailHit[] {
  const scored: SynthesisRailHit[] = [
    {
      id: 'conditions_then_examples',
      score: scoreConditionsThenExamples(text),
      rail: CONDITIONS_RAIL,
    },
    {
      id: 'fixed_clock_reverse',
      score: scoreFixedClockReverse(text),
      rail: CLOCK_RAIL,
    },
  ];
  return scored
    .filter((h) => h.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

/** Call-2 User-Prompt-Stück. Leer wenn kein nahes Geländer. */
export function formatSynthesisRailsForPrompt(text: string): string {
  const hits = matchSynthesisRails(text);
  if (!hits.length) return '';
  return [
    '=== SYNTHESE-GELÄNDER (Hang-on, keine Pflicht) ===',
    'Nimm die Form, ersetze Slots durch die Währung der Frage. Schiefer Fit: weglassen.',
    ...hits.map((h) => h.rail),
  ].join('\n');
}
