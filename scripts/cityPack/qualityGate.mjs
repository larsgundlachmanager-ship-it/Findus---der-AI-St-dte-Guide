/** Hard Module-1 quality gates for CityPacks. */

import {
  MODULE1_MUST_HAVE,
  MODULE1_NICE,
  generalInfoFor,
  isDirectorySpot,
  isEphemeralCategory,
  relatedTriggers,
  triggerForSpot,
} from './lib.mjs';
import { validateCityPack } from '../geo/validatePack.mjs';

function hasPoly(spot) {
  const p = spot.polygonCoordinates || spot.polygon;
  return Array.isArray(p) && p.length >= 3;
}

function approaches(spot) {
  return spot.approach_triggers || spot.approachTriggers || [];
}

function deepPool(pack, spot) {
  const t = triggerForSpot(pack, spot);
  return t?.deep_data_pool || [];
}

function categoryOf(spot) {
  return String(spot.category || spot.district || 'ort').toLowerCase();
}

function isMainSpot(spot) {
  // Directory / ephemeral catalog: GPS+lookup only — no full story gate
  if (isDirectorySpot(spot)) return false;
  return !isEphemeralCategory(categoryOf(spot));
}

/**
 * @returns {{ ok: boolean, errors: string[], warnings: string[], stats: object, gaps: object }}
 */
export function runQualityGate(pack, opts = {}) {
  const strict = opts.strict !== false;
  const base = validateCityPack(pack);
  const errors = [...base.errors];
  const warnings = [...base.warnings];

  if (!pack?.name) errors.push('missing name');
  if (typeof pack?.lat !== 'number' || typeof pack?.lng !== 'number') {
    errors.push('missing city lat/lng');
  }
  if (!pack?.data_version) warnings.push('missing data_version');

  const spots = pack.spots || [];
  const triggers = pack.trigger_points || [];
  const linkedTriggerIds = new Set();

  let missingTrigger = 0;
  let missingNarration = 0;
  let missingApproach = 0;
  let missingPoly = 0;
  let thinDeep = 0;
  let orphanTriggers = 0;

  for (const spot of spots) {
    const id = spot.id || spot.name || '?';
    if (!spot.id) errors.push(`${id}: spot missing id`);
    const related = relatedTriggers(pack, spot);
    for (const t of related) if (t.id) linkedTriggerIds.add(t.id);
    if (!related.length) {
      missingTrigger += 1;
      errors.push(`${id}: no matching trigger (id or name)`);
    }

    const info = generalInfoFor(pack, spot);
    const main = isMainSpot(spot);
    const t0 = triggerForSpot(pack, spot);

    if (main) {
      if (info.length < 80) {
        missingNarration += 1;
        (strict ? errors : warnings).push(
          `${id}: general_info/Erzählung too short (${info.length}<80)`,
        );
      }
      // Polygon on spot OR trigger counts
      const polyOk =
        hasPoly(spot) ||
        related.some((t) => Array.isArray(t.polygon) && t.polygon.length >= 3);
      if (!polyOk && !(typeof t0?.lat === 'number')) {
        missingPoly += 1;
        (strict ? errors : warnings).push(
          `${id}: main spot missing polygon/coords`,
        );
      } else if (!polyOk) {
        missingPoly += 1;
        warnings.push(
          `${id}: main spot has point trigger but no polygon (recommend entrance polygon)`,
        );
      }
      if (approaches(spot).length < 1) {
        // Legacy multi-point triggers (_t1/_t2) count as approach network
        if (related.length >= 2) {
          warnings.push(
            `${id}: uses legacy multi-triggers (${related.length}) — migrate to approach_triggers`,
          );
        } else {
          missingApproach += 1;
          (strict ? errors : warnings).push(
            `${id}: main spot needs ≥1 approach`,
          );
        }
      } else {
        for (const a of approaches(spot)) {
          const teaser = (a.teaser_text || a.teaserText || '').trim();
          if (!teaser) {
            (strict ? errors : warnings).push(`${id}: approach without teaser`);
          }
          if (/wegweiser/i.test(teaser)) {
            errors.push(`${id}: teaser must not say „Wegweiser“`);
          }
        }
      }
      const deep = deepPool(pack, spot);
      // Sum deep across related legacy triggers
      const deepCount = related.reduce(
        (n, t) => n + (t.deep_data_pool || []).length,
        0,
      );
      if (Math.max(deep.length, deepCount) < 4) {
        thinDeep += 1;
        warnings.push(`${id}: deep_data_pool thin (${deepCount}<4)`);
      }
    } else {
      if (!t0 || typeof t0.lat !== 'number') {
        warnings.push(`${id}: optional spot without trigger coords`);
      }
    }

    // Hard ban ephemeral prices in pack facts
    const blob = [
      ...(spot.bullets || []),
      spot.facts?.now,
      info,
      ...deepPool(pack, spot).map((e) =>
        typeof e === 'string' ? e : Array.isArray(e) ? e[0] : e?.text,
      ),
    ]
      .filter(Boolean)
      .join('\n');
    if (
      /(\d+[.,]\d{2}\s*€|eintritt\s*\d+|zimmer\s*ab\s*\d+|preis[e]?:\s*\d+)/i.test(
        blob,
      )
    ) {
      warnings.push(
        `${id}: looks like hard-coded price — prefer _live_research`,
      );
    }
  }

  for (const t of triggers) {
    if (
      t.id &&
      !linkedTriggerIds.has(t.id) &&
      t.trigger_kind !== 'approach' &&
      t.trigger_kind !== 'sub'
    ) {
      orphanTriggers += 1;
      warnings.push(`${t.id}: trigger without spot`);
    }
  }

  const cats = new Set(spots.map(categoryOf));
  const missingMust = MODULE1_MUST_HAVE.filter((c) => {
    // soft match: bahnhof covered by transport etc.
    if (c === 'transport') {
      return ![...cats].some((x) =>
        /bahnhof|hafen|transport|ferry|station/.test(x),
      );
    }
    return !cats.has(c) && ![...cats].some((x) => x.includes(c));
  });
  for (const c of missingMust) {
    warnings.push(`coverage: missing must-have category '${c}'`);
  }

  const live = pack._live_research || [];
  if (!Array.isArray(live) || live.length < 2) {
    warnings.push('missing _live_research prompts (≥2 recommended)');
  }

  const cov = pack._coverage;
  if (
    !cov ||
    ![cov.latMin, cov.latMax, cov.lngMin, cov.lngMax].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    ) ||
    cov.latMin >= cov.latMax ||
    cov.lngMin >= cov.lngMax
  ) {
    (strict ? errors : warnings).push(
      'missing/invalid _coverage (city BBox for Stempelkarte / % erkundet)',
    );
  } else if (
    typeof pack.lat === 'number' &&
    typeof pack.lng === 'number' &&
    (pack.lat < cov.latMin ||
      pack.lat > cov.latMax ||
      pack.lng < cov.lngMin ||
      pack.lng > cov.lngMax)
  ) {
    warnings.push('city center lat/lng outside _coverage BBox');
  }

  const storyCount = spots.filter((s) => !isDirectorySpot(s)).length;
  const directoryCount = spots.filter((s) => isDirectorySpot(s)).length;
  const stats = {
    spots: spots.length,
    storySpots: storyCount,
    directorySpots: directoryCount,
    triggers: triggers.length,
    missingTrigger,
    missingNarration,
    missingApproach,
    missingPoly,
    thinDeep,
    orphanTriggers,
    categories: [...cats].sort(),
    missingMustHave: missingMust,
    nicePresent: MODULE1_NICE.filter((c) => cats.has(c)),
    liveResearch: live.length,
    offlineQa: (pack._offline_qa || []).length,
    hasCoverage: !!(
      cov &&
      typeof cov.latMin === 'number' &&
      typeof cov.latMax === 'number'
    ),
    hasTransit: !!pack._transit,
    hasMobility: !!pack._mobility,
    links: (pack._links || []).length,
  };

  const gaps = {
    needsNarration: spots
      .filter((s) => isMainSpot(s) && generalInfoFor(pack, s).length < 80)
      .map((s) => s.id || s.name),
    needsPolygon: spots
      .filter((s) => isMainSpot(s) && !hasPoly(s))
      .map((s) => s.id || s.name),
    needsApproach: spots
      .filter((s) => isMainSpot(s) && approaches(s).length < 1)
      .map((s) => s.id || s.name),
    needsDeep: spots
      .filter((s) => isMainSpot(s) && deepPool(pack, s).length < 4)
      .map((s) => s.id || s.name),
    missingCategories: missingMust,
  };

  const ok = errors.length === 0;
  return { ok, errors, warnings, stats, gaps };
}
