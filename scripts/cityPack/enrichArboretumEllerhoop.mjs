#!/usr/bin/env node
/**
 * Arboretum Ellerhoop — leere Directory-Stubs mit echten Fakten füllen.
 * Quellen: Wikipedia Arboretum Ellerhoop-Thiensen + arboretum-ellerhoop.de
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAEDTE = path.join(ROOT, 'data', 'staedte');

const GENERAL = `Norddeutsche Gartenschau – Arboretum Ellerhoop in Thiensen (Gemeinde Ellerhoop), am Rand der Bilsbek-Niederung in der Knicklandschaft. Rund 17,5 Hektar Gesamtanlage, davon etwa 8 Hektar öffentlich als Park, Schul- und Volksbildungsort. 1956 legte Baumschul-Inhaber Erich Frahm mit Dendrologe Gerd Krüssmann ein 3,5-Hektar-Arboretum an; 1980 kaufte der Kreis Pinneberg das Gelände und erweiterte es. Seit 1996 trägt der Förderkreis die Betriebsträgerschaft; 2009 Umbenennung zur Norddeutschen Gartenschau. Highlights: größte Strauch-Pfingstrosen-Sammlung Deutschlands, Bauerngarten am Münsterhof, Lotosblüte am See, Chinesischer Garten, Bernsteingarten, Blauregentunnel. LIVE: Eintritt und Öffnungszeiten aktuell prüfen — arboretum-ellerhoop.de.`;

const DEEP = [
  {
    text: '1956: Erich Frahm (Baumschule Timm & Co.) gründet mit Dendrologe Gerd Krüssmann das Arboretum auf zunächst 3,5 Hektar am historischen Münsterhof (seit 1943 Baumschulstandort).',
    tags: ['geschichte', 'origin'],
  },
  {
    text: '1980 erwirbt der Kreis Pinneberg das Arboretum plus Erweiterungsfläche; Konzept mit Bund deutscher Baumschulen, Botanischem Garten Hamburg und Planung von Hans-Dieter Warda — Ausbau auf rund 17 Hektar.',
    tags: ['geschichte'],
  },
  {
    text: '1989 Förderkreis Arboretum Baumpark Ellerhoop-Thiensen e. V.; ab 1996 Betriebsträgerschaft. 2009 Umbenennung in „Norddeutsche Gartenschau – Arboretum Ellerhoop“.',
    tags: ['geschichte', 'now'],
  },
  {
    text: 'Heute: permanente Gartenschau mit Themengärten — Bauerngarten, Weißer/Roter/Chinesischer Garten, Garten des Südens, Heidegarten, Rosengarten, Duft- und Tastgarten, Bernsteingarten (seit 2008), Kamelienhaus.',
    tags: ['now', 'natur'],
  },
  {
    text: 'Besonderheit: größte Sammlung von Strauch-Pfingstrosen in Deutschland (Wildarten und weit über 200 Sorten); Schwerpunkte auch Prunus, Malus, Hortensien, Bambus und Herbstfärber.',
    tags: ['highlight', 'natur'],
  },
  {
    text: 'Im Sommer Lotosblüte am Parksee; im Frühling Blauregentunnel (Glyzinien-Allee). Schulbiologie mit Erlebnispfaden, Saurier-Modell und Sumpfzypressenwald.',
    tags: ['highlight', 'fun'],
  },
  {
    text: 'Weit über 100.000 Besucher im Jahr. Website: https://www.arboretum-ellerhoop.de/',
    tags: ['cta', 'website'],
  },
  {
    text: 'LIVE: Öffnungszeiten und Eintrittspreise aktuell auf der Arboretum-Website prüfen — nichts aus dem Pack als Tagespreis vorlesen.',
    tags: ['live_hint', 'ephemeral'],
  },
  {
    text: 'User-Frage: Was ist das Arboretum Ellerhoop? Antwort: Die Norddeutsche Gartenschau — ein großer Baum- und Themengartenpark in Ellerhoop-Thiensen mit Arboretum-Geschichte seit 1956 und öffentlichem Park auf mehreren Hektar.',
    tags: ['faq', 'user_question'],
  },
  {
    text: 'User-Frage: Woran erkenne ich den Ort? Antwort: Große Parkschilder „Arboretum / Norddeutsche Gartenschau“, Eingangsbereich Thiensen, Knicks und Themengärten statt reiner Wald.',
    tags: ['faq', 'user_question'],
  },
  {
    text: 'User-Frage: Was macht den Park besonders? Antwort: Die größte Strauch-Pfingstrosen-Sammlung Deutschlands, Lotos am See, Chinesischer Garten, Blauregentunnel und der Bauerngarten am Münsterhof.',
    tags: ['faq', 'user_question'],
  },
];

const BULLETS = [
  'Seit 1956 Baumpark / Arboretum',
  'Norddeutsche Gartenschau · ~17 ha',
  'Größte Strauch-Pfingstrosen-Sammlung DE',
];

const FACTS = {
  origin:
    '1956 Arboretum durch Erich Frahm und Dendrologe Gerd Krüssmann (3,5 ha) am Münsterhof; 1980 Kauf durch Kreis Pinneberg und Erweiterung.',
  now: 'Norddeutsche Gartenschau – Arboretum Ellerhoop: permanente Gartenschau mit Themengärten, Schulbiologie und Naherholung. LIVE Eintritt/Zeiten prüfen.',
  architecture:
    'Eingebettet in Knicklandschaft an der Bilsbek-Niederung; historischer Münsterhof mit Bauerngarten, See mit Lotos, Chinesischer Garten mit Mondtor.',
  tags: ['natur', 'garten', 'geschichte', 'touristic'],
};

function enrichSpot(spot) {
  spot.name = spot.name || 'Arboretum Ellerhoop';
  spot.category = 'natur';
  spot.pack_role = 'story';
  spot.place_tier = 1;
  spot.relevance = [
    'natur',
    'interest:natur',
    'garten',
    'geschichte',
    'touristic',
    'must_have',
  ];
  spot.tags = [
    'natur',
    'garten',
    'interest:natur',
    'geschichte',
    'touristic',
    'tier1',
    'story',
    'classified',
    'module1',
    'must_have',
  ];
  spot.bullets = [...BULLETS];
  spot.facts = { ...FACTS };
  if (!spot.approach_triggers?.length) {
    spot.approach_triggers = [
      {
        id: `${spot.id}_a1`,
        lat: spot.lat ?? 53.716673,
        lng: spot.lng ?? 9.7765213,
        radius_m: 80,
        teaser_text:
          'Gleich der große Gartenpark — Arboretum, Themengärten, richtig was zu entdecken.',
        condition_rule: 'always',
      },
    ];
  } else {
    for (const a of spot.approach_triggers) {
      a.teaser_text =
        a.teaser_text?.includes('liegt voraus') && a.teaser_text.length < 40
          ? 'Gleich der große Gartenpark — Arboretum, Themengärten, richtig was zu entdecken.'
          : a.teaser_text;
      if ((a.radius_m ?? 0) < 50) a.radius_m = 80;
    }
  }
  return spot;
}

function enrichTrigger(tp) {
  tp.name = tp.name || 'Arboretum Ellerhoop';
  tp.general_info = GENERAL;
  tp.deep_data_pool = DEEP.map((d) => ({ ...d, tags: [...d.tags] }));
  if ((tp.radius_m ?? 0) < 40) tp.radius_m = 55;
  return tp;
}

function patchCity(cityId, spotId) {
  const file = path.join(STAEDTE, `${cityId}.json`);
  if (!fs.existsSync(file)) {
    console.warn('[skip]', cityId, 'missing');
    return;
  }
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const s of pack.spots ?? []) {
    if (s.id === spotId || /arboretum.?ellerhoop/i.test(s.id || '')) {
      if (/parkplatz/i.test(s.name || '')) continue;
      enrichSpot(s);
      n += 1;
    }
  }
  for (const t of pack.trigger_points ?? []) {
    if (t.id === spotId || /arboretum.?ellerhoop/i.test(t.id || '')) {
      if (/parkplatz|weisser|weißer|garten_des|chinesischer/i.test(t.id || '')) {
        // Sub-Gärten: wenigstens general_info anreichern, wenn leer
        if (/denkmal-Punkt|Offline-Lookup|Orientierung und Offline/i.test(t.general_info || '')) {
          t.general_info = `${t.name}: Teil der Norddeutschen Gartenschau / Arboretum Ellerhoop. ${GENERAL.slice(0, 280)}`;
          if (!Array.isArray(t.deep_data_pool) || t.deep_data_pool.length < 3) {
            t.deep_data_pool = DEEP.slice(0, 6).map((d) => ({
              ...d,
              tags: [...d.tags],
            }));
          }
          n += 1;
        }
        continue;
      }
      enrichTrigger(t);
      n += 1;
    }
  }
  pack.updated_at = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  console.log(`[ok] ${cityId}: patched ${n} entries`);
}

patchCity('prisdorf', 'prisdorf_arboretum_ellerhoop');
patchCity('pinneberg', 'pinneberg_arboretum_ellerhoop');
patchCity('tornesch', 'tornesch_garten_des_sudens_arboretum_ellerhoop');
