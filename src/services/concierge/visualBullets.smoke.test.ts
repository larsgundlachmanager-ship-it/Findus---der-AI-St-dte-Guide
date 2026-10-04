/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/visualBullets.smoke.test.ts
 */
import {
  looksLikeProseBullet,
  clampVisualBullets,
  estimateBulletMaxChars,
  isProgramBulletCard,
  MAX_PROGRAM_LIST_BULLETS,
  rewriteBulletToFit,
  stripLeadingEllipsisSnippet,
} from './visualBullets';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const speech =
    'Fairway Hotel mit Pool und Sauna, 1,3 km, live ab 189 Euro. Die Kaffeerei Rösterei liegt 1,7 km.';
  const b = clampVisualBullets(
    [
      'Fairway Hotel Peiner Hof: 1,3 km',
      'Die Kaffeerei Rösterei: 1,7 km',
      'Fairway Hotel Peiner Hof: 4.6 Sterne bei 226 Bewertungen',
      'Pool und Sauna',
      '189 € live',
    ],
    { speechText: speech, surface: 'pitch' },
  );
  assert(
    !b.some((x) => /sterne|bewertung/i.test(x)),
    `keine Sterne: ${b.join(' | ')}`,
  );
  const distHits = b.filter((x) => /\d+[.,]?\d*\s*km\b/i.test(x));
  assert(distHits.length <= 1, `max 1× km, got ${distHits.join(' | ')}`);
  assert(
    b.some((x) => /pool|sauna|189|€/i.test(x)),
    `Wunsch/Preis vor Distanz: ${b.join(' | ')}`,
  );
}

{
  const b = clampVisualBullets(
    ['1,3 km', 'Hotel: 1,3 km', 'Pool'],
    {
      speechText: 'Das Hotel mit Pool liegt 1,3 km entfernt.',
    },
  );
  assert(
    b.filter((x) => /1[,.]3\s*km/i.test(x)).length <= 1,
    `km dedupe: ${b.join(' | ')}`,
  );
  assert(b.some((x) => /pool/i.test(x)), 'Pool bleibt');
}

{
  // Budget muss eng genug sein, dass 2 UI-Zeilen nicht ellipsieren
  const max = estimateBulletMaxChars({
    widthPx: 320,
    fontSize: 14,
    lines: 2,
    bulletPrefixPx: 22,
  });
  assert(max <= 70, `konservatives Budget, got ${max}`);
  const long =
    'Ein sehr langer Stichpunkt mit vielen Worten der sonst in der UI mit Punkten abgeschnitten würde';
  const fitted = rewriteBulletToFit(long, max);
  assert(fitted.length <= max, `fit ≤ budget: ${fitted.length} > ${max}`);
  assert(!/\.\.\.|…$/.test(fitted), 'kein Ellipsis-Suffix');
}

{
  assert(isProgramBulletCard('Programm — Burgkino'), 'Programm-Titel erkannt');
  assert(!isProgramBulletCard('Spickzettel'), 'normale Karte');
  const prog = clampVisualBullets(
    [
      'Film A: heute 18:00',
      'Film B: heute 20:15',
      'Film C: heute 21:00',
      'Film D: morgen 17:00',
      'Film E: morgen 19:30',
      'Film F: morgen 21:00',
      'Film G: So 16:00',
      'Film H: extra',
    ],
    {
      surface: 'program',
      speechText:
        'Film A heute 18:00 Film B 20:15 Film C 21:00 Film D morgen 17:00 Film E 19:30 Film F 21:00 Film G So 16:00',
    },
  );
  assert(
    prog.length <= MAX_PROGRAM_LIST_BULLETS,
    `Programm max ${MAX_PROGRAM_LIST_BULLETS}, got ${prog.length}`,
  );
  assert(prog.length >= 5, `Programm mehrere Einträge: ${prog.length}`);
}

{
  const { glueSplitThousandBullets } = require('./visualBullets') as {
    glueSplitThousandBullets: (b: string[]) => string[];
  };
  const glued = glueSplitThousandBullets([
    'In Pinneberg leben aktuell rund 45',
    '000 Menschen auf einer Fläche',
    'knapp 22 km²',
  ]);
  assert(
    glued.some((x) => /45\.000|45000/.test(x)),
    `Tausender geklebt: ${glued.join(' | ')}`,
  );
  assert(
    !glued.some((x) => /^000\b/.test(x)),
    `kein orphan 000: ${glued.join(' | ')}`,
  );
  const b = clampVisualBullets(glued, {
    speechText:
      'In Pinneberg leben aktuell rund 45.000 Menschen auf einer Fläche von knapp 22 Quadratkilometern.',
  });
  assert(
    b.some((x) => /45\.?000|45000/.test(x)),
    `Einwohner-Stichpunkt ganz: ${b.join(' | ')}`,
  );
  assert(!b.some((x) => /^45$/.test(x.trim())), 'kein nacktes 45');
}

{
  const long =
    'England selbst hat seit dem Jahr 1707 und den Acts of Union keine eigene Monarchin mehr';
  const fitted = rewriteBulletToFit(long, 56);
  assert(!/und den\s*$/i.test(fitted), `kein dangling Tail: ${fitted}`);
  assert(!/\.\.\.|…$/.test(fitted), `kein Ellipsis: ${fitted}`);
  assert(fitted.length <= 56, `fit ≤56: ${fitted}`);
  const b = clampVisualBullets(
    [
      'Charles III.',
      'seit 1707 keine Königin von England',
      'Vereinigtes Königreich',
      long,
    ],
    {
      userText: 'Wer ist die aktuelle Königin von England?',
      speechText:
        'England hat seit 1707 keine eigene Königin mehr — Charles III. ist König des Vereinigten Königreichs.',
    },
  );
  assert(b.length >= 2 && b.length <= 3, `3er Spickzettel: ${b.join(' | ')}`);
  assert(
    b.some((x) => /charles|1707|könig/i.test(x)),
    `Antwort-Fakten: ${b.join(' | ')}`,
  );
  assert(!b.some((x) => /und den\s*$/i.test(x)), 'keine abgebrochenen Bullets');
}

assert(looksLikeProseBullet('Also, in Prisdorf sieht es so aus, dass es morgen regnet und du eine Jacke brauchst.') === true, 'prose rejected');
assert(looksLikeProseBullet('Wechselhaft · bis 17°') === false, 'chip ok');
{
  const b = clampVisualBullets(['Alter 36 Jahre', '36 Jahre', 'Geboren am 13. September 1989'], {
    speechText: 'Thomas Müller ist 36 Jahre alt. Er wurde am 13. September 1989 geboren.',
    userText: 'Wie alt ist Thomas Müller?',
  });
  assert(b.length <= 3, 'max 3');
  assert(b.filter((x) => /36/.test(x)).length <= 1, 'no duplicate age');
}
{
  const b = clampVisualBullets(['Genaue Preise liegen mir gerade nicht vor'], {
    cardTitle: 'Genaue Preise liegen mir gerade nicht vor',
    speechText: 'Genaue Preise liegen mir gerade nicht vor',
  });
  assert(b.length === 0, 'title duplicate dropped');
}

{
  // Call-2 / Gold Struktur-Meta — nie Spickzettel (AYCE-Leak)
  const { isMetaStructureBullet, humanizeBullets } = require('../../module2/speech/draftToHumanSpeech') as {
    isMetaStructureBullet: (t: string) => boolean;
    humanizeBullets: (xs: string[], max?: number) => string[];
  };
  assert(
    isMetaStructureBullet('Unverträglichkeiten vermeiden'),
    'meta: unverträglichkeiten',
  );
  assert(
    isMetaStructureBullet('mehrteilige Antwort'),
    'meta: mehrteilige Antwort',
  );
  assert(
    isMetaStructureBullet('mehrteilige Frage'),
    'meta: mehrteilige Frage',
  );
  assert(!isMetaStructureBullet('All you can eat · 29 €'), 'real fact ok');
  const hum = humanizeBullets(
    [
      'Unverträglichkeiten vermeiden',
      'mehrteilige Antwort',
      'Oyukin · 29 €',
      'needed_slots: price',
    ],
    3,
  );
  assert(
    !hum.some((x) => /unverträglichkeit|mehrteilig|needed_slots/i.test(x)),
    `humanize drops meta: ${hum.join(' | ')}`,
  );
  assert(hum.some((x) => /oyukin|29/i.test(x)), `keeps fact: ${hum.join(' | ')}`);
  const clamped = clampVisualBullets(
    [
      'Unverträglichkeiten vermeiden',
      'mehrteilige Antwort',
      'AYCE ab 29 €',
      'Sushi · Buffet',
    ],
    {
      speechText: 'All you can eat bei Oyukin ab 29 Euro, Sushi-Buffet.',
      surface: 'pitch',
    },
  );
  assert(
    !clamped.some((x) => /unverträglichkeit|mehrteilig/i.test(x)),
    `clamp drops meta: ${clamped.join(' | ')}`,
  );
  assert(
    clamped.some((x) => /29|ayce|sushi|buffet/i.test(x)),
    `clamp keeps dining fact: ${clamped.join(' | ')}`,
  );
}
console.log('visualBullets prose/title/dedupe/meta OK');

{
  const cleaned = stripLeadingEllipsisSnippet('…n, Giant Burger und Hüftsteak. Wir sahsen …');
  assert(!/^(?:\u2026|\.\.\.)/.test(cleaned), 'leading ellipsis gone');
  assert(!/^n,/i.test(cleaned), 'mid-word crumb gone');
  const area = rewriteBulletToFit(
    'Außenalster: rund 1.640.000 Quadratmeter (164 ha)',
    48,
  );
  assert(/ha/i.test(area), `area compact: ${area}`);
  assert(!/\(164\s*$/i.test(area), 'no open paren cut');
  assert(!/…|\.\.\./.test(area), 'no ellipsis on area');
}
{
  // Alster: Label „Fläche“ steht oft nur im Bullet — Zahl in Speech reicht
  const b = clampVisualBullets(['Fläche: 1,6 km²', 'Binnenalster: 18 ha'], {
    userText: 'Wie groß ist die Alster?',
    speechText: 'Die Außenalster hat rund 1,6 km², die Binnenalster etwa 18 Hektar.',
    cardTitle: 'Größe der Alster',
  });
  assert(b.length >= 1, `alster bullets kept: ${b.join(' | ')}`);
  assert(
    b.some((x) => /1[,.]6|km/i.test(x)),
    `alster area fact: ${b.join(' | ')}`,
  );
}
console.log('visualBullets screenshot extras: OK');
console.log('visualBullets.smoke.test.ts ok');
