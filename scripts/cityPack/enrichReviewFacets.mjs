#!/usr/bin/env node
/**
 * Gastro-Directory: stabile Facet-Tags aus Google-Reviews (kein Review-Volltext,
 * keine Preise, keine Speisekarte). Damit Pack-Suche Steak/vegan/Terrasse findet,
 * ohne jedes Mal Live-Reviews zu ziehen.
 *
 *   npm run city:review-facets -- --city prisdorf
 *   npm run city:review-facets -- --city prisdorf --force
 */
import {
  arg,
  hasFlag,
  loadEnvFile,
  loadPack,
  packCostIsCheap,
  savePack,
} from './lib.mjs';
import {
  placesTextIdsOnly,
  placeDetailsReviews,
  requireGoogleKey,
} from './google.mjs';
import { extractReviewFacetTags } from './reviewFacetTags.mjs';

loadEnvFile();

const GASTRO_RE =
  /restaurant|cafe|café|gastro|bistro|imbiss|bar|pub|gasthof|gasthaus|landgasthof|wirtshaus|hotel|pension|bakery|bäck|baeck|pizzeria|trattoria|osteria|grill/i;

const META_TAGS = new Set([
  'directory',
  'tier4',
  'offline_lookup',
  'optional_live',
  'auto_polish',
  'story',
  'review_facet',
  'module1',
  'master_report',
]);

function isGastroSpot(spot) {
  const blob = `${spot.category || ''} ${(spot.tags || []).join(' ')} ${spot.name || ''}`;
  return GASTRO_RE.test(blob);
}

function mergeTags(existing, extra) {
  return [...new Set([...(existing || []).map(String), ...extra])];
}

function placeIdOf(spot) {
  return String(spot?._google?.place_id || '').replace(/^places\//, '').trim();
}

function facetLine(facets) {
  return `Gäste erwähnen regelmäßig: ${facets.join(', ')}. (Review-Facetten, keine Preise.)`;
}

function applyFacets(pack, spot, facets, placeId) {
  if (!facets.length) return false;
  spot.tags = mergeTags(spot.tags, ['review_facet', ...facets]);
  spot.facts = spot.facts || {};
  spot.facts.tags = mergeTags(spot.facts.tags, ['review_facet', ...facets]);
  if (placeId) {
    spot._google = { ...(spot._google || {}), place_id: placeId };
  }
  const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
  if (trigger) {
    trigger.deep_data_pool = trigger.deep_data_pool || [];
    const already = trigger.deep_data_pool.some((d) =>
      (Array.isArray(d?.tags) ? d.tags : []).includes('review_facet'),
    );
    if (!already) {
      trigger.deep_data_pool.push({
        text: facetLine(facets),
        tags: ['review_facet', 'directory', ...facets],
      });
    } else {
      for (const d of trigger.deep_data_pool) {
        const tags = Array.isArray(d?.tags) ? d.tags : [];
        if (!tags.includes('review_facet')) continue;
        d.text = facetLine(facets);
        d.tags = mergeTags(tags, facets);
      }
    }
  }
  return true;
}

async function resolvePlaceId(spot, pack) {
  const existing = placeIdOf(spot);
  if (existing) return existing;
  const city = pack.name || pack.city_id || '';
  const query = `${spot.name} ${city}`.replace(/\s+/g, ' ').trim();
  const near =
    pack.lat != null && pack.lng != null
      ? { lat: pack.lat, lng: pack.lng, radiusM: 8000 }
      : null;
  const ids = await placesTextIdsOnly(query, near);
  return ids[0] || null;
}

async function main() {
  const cityId = String(arg('city') || '').toLowerCase().trim();
  if (!cityId) {
    console.error('Usage: npm run city:review-facets -- --city <id> [--force]');
    process.exit(1);
  }
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack missing: ${cityId}`);
  requireGoogleKey();

  const cheap = packCostIsCheap();
  const cap = Number(arg('limit') || (cheap ? 40 : 120));
  const force = hasFlag('force');
  const gastro = (pack.spots || []).filter(isGastroSpot);
  const todo = gastro.filter((s) => force || !(s.tags || []).includes('review_facet'));
  const slice = todo.slice(0, cap);

  console.log(
    `[review-facets] ${cityId} gastro=${gastro.length} pending=${todo.length} cap=${cap} mode=${cheap ? 'cheap' : 'full'}`,
  );

  const stats = { tagged: 0, empty: 0, fail: 0, skip: gastro.length - todo.length };

  for (const spot of slice) {
    try {
      const placeId = await resolvePlaceId(spot, pack);
      if (!placeId) {
        stats.empty += 1;
        continue;
      }
      const det = await placeDetailsReviews(placeId);
      const reviews = det.result?.reviews || [];
      const blob = [
        det.result?.editorialSummary || '',
        ...reviews.map((r) => r.text || ''),
      ].join('\n');
      const facets = extractReviewFacetTags(
        `${spot.name} ${(spot.tags || []).join(' ')} ${blob}`,
      ).filter((t) => !META_TAGS.has(t) && t !== (spot.category || '').toLowerCase());
      if (!facets.length) {
        spot.tags = mergeTags(spot.tags, ['review_facet']);
        stats.empty += 1;
        continue;
      }
      if (applyFacets(pack, spot, facets, placeId)) stats.tagged += 1;
    } catch (e) {
      stats.fail += 1;
      console.warn(
        `[review-facets] skip ${spot.name}: ${String(e?.message || e).slice(0, 140)}`,
      );
    }
  }

  savePack(pack, { bumpVersion: true });
  console.log(
    `[review-facets] tagged=${stats.tagged} empty=${stats.empty} fail=${stats.fail} already=${stats.skip}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
