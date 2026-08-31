/**
 * Run: npx --yes tsx src/services/homeMap/homeMapPlaceBullets.smoke.test.ts
 */

import type { PoiWithFacts } from '../../db/types';
import { buildHomeMapPlaceBullets, categoryLabelForPoi } from './homeMapPlaceBullets';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function poi(name: string, category: string, texts: string[]): PoiWithFacts {
  return {
    id: 1,
    name,
    lat: 53.67,
    lng: 9.76,
    radius_meters: 30,
    category,
    facts: texts.map((fact_text, i) => ({ id: i, poi_id: 1, fact_text })),
  };
}

{
  const bullets = buildHomeMapPlaceBullets(
    poi('Kindergarten Lütte Prisdörper', 'geschichte', [
      '[Kurzfakt] Zentrumsanker an Haupt-/Schulstraße.',
      '[Kurzfakt] Transformationsgeschichte Schule → Kita.',
      '[Erzählung] Hauptstraße Ecke Schulstraße: 1912 als Volksschule gegründet (einst eine Klasse für alle Jahrgänge), 1974 Umbau zum Kindergarten. Aktuell pädagogischer Betrieb.',
      'User-Frage: Woran erkenne ich diesen Ort? Antwort: Am Gebäude Hauptstraße/Schulstraße — ehemalige Volksschule, heute Kindergarten',
      '[Thema:cta] Schau vom Weg aus auf den Hofbaum und den hellen Kita-Bau — und denk daran: Hier stand jahrzehntelang die Dorfschule.',
    ]),
    'geschichte',
  );
  const blob = bullets.join(' | ');
  assert(bullets.length === 2, 'Kita: zwei Stichpunkte');
  assert(!/user-frage|woran erkenne|hauptstraße|schulstraße/i.test(blob), 'Kita: keine Erkennungs-FAQ, keine Straße');
  assert(/schule|kindergarten|kita|1912|1974/i.test(bullets[0]!), 'Kita 1: was der Ort ist');
  assert(/hofbaum|dorfschule|kita-bau/i.test(bullets[1]!), 'Kita 2: warum hin (Hook vor Ort)');
  assert(bullets[0]!.length <= 72 && bullets[1]!.length <= 72, 'Kita: kompakt für 2 UI-Zeilen');
  assert(!/\.\.\.|…/.test(blob), 'Kita: kein Ellipsis-Schnitt im Text');
}

{
  const bullets = buildHomeMapPlaceBullets(
    poi('Eisenbahnbrücke am Hudenbarg', 'aussicht', [
      '[Kurzfakt] In der Unterführung: Wandmalereien mit Prisdorfer Geschichte — das visuelle Highlight vor Ort, oft übersehen.',
      '[Thema:visuell] Woran erkenne ich Eisenbahnbrücke am Hudenbarg? Technisches Denkmal der Infrastruktur: Bahnstrecke von 1844 kombiniert mit modernem Straßentrog von 2019. Kein Besucherzentrum.',
      '[Thema:sehenswuerdigkeiten_architektur_highlights] Technisches Denkmal der Infrastruktur: Bahnstrecke von 1844 kombiniert mit modernem Straßentrog von 2019. Kein Besucherzentrum.',
      '[Erzählung] Die Eisenbahnbrücke am Hudenbarg quert die DB-Strecke von Hamburg-Altona nach Kiel. Unten in der Unterführung lohnen die Wandmalereien mit Prisdorfer Geschichte — das ist der visuelle Aufhänger.',
      '[Thema:wandmalerei] Die Unterführung enthält Wandmalereien mit Prisdorfer Geschichte — lokales Infrastruktur-Kunstprojekt, tagsüber gut zum Anschauen und Fotografieren.',
    ]),
    'aussicht',
  );
  const blob = bullets.join(' | ');
  assert(bullets.length === 2, 'Brücke: zwei Stichpunkte');
  assert(!/user-frage|woran erkenne|technisches denkmal der infrastruktur/i.test(blob), 'Brücke: kein Erkennen, kein Jargon-Label');
  assert(/brücke|strecke|bahn/i.test(bullets[0]!), 'Brücke 1: was es ist');
  assert(/wandmalerei/i.test(bullets[1]!), 'Brücke 2: Hook = Wandmalereien');
  assert(!/,\s*$/.test(bullets[1]!), 'Brücke: kein hängendes Komma');
  assert(bullets.every((b) => b.length <= 72), 'Brücke: kompakt');
}

{
  const bullets = buildHomeMapPlaceBullets(
    poi('Hoyers Gasthof und Hotel', 'restaurant', [
      '[Kurzfakt] Hoyers Gasthof, Hauptstraße 102, Tel. 04101 789907.',
      '[Kurzfakt] Gasthof und Hotel mit mediterraner Küche und Fremdenzimmern zwischen Hamburg und Nordsee.',
      '[Erzählung] Hoyers Gasthof Hauptstraße 102: klassischer Dorfgasthof mit Fremdenzimmern.',
      '[Thema:faq] User-Frage: Kann ich bei Hoyers einfach auf der Bank vorm Haus sitzen? Antwort: Ja, das ist ein beliebter Prisdorfer Moment — Kaffee trinken und an die Geschichte des Ortes denken. Vom Tresen zur Tanzfläche, von der Tanzfläche zum Sportverein: Hoyers hat viel erlebt. Ein ruhiger Stopp lohnt sich.',
      '[Detail] Hoyers Gasthof Hauptstraße 102 — klassischer Dorfgasthof; am 17.09.1947 wurde hier bei einer Tanzveranstaltung der TSV Prisdorf gegründet.',
    ]),
    'restaurant',
  );
  const blob = bullets.join(' | ');
  assert(bullets.length === 2, 'Hoyers: zwei Stichpunkte');
  assert(!/beliebter|kaffee trinken|tel\.|hauptstraße 102/i.test(blob), 'Hoyers: kein FAQ-Plaudern, keine Adresse/Tel');
  assert(/gasthof|hotel|dorfgasthof/i.test(blob), 'Hoyers: Identität');
  assert(/küche|fremdenzimmer|tsv|1947|mediterran/i.test(blob), 'Hoyers: Warum/Hook');
  assert(bullets.every((b) => b.length <= 72), 'Hoyers: kompakt');
}

{
  const empty = buildHomeMapPlaceBullets(null, 'geschichte');
  assert(empty.length === 0, 'ohne Fakten: keine Platzhalter-Stichpunkte');
}

{
  const bullets = buildHomeMapPlaceBullets(
    poi('Kindergarten Lütte Prisdörper', 'geschichte', [
      'Zentrumsanker an Haupt-/Schulstraße.',
      'Transformationsgeschichte Schule → Kita.',
      'Volksschule 1912; Kindergarten ab 1974; Koordinaten ~53.678838, 9.756587.',
    ]),
    'geschichte',
  );
  const blob = bullets.join(' | ');
  assert(bullets.length >= 1, 'Pack-Kurzfakten ergeben mindestens Was');
  assert(!/mit eigener geschichte|zentrumsanker|koordinaten/i.test(blob), 'kein Jargon, kein GPS');
  assert(/schule|kindergarten|kita|1912|1974/i.test(blob), 'Kita: Schule/Kita-Identität');
}

assert(
  categoryLabelForPoi({ name: 'Eisenbahnbrücke am Hudenbarg', category: 'aussicht' }) ===
    'Brücke',
  'Brücke nicht als Aussicht',
);
assert(
  categoryLabelForPoi({ name: 'Kindergarten Lütte Prisdörper', category: 'geschichte' }) ===
    'Kita',
  'Kita nicht als Geschichte',
);

console.log('homeMapPlaceBullets.smoke.test.ts OK');
