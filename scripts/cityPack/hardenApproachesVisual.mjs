#!/usr/bin/env node
/**
 * Härtet Wegweiser + visuelle Erkennung für Story-Orte (stadt-agnostisch).
 *
 * - Stellt mind. 2 Approach-Trigger sicher (Offsets N/S vom GPS-Zentrum)
 * - Teaser: Visuell-first aus Pack-Fakten (Farbe/Form/Merkmal), kein Meta
 * - FAQ „Woran erkenne ich…?“ im deep_data_pool wenn fehlend
 * - Haupteingang-Sub-POI sync mit Spot-Zentrum
 *
 * Usage:
 *   node scripts/cityPack/hardenApproachesVisual.mjs --city prisdorf --apply
 *   node scripts/cityPack/hardenApproachesVisual.mjs --all --apply --story-only
 */
import {
  STAEDTE_DIR,
  arg,
  hasFlag,
  loadPack,
  offset,
  savePack,
  writeJson,
} from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

function isStory(spot) {
  const role = String(spot.pack_role || '').toLowerCase();
  if (role === 'directory') return false;
  if (role === 'story') return true;
  const tier = Number(spot.place_tier);
  if (Number.isFinite(tier) && tier <= 2) return true;
  const tags = (spot.tags || []).map(String);
  return tags.some((t) => /must_have|landmark|tier1|story/i.test(t));
}

function packCenter(spot, trigger) {
  if (typeof spot.lat === 'number' && typeof spot.lng === 'number') {
    return { lat: spot.lat, lng: spot.lng };
  }
  if (trigger && typeof trigger.lat === 'number') {
    return { lat: trigger.lat, lng: trigger.lng };
  }
  const poly = spot.polygonCoordinates || spot.polygon;
  if (Array.isArray(poly) && poly.length) {
    let lat = 0;
    let lng = 0;
    let n = 0;
    for (const p of poly) {
      const a = p.latitude ?? p.lat;
      const b = p.longitude ?? p.lng;
      if (typeof a === 'number' && typeof b === 'number') {
        lat += a;
        lng += b;
        n += 1;
      }
    }
    if (n) return { lat: lat / n, lng: lng / n };
  }
  const entrance = (spot.sub_pois || spot.subPois || []).find((s) =>
    /eingang|entrance/i.test(String(s.name || s.id || '')),
  );
  if (entrance && typeof entrance.lat === 'number') {
    return { lat: entrance.lat, lng: entrance.lng };
  }
  return null;
}

function collectVisualBits(spot, trigger) {
  const bits = [];
  const push = (raw) => {
    const t = String(raw || '')
      .replace(/^LIVE:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length < 20 || t.length > 160) return;
    if (/GPS-Eingang|Koordinaten|lat|lng|http/i.test(t)) return;
    if (
      !/\b(ziegel|glas|holz|turm|kuppel|giebel|fassade|schild|uhr|fahne|brücke|bruecke|hafen|kran|kupfer|sandstein|weiß|weiss|rot|grün|gruen|schwarz|gelb|kirche|dom|tor|statue|denkmal|fachwerk|backstein)\b/iu.test(
        t,
      ) &&
      !/\b(erkenn|sieht man|ausseh|visuell|optik|markant)\b/iu.test(t)
    ) {
      return;
    }
    if (!bits.includes(t)) bits.push(t);
  };
  for (const b of spot.bullets || []) push(b);
  for (const raw of trigger?.deep_data_pool || []) {
    const text = typeof raw === 'string' ? raw : raw?.text;
    const tags = typeof raw === 'object' && raw?.tags ? raw.tags : [];
    if (
      tags.some((t) =>
        /visuell|optik|orientierung|wegweiser|fassade|erkenn/i.test(String(t)),
      )
    ) {
      push(text);
    } else {
      push(text);
    }
  }
  for (const raw of spot.deep_data_pool || []) {
    push(typeof raw === 'string' ? raw : raw?.text);
  }
  return bits.slice(0, 4);
}

function buildTeaser(spot, visualBits, side) {
  const name = String(spot.name || 'der Ort').trim();
  const v =
    visualBits[0] ||
    `das markante Gebäude von ${name} — Form und Fassade fallen sofort auf`;
  const hook =
    visualBits[1] ||
    `Kurz näher rangehen lohnt: da steckt echte Ortsgeschichte drin.`;
  const sideBit =
    side === 'n'
      ? 'Voraus'
      : side === 's'
        ? 'Von dieser Seite'
        : 'Gleich da';
  // Visuell zuerst, Name danach — Masterbook Visuals Before Naming
  return `${sideBit}: ${v.replace(/\.$/, '')}. ${hook.replace(/\.$/, '')}.`.slice(
    0,
    280,
  );
}

function ensureApproaches(spot, center, visualBits) {
  const existing = [...(spot.approach_triggers || spot.approachTriggers || [])];
  const a = offset(center.lat, center.lng, 45, 0);
  const b = offset(center.lat, center.lng, -40, 15);
  const defaults = [
    {
      id: `${spot.id}_approach_n`,
      lat: a.lat,
      lng: a.lng,
      radius_m: 36,
      teaser_text: buildTeaser(spot, visualBits, 'n'),
      condition_rule: 'always',
    },
    {
      id: `${spot.id}_approach_s`,
      lat: b.lat,
      lng: b.lng,
      radius_m: 28,
      teaser_text: buildTeaser(spot, visualBits.slice(1), 's'),
      condition_rule: 'always',
    },
  ];

  if (existing.length === 0) return defaults;

  return existing.map((ex, i) => {
    const d = defaults[Math.min(i, defaults.length - 1)];
    const lat = typeof ex.lat === 'number' ? ex.lat : d.lat;
    const lng = typeof ex.lng === 'number' ? ex.lng : d.lng;
    const oldTeaser = String(ex.teaser_text || ex.teaserText || '').trim();
    const boring =
      !oldTeaser ||
      oldTeaser.length < 40 ||
      /Haupteingang laut Google|geh auf den Eingang|Kurz vorher:.*liegt voraus|Wegweiser/i.test(
        oldTeaser,
      );
    return {
      ...ex,
      id: ex.id || d.id,
      lat,
      lng,
      radius_m: Math.max(Number(ex.radius_m || ex.radiusMeters || 28), 28),
      teaser_text: boring ? d.teaser_text : oldTeaser,
      condition_rule: ex.condition_rule || ex.conditionRule || 'always',
    };
  });
}

function ensureVisualFaq(trigger, spot, visualBits) {
  if (!trigger) return false;
  const pool = [...(trigger.deep_data_pool || [])];
  const has = pool.some((e) => {
    const t = typeof e === 'string' ? e : e?.text || '';
    return /Woran erkenne|erkenne ich|visuell erkenn/i.test(t);
  });
  if (has) return false;
  const detail =
    visualBits[0] ||
    `${spot.name}: markante Fassade/Form — im Ortsbild sofort sichtbar.`;
  pool.unshift({
    text: `Woran erkenne ich ${spot.name}? ${detail}`,
    tags: ['visuell', 'wegweiser', 'orientierung', 'faq'],
  });
  trigger.deep_data_pool = pool;
  return true;
}

function ensureEntranceSub(spot, center) {
  const subs = [...(spot.sub_pois || spot.subPois || [])];
  const entrance = {
    id: `${spot.id}_sub_eingang`,
    name: `${spot.name} · Haupteingang`,
    lat: center.lat,
    lng: center.lng,
    radius_m: 12,
    fact_details:
      'Haupteingang / Navigationsziel — Route vom Wegweiser führt hierher.',
    tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target'],
  };
  spot.sub_pois = [
    entrance,
    ...subs.filter((s) => !String(s.id || '').includes('eingang')),
  ];
}

function hardenCity(cityId, apply) {
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);
  const storyOnly = hasFlag('story-only') || true;
  let touched = 0;
  let approachesFixed = 0;
  let faqAdded = 0;
  const rows = [];

  for (const spot of pack.spots || []) {
    if (storyOnly && !isStory(spot)) continue;
    const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
    const center = packCenter(spot, trigger);
    if (!center) {
      rows.push({ id: spot.id, name: spot.name, status: 'NO_CENTER' });
      continue;
    }
    const visualBits = collectVisualBits(spot, trigger);
    const before = (spot.approach_triggers || []).length;
    spot.approach_triggers = ensureApproaches(spot, center, visualBits);
    if (spot.approachTriggers) delete spot.approachTriggers;
    ensureEntranceSub(spot, center);
    if (trigger) {
      trigger.lat = center.lat;
      trigger.lng = center.lng;
      if (ensureVisualFaq(trigger, spot, visualBits)) faqAdded += 1;
    }
    approachesFixed += 1;
    touched += 1;
    rows.push({
      id: spot.id,
      name: spot.name,
      status: 'HARDENED',
      approaches: spot.approach_triggers.length,
      visual_bits: visualBits.length,
      had_approaches: before,
    });
  }

  if (apply && touched) {
    savePack(pack, { bumpVersion: true });
  }

  const report = {
    city: cityId,
    apply,
    touched,
    approachesFixed,
    faqAdded,
    data_version: pack.data_version,
    rows,
  };
  writeJson(path.join(STAEDTE_DIR, `${cityId}.approaches_visual_report.json`), report);
  return report;
}

async function main() {
  const apply = hasFlag('apply');
  let cities = [];
  if (hasFlag('all')) {
    try {
      const idx = JSON.parse(
        fs.readFileSync(path.join(STAEDTE_DIR, 'index.json'), 'utf8'),
      );
      cities = (idx.available_cities || [])
        .map((c) => c.id)
        .filter((id) => fs.existsSync(path.join(STAEDTE_DIR, `${id}.json`)));
    } catch {
      cities = [];
    }
  } else {
    const city = arg('city');
    if (!city) {
      console.error(
        'Usage: hardenApproachesVisual.mjs --city <id> --apply | --all --apply',
      );
      process.exit(1);
    }
    cities = [city];
  }

  const summaries = [];
  for (const id of cities) {
    const packPath = path.join(STAEDTE_DIR, `${id}.json`);
    if (!fs.existsSync(packPath)) continue;
    try {
      const r = hardenCity(id, apply);
      summaries.push({
        city: id,
        touched: r.touched,
        faqAdded: r.faqAdded,
        v: r.data_version,
      });
      console.log(
        `[harden] ${id}: spots=${r.touched} faq+${r.faqAdded} v${r.data_version}${apply ? ' APPLIED' : ' dry'}`,
      );
    } catch (e) {
      console.warn(`[harden] ${id} fail:`, e.message);
    }
  }
  writeJson(
    path.join(STAEDTE_DIR, '_approaches_visual_batch_report.json'),
    { at: new Date().toISOString(), apply, summaries },
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
