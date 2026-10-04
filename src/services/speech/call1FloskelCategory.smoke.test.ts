/**
 * Call-1 Floskel: Kategorie muss den Wunsch treffen (nicht „heute Abend“→Events).
 * Run: npx --yes tsx src/services/speech/call1FloskelCategory.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  detectFloskelCategoryPublic,
  pickFloskelForUserText,
  resetFloskelCacheForTests,
} from './floskelEngine';

resetFloskelCacheForTests();

const cases: Array<{ q: string; cat: string; ban?: RegExp; want?: RegExp }> = [
  {
    q: 'Ich möchte heute Abend ins Kino gehen. Welche Filme laufen heute Abend?',
    cat: 'cinema',
    ban: /Veranstaltung|Abendprogramm|Anliegen|nützlichen Fakten/i,
    want: /Kino|Film|Programm/i,
  },
  {
    q: 'Ich brauche nächste Woche Freitag bis Sonntag ein Hotel mit Pool in Amsterdam für unter 200 Euro',
    cat: 'accommodation_search',
    ban: /Prisdorf|Veranstaltung/i,
    want: /Amsterdam|Hotel/i,
  },
  {
    q: 'Mein Freund hat sich den Fuß gebrochen. Wo können wir hin?',
    cat: 'safety',
    ban: /Veranstaltung|Abendprogramm|Anliegen/i,
    want: /übel|Hilfe|Not|priorisier|Ort/i,
  },
  {
    q: 'Ich habe akute Zahnschmerzen. Wo kann ich jetzt hingehen?',
    cat: 'safety',
    ban: /Veranstaltung|Stay-Option/i,
  },
  {
    q: 'Wie komme ich am schnellsten mit öffentlichen Verkehrsmitteln zum Hamburger Hauptbahnhof?',
    cat: 'transit',
    ban: /Veranstaltung|Anliegen/i,
    want: /Verbindung|Hamburger Hauptbahnhof|ÖPNV|Zug|Bus/i,
  },
  {
    q: 'Bring mich so schnell es geht zum Hamburger Hauptbahnhof',
    cat: 'nav',
    ban: /Veranstaltung|nützlichen Fakten/i,
    want: /navigier|Route|Hamburger Hauptbahnhof|hin/i,
  },
  {
    q: 'Ich habe heute Abend richtig Lust auf so ein Angus-Steak. Wo kann ich da am besten hingehen?',
    cat: 'dining',
    ban: /Veranstaltung|Abendprogramm/i,
    want: /Essen|Restaurant|pass/i,
  },
  {
    q: 'Ich bin Vegetarier. Wo essen wir gut heute Abend?',
    cat: 'food_allergy',
    ban: /Veranstaltung|Abendprogramm|Event/i,
    want: /vegetar|Ernährung|passend|Küche|Gerichte|filter/i,
  },
];

for (const c of cases) {
  const got = detectFloskelCategoryPublic(c.q);
  assert.equal(got, c.cat, `${c.q.slice(0, 40)}… → ${got} (want ${c.cat})`);
  resetFloskelCacheForTests();
  const pick = pickFloskelForUserText(c.q);
  assert.equal(pick.category, c.cat, `pick cat ${c.cat}`);
  if (c.ban) {
    assert.ok(!c.ban.test(pick.phrase), `ban in phrase: ${pick.phrase}`);
  }
  if (c.want) {
    assert.ok(c.want.test(pick.phrase), `want in phrase: ${pick.phrase}`);
  }
}

console.log('call1FloskelCategory.smoke: ok');
