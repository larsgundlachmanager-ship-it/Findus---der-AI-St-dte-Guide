/**
 * Pure Klassifikation + Stage-Motive für Akt-3 Screensaver — smoke-fähig ohne RN.
 * Weltweit: Europa-Karte oder Weltkarte je nach Fund-Koordinaten.
 */

import type { ResearchSpark } from '../types';
import {
  airportPin,
  approxPinForSpark,
  extractPriceLabel,
  parseFlightLabel,
  projectPinToPercent,
  resolveTheaterView,
  sanitizeLatLng,
  type SparkPin,
  type TheaterBounds,
  type TheaterRegionId,
  type TheaterView,
} from './sparkGeo';
import { normalizeTheaterStage } from './theaterStages';

/** Theater-/Legacy-Stage → Motiv-/Pill-Bucket. */
function sceneBucket(stage: string | null | undefined): string {
  const raw = (stage || '').toLowerCase();
  if (!raw) return '';
  if (
    raw === 'climate' ||
    raw === 'soft' ||
    raw === 'events' ||
    raw === 'discover' ||
    raw === 'flights' ||
    raw === 'calendar' ||
    raw === 'stay' ||
    raw === 'transfer' ||
    raw === 'compare' ||
    raw === 'qa' ||
    raw === 'pivot' ||
    raw === 'rail' ||
    raw === 'bahn' ||
    raw === 'cruise' ||
    raw === 'ferry'
  ) {
    return raw;
  }
  const norm = normalizeTheaterStage(raw);
  switch (norm) {
    case 'brief_plan':
      return 'climate';
    case 'open_space':
      return 'discover';
    case 'access_filter':
    case 'shortlist':
      return 'discover';
    case 'stay_tracks':
      return 'stay';
    case 'flight_matrix':
      return 'flights';
    case 'score_compare':
      return 'compare';
    case 'feeder':
      return 'transfer';
    case 'package_pick':
      return 'qa';
    default:
      return raw;
  }
}

export type PinLabelSide = 'below' | 'above' | 'left' | 'right';

export type TheaterPin = {
  id: string;
  label: string;
  emoji: string;
  kind: ResearchSpark['kind'];
  xPct: number;
  yPct: number;
  hasGeo: boolean;
  /** Kurzer Grund (Discover) — UI faded ein/aus. */
  reason?: string | null;
  sub?: string;
  price?: string | null;
  /** Label-Seite nach Entzerrung — weniger Überdeckung. */
  labelSide?: PinLabelSide;
};

export type TheaterFlight = {
  id: string;
  label: string;
  price: string | null;
  from: { xPct: number; yPct: number; label: string };
  to: { xPct: number; yPct: number; label: string };
  mid: { xPct: number; yPct: number };
};

export type TheaterMotif = {
  id: string;
  emoji: string;
  xPct: number;
  yPct: number;
  label?: string;
};

export type CompareStatus = 'in' | 'maybe' | 'out';

export type TheaterCompareNode = {
  id: string;
  label: string;
  emoji: string;
  /** Hotel / Wunsch / Angebot — kein Finalpreis. */
  hint?: string;
  status: CompareStatus;
  reason?: string;
};

export type TheaterPill = {
  id: string;
  label: string;
  emoji?: string;
  /** Contextual: flight | stay | activity — kein generisches „Wunsch“ überall. */
  tone: 'flight' | 'stay' | 'activity';
};

export type TheaterScene = {
  pins: TheaterPin[];
  flights: TheaterFlight[];
  pills: TheaterPill[];
  motifs: TheaterMotif[];
  compareNodes: TheaterCompareNode[];
  view: TheaterView;
};

function isAmenityWish(s: ResearchSpark): boolean {
  if (s.kind !== 'vibe') return false;
  return /pool|villa|sauna|terrasse|balkon|all.?inclusive|apartment|hotel|ferienhaus|küche/i.test(
    `${s.label} ${s.sub || ''}`,
  );
}

function isActivityWish(s: ResearchSpark): boolean {
  if (s.kind !== 'vibe') return false;
  return /club|party|padel|tennis|surf|ski|hike|strand|beach|spa|event|konzert|stadion/i.test(
    `${s.label} ${s.sub || ''}`,
  );
}

function isFlightWish(s: ResearchSpark): boolean {
  if (s.kind !== 'vibe' && s.kind !== 'flight') return false;
  return /direkt|nonstop|umstieg|flug|airport|abflug|früh|spät|gepäck/i.test(
    `${s.label} ${s.sub || ''}`,
  );
}

function sparkLatLng(s: ResearchSpark): SparkPin | null {
  const known = approxPinForSpark(s.label);
  if (
    typeof s.lat === 'number' &&
    Number.isFinite(s.lat) &&
    typeof s.lng === 'number' &&
    Number.isFinite(s.lng)
  ) {
    const sane = sanitizeLatLng(s.lat, s.lng);
    if (!sane) return known;
    // Nur bei klar bekanntem Ort + wild abweichenden Koords Seed nehmen
    if (known) {
      const dLat = Math.abs(sane.lat - known.lat);
      const dLng = Math.abs(sane.lng - known.lng);
      if (dLat > 4 || dLng > 4) return known;
    }
    return sane;
  }
  if (known) return known;
  if (s.kind === 'flight') {
    const parsed = parseFlightLabel(s.label);
    if (parsed.dest) {
      const d = airportPin(parsed.dest);
      if (d) return d;
    }
  }
  // Kein Soft-Pin / kein Fuzzy — ohne Geo unsichtbar
  return null;
}

function pinPos(
  spark: ResearchSpark,
  bounds: TheaterBounds,
): { xPct: number; yPct: number; hasGeo: boolean } | null {
  const geo = sparkLatLng(spark);
  if (geo) {
    return { ...projectPinToPercent(geo.lat, geo.lng, bounds), hasGeo: true };
  }
  // Kein Soft-Pin: lieber unsichtbar als geografisch falsch
  return null;
}

function flightFromSpark(s: ResearchSpark, bounds: TheaterBounds): TheaterFlight | null {
  const parsed = parseFlightLabel(s.label);
  const price = extractPriceLabel(s.sub) || (s.sub && /€|\d/.test(s.sub) ? s.sub.slice(0, 14) : null);
  const destPin =
    (parsed.dest && airportPin(parsed.dest)) ||
    (typeof s.lat === 'number' && typeof s.lng === 'number'
      ? { lat: s.lat, lng: s.lng, label: parsed.dest || s.label }
      : null);
  const originRaw = parsed.origins[0];
  const fromPin = originRaw ? airportPin(originRaw) : null;

  if (!destPin && !fromPin) {
    // Ohne echte Geo keine Fake-Route zeichnen
    return null;
  }

  const to = destPin
    ? { ...projectPinToPercent(destPin.lat, destPin.lng, bounds), label: destPin.label }
    : null;
  if (!to) return null;
  const from = fromPin
    ? { ...projectPinToPercent(fromPin.lat, fromPin.lng, bounds), label: fromPin.label }
    : {
        xPct: Math.max(6, to.xPct - 28),
        yPct: Math.min(80, to.yPct + 6),
        label: originRaw || 'Start',
      };
  const toP = to as { xPct: number; yPct: number; label: string };
  return {
    id: s.id,
    label: s.label,
    price,
    from: { xPct: from.xPct, yPct: from.yPct, label: from.label },
    to: toP,
    mid: {
      xPct: (from.xPct + toP.xPct) / 2,
      yPct: (from.yPct + toP.yPct) / 2 - 4,
    },
  };
}

function weatherMotifsForRegion(
  region: TheaterRegionId,
  weatherHint?: string | null,
  tempSamples?: Array<{ label: string; emoji: string; tempLabel: string }>,
): TheaterMotif[] {
  // Echte Temps schlagen Fake-Regional-Emojis
  if (tempSamples && tempSamples.length >= 2) {
    const slots = [
      { xPct: 38, yPct: 58 },
      { xPct: 58, yPct: 42 },
      { xPct: 48, yPct: 68 },
      { xPct: 72, yPct: 52 },
    ];
    return tempSamples.slice(0, 4).map((t, i) => ({
      id: `wx-live-${i}`,
      emoji: t.emoji || '🌡️',
      xPct: slots[i]!.xPct,
      yPct: slots[i]!.yPct,
      label: `${t.label} ${t.tempLabel}`.trim().slice(0, 22),
    }));
  }
  const warm = /warm|sonne|hot|beach|\d{1,2}°/i.test(weatherHint || '');
  const cool = /kühl|kalt|cool|regen|❄️/i.test(weatherHint || '');
  if (region === 'asia') {
    return [
      { id: 'wx-sea', emoji: warm || !cool ? '☀️' : '🌦️', xPct: 42, yPct: 62, label: 'Südostasien' },
      { id: 'wx-mon', emoji: '🌧️', xPct: 55, yPct: 48, label: 'Monsun' },
      { id: 'wx-jp', emoji: cool ? '❄️' : '🌸', xPct: 78, yPct: 32, label: 'Ostasien' },
      { id: 'wx-in', emoji: warm || !cool ? '🌞' : '🌤️', xPct: 28, yPct: 52, label: 'Indien' },
    ];
  }
  if (region === 'americas') {
    return [
      { id: 'wx-car', emoji: warm || !cool ? '☀️' : '🌦️', xPct: 48, yPct: 48, label: 'Karibik' },
      { id: 'wx-usa', emoji: cool ? '❄️' : '🌤️', xPct: 42, yPct: 28, label: 'Norden' },
      { id: 'wx-br', emoji: warm || !cool ? '🌞' : '🌧️', xPct: 62, yPct: 72, label: 'Brasilien' },
      { id: 'wx-pac', emoji: '🌊', xPct: 22, yPct: 45, label: 'Pazifik' },
    ];
  }
  if (region === 'africa') {
    return [
      { id: 'wx-saf', emoji: warm || !cool ? '☀️' : '🌤️', xPct: 48, yPct: 72, label: 'Südafrika' },
      { id: 'wx-sah', emoji: '🏜️', xPct: 42, yPct: 28, label: 'Sahara' },
      { id: 'wx-ea', emoji: '🌞', xPct: 62, yPct: 52, label: 'Ostafrika' },
      { id: 'wx-mag', emoji: cool ? '🌧️' : '☀️', xPct: 28, yPct: 22, label: 'Maghreb' },
    ];
  }
  if (region === 'atlantic' || region === 'world') {
    return [
      { id: 'wx-eu', emoji: cool ? '🌧️' : '🌤️', xPct: 58, yPct: 32, label: 'Europa' },
      { id: 'wx-am', emoji: warm || !cool ? '☀️' : '🌤️', xPct: 28, yPct: 42, label: 'Amerika' },
      { id: 'wx-af', emoji: '🌞', xPct: 52, yPct: 58, label: 'Afrika' },
      { id: 'wx-as', emoji: warm || !cool ? '☀️' : '🌦️', xPct: 78, yPct: 45, label: 'Asien' },
    ];
  }
  return [
    { id: 'wx-med', emoji: warm || !cool ? '☀️' : '🌤️', xPct: 38, yPct: 68, label: 'Mittelmeer' },
    { id: 'wx-atl', emoji: cool ? '🌧️' : '🌤️', xPct: 18, yPct: 48, label: 'Atlantik' },
    { id: 'wx-alp', emoji: '❄️', xPct: 48, yPct: 52, label: 'Alpen' },
    { id: 'wx-bal', emoji: cool ? '🌬️' : '⛅', xPct: 52, yPct: 28, label: 'Norden' },
    { id: 'wx-eg', emoji: warm || !cool ? '🌞' : '🌦️', xPct: 72, yPct: 62, label: 'Ägäis' },
  ];
}

/** Ambient-Motive — kein separates „Wünsche“-Show; Activities als Bubbles. */
export function stageAmbientMotifs(
  stage: string | null | undefined,
  weatherHint?: string | null,
  region: TheaterRegionId = 'europe',
  tempSamples?: Array<{ label: string; emoji: string; tempLabel: string }>,
): TheaterMotif[] {
  const s = sceneBucket(stage);
  if (s === 'climate') return weatherMotifsForRegion(region, weatherHint, tempSamples);
  if (s === 'events') {
    return [
      { id: 'ev1', emoji: '🎟️', xPct: 42, yPct: 55, label: 'Events' },
      { id: 'ev2', emoji: '🎵', xPct: 58, yPct: 48 },
      { id: 'ev3', emoji: '🏟️', xPct: 35, yPct: 42 },
      { id: 'ev4', emoji: '🎭', xPct: 62, yPct: 62 },
    ];
  }
  // soft = Aktivitäten auf der Karte, nicht Wishlist-Pills
  if (s === 'soft') {
    return [
      { id: 'sf1', emoji: '🎉', xPct: 48, yPct: 52, label: 'Club' },
      { id: 'sf2', emoji: '🎾', xPct: 58, yPct: 58, label: 'Padel' },
      { id: 'sf3', emoji: '🏖️', xPct: 40, yPct: 68, label: 'Strand' },
    ];
  }
  if (s === 'stay') {
    return [
      { id: 'st1', emoji: '🏡', xPct: 44, yPct: 52 },
      { id: 'st2', emoji: '🏨', xPct: 58, yPct: 58 },
      { id: 'st3', emoji: '🏊', xPct: 36, yPct: 62, label: 'Pool' },
    ];
  }
  if (s === 'flights') {
    return [
      { id: 'fl1', emoji: '✈️', xPct: 50, yPct: 40, label: 'Direktflug' },
    ];
  }
  if (s === 'transfer') {
    return [
      { id: 'tr1', emoji: '🚕', xPct: 48, yPct: 55 },
      { id: 'tr2', emoji: '🚌', xPct: 40, yPct: 48 },
    ];
  }
  if (s === 'calendar') {
    return [
      { id: 'ca1', emoji: '📅', xPct: 45, yPct: 48, label: 'Fenster' },
      { id: 'ca2', emoji: '💹', xPct: 58, yPct: 55, label: 'Preise' },
    ];
  }
  if (s === 'pivot') {
    return [
      { id: 'pv1', emoji: '🔄', xPct: 50, yPct: 50, label: 'Neu filtern' },
      { id: 'pv2', emoji: '💶', xPct: 40, yPct: 58 },
    ];
  }
  if (s === 'qa') {
    return [
      { id: 'qa1', emoji: '✅', xPct: 48, yPct: 48 },
      { id: 'qa2', emoji: '📋', xPct: 58, yPct: 56 },
    ];
  }
  if (s === 'rail' || s === 'bahn') {
    return [
      { id: 'rl1', emoji: '🚆', xPct: 42, yPct: 42, label: 'Bahn' },
      { id: 'rl2', emoji: '🛤️', xPct: 55, yPct: 52 },
      { id: 'rl3', emoji: '🚉', xPct: 48, yPct: 62 },
    ];
  }
  if (s === 'cruise' || s === 'ferry') {
    return [
      { id: 'cr1', emoji: '🚢', xPct: 45, yPct: 58, label: 'Kreuzfahrt' },
      { id: 'cr2', emoji: '⚓', xPct: 58, yPct: 65 },
      { id: 'cr3', emoji: '🌊', xPct: 35, yPct: 70 },
    ];
  }
  return [];
}

function stripPriceHint(sub?: string | null): string | undefined {
  if (!sub) return undefined;
  const t = sub.replace(/buy-?in\s*€?\s*\d+/gi, '').replace(/\d+\s*€[^·]*/gi, '').replace(/\s*·\s*/g, ' · ').trim();
  if (!t || /^[\d€\s·.%]+$/.test(t)) return undefined;
  return t.slice(0, 36);
}

function compareStatusForIndex(i: number, total: number): CompareStatus {
  if (total <= 1) return 'in';
  if (i === 0) return 'in';
  if (i === total - 1) return 'out';
  return 'maybe';
}

function pillsForStage(
  stage: string | null | undefined,
  sparks: ResearchSpark[],
  maxPills: number,
): TheaterPill[] {
  const s = sceneBucket(stage);
  const out: TheaterPill[] = [];
  const seen = new Set<string>();

  const push = (p: TheaterPill) => {
    const k = p.label.toLowerCase();
    if (seen.has(k) || out.length >= maxPills) return;
    seen.add(k);
    out.push(p);
  };

  if (s === 'flights' || s === 'calendar') {
    push({ id: 'flt-dir', label: 'Direktflug', emoji: '✈️', tone: 'flight' });
    for (const sp of sparks) {
      if (!isFlightWish(sp) && sp.kind !== 'flight') continue;
      if (sp.kind === 'flight' && /→/.test(sp.label)) continue;
      push({
        id: sp.id,
        label: /direkt|nonstop/i.test(sp.label) ? sp.label : sp.sub?.includes('Direkt') ? 'Direktflug' : sp.label.slice(0, 18),
        emoji: sp.emoji || '✈️',
        tone: 'flight',
      });
    }
    return out;
  }

  if (s === 'stay' || s === 'transfer') {
    for (const sp of sparks) {
      if (!isAmenityWish(sp)) continue;
      push({ id: sp.id, label: sp.label, emoji: sp.emoji || '🏊', tone: 'stay' });
    }
    return out;
  }

  if (s === 'soft' || s === 'events' || s === 'discover') {
    for (const sp of sparks) {
      if (!isActivityWish(sp)) continue;
      push({ id: sp.id, label: sp.label, emoji: sp.emoji || '✨', tone: 'activity' });
    }
    return out;
  }

  // compare / qa / climate: keine Bottom-Wishlist-Pills
  return out;
}

function inferExtraStage(sparks: ResearchSpark[], activeStage?: string | null): string | null {
  if (activeStage) return activeStage;
  const blob = sparks
    .slice(-6)
    .map((s) => `${s.label} ${s.sub || ''}`)
    .join(' ')
    .toLowerCase();
  if (/kreuzfahrt|cruise|ferry|fähre/.test(blob)) return 'cruise';
  if (/bahn|zug|rail|train|ice|öbb/.test(blob)) return 'rail';
  return null;
}

function collectGeoPoints(sparks: ResearchSpark[]): SparkPin[] {
  const out: SparkPin[] = [];
  for (const s of sparks) {
    const g = sparkLatLng(s);
    if (g) out.push(g);
    if (s.kind === 'flight') {
      const parsed = parseFlightLabel(s.label);
      for (const o of parsed.origins) {
        const a = airportPin(o);
        if (a) out.push(a);
      }
      if (parsed.dest) {
        const d = airportPin(parsed.dest);
        if (d) out.push(d);
      }
    }
  }
  return out;
}

function clampPct(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function distPct(a: { xPct: number; yPct: number }, b: { xPct: number; yPct: number }): number {
  const dx = a.xPct - b.xPct;
  const dy = a.yPct - b.yPct;
  return Math.sqrt(dx * dx + dy * dy);
}

const LABEL_SIDES: PinLabelSide[] = ['below', 'above', 'right', 'left'];

/**
 * Pins entzerren — Ziel: Box-Überlappung (Icon+Label) ≤ 20 % IoU.
 * minDist ≈ 18 % Zentrumsabstand hält typische Pin-Boxen unter dem Threshold.
 */
export function pinBoxOverlapRatio(
  a: { xPct: number; yPct: number },
  b: { xPct: number; yPct: number },
  boxW = 14,
  boxH = 10,
): number {
  const ax0 = a.xPct - boxW / 2;
  const ay0 = a.yPct - boxH / 2;
  const bx0 = b.xPct - boxW / 2;
  const by0 = b.yPct - boxH / 2;
  const ix0 = Math.max(ax0, bx0);
  const iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax0 + boxW, bx0 + boxW);
  const iy1 = Math.min(ay0 + boxH, by0 + boxH);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = boxW * boxH * 2 - inter;
  return union > 0 ? inter / union : 0;
}

export function deconflictPins(pins: TheaterPin[], minDist = 18): TheaterPin[] {
  const maxOverlap = 0.2;
  const out: TheaterPin[] = [];
  for (let i = 0; i < pins.length; i++) {
    const src = pins[i]!;
    let x = src.xPct;
    let y = src.yPct;
    for (let attempt = 0; attempt < 18; attempt++) {
      let clash = false;
      for (const p of out) {
        if (distPct({ xPct: x, yPct: y }, p) < minDist) {
          clash = true;
          break;
        }
        if (pinBoxOverlapRatio({ xPct: x, yPct: y }, p) > maxOverlap) {
          clash = true;
          break;
        }
      }
      if (!clash) break;
      const ang = (i * 2.399 + attempt * 0.95) % (Math.PI * 2);
      const r = minDist * (0.5 + attempt * 0.28);
      x = clampPct(src.xPct + Math.cos(ang) * r, 10, 90);
      y = clampPct(src.yPct + Math.sin(ang) * r * 0.85, 16, 74);
    }
    out.push({
      ...src,
      xPct: x,
      yPct: y,
      labelSide: LABEL_SIDES[i % LABEL_SIDES.length],
    });
  }
  return out;
}

/** Motive weg von Pins; bei vielen Pins Labels streichen / stark ausdünnen. */
export function placeMotifsClearOfPins(
  motifs: TheaterMotif[],
  pins: TheaterPin[],
  maxMotifs = 3,
): TheaterMotif[] {
  if (!motifs.length) return [];
  if (pins.length >= 5) return [];
  const limit = pins.length >= 2 ? Math.min(2, maxMotifs) : maxMotifs;
  const kept: TheaterMotif[] = [];
  for (const m of motifs) {
    if (kept.length >= limit) break;
    if (pins.some((p) => distPct(m, p) < 16 || pinBoxOverlapRatio(m, p) > 0.2)) continue;
    if (kept.some((k) => distPct(m, k) < 14 || pinBoxOverlapRatio(m, k) > 0.2)) continue;
    kept.push({
      ...m,
      label: pins.length > 0 ? undefined : m.label,
    });
  }
  return kept;
}

/** Baut sichtbare Szene aus Sparks + aktivem Stage. */
export function buildTheaterScene(
  sparks: ResearchSpark[],
  opts?: {
    maxPins?: number;
    maxPills?: number;
    maxFlights?: number;
    stage?: string | null;
    weatherHint?: string | null;
  },
): TheaterScene {
  const maxPins = opts?.maxPins ?? 6;
  const maxPills = opts?.maxPills ?? 4;
  const maxFlights = opts?.maxFlights ?? 2;
  const view = resolveTheaterView(collectGeoPoints(sparks));
  const bounds = view.bounds;
  const stageKey = sceneBucket(inferExtraStage(sparks, opts?.stage) || opts?.stage);

  const tempSamples: Array<{ label: string; emoji: string; tempLabel: string }> = [];
  for (const s of sparks) {
    if (s.kind !== 'vibe') continue;
    const blob = `${s.label} ${s.sub || ''}`;
    const m = blob.match(/(-?\d{1,2})\s*–\s*(-?\d{1,2})\s*°|(-?\d{1,2})\s*°/);
    if (!m) continue;
    const tempLabel = m[1] && m[2] ? `${m[1]}–${m[2]}°` : `${m[3]}°`;
    const place = (s.label || '').replace(/\s*\d.*/g, '').trim() || 'Ort';
    tempSamples.push({
      label: place.slice(0, 14),
      emoji: s.emoji || '🌡️',
      tempLabel,
    });
    if (tempSamples.length >= 4) break;
  }

  const pins: TheaterPin[] = [];
  const flights: TheaterFlight[] = [];
  const compareNodes: TheaterCompareNode[] = [];
  const seen = new Set<string>();

  for (const s of sparks) {
    const k = `${s.kind}:${s.label.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);

    if (s.kind === 'flight') {
      if (flights.length < maxFlights) {
        const f = flightFromSpark(s, bounds);
        if (f) flights.push(f);
      }
      continue;
    }

    if (s.kind === 'compare') {
      // nodes later
    }

    if (
      s.kind === 'place' ||
      s.kind === 'stay' ||
      s.kind === 'deal' ||
      s.kind === 'compare'
    ) {
      if (pins.length < maxPins) {
        const pos = pinPos(s, bounds);
        if (!pos) continue;
        const reason =
          stageKey === 'discover' || s.kind === 'place'
            ? stripPriceHint(s.sub) || null
            : s.kind === 'stay'
              ? stripPriceHint(s.sub) || null
              : null;
        pins.push({
          id: s.id,
          label: s.label,
          emoji: s.emoji,
          kind: s.kind,
          xPct: pos.xPct,
          yPct: pos.yPct,
          hasGeo: pos.hasGeo,
          reason,
          sub: s.sub,
          price: s.kind === 'flight' ? extractPriceLabel(s.sub) : null,
        });
      }
    }
  }

  const compareSparks = sparks.filter((s) => s.kind === 'compare' || s.kind === 'place' || s.kind === 'stay');
  const uniqueCompare: ResearchSpark[] = [];
  const ck = new Set<string>();
  for (const s of compareSparks) {
    const key = s.label.toLowerCase();
    if (ck.has(key)) continue;
    ck.add(key);
    uniqueCompare.push(s);
    if (uniqueCompare.length >= 5) break;
  }
  uniqueCompare.forEach((s, i) => {
    const status = compareStatusForIndex(i, uniqueCompare.length);
    const hint = stripPriceHint(s.sub);
    compareNodes.push({
      id: s.id,
      label: s.label,
      emoji: s.emoji || (status === 'out' ? '⬇️' : status === 'in' ? '⭐' : '🔄'),
      hint: hint && !/€|buy/i.test(hint) ? hint : status === 'out' ? 'fällt raus' : status === 'in' ? 'passt stark' : 'Alternative',
      status,
      reason:
        status === 'out'
          ? hint || 'passt weniger'
          : status === 'in'
            ? hint || 'beste Kombi'
            : hint || 'im Rennen',
    });
  });

  const pills = pillsForStage(stageKey, sparks, maxPills);
  let motifs = stageAmbientMotifs(stageKey, opts?.weatherHint, view.region, tempSamples);
  if ((stageKey === 'discover' || stageKey === 'flights') && motifs.length === 0 && pins.length === 0) {
    motifs = [
      { id: 'd1', emoji: '✨', xPct: 40, yPct: 55 },
      { id: 'd2', emoji: '📍', xPct: 55, yPct: 48 },
    ];
  }

  const spaced = deconflictPins(pins);
  // Reason nur am ersten Pin — weniger Text-Wirrwarr
  const cleaned = spaced.map((p, i) => (i === 0 ? p : { ...p, reason: null }));
  // Klima-Stage: Wetter-Icons dürfen Labels behalten; sonst Motive von Pins freiräumen
  motifs =
    stageKey === 'climate'
      ? motifs.slice(0, 4)
      : placeMotifsClearOfPins(motifs, cleaned);

  return { pins: cleaned, flights, pills, motifs, compareNodes, view };
}
