#!/usr/bin/env node
/**
 * Gap report + Deep-Research prompts for a city pack (Module 1).
 *
 * Usage:
 *   node scripts/cityPack/gapReport.mjs --city wangerooge
 *   node scripts/cityPack/gapReport.mjs --city prisdorf --out data/staedte/prisdorf.gaps.md
 */

import path from 'node:path';
import {
  STAEDTE_DIR,
  arg,
  defaultLiveResearch,
  generalInfoFor,
  isEphemeralCategory,
  loadPack,
  triggerForSpot,
  writeText,
  writeJson,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

function deepLen(pack, spot) {
  return (triggerForSpot(pack, spot)?.deep_data_pool || []).length;
}

function hasPoly(spot) {
  const p = spot.polygonCoordinates || spot.polygon;
  return Array.isArray(p) && p.length >= 3;
}

function buildMarkdown(pack, gate) {
  const city = pack.name || pack.city_id;
  const lines = [];
  lines.push(`# Findus Deep-Research — ${city}`);
  lines.push('');
  lines.push(
    'Modul-1-Pack-Fokus: stabile Orte, Geschichte, Orientierung, GPS-Eingänge, Wegweiser, Offline-Erzählungen, FAQ.',
  );
  lines.push(
    'Nicht ins Pack hardcoden: Preise, Speisekarten-URLs die rotieren, heutige Konzerte, Hotelpreise → `_live_research`.',
  );
  lines.push('');
  lines.push('## Pack-Status');
  lines.push(`- spots: ${gate.stats.spots}`);
  lines.push(`- categories: ${gate.stats.categories.join(', ') || '—'}`);
  lines.push(
    `- missing must-have: ${gate.stats.missingMustHave.join(', ') || 'ok'}`,
  );
  lines.push(`- live_research prompts: ${gate.stats.liveResearch}`);
  lines.push(`- transit: ${gate.stats.hasTransit ? 'yes' : 'no'}`);
  lines.push('');

  if (gate.errors.length) {
    lines.push('## Errors');
    for (const e of gate.errors) lines.push(`- ${e}`);
    lines.push('');
  }
  if (gate.warnings.length) {
    lines.push('## Warnings (Top 40)');
    for (const w of gate.warnings.slice(0, 40)) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('## Google Deep Research — Master Prompt');
  lines.push('');
  lines.push('```');
  lines.push(
    `Erstelle einen evidenzbasierten Ortsbericht für ${city} (Deutschland) für einen Offline-Stadtführer.`,
  );
  lines.push(
    'Nur belegte Fakten mit Quelle. Keine erfundenen Preise/Öffnungszeiten ohne Datum.',
  );
  lines.push('');
  lines.push('Abschnitte:');
  lines.push(
    '1) Stadtgeschichte (Gründung, Name, prägende Ereignisse, heute) — max. ~800 Wörter',
  );
  lines.push(
    '2) Must-See Orte (Module 1): Museen, Denkmäler, Kirchen, Natur/Aussicht, Bahnhof/Hafen, besondere Architektur',
  );
  lines.push(
    '   Pro Ort: Herkunft, Architektur, was man DORT machen kann, visuelle Anker (Fassade/Eingang/Farbe/Form), FAQ (5 typische Fragen)',
  );
  lines.push(
    '   Pflicht-FAQ pro Ort: „Woran erkenne ich diesen Ort?“ (sichtbare Merkmale von der Straße/vom Weg, bevor der Name fällt)',
  );
  lines.push(
    '   Querverbindungen: logische Bezüge zu anderen Orten derselben Stadt (Achsen, Kontraste, gemeinsame Geschichte)',
  );
  lines.push(
    '3) Wege & Orientierung: wichtige Pfade/Promenaden/Trampelpfade, offizielle Ortspläne (URL)',
  );
  lines.push(
    '4) ÖPNV: Bahnhöfe/Haltestellen/Fähren mit Namen (keine Live-Fahrpläne)',
  );
  lines.push(
    '5) Service/Notfall: Arzt, Apotheke, Polizei, Defi — nur stabile Infos',
  );
  lines.push(
    '6) Explizit NICHT: tagesaktuelle Konzertlisten, Hotelpreise, Speisekarten-Preise',
  );
  lines.push('```');
  lines.push('');

  lines.push('## Gezielte Lückenfragen');
  lines.push('');

  const needsStory = gate.gaps.needsNarration || [];
  if (needsStory.length) {
    lines.push(`### Erzählung fehlt (${needsStory.length})`);
    lines.push(
      'Schreibe für jeden Ort eine Offline-Erzählung (80–200 Wörter), atmosphärisch, ohne Adress-Dump:',
    );
    for (const id of needsStory.slice(0, 40)) lines.push(`- ${id}`);
    lines.push('');
  }

  const needsDeep = gate.gaps.needsDeep || [];
  if (needsDeep.length) {
    lines.push(`### Deep/FAQ fehlt (${needsDeep.length})`);
    lines.push(
      'Je Ort ≥4 Deep-Fakten + ≥3 FAQ im Format „User-Frage: … Antwort: …“:',
    );
    for (const id of needsDeep.slice(0, 40)) lines.push(`- ${id}`);
    lines.push('');
  }

  if (gate.gaps.missingCategories?.length) {
    lines.push('### Fehlende Kategorien');
    lines.push(
      `Finde belegte Orte in ${city} für: ${gate.gaps.missingCategories.join(', ')}`,
    );
    lines.push('');
  }

  lines.push('### Coverage-Check (nichts vergessen)');
  lines.push(
    '- Gibt es markante Trampelpfade, Promenaden, Aussichtspunkte, die noch fehlen?',
  );
  lines.push('- Alle Bahnhöfe/Haltestellen/Fähranleger vollständig?');
  lines.push('- Offizieller Ortsplan / Webcam / Tourismus-URL?');
  lines.push(
    '- Typische Touren-Typen (nur Typ + wo buchen, keine heutigen Termine)?',
  );
  lines.push('');

  lines.push('## Live-Research Prompts (App, nicht Pack-Hardcode)');
  const live = pack._live_research?.length
    ? pack._live_research
    : defaultLiveResearch(city);
  for (const p of live) {
    lines.push(`- **${p.topic || p.id}**: ${p.prompt}`);
  }
  lines.push('');

  lines.push('## Spot-Übersicht (Kurz)');
  for (const spot of pack.spots || []) {
    const cat = spot.category || spot.district || '?';
    const info = generalInfoFor(pack, spot).length;
    const deep = deepLen(pack, spot);
    const ap = (spot.approach_triggers || []).length;
    const poly = hasPoly(spot) ? 'poly' : 'nopoly';
    const eph = isEphemeralCategory(cat) ? 'optional' : 'main';
    lines.push(
      `- \`${spot.id}\` [${cat}/${eph}] narr=${info} deep=${deep} approaches=${ap} ${poly}`,
    );
  }
  lines.push('');
  lines.push('---');
  lines.push(
    `Nach dem Report: Datei speichern und \`node scripts/cityPack/mergeDeepResearch.mjs --city ${pack.city_id} --file <report>\` ausführen.`,
  );
  return lines.join('\n');
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/gapReport.mjs --city <id>');
    process.exit(1);
  }
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);

  if (!pack._live_research?.length) {
    pack._live_research = defaultLiveResearch(pack.name || cityId);
  }

  const gate = runQualityGate(pack, { strict: false });
  const md = buildMarkdown(pack, gate);
  const out = arg('out') || path.join(STAEDTE_DIR, `${cityId}.gaps.md`);
  writeText(out, md);
  writeJson(path.join(STAEDTE_DIR, `${cityId}.gaps.json`), {
    city_id: cityId,
    gate,
    generated_at: new Date().toISOString(),
  });
  console.log(`[gaps] ${out}`);
  console.log(
    `[gaps] errors=${gate.errors.length} warnings=${gate.warnings.length} needsNarration=${gate.gaps.needsNarration.length}`,
  );
}

main();
