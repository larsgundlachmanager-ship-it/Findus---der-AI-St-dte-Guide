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
    /\b(welche\s+filme|was\s+läuft|was\s+laeuft|kinoprogramm|filme\s+(?:laufen|gibt)|aktuell(?:es)?\s+programm|programm(?:vorschau)?)\b/iu.test(
      t,
    )
  ) {
    return 'showtimes';
  }
  if (
    /\b(was\s+(?:kannst|läuf|läuft|empfehl)|empfehlen|ins\s+kino|kino\s+gehen|kinobesuch|kinoabend)\b/iu.test(
      t,
    )
  ) {
    return 'orient';
  }
  if (/\b(kino|cinema|filmtheater)\b/iu.test(t)) return 'orient';
  return 'orient';
}

assert(
  detectCinemaPhaseLite('was läuft aktuell im Kino') === 'showtimes',
  'was läuft aktuell → showtimes',
);
assert(
  detectCinemaPhaseLite('Welche Filme laufen aktuell?') === 'showtimes',
  'welche Filme aktuell → showtimes',
);
assert(
  detectCinemaPhaseLite('welche Filme laufen heute im Kino') === 'showtimes',
  'welche Filme heute → showtimes',
);
assert(
  detectCinemaPhaseLite('Welche Filme laufen dann morgen?') === 'showtimes',
  'welche Filme morgen → showtimes',
);
assert(
  detectCinemaPhaseLite('Kinoprogramm heute') === 'showtimes',
  'Kinoprogramm heute → showtimes',
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
