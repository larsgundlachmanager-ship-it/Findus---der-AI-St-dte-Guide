#!/usr/bin/env node
/**
 * Force-fill map popup bullets for every spot (no Google).
 * Uses category hooks when facts are thin.
 *
 *   node scripts/cityPack/forceFillMapBullets.mjs --city kiel
 */
import { arg, hasFlag, loadPack, savePack } from './lib.mjs';

const BAD =
  /adresse\s*\(|google maps:|mehr infos und route|offline-directory|offline-katalog|user-frage:|gps-eingang|^\(leer\)$/i;

function shortName(name) {
  return String(name || '')
    .split(/[–—|]/)[0]
    .trim()
    .slice(0, 48);
}

function hooks(spot) {
  const name = String(spot.name || '').trim();
  const cat = String(spot.category || '').toLowerCase();
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase()).join(' ');
  const blob = `${name} ${cat} ${tags}`;
  if (!name) return ['Ort auf der Karte', 'Route starten möglich'];
  const short = shortName(name);
  if (/hotel|pension|hostel/i.test(blob)) return [`${short} — Übernachtung vor Ort`];
  if (/cafe|café|restaurant|bistro|pizza|sushi|burger|imbiss|bar\b|pub\b|kneipe|gastro/i.test(blob)) {
    return [`${short} — Essen & Trinken`, 'Öffnungszeiten und Speisekarte über die Buttons'];
  }
  if (/kirche|dom|kapelle/i.test(blob)) return [`${short} — Kirche`, 'Geschichte und Raum vor Ort'];
  if (/museum|galerie/i.test(blob)) return [`${short} — Museum`, 'Ausstellung und Infos über die Buttons'];
  if (/theater|kino|arena|halle/i.test(blob)) {
    return [`${short} — Veranstaltungsort`, 'Programm über die Buttons'];
  }
  if (/schriftzug|foto|ahoi/i.test(blob)) {
    return ['Fotospot', 'Schönes Motiv — kurz stehen bleiben und schauen'];
  }
  if (/denkmal|ehrenmal|stolper/i.test(blob)) return [`${short} — Gedenken vor Ort`];
  if (/hafen|bootshafen|förde|foerde/i.test(blob)) {
    return [`${short} — Hafen`, 'Wasser, Schiffe und Spaziergang'];
  }
  if (/bahnhof|haltepunkt|haltestelle|hbf/i.test(blob)) {
    return [`${short} — ÖPNV`, 'Live-Abfahrten über den Button'];
  }
  if (/parkplatz|p\+r|parking/i.test(blob)) return [`${short} — Parken`];
  if (/spielplatz/i.test(blob)) return [`${short} — Spielplatz für Kinder`];
  if (/toilette|\bwc\b/i.test(blob)) return ['Öffentliche Toilette in der Nähe'];
  if (/tankstelle|fuel/i.test(blob)) return [`${short} — Tankstelle`, 'Tanken und Shop'];
  if (/sport|tennis|kletter|schwimm/i.test(blob)) {
    return [`${short} — Sport & Freizeit`, 'Aktivität vor Ort'];
  }
  if (/supermarket|supermarkt|drogerie|apotheke|einkauf/i.test(blob)) {
    return [`${short} — Einkaufen`, 'Alltag in der Nähe'];
  }
  if (/park\b|garten|natur|wanderung/i.test(blob)) {
    return [`${short} — Grün & Freizeit`, 'Zum Spazieren und Durchatmen'];
  }
  return [short, 'Route starten oder mehr über die Buttons'];
}

function needsFill(bullets) {
  if (!Array.isArray(bullets) || bullets.length === 0) return true;
  const hasGood = bullets.some(
    (b) =>
      b &&
      String(b).trim().length >= 8 &&
      !BAD.test(String(b)) &&
      !/^adresse/i.test(String(b)),
  );
  if (!hasGood) return true;
  if (bullets.some((b) => BAD.test(String(b || '')) || /^adresse/i.test(String(b || '')))) {
    return true;
  }
  return false;
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/forceFillMapBullets.mjs --city <id>');
    process.exit(1);
  }
  const dry = hasFlag('dry');
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`pack missing ${cityId}`);
  let changed = 0;
  for (const spot of pack.spots || []) {
    if (!needsFill(spot.bullets)) continue;
    const next = hooks(spot);
    spot.bullets = next;
    changed += 1;
  }
  console.log(`[force-bullets] ${cityId}: filled ${changed}/${(pack.spots || []).length}`);
  if (!dry && changed) {
    pack.updated_at = new Date().toISOString();
    savePack(pack, { bumpVersion: true });
    console.log(`[force-bullets] saved ${cityId} v${pack.data_version}`);
  }
}

main();
