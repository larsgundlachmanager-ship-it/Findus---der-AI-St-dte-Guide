#!/usr/bin/env node
/**
 * Bring city packs to Tettnang-like master baseline:
 * - reclassify amenities → directory
 * - attach _city_history from research sidecar when present
 * - seed common offline QA
 * - write Gemini master prompt listing remaining story gaps
 * - quality gate + optional save
 *
 *   node scripts/cityPack/applyMasterBaseline.mjs --cities prisdorf,pinneberg,wangerooge,hechingen --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  STAEDTE_DIR,
  arg,
  hasFlag,
  loadEnvFile,
  loadPack,
  savePack,
  writeJson,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';
import { interestTagsForCategory } from './placeCategoryPolicy.mjs';

loadEnvFile();

const DEFAULT_CITIES = ['prisdorf', 'pinneberg', 'wangerooge', 'hechingen'];

const FALLBACK_HISTORY = {
  prisdorf:
    'Prisdorf liegt im Kreis Pinneberg an der Pinnau/Bilsbek-Niederung und ist eng mit dem Hamburger Speckgürtel und der Bahnlinie Hamburg–Elmshorn verbunden. Die Gemeinde prägen dörfliche Strukturen, Gewerbe am Peiner Hag, Sport-/Vereinsleben und die Nähe zu Pinneberg. Historische Anker sind u. a. Kriegerehrenmal, Bahnbrücke/Hudenbarg und die übergreifende Dorfgeschichte — vertiefende Meisterdaten folgen dem Gemini-Masterbericht.',
  wangerooge:
    'Wangerooge ist die östlichste bewohnte Ostfriesische Insel (Nationalpark Niedersächsisches Wattenmeer). Erreichbar per Fähre und Inselbahn, ohne klassischen Autoverkehr im Inselkern. Prägend: Alter und Neuer Leuchtturm, Westturm, Nationalpark-Haus, Dorfplatz und Strandpromenaden. Geschichte und Natur (Watt, Dünen, Seebad) bilden den Kern der Findus-Story — Gastro/Hotels bleiben Directory/LIVE.',
};

function demoteAmenityStories(pack) {
  let demoted = 0;
  for (const s of pack.spots || []) {
    if (
      (s.tags || []).includes('master_report') ||
      (s.tags || []).includes('must_have') ||
      (s.tags || []).includes('city_welcome') ||
      s.place_tier === 1
    ) {
      continue;
    }
    const blob = `${s.id} ${s.name} ${s.category}`;
    const cat = String(s.category || '').toLowerCase();
    const amenity =
      /restaurant|ristorante|pizzeria|gaststätte|gasthof|bistro|imbiss|strandbar|café|cafe|eiscafé|eiscafe|bäckerei|baeckerei|hotel|pension|strandhotel|apotheke|zahnarzt|praxis|klinik|marktkauf|edeka|rewe|aldi|lidl|penny|parkhaus|parkplatz|p\+r|taxi |golf|tennis|sportgelände|stadion|vereinsheim|kindergarten|schule |feuerwehr|drk |alten.?und.?pflege|supermarket|tankstelle|tourist.?info|wochenmarkt|bäder |baeder /i.test(
        blob,
      ) ||
      [
        'restaurant',
        'cafe',
        'bakerei',
        'bakery',
        'hotel',
        'supermarket',
        'apotheke',
        'gesundheit',
        'sport',
        'golf',
        'service',
        'toilette',
        'spielplatz',
        'transit',
        'bahnhof',
        'tankstelle',
        'tourist_info',
        'einkaufen',
        'markt',
        'freizeit',
        'transport',
        'verwaltung',
      ].includes(cat);

    // Kern-Bahnhöfe / Rathaus / Stadtgeschichte bewusst Story behalten
    const forceKeep =
      /inselbahnhof|bahnhof wangerooge|bahnhof pinneberg|bahnhof prisdorf|bahnhof hechingen|stadtgeschichte|dorfgeschichte|rathaus |die drostei|altes schloss|neues schloss|burg hohenzollern/i.test(
        s.name,
      ) || (s.tags || []).includes('deep_research_merged');

    if (amenity && !forceKeep) {
      if (s.pack_role !== 'directory') demoted += 1;
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []).filter(
            (t) => !/^tier\d$/.test(t) && t !== 'story' && t !== 'interest:kulinarik',
          ),
          'directory',
          'tier4',
          'amenity_skip',
          'offline_lookup',
          'master_baseline',
        ]),
      ];
    } else if (forceKeep && /bahnhof|drostei|stadtgeschichte|dorfgeschichte|rathaus|schloss|hohenzollern/i.test(s.name)) {
      s.pack_role = 'story';
      s.place_tier = Math.min(s.place_tier || 2, 2);
      if (/stadtgeschichte|dorfgeschichte/i.test(s.name)) s.place_tier = 1;
    }
  }
  return demoted;
}

function attachCityHistory(pack, cityId) {
  const researchPath = path.join(STAEDTE_DIR, `${cityId}.research.json`);
  if (fs.existsSync(researchPath)) {
    try {
      const r = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
      if (r.city_history && String(r.city_history).length > 80) {
        pack._city_history = String(r.city_history).slice(0, 1800);
        return 'research';
      }
    } catch {
      /* ignore */
    }
  }
  if (!(pack._city_history && String(pack._city_history).length > 80)) {
    if (FALLBACK_HISTORY[cityId]) {
      pack._city_history = FALLBACK_HISTORY[cityId];
      return 'fallback';
    }
  }
  return pack._city_history ? 'kept' : 'missing';
}

function seedOfflineQa(pack, cityName) {
  const extras = [
    {
      q: `Wo ist der Bahnhof in ${cityName}?`,
      a: 'Im Pack unter Bahnhof/Transit — LIVE Abfahrten und Störungen frisch prüfen.',
      tags: ['transit'],
    },
    {
      q: `Gibt es öffentliche Toiletten in ${cityName}?`,
      a: 'Directory-Einträge und ggf. Nette Toilette / Parkhäuser — LIVE Öffnung prüfen.',
      tags: ['service'],
    },
    {
      q: `Was sind die Must-Sees in ${cityName}?`,
      a: 'Story-Orte Tier 1–2 im Pack (Museen, Denkmäler, Aussichten, Parks) — je nach Interesse.',
      tags: ['orientierung'],
    },
  ];
  pack._offline_qa = pack._offline_qa || [];
  const seen = new Set(pack._offline_qa.map((e) => String(e.q || '').toLowerCase()));
  for (const e of extras) {
    if (seen.has(e.q.toLowerCase())) continue;
    pack._offline_qa.push({ ...e, tags: ['offline_qa', 'master_baseline', ...(e.tags || [])] });
  }
}

function writeGeminiPrompt(pack, cityId) {
  const story = (pack.spots || []).filter((s) => s.pack_role !== 'directory');
  const thin = [];
  for (const s of story) {
    const t = (pack.trigger_points || []).find((x) => x.id === s.id);
    const deep = (t?.deep_data_pool || []).length;
    const gi = (t?.general_info || '').length;
    if (deep < 5 || gi < 120) thin.push({ id: s.id, name: s.name, deep, gi });
  }
  thin.sort((a, b) => a.deep - b.deep || a.gi - b.gi);

  const list = story
    .slice(0, 40)
    .map((s, i) => `${i + 1}. ${s.name} (${s.category || '?'}, tier ${s.place_tier ?? '?'})`)
    .join('\n');

  const thinList = thin
    .slice(0, 25)
    .map((s) => `- ${s.name} [${s.id}] deep=${s.deep} gi=${s.gi}`)
    .join('\n');

  const md = `# Gemini Deep Research — ${pack.name || cityId} (Master-Standard)

Paste den Block unten in Gemini Deep Research. Nur belegte Fakten. Ephemeres mit \`LIVE:\` markieren.
Keine ortsspezifischen Vorlese-Skripte — Struktur/Fakten für Findus-Pack.

---

\`\`\`
Master-Datenprofil und Historisch-Geografischer Strukturbericht: ${pack.name || cityId}

1) Übergreifende Stadtgeschichte und geografisch-wirtschaftliches Profil
- Ersterwähnung, Herrschaft, Stadtrechte, Brüche, heutige Identität
- 1 kurzer Absatz Agrar/Industrie/Tourismus je nach Stadt

2) Soziokulturelle Verankerung (Vereine, Märkte, Brauchtum) — nur belegte Highlights

3) Systematische Findus-Ortsdaten (kaskadierende Architektur)
Für JEDEN der folgenden Story-Orte (Priorität: zuerst dünne):
SPOT_NAME, ADRESSE, KOORDINATEN, ORTSTYP
HISTORISCHE FAKTEN, LIVE-INFOS (nur Hinweise), KASKADIERENDE TRIGGER (100/50/20/5m wo sinnvoll)
5 FAQ inkl. „Woran erkenne ich diesen Ort?“ + 1 Querverbindung

Story-Orte im aktuellen Pack:
${list}

Besonders dünn (unbedingt vertiefen):
${thinList || '(keine)'}

4) Systematisches Daten-Audit (Findus-Kontrollfragen)
Toiletten, Trinkwasser/Refill, historische Hauptgebäude, Sakralbauten (Katalog vs. Story),
Top-Museen, Denkmäler, Parks/Zoo, Wochenmarkt, Ufer/Promenade falls vorhanden.
\`\`\`
`;

  const out = path.join(STAEDTE_DIR, `${cityId}.gemini-master.md`);
  fs.writeFileSync(out, md, 'utf8');
  return { out, story: story.length, thin: thin.length };
}

function refreshIndex(pack) {
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse).',
  };
}

function processCity(cityId, apply) {
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`missing pack ${cityId}`);

  const demoted = demoteAmenityStories(pack);
  const hist = attachCityHistory(pack, cityId);
  seedOfflineQa(pack, pack.name || cityId);

  // Ensure interest tags on remaining stories
  for (const s of pack.spots || []) {
    if (s.pack_role === 'directory') continue;
    s.tags = [
      ...new Set([
        ...(s.tags || []),
        ...interestTagsForCategory(s.category),
        `tier${s.place_tier || 2}`,
        'story',
      ]),
    ];
  }

  refreshIndex(pack);
  const prompt = writeGeminiPrompt(pack, cityId);
  const gate = runQualityGate(pack, { strict: false });

  if (apply) {
    savePack(pack, { bumpVersion: true });
  }

  writeJson(path.join(STAEDTE_DIR, `${cityId}.master_baseline_report.json`), {
    city_id: cityId,
    demoted,
    history_source: hist,
    pack_index: pack._pack_index,
    gemini_prompt: prompt.out,
    thin_story: prompt.thin,
    gate: { ok: gate.ok, errors: gate.errors.length, warnings: gate.warnings.length },
    applied: apply,
  });

  console.log(
    `[baseline] ${cityId} demoted=${demoted} story=${pack._pack_index.story} dir=${pack._pack_index.directory} hist=${hist} thin=${prompt.thin} ok=${gate.ok} apply=${apply}`,
  );
  return pack;
}

function main() {
  const raw = arg('cities') || DEFAULT_CITIES.join(',');
  const cities = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const apply = hasFlag('apply');
  for (const id of cities) processCity(id, apply);
  if (!apply) console.log('[baseline] dry-run — add --apply to write packs');
}

main();
