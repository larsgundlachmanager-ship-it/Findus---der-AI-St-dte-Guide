/**
 * Cinema phase / pitch kind — ohne gemini/RN-Import.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/cinemaPitch.smoke.test.ts
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Spiegel der detectCinemaPhase-Logik (SSOT bleibt cinemaShowtimeResearch.ts)
function detectCinemaPhaseLite(text: string): 'orient' | 'showtimes' {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'orient';
  if (
    /\b(wann|um\s+wie\s*viel|uhrzeit(?:en)?|spielzeit(?:en)?|ticket(?:s)?\s+(?:für|zu)|karten\s+für|welche\s+uhr|welche\s+zeiten)\b/iu.test(
      t,
    )
  ) {
    return 'showtimes';
  }
  if (
    /\b(welche\s+filme|was\s+(?:kannst|läuf|läuft|empfehl)|empfehlen|ins\s+kino|kino\s+gehen|kinobesuch|kinoabend|kinoprogramm|was\s+läuft|aktuell(?:es)?\s+programm|programm(?:vorschau)?)\b/iu.test(
      t,
    )
  ) {
    return 'orient';
  }
  if (/\b(kino|cinema|filmtheater)\b/iu.test(t)) return 'orient';
  return 'orient';
}

assert(
  detectCinemaPhaseLite('was läuft aktuell im Kino') === 'orient',
  'was läuft aktuell → orient',
);
assert(
  detectCinemaPhaseLite('welche Filme laufen heute im Kino') === 'orient',
  'welche Filme → orient',
);
assert(
  detectCinemaPhaseLite('Kinoprogramm heute') === 'orient',
  'Kinoprogramm → orient preview',
);
assert(
  detectCinemaPhaseLite('Spider-Man Spielzeiten') === 'showtimes',
  'Spielzeiten → showtimes',
);

const { detectPitchKind } = require('./parentBrief') as {
  detectPitchKind: (t: string) => string;
};
assert(detectPitchKind('was läuft im Kino') === 'cinema', 'kind cinema');

console.log('cinemaPitch.smoke.test.ts ok');
