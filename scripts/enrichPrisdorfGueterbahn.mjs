#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/prisdorf.json');
const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));

const spot = pack.spots.find((s) => s.id === 'prisdorf_bahnhof_wartehäuschen');
const sub = spot.sub_pois.find(
  (s) => s.id === 'prisdorf_bahnhof_gueterbahnsteig_sub',
);

sub.name = 'Alter Güterbahnsteig / abgetrenntes Gleis';
sub.fact_details = [
  'Geschichte: Hier lag der Güterbereich des alten Bahnhofs Prisdorf. Solange Weichen und Anschlussgleise existierten, war Prisdorf ein echter Bahnhof — nicht nur ein Haltepunkt. Heute liegt oft noch ein abgetrenntes Gleis, das nicht mehr an die Hauptgleise angeschlossen ist.',
  'Heute: Personen halten RB61/RB71 am Bahnsteig; Güterverkehr und Rangieren gehören der Vergangenheit. Eisenbahner sagen deshalb: ohne Weichen ist Prisdorf formal ein Haltepunkt.',
  'Zukunft: Das tote Gleis bleibt stummes Relikt. Ob man es entfernt oder als Spur der Industriekultur sichtbar lässt, entscheiden Bahn und Gemeinde.',
  'Schätzfrage: Warum nennen Fachleute Prisdorf oft Haltepunkt statt Bahnhof? (Antwort: Weil keine Weichen mehr da sind — das Güter-/Anschlussgleis ist abgetrennt.)',
  'Aufforderung: Geh vorsichtig Richtung Gleisende (ohne das Gleisfeld zu betreten), such die abgetrennte Spur und vergleich sie mit dem befahrenen Hauptgleis — so siehst du, was vom Güterbahnhof übrig blieb.',
].join(' ');

sub.tags = Array.from(
  new Set([
    ...(sub.tags || []),
    'geschichte',
    'heute',
    'zukunft',
    'quiz',
    'cta',
    'gueterbahn',
    'historical_core',
  ]),
);

const tp = pack.trigger_points.find((t) => t.id === spot.id);
const extras = [
  {
    text: 'Geschichte Güterbahnhof: Am Prisdorfer Bahnhof gab es früher Anschluss- und Gütergleise. Das Empfangsgebäude wurde schon vor Jahrzehnten abgerissen; übrig blieben das Wartehäuschen von 1911 und Spuren des Güterbereichs.',
    tags: ['geschichte', 'gueterbahn', 'transport', 'historical_core'],
  },
  {
    text: 'Heute Güterbereich: Ein abgetrenntes Gleis ohne Anschluss an die Hauptgleise erinnert daran, dass hier einst rangiert und Güter umgeschlagen wurden. Personenverkehr läuft nur noch über den Haltepunkt.',
    tags: ['heute', 'gueterbahn', 'transport'],
  },
  {
    text: 'Zukunft Gütergleis: Ob das tote Gleis bleibt oder verschwindet, ist Bahn-Sache. Als Lernort für die Dorfgeschichte zeigt es den Wandel vom Bahnhof zum reinen Personenhalt.',
    tags: ['zukunft', 'gueterbahn'],
  },
  {
    text: 'Schätzfrage Güterbahnhof: Was fehlt Prisdorf bahntechnisch, damit es wieder ein Bahnhof im Fachsinn wäre — ein Café, Weichen, oder ein Fahrkartenautomat? (Antwort: Weichen / Anschlussgleise.)',
    tags: ['quiz', 'gueterbahn', 'schaetzfrage'],
  },
  {
    text: 'Aufforderung Gütergleis: Vom Bahnsteig aus peile das abgetrennte Gleis an und sag dir: Hier endete der Güterverkehr — und damit ein Stück Dorfwirtschaft an der Schiene.',
    tags: ['cta', 'gueterbahn', 'aufforderung'],
  },
];

tp.deep_data_pool = tp.deep_data_pool || [];
for (const e of extras) {
  const key = e.text.toLowerCase();
  if (
    !tp.deep_data_pool.some(
      (x) => String(x.text || '').toLowerCase() === key,
    )
  ) {
    tp.deep_data_pool.push(e);
  }
}

if (
  !spot.approach_triggers.some((a) =>
    /Güter|Gueter|gueter|abgetrennt/i.test(a.teaser_text || ''),
  )
) {
  spot.approach_triggers.push({
    id: 'prisdorf_bahnhof_gueter_approach',
    lat: 53.67548,
    lng: 9.75955,
    radius_m: 18,
    teaser_text:
      'Richtung Gleisende: Dort lag der alte Güterbereich. Ein abgetrenntes Gleis verrät, dass Prisdorf früher mehr Bahnhof war als heute.',
    condition_rule: 'always',
  });
}

pack.data_version = 14;
fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

const indexPath = path.join(ROOT, 'data/staedte/index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const pd = (index.available_cities || []).find((c) => c.id === 'prisdorf');
if (pd) pd.data_version = 14;
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

console.log(
  JSON.stringify(
    {
      version: pack.data_version,
      sub: sub.name,
      gueterFacts: tp.deep_data_pool.filter((e) =>
        (e.tags || []).includes('gueterbahn'),
      ).length,
      approaches: spot.approach_triggers.length,
      factPreview: sub.fact_details.slice(0, 160) + '...',
    },
    null,
    2,
  ),
);
