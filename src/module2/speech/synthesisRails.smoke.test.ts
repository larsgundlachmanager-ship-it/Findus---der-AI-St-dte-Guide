/**
 * Synthese-Geländer: Form erben, Slots der Frage, keine Pflicht.
 * Avoid importing findusResponsePolicy (RN leak). Policy text is read from disk.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/speech/synthesisRails.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatSynthesisRailsForPrompt,
  matchSynthesisRails,
} from './synthesisRails';
import { weatherOutfitLookupTips } from '../planning/planUtteranceGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const wear = matchSynthesisRails('Was soll ich morgen anziehen für den Stadtbummel?');
assert(
  wear.some((h) => h.id === 'conditions_then_examples'),
  'anziehen → Lage-dann-Beispiele',
);

const deko = matchSynthesisRails('Hast du Ideen für Deko in der Wohnung?');
assert(
  deko.some((h) => h.id === 'conditions_then_examples'),
  'Deko-Ideen erben dieselbe Form analog',
);
assert(wear[0]!.id === deko[0]!.id, 'anziehen und Deko teilen das Geländer');

const dekoPrompt = formatSynthesisRailsForPrompt(
  'Hast du Ideen für Deko in der Wohnung?',
);
assert(/geländer|nicht pflicht/i.test(dekoPrompt), 'Deko-Prompt ist Geländer');
assert(
  !/ich muss .{0,20}(jacke|kleidungsteile)/i.test(dekoPrompt),
  'Deko erzwingt keine Kleidung',
);
assert(/währung|slots ersetzen/i.test(dekoPrompt), 'Slots der Frage, nicht des Tipps');

const pizza = matchSynthesisRails('Wo ist die nächste Pizza?');
assert(
  !pizza.some((h) => h.id === 'conditions_then_examples'),
  'Pizza-Suche ist kein Lage-dann-Beispiele-Geländer',
);

const leave = matchSynthesisRails('Wann muss ich los zum Flughafen?');
assert(
  leave.some((h) => h.id === 'fixed_clock_reverse'),
  'Los-zum-Flughafen → Halt rückwärts',
);

const nextBus = matchSynthesisRails('Wann fährt der nächste Bus?');
assert(
  !nextBus.some((h) => h.id === 'fixed_clock_reverse'),
  'nächster Bus ist Live-Abfahrt, kein Leave-by',
);

const policyPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../services/concierge/findusResponsePolicy.ts',
);
const policy = readFileSync(policyPath, 'utf8');
assert(/FINDUS_SYNTHESIS_RAIL_BLOCK/.test(policy), 'Policy export exists');
assert(/keine Pflicht/.test(policy), 'Policy: keine Pflicht');
assert(/Währung der Frage/.test(policy), 'Policy: Währung der Frage');
assert(
  /FINDUS_SYNTHESIS_RAIL_BLOCK,/.test(policy),
  'Geländer sitzt im Core-Appendix (Call-2)',
);

const wxTips = weatherOutfitLookupTips('was anziehen morgen');
assert(/keine Timeline/i.test(wxTips), 'Wetter-Tipps öffnen keine Timeline');
assert(/geländer/i.test(wxTips), 'Wetter-Tipps sind Geländer');
assert(/himmel|temperatur|kleidung/i.test(wxTips), 'Wetter-Pflichtstruktur');
assert(/aushang/i.test(wxTips), 'Aushang explizit verboten');

console.log('synthesisRails.smoke.test.ts ok');
