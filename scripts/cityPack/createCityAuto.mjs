#!/usr/bin/env node
/**
 * One-command city pack bootstrap (mechanical pipeline).
 *
 *   npm run city:auto -- --city "Laboe" --id laboe
 *   npm run city:auto -- --city Wangerooge --upload
 *
 * Steps:
 *   skeleton → directory → classify → live-hints → wiki-enrich
 *   → baseline polish → entrances → cover → gate → agent-brief.md
 *
 * Wangerooge-level depth still needs Agent web-research on T1 after this
 * (see .cursor/rules/findus-city-auto.mdc).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  arg,
  hasFlag,
  loadEnvFile,
  loadPack,
  savePack,
  slugify,
  distM,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';
import { findPending, pendingBriefSection } from './pendingCovers.mjs';

loadEnvFile();

function run(scriptRel, args, label) {
  const script = path.join(ROOT, 'scripts', 'cityPack', scriptRel);
  console.log(`\n[auto] ▶ ${label}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status})`);
  }
}

function polishPack(pack) {
  const center = { lat: pack.lat, lng: pack.lng };
  const DIR_RE =
    /haltestelle|bus.?halt|ladestation|stranddusche|restaurant|camping|hotel|pension|apotheke|arzt|praxis|drk|feuerwehr|tankstelle|supermarkt|aldi|edeka|rewe|lidl|penny|spielhalle|kiosk|yachtcharter|e_bike|strohfigur|steffis/i;
  const FAR_M = 5500;
  let demoted = 0;
  let promoted = 0;

  for (const s of pack.spots || []) {
    const t = (pack.trigger_points || []).find((x) => x.id === s.id);
    const d =
      t?.lat != null && center.lat != null
        ? distM(center, { lat: t.lat, lng: t.lng })
        : 0;
    const amenity =
      DIR_RE.test(s.id || '') ||
      DIR_RE.test(s.name || '') ||
      ['restaurant', 'cafe', 'hotel', 'supermarket', 'toilette', 'tankstelle', 'gesundheit'].includes(
        String(s.category || '').toLowerCase(),
      );

    const landmark =
      /museum|denkmal|ehrenmal|kirche|schloss|burg|hafen|strand|promenade|leuchtturm|kurpark|rathaus|theater|mühle|muehle|naturschutz|aussicht|turm/i.test(
        `${s.id} ${s.name} ${s.category}`,
      );

    if (amenity && !landmark) {
      if (s.pack_role !== 'directory') demoted += 1;
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []).filter((x) => !['story', 'tier1', 'tier2', 'must_have'].includes(x)),
          'directory',
          'tier4',
          'auto_polish',
        ]),
      ];
      continue;
    }

    if (d > FAR_M && !landmark) {
      if (s.pack_role !== 'directory') demoted += 1;
      s.pack_role = 'directory';
      s.place_tier = 4;
      continue;
    }

    if (landmark && s.pack_role !== 'directory') {
      const wantTier = /ehrenmal|museum|hauptstrand|leuchtturm|rathaus|schloss/i.test(
        `${s.id} ${s.name}`,
      )
        ? 1
        : Math.min(s.place_tier || 2, 2);
      if ((s.place_tier || 9) > wantTier) promoted += 1;
      s.place_tier = wantTier;
      s.pack_role = 'story';
      s.tags = [...new Set([...(s.tags || []), 'story', `tier${wantTier}`, 'auto_polish'])];
    }
  }

  const cityName = pack.name || pack.city_id;
  pack._offline_qa = pack._offline_qa || [];
  const extras = [
    {
      q: `Anreise ${cityName}?`,
      a: `ÖPNV und ggf. Fähre/Regionalbus im Pack und LIVE-Fahrplänen prüfen. Nächster Fernbahnhof oft in der Region — Umstieg und Takte tagesaktuell.`,
      tags: ['transport'],
    },
    {
      q: `Öffentliche Toiletten ${cityName}?`,
      a: `Directory-Einträge und Tourist-Info / Hafen / Strandbereiche — LIVE Öffnung und Gebühren vor Ort.`,
      tags: ['komfort', 'toilette'],
    },
    {
      q: `Must-Sees ${cityName}?`,
      a: `Story-Orte Tier 1–2 (Museen, Denkmäler, Aussichten, Strände/Parks) — je nach Interesse und Zeit.`,
      tags: ['orientierung'],
    },
    {
      q: `Fahrrad / Leihrad ${cityName}?`,
      a: `Lokale Verleiher oder regionale Sharing-Systeme falls vorhanden — LIVE Tarife und Stationen in der App prüfen.`,
      tags: ['transport', 'fahrrad'],
    },
  ];
  const seen = new Set(pack._offline_qa.map((e) => String(e.q || '').toLowerCase()));
  for (const e of extras) {
    if (seen.has(e.q.toLowerCase())) continue;
    pack._offline_qa.push({ ...e, tags: [...(e.tags || []), 'offline_qa', 'city_auto'] });
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse).',
  };
  return { demoted, promoted };
}

function writeAgentBrief(pack, cityId) {
  const stories = (pack.spots || [])
    .filter((s) => s.pack_role !== 'directory')
    .sort((a, b) => (a.place_tier ?? 9) - (b.place_tier ?? 9));
  const thin = stories.filter((s) => {
    const t = (pack.trigger_points || []).find((x) => x.id === s.id);
    return (t?.deep_data_pool || []).length < 6 || (t?.general_info || '').length < 100;
  });
  const md = `# Agent Deep Research — ${pack.name || cityId}

Pipeline \`city:auto\` fertig. Für **Wangerooge-Qualität** (tiefe Stories + Offline-QA) Agent-Webresearch auf T1/dünne Orte.

## Regeln
- Nur belegte Fakten; Preise/Öffnung nur \`LIVE: …\`
- Keine Dialog-Skripte
- Pack-IDs strikt

## Dünn / Priorität
${
  thin
    .slice(0, 30)
    .map((s) => {
      const t = (pack.trigger_points || []).find((x) => x.id === s.id);
      return `- **${s.name}** (T${s.place_tier}) \`${s.id}\` — deep=${(t?.deep_data_pool || []).length} gi=${(t?.general_info || '').length}`;
    })
    .join('\n') || '- keine'
}

## Alle Stories
${stories.map((s, i) => `${i + 1}. ${s.name} (T${s.place_tier}) \`${s.id}\``).join('\n')}

## Stats
- Spots: ${pack.spots.length} · Story: ${stories.length} · Directory: ${pack.spots.length - stories.length}
- Offline-QA: ${(pack._offline_qa || []).length}
- Version: ${pack.data_version}
${pendingBriefSection(cityId)}
`;
  const out = path.join(ROOT, 'data', 'staedte', `${cityId}.agent-brief.md`);
  fs.writeFileSync(out, md, 'utf8');
  return { out, thinCount: thin.length, storyCount: stories.length };
}

function main() {
  const city = arg('city');
  if (!city) {
    console.error('Usage: npm run city:auto -- --city "Laboe" [--id laboe] [--upload] [--skip-wiki]');
    process.exit(1);
  }
  const id = (arg('id') || slugify(city)).toLowerCase();
  const doUpload = hasFlag('upload');
  const skipWiki = hasFlag('skip-wiki');
  const radius = arg('radius');

  const skeletonArgs = ['--city', city, '--id', id];
  if (radius) skeletonArgs.push('--radius', String(radius));
  run('buildCitySkeleton.mjs', skeletonArgs, 'skeleton');
  run('expandCityDirectory.mjs', ['--city', id], 'directory');
  const classifyArgs = ['--city', id];
  if (radius) classifyArgs.push('--radius', String(radius));
  run('classifyPackCategories.mjs', classifyArgs, 'classify');
  run('seedLiveHints.mjs', ['--city', id, '--apply'], 'live-hints');

  if (!skipWiki) {
    try {
      run('enrichFromWikipedia.mjs', ['--city', id, '--apply', '--limit', '25'], 'wikipedia');
    } catch (e) {
      console.warn('[auto] wikipedia failed (non-fatal) — Agent Deep Research übernimmt Tiefe', e?.message || e);
    }
  }

  const pack = loadPack(id);
  const polish = polishPack(pack);
  savePack(pack, { bumpVersion: true });
  console.log(`[auto] polish demoted=${polish.demoted} promoted=${polish.promoted}`);

  run('auditEntrances.mjs', ['--city', id, '--apply'], 'entrances');

  const pendingCover = findPending(id);
  const hasLocalCover = fs.existsSync(
    path.join(ROOT, 'assets', 'onboarding', `city-${id}.png`),
  );
  if (pendingCover && pendingCover.status !== 'applied') {
    console.log(
      `[auto] pending user cover (${pendingCover.status}) → Agent muss stylizen (city:cover:pending / findus-city-cover skill)`,
    );
    if (pendingCover.status === 'stylized' && pendingCover.stylized) {
      try {
        run(
          'applyStylizedCityCover.mjs',
          ['--id', id, '--city', city, '--from', path.join(ROOT, pendingCover.stylized)],
          'cover-apply-pending',
        );
      } catch (e) {
        console.warn('[auto] pending cover apply failed (non-fatal)', e?.message || e);
      }
    }
  } else if (!hasLocalCover) {
    try {
      run('fetchCityCover.mjs', ['--id', id, '--title', city, '--force'], 'cover');
    } catch {
      console.warn('[auto] cover failed (non-fatal)');
    }
  } else {
    console.log(`[auto] local cover already present: city-${id}.png`);
  }

  run('runQualityGate.mjs', ['--city', id], 'gate');

  const finalPack = loadPack(id);
  const brief = writeAgentBrief(finalPack, id);
  console.log(`[auto] agent brief → ${brief.out}`);
  if (findPending(id)?.status === 'queued') {
    console.log(
      `[auto] ACTION: Cover-Agent — npm run city:cover:pending -- --id ${id}`,
    );
  }

  if (doUpload) {
    console.log('\n[auto] ▶ upload');
    const up = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), path.join('data', 'staedte', `${id}.json`)],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    if (up.status !== 0) throw new Error('upload failed');
  }

  const gate = runQualityGate(finalPack, { strict: false });
  console.log(
    `\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}`,
  );
  console.log('[auto] Next: Agent vertieft T1 laut agent-brief.md → upload:city');
}

main();
