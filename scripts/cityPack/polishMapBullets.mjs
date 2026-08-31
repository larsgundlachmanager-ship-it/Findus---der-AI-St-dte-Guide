#!/usr/bin/env node
/**
 * Map-Popup-Stichpunkte: max. 2 kurze Zeilen — Was ist der Ort? Warum hingehen?
 *
 * Nur aus facts.origin / facts.now / general_info (keine FAQ, kein Skeleton-Müll).
 *
 *   node scripts/cityPack/polishMapBullets.mjs --city prisdorf
 */
import { hasFlag, loadPack, savePack } from './lib.mjs';

const MAX = 72;

const SKIP_RE =
  /zentrumsanker|transformationsgeschichte|offline-katalog|offline-directory|ist ein \w+-punkt in|user-frage:|woran erkenne|beliebter .+ moment|^ja[,!.]?\s|google_maps:|gps-eingang|koordinaten\s*~|sourced_osm|live:\s|tel\.?\s*\d|adresse:|öffnungszeiten club/i;

function looksLikeBareAddress(text) {
  const t = String(text || '').trim();
  if (/^\d+[a-z]?,?\s*\d{5}\b/i.test(t)) return true;
  if (/^[A-ZÄÖÜa-zäöü][\wÄÖÜäöüß.\- ]+\s+\d+[a-zA-Z]?,?\s*\d{5}\b/.test(t)) return true;
  if (/^[\wÄÖÜäöüß.\- ]+,\s*\d{5}\b/.test(t) && t.length < 55) return true;
  return false;
}

/** Hand-gepflegte Dorf-Spots (User-Qualität). */
const OVERRIDES = {
  prisdorf_hoyers_gasthof: [
    'Klassischer Dorfgasthof und Hotel mit Fremdenzimmern',
    'Mediterrane Küche — 1947 wurde hier der TSV Prisdorf gegründet',
  ],
  prisdorf_alte_schule_lütte_prisdörper: [
    '1912 Volksschule, seit 1974 Kindergarten Lütte Prisdörper',
    'Hofbaum und heller Kita-Bau — früher die Dorfschule',
  ],
  prisdorf_eisenbahnbrücke_hudenbarg: [
    'Eisenbahnbrücke über die Strecke Hamburg–Kiel am Hudenbarg',
    'In der Unterführung: Wandmalereien zur Prisdorfer Geschichte',
  ],
  prisdorf_kriegerehrenmal_bilsbek: [
    'Kriegerehrenmal an der Bilsbekbrücke im Ortskern',
    'Gedenkstein mit Namen — ruhiger Ort an der Brücke',
  ],
  prisdorf_bahnhof_wartehäuschen: [
    'Haltepunkt Prisdorf an der Strecke Hamburg–Kiel',
    'Regionalzüge Richtung Hamburg und Elmshorn/Kiel',
  ],
  prisdorf_bahnwartehaeuschen: [
    'Historisches Bahnwartehäuschen am Gleis',
    'Fachwerk-Gebäude — typisches Bild am Haltepunkt',
  ],
  prisdorf_pr_parkplatz_bahnhof: [
    'P+R-Parkplatz direkt am Haltepunkt Prisdorf',
    'Pendlerparken — Auto stehen lassen und Zug nehmen',
  ],
  prisdorf_sparkasse_geldautomat_meyers: [
    'Sparkasse-Geldautomat im Meyers Frischecenter',
    'Peiner Hag — praktischer Stopp beim Einkaufen',
  ],
  prisdorf_marktkauf_meyers_frischecenter: [
    'Marktkauf / Meyers Frischecenter am Peiner Hag',
    'Großer Einkaufsmarkt mit Apotheke und Shops',
  ],
  prisdorf_bilsbek_fluss: [
    'Die Bilsbek fließt durch Prisdorf am Ehrenmal vorbei',
    'Kleiner Bachlauf — Dorfgeschichte am Wasser',
  ],
};

function compact(text) {
  let t = String(text || '')
    .replace(/^➔\s*/u, '')
    .replace(/^heute:\s*/i, '')
    .replace(/\s+zwischen hamburg und nordsee\.?$/i, '')
    .replace(/\s*[—–-]\s*und denk daran:[^.!]*[.!]?/i, '')
    .replace(/\btel\.?\s*[\d\s\/()+-]{6,}/gi, '')
    .replace(/\s*\([^)]*google[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?…;]+$/u, '')
    .trim();
  if (t.length <= MAX) return t;
  const slice = t.slice(0, MAX);
  const at = Math.max(
    slice.lastIndexOf(' — '),
    slice.lastIndexOf('. '),
    slice.lastIndexOf(', '),
  );
  return (at >= 28 ? slice.slice(0, at) : slice.replace(/\s+\S*$/, ''))
    .replace(/[,;:—–-]+$/u, '')
    .trim();
}

function stripLead(text) {
  return String(text || '')
    .replace(
      /^(?:am gebäude\s+)?[\wÄÖÜäöüß.\/\-]+(?:straße|strasse)(?:\s*\/\s*[\wÄÖÜäöüß.\/\-]+(?:straße|strasse))?(?:\s+ecke\s+[\wÄÖÜäöüß.\-]+(?:straße|strasse)?)?\s*[:—–-]\s*/i,
      '',
    )
    .replace(
      /^[\wÄÖÜäöüß.'’\- ]{2,48}?\b[\wÄÖÜäöüß.-]+(?:straße|strasse)\s+\d{1,4}[a-zA-Z]?\s*[:—–,;]\s*/i,
      '',
    )
    .trim();
}

function goodLine(raw) {
  const t = compact(stripLead(raw));
  if (t.length < 18 || t.length > MAX) return null;
  if (SKIP_RE.test(t)) return null;
  if (looksLikeBareAddress(t)) return null;
  if (/^\d{4}\b/.test(t) && t.length < 28) return null;
  if (/[,;]\s*$/.test(t)) return null;
  return t;
}

function categoryHook(spot) {
  const name = String(spot.name || '').trim();
  const cat = String(spot.category || '').toLowerCase();
  if (!name) return null;
  if (/hotel/.test(cat) || /hotel|gasthof|pension/i.test(name)) {
    return compact(`${name.split(/[–—|]/)[0].trim()} — Übernachtung in der Region`);
  }
  if (/restaurant|cafe|café|bakerei|imbiss/i.test(cat) || /café|cafe|bistro|restaurant/i.test(name)) {
    return compact(`${name.split(/[–—|]/)[0].trim()} — Essen & Trinken`);
  }
  if (/denkmal|ehrenmal|stolper/i.test(cat) || /denkmal|ehrenmal|stolper/i.test(name)) {
    return compact(`${name.split(/[–—|]/)[0].trim()} — Gedenken vor Ort`);
  }
  if (/parkplatz|parking/i.test(cat) || /parkplatz|p\+r/i.test(name)) {
    return compact(`${name} — Parken`);
  }
  if (/spielplatz/i.test(cat) || /spielplatz/i.test(name)) {
    return compact(`${name} — Spielplatz für Kinder`);
  }
  if (/toilette/i.test(cat) || /toilette|wc /i.test(name)) {
    return compact('Öffentliche Toilette in der Nähe');
  }
  return null;
}

function pickFromFacts(spot, trigger) {
  const cands = [];
  for (const raw of [
    spot?.facts?.now,
    spot?.facts?.origin,
    trigger?.general_info,
  ]) {
    if (!raw) continue;
    const parts = String(raw)
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      const g = goodLine(p);
      if (g) cands.push(g);
    }
  }
  const uniq = [...new Set(cands)];
  if (uniq.length === 0) return null;
  if (uniq.length === 1) return [uniq[0]];
  // Erst Identität, dann zweite Zeile mit anderem Anfang
  return [uniq[0], uniq.find((u) => u !== uniq[0])].filter(Boolean).slice(0, 2);
}

function isJunkBullets(bullets) {
  if (!Array.isArray(bullets) || bullets.length === 0) return true;
  return bullets.some(
    (b) =>
      SKIP_RE.test(b) ||
      looksLikeBareAddress(b) ||
      String(b).length > 95 ||
      /tel\.?\s*\d/i.test(b) ||
      /[,;]\s*$/.test(b),
  );
}

function main() {
  const dry = hasFlag('dry');
  const cityArg =
    process.argv.find((a) => a.startsWith('--city='))?.slice(7) ||
    process.argv[process.argv.indexOf('--city') + 1];
  if (!cityArg || cityArg.startsWith('--')) {
    throw new Error('Usage: node scripts/cityPack/polishMapBullets.mjs --city <id>');
  }
  const pack = loadPack(cityArg);
  if (!pack) throw new Error(`pack missing: ${cityArg}`);
  const triggers = new Map((pack.trigger_points || []).map((t) => [t.id, t]));

  let changed = 0;
  for (const spot of pack.spots || []) {
    let next = OVERRIDES[spot.id] || null;
    if (!next && isJunkBullets(spot.bullets)) {
      next = pickFromFacts(spot, triggers.get(spot.id));
      if (!next || next.length === 0) {
        const hook = categoryHook(spot);
        next = hook ? [hook] : [];
      }
    }
    if (!next) continue;
    // Leere Liste = lieber Builder aus Fakten als Adress-Müll
    const prev = JSON.stringify(spot.bullets || []);
    const neu = JSON.stringify(next);
    if (prev === neu) continue;
    spot.bullets = next;
    changed += 1;
    console.log(`POLISH ${spot.id}\n  → ${next.join(' | ') || '(leer)'}`);
  }

  console.log(`Changed ${changed} spots`);
  if (!dry) {
    pack.updated_at = new Date().toISOString();
    savePack(pack);
    console.log(`Saved data/staedte/${cityArg}.json`);
  } else {
    console.log('Dry-run — not written');
  }
}

main();
