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
  googleBudgetExceeded,
  googleSpendEstUsd,
  googleBudgetCapEur,
} from './google.mjs';
import { extractReviewFacetTags } from './reviewFacetTags.mjs';

loadEnvFile();

// Facet-Ziele: Gastro + Hotel + Museum + Park + Aktivität (Leisure) + Attraktion.
const FACET_TARGET_RE =
  /restaurant|cafe|café|gastro|bistro|imbiss|bar|pub|gasthof|gasthaus|landgasthof|wirtshaus|hotel|pension|hostel|bakery|bäck|baeck|pizzeria|trattoria|osteria|grill|museum|ausstellung|galerie|kunsthalle|park|garten|leisure|freizeit|kletter|boulder|schwimmbad|freibad|hallenbad|minigolf|bowling|kino|theater|sport|fitness|attraction|sehensw|aussicht|zoo|tierpark|wasserski|surf/i;

// Toiletten: nur OSM-Tags (Directory-Expand) — kein teures Google hier.
const TOILET_RE = /toilette|\btoilet\b|\bwc\b|klohaus|sanit[aä]r|pissoir/i;

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

function spotBlob(spot) {
  return `${spot.category || ''} ${(spot.tags || []).join(' ')} ${spot.name || ''}`;
}

function isFacetTargetSpot(spot) {
  const blob = spotBlob(spot);
  if (TOILET_RE.test(blob)) return false; // OSM-only, kein Google
  return FACET_TARGET_RE.test(blob);
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

/** Rating aus Google-Details in Pack (spot._google) + Runtime-Tags schreiben. */
function applyRating(spot, det) {
  const rating = Number(det?.result?.rating);
  const count = Number(det?.result?.user_ratings_total);
  const hasRating = Number.isFinite(rating) && rating > 0 && rating <= 5;
  const hasCount = Number.isFinite(count) && count > 0;
  if (!hasRating && !hasCount) return;
  spot._google = { ...(spot._google || {}) };
  if (hasRating) spot._google.rating = Math.round(rating * 10) / 10;
  if (hasCount) spot._google.user_ratings_total = Math.round(count);
  // Runtime-Tags, damit das Popup Rating ohne Google zeigen kann.
  const ratingTags = [];
  if (hasRating) ratingTags.push(`rating:${(Math.round(rating * 10) / 10).toFixed(1)}`);
  if (hasCount) ratingTags.push(`ratings:${Math.round(count)}`);
  if (ratingTags.length) {
    // Alte rating:/ratings:-Tags entfernen, dann neu setzen.
    spot.tags = (spot.tags || []).filter(
      (t) => !/^ratings?:/i.test(String(t)),
    );
    spot.tags = mergeTags(spot.tags, ratingTags);
  }
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
  const targets = (pack.spots || []).filter(isFacetTargetSpot);
  const todo = targets.filter((s) => {
    if (force) return true;
    if (!(s.tags || []).includes('review_facet')) return true;
    // Rating nachziehen, wenn Facetten schon da sind.
    const r = Number(s?._google?.rating);
    return !(Number.isFinite(r) && r > 0);
  });
  const slice = todo.slice(0, cap);

  console.log(
    `[review-facets] ${cityId} targets=${targets.length} pending=${todo.length} cap=${cap} budget=€${googleBudgetCapEur()} mode=${cheap ? 'cheap' : 'full'}`,
  );

  const stats = {
    tagged: 0,
    empty: 0,
    fail: 0,
    skip: targets.length - todo.length,
    budgetStop: false,
  };

  for (const spot of slice) {
    // Budget-Wächter: vor jeder teuren Details-Abfrage prüfen.
    if (googleBudgetExceeded()) {
      stats.budgetStop = true;
      console.warn(
        `[review-facets] BUDGET STOP: est $${googleSpendEstUsd().toFixed(2)} ≥ €${googleBudgetCapEur()} — restliche ${slice.length - (stats.tagged + stats.empty + stats.fail)} Spots übersprungen.`,
      );
      break;
    }
    try {
      const placeId = await resolvePlaceId(spot, pack);
      if (!placeId) {
        stats.empty += 1;
        continue;
      }
      const det = await placeDetailsReviews(placeId);
      applyRating(spot, det);
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
    `[review-facets] tagged=${stats.tagged} empty=${stats.empty} fail=${stats.fail} already=${stats.skip}${stats.budgetStop ? ' [BUDGET-CAPPED]' : ''} est=$${googleSpendEstUsd().toFixed(2)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
