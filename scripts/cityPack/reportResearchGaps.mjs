#!/usr/bin/env node
/**
 * Research-Lücken + Rückfragen für den User (sofort, nicht erst auf Nachfrage).
 *
 *   node scripts/cityPack/reportResearchGaps.mjs --city luebeck
 *   node scripts/cityPack/reportResearchGaps.mjs --city luebeck --google
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  STAEDTE_DIR,
  arg,
  distM,
  hasFlag,
  loadEnvFile,
  loadPack,
  writeText,
} from './lib.mjs';
import { placesTextAll, requireGoogleKey } from './google.mjs';
import {
  STORY_DISCOVERY_QUERIES,
  suggestedMinStory,
  suggestedDiscoveryRadius,
} from './placeCategoryPolicy.mjs';

loadEnvFile();

function isThinStory(pack, spot) {
  const t = (pack.trigger_points || []).find((x) => x.id === spot.id);
  const gi = (t?.general_info || '').trim();
  const deep = t?.deep_data_pool || [];
  const master =
    (spot.tags || []).includes('master_report') ||
    (spot.tags || []).includes('deep_research_merged');
  const stubby =
    /Offline-Lookup|Orientierung und Offline|kultureller Ankerpunkt|Deep Research folgt|needs_deep_research|liegt voraus/i.test(
      gi,
    ) || gi.length < 160;
  const thinDeep = deep.filter((d) => {
    const text = String(d.text || d || '');
    return !/LIVE:|GPS:|Kategorie |Kultur-Spot|Offline-Pack/i.test(text);
  }).length < 2;
  return spot.pack_role !== 'directory' && (!master || stubby || thinDeep);
}

async function findGoogleMissing(pack, radiusM) {
  requireGoogleKey();
  const missing = [];
  const center = { lat: pack.lat, lng: pack.lng };
  for (const dq of STORY_DISCOVERY_QUERIES.filter((q) => (q.tier || 2) <= 2)) {
    const query = `${dq.q} ${pack.name || pack.city_id}`;
    let results = [];
    try {
      const data = await placesTextAll(
        query,
        { ...center, radiusM },
        { maxPages: 1 },
      );
      results = data.results || [];
    } catch {
      continue;
    }
    for (const r of results.slice(0, 15)) {
      const loc = r.geometry?.location;
      if (!loc) continue;
      if (distM(center, loc) > radiusM + 2000) continue;
      const near = (pack.spots || []).some((s) => {
        const t = pack.trigger_points.find((x) => x.id === s.id);
        if (!t || typeof t.lat !== 'number') return false;
        return distM(t, loc) < 70;
      });
      const nameHit = (pack.spots || []).some((s) =>
        s.name.toLowerCase().includes(String(r.name || '').slice(0, 14).toLowerCase()),
      );
      if (!near && !nameHit) {
        missing.push({
          name: r.name,
          categoryHint: dq.categoryHint,
          address: r.formatted_address || null,
          lat: loc.lat,
          lng: loc.lng,
          query: dq.q,
        });
      }
    }
  }
  // dedupe by name
  const seen = new Set();
  return missing.filter((m) => {
    const k = m.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error(
      'Usage: node scripts/cityPack/reportResearchGaps.mjs --city <id> [--google]',
    );
    process.exit(1);
  }
  const pack = loadPack(cityId);
  const minStory = suggestedMinStory(pack);
  const radius = suggestedDiscoveryRadius(pack);
  const stories = (pack.spots || []).filter((s) => s.pack_role !== 'directory');
  const thin = stories.filter((s) => isThinStory(pack, s));
  const rich = stories.filter((s) => !isThinStory(pack, s));

  let googleMissing = [];
  if (hasFlag('google')) {
    console.log('[gaps] Google-Abgleich…');
    googleMissing = await findGoogleMissing(pack, radius);
  }

  const lines = [];
  lines.push(`# Rückfragen / Research-Lücken — ${pack.name || cityId}`);
  lines.push('');
  lines.push(`Stand: ${new Date().toISOString()}`);
  lines.push(
    `Story: **${stories.length}** (Guidance ≥ **${minStory}**) · Directory: **${pack._pack_index?.directory ?? '—'}** · dünn: **${thin.length}** · angereichert: **${rich.length}**`,
  );
  lines.push('');
  lines.push('## Bitte nachliefern (Gemini / Deep Research)');
  lines.push('');
  lines.push(
    'Für jeden Ort unten: kurze stabile Erzählung (Hook → Historie → Heute), 50/20/5-m-Trigger-Ideen, 2 Querverbindungen, keine Preise (nur LIVE-Hinweise).',
  );
  lines.push('');
  for (const [i, s] of thin
    .sort((a, b) => (a.place_tier || 9) - (b.place_tier || 9) || a.name.localeCompare(b.name))
    .entries()) {
    lines.push(
      `${i + 1}. **${s.name}** (T${s.place_tier || '?'} / ${s.category || '?'}) — id \`${s.id}\``,
    );
  }
  lines.push('');
  if (stories.length < minStory) {
    lines.push('## Pack zu dünn');
    lines.push('');
    lines.push(
      `Aktuell ${stories.length} Stories, Ziel für diese Stadtgröße ≈ ${minStory}. Bitte weitere Top-Sehenswürdigkeiten / Museen / Theater / Kirchen / Aussichten liefern oder \`city:classify --radius ${radius}\` mit Google-Discovery laufen lassen.`,
    );
    lines.push('');
  }
  if (googleMissing.length) {
    lines.push('## Google Maps gefunden, aber noch nicht im Pack');
    lines.push('');
    lines.push(
      'Sollen diese Orte als Story (Kultur/Sehenswürdigkeit) oder Directory aufgenommen werden?',
    );
    lines.push('');
    for (const [i, m] of googleMissing.slice(0, 40).entries()) {
      lines.push(
        `${i + 1}. **${m.name}** (${m.categoryHint}) — ${m.address || `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`}`,
      );
    }
    if (googleMissing.length > 40) {
      lines.push(`… +${googleMissing.length - 40} weitere`);
    }
    lines.push('');
  }
  lines.push('## Offene Kontrollfragen an dich');
  lines.push('');
  lines.push(
    '1. Welche der dünnen Stories haben Priorität für den nächsten Master-Paste (Top 10)?',
  );
  lines.push(
    '2. Travemünde/Priwall: nur Leuchtturm+Passat, oder Strand/Seebrücke/Casino als eigene Stories?',
  );
  lines.push(
    '3. Kleine Denkmäler/Statuen (Brahms, Kaiser Wilhelm, …): Story T2 oder Directory?',
  );
  lines.push(
    '4. Kinos (Filmhaus, Kommunales, Kolosseum): Kultur-Story behalten oder Directory?',
  );
  lines.push(
    '5. Fehlt ein Must-See, den Google nicht geliefert hat (z. B. konkreter Hof/Gasse/Hidden Spot)?',
  );
  lines.push('');

  const out = path.join(STAEDTE_DIR, `${cityId}.rueckfragen.md`);
  writeText(out, lines.join('\n'));
  const jsonOut = path.join(STAEDTE_DIR, `${cityId}.rueckfragen.json`);
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        city_id: cityId,
        story: stories.length,
        minStory,
        thin: thin.map((s) => ({
          id: s.id,
          name: s.name,
          tier: s.place_tier,
          category: s.category,
        })),
        google_missing: googleMissing,
      },
      null,
      2,
    ),
  );
  console.log(`[gaps] wrote ${out}`);
  console.log(`[gaps] thin=${thin.length} story=${stories.length} missingGoogle=${googleMissing.length}`);
  console.log('\n' + lines.slice(0, 80).join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
