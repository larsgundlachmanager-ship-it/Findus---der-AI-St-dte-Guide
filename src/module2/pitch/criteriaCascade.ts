/**
 * Kriterien-Cascade: nacheinander filtern (Dish → View → Outdoor → …),
 * Zwei-Strang: Perfect + Backtrack — Checkliste fulfilled / soft-miss.
 * Kein Orts-Hardcode.
 */

import type { PitchCandidate, PitchCall1Criterion, PitchRequest, PitchWish } from './types';
import { isAtmosphereVibeLabel } from './searchBrief';

export type CascadeStepStatus =
  | 'pass'
  | 'soft_miss'
  | 'fail'
  | 'skip'
  | 'only_one';

export type CascadeStepResult = {
  key: string;
  label: string;
  status: CascadeStepStatus;
  remaining: number;
};

export type CascadeOutcome = {
  /** Speak-Pool (nach Backtrack: oft ≥1–2, Soft-Wünsche ggf. gelockert) */
  pool: PitchCandidate[];
  /** Nur Perfect-Strang (alle angewandten Filter) — kann 0–1 sein */
  perfectPool: PitchCandidate[];
  checklist: CascadeStepResult[];
  /** Kurz für Call-2 / softFailReason — ehrlich + Nachfrage */
  honestyLine: string | null;
  /** Soft-Wünsche, die beim Backtrack fallen gelassen wurden */
  relaxedLabels: string[];
};

function blobOf(c: PitchCandidate): string {
  return `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')} ${c.address ?? ''}`
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function hitsKey(c: PitchCandidate, key: string): boolean {
  const k = key.toLowerCase().trim();
  if (!k) return false;
  const blob = blobOf(c);
  // AYCE: nie substring „all/you/can/eat“ — sonst Soft-Fill mit normalen Restaurants
  if (/all_you_can_eat|\bayce\b|schlemmer|buffet/i.test(k)) {
    try {
      const { scoreAyceEvidence } = require('./hardMatchVerify') as {
        scoreAyceEvidence: (b: string) => number;
      };
      return scoreAyceEvidence(blob) >= 2;
    } catch {
      return /all[\s-]*(?:you|xou)[\s-]*can[\s-]*eat|\bayce\b|flatrate|schlemmer/i.test(
        blob,
      );
    }
  }
  if (blob.includes(k)) return true;
  const parts = k.split(/[\s_/]+/).filter((p) => p.length >= 3);
  return parts.length > 0 && parts.every((p) => blob.includes(p));
}

type Stage = {
  key: string;
  label: string;
  /** hard = Hauptziel; soft = Wunsch (Blick/Budget/…) */
  mode: 'hard' | 'soft';
  test: (c: PitchCandidate) => boolean;
};

function stagesFromRequest(req: PitchRequest): Stage[] {
  const out: Stage[] = [];
  const seen = new Set<string>();
  const pushWish = (w: PitchWish) => {
    const text = String(w.text || '').trim();
    if (!text || text.length < 2) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const vibe = w.kind === 'vibe' || isAtmosphereVibeLabel(text);
    const ayceHard =
      w.kind === 'amenity' &&
      /all_you_can_eat|ayce|buffet|schlemmer/i.test(text);
    out.push({
      key,
      label: text,
      mode: vibe && !ayceHard ? 'soft' : w.hardness === 'must' || ayceHard ? 'hard' : 'soft',
      test: (c) => hitsKey(c, text),
    });
  };
  const wishes = [...(req.wishes ?? [])];
  const order = (w: PitchWish) =>
    w.kind === 'dish' || w.kind === 'cuisine'
      ? 0
      : w.kind === 'amenity'
        ? 1
        : w.kind === 'vibe'
          ? 2
          : 3;
  wishes.sort((a, b) => order(a) - order(b));
  for (const w of wishes) {
    if (w.hardness !== 'must' && w.kind === 'generic') continue;
    if (w.hardness === 'must' || w.kind === 'dish' || w.kind === 'vibe') {
      pushWish(w);
    }
  }
  for (const cr of req.call1Criteria ?? []) {
    const key = String(cr.key || '').trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    if (/naehe|nähe|offen|open|budget|preis|rating|stern/i.test(key)) continue;
    seen.add(key.toLowerCase());
    const vibe =
      isAtmosphereVibeLabel(key) || cr.role === 'nice' || cr.role === 'soft';
    out.push({
      key: key.toLowerCase(),
      label: key,
      mode: vibe || cr.role !== 'must' ? 'soft' : 'hard',
      test: (c) => hitsKey(c, key),
    });
  }
  out.push({
    key: 'open_at_visit',
    label: 'offen zur Besuchszeit',
    mode: 'soft',
    test: (c) => !(c.openNow === false || c.closedOnVisitDay === true),
  });
  out.push({
    key: 'rating_floor',
    label: 'Bewertung ≥ 3,5',
    mode: 'soft',
    test: (c) => c.rating == null || c.rating >= 3.5,
  });
  const budget = String(req.prefs?.budgetHint || '').toLowerCase();
  if (budget && /günstig|guenstig|billig|budget|preiswert|€|euro|\d+/.test(budget)) {
    out.push({
      key: 'budget',
      label: budget.match(/\d+\s*€?/)?.[0]
        ? `Budget ~${budget.match(/\d+/)?.[0]} €`
        : 'Budget',
      mode: 'soft',
      test: (c) => {
        if (c.priceTotalEur == null && c.pricePerNightEur == null) return true;
        const p = c.pricePerNightEur ?? c.priceTotalEur ?? 0;
        const cap = Number(budget.match(/\d+/)?.[0] || 0);
        if (cap > 0 && p > cap) return false;
        if (/günstig|guenstig|billig|preiswert|budget/.test(budget) && p > 180) {
          return false;
        }
        return true;
      },
    });
  }
  return out;
}

function cheapestHint(pool: PitchCandidate[]): string | null {
  let best: number | null = null;
  for (const c of pool) {
    const p = c.pricePerNightEur ?? c.priceTotalEur;
    if (p != null && Number.isFinite(p) && (best == null || p < best)) {
      best = p;
    }
  }
  if (best == null) return null;
  return `Günstigstes Belegtes ≈ ${Math.round(best)} €`;
}

function buildHonestyLine(opts: {
  checklist: CascadeStepResult[];
  pool: PitchCandidate[];
  perfectPool: PitchCandidate[];
  relaxedLabels: string[];
}): string | null {
  const { checklist, pool, perfectPool, relaxedLabels } = opts;
  let humanize = (s: string) => s;
  try {
    const { humanizePitchLabel } = require('./pitchLabelHumanize') as {
      humanizePitchLabel: (s: string) => string;
    };
    humanize = humanizePitchLabel;
  } catch {
    /* soft */
  }
  const misses = checklist
    .filter((s) => s.status === 'soft_miss' || s.status === 'only_one')
    .map((s) => humanize(s.label))
    .filter(Boolean);
  const passes = checklist
    .filter((s) => s.status === 'pass')
    .map((s) => humanize(s.label))
    .filter(Boolean);
  const relaxed = relaxedLabels.map(humanize).filter(Boolean);
  // Radius nur intern für Harvest — nie km-Technik in Speech
  const parts: string[] = [];

  if (perfectPool.length >= 2 && !relaxed.length && !misses.length) {
    return null;
  }

  if (perfectPool.length === 1 && pool.length >= 1) {
    parts.push(
      passes.length
        ? `Nur eine Option erfüllt alles Wichtige (${passes.slice(0, 3).join(', ')}) — die darf vorgeschlagen werden.`
        : 'Nur eine Option erfüllt den Kernwunsch — die darf vorgeschlagen werden.',
    );
  }

  if (relaxed.length) {
    parts.push(
      `Keine perfekte Kombi: ${relaxed.slice(0, 3).join(', ')} gelockert. Hauptziel bleibt${
        passes.length ? ` (${passes.slice(0, 3).join(', ')})` : ''
      }. Specialty: beste belegte Option pitchen — Expand nur intern, nie vorlesen.`,
    );
  } else if (misses.length && passes.length) {
    parts.push(
      `Hauptziel ok (${passes.slice(0, 3).join(', ')}). Noch offen: ${misses
        .slice(0, 3)
        .join(', ')}.`,
    );
  } else if (misses.length && !passes.length) {
    parts.push(
      `Kernwunsch noch nicht belegt (${misses.slice(0, 3).join(', ')}) — beste belegte Alternative pitchen (ohne Such-Prozess/km-Ringe vorlesen).`,
    );
  }

  const budgetMiss = checklist.some(
    (s) =>
      (s.status === 'soft_miss' || s.status === 'only_one') &&
      /budget|preis|€|euro/i.test(s.key + s.label),
  );
  if (budgetMiss) {
    const cheap = cheapestHint(pool);
    if (cheap) {
      parts.push(
        `${cheap} — ehrlich nennen; keine „weiter suchen?“-Nachfrage, finale Option pitchen.`,
      );
    }
  }

  if (parts.length) {
    parts.push(
      'Speech: Lücke kurz (Preis/Blick), dann Option(en). VERBOTEN: km-Ringe, Datensatz/Expand-Meta, „nichts in 10 km“, „weiter suchen?“.',
    );
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * Cascade Zwei-Strang:
 * - Hard: Treffer → übernehmen; 0 → soft_miss, Pool behalten (Hauptziel fehlt).
 * - Soft Perfect: ≥2 → übernehmen; genau 1 → übernehmen (only_one, vorschlagen ok);
 *   0 → soft_miss + Backtrack (Filter weglassen, vorherigen Pool behalten).
 * Speak-Pool = nach Backtrack; perfectPool = ohne gelockerte Soft-Stufen.
 */
export function applyCriteriaCascade(
  req: PitchRequest,
  poolIn: PitchCandidate[],
): CascadeOutcome {
  let pool = [...poolIn];
  let perfectPool = [...poolIn];
  const checklist: CascadeStepResult[] = [];
  const relaxedLabels: string[] = [];

  if (!pool.length) {
    return {
      pool,
      perfectPool,
      checklist,
      honestyLine: 'Keine Kandidaten im Datensatz.',
      relaxedLabels,
    };
  }

  for (const stage of stagesFromRequest(req)) {
    const matchedSpeak = pool.filter(stage.test);
    const matchedPerfect = perfectPool.filter(stage.test);

    if (stage.mode === 'hard') {
      if (matchedSpeak.length >= 1) {
        pool = matchedSpeak;
        perfectPool = matchedPerfect.length ? matchedPerfect : matchedSpeak;
        checklist.push({
          key: stage.key,
          label: stage.label,
          status: 'pass',
          remaining: pool.length,
        });
      } else {
        checklist.push({
          key: stage.key,
          label: stage.label,
          status: 'soft_miss',
          remaining: pool.length,
        });
      }
      continue;
    }

    // Soft — Perfect-Strang
    if (matchedPerfect.length >= 2) {
      perfectPool = matchedPerfect;
    } else if (matchedPerfect.length === 1) {
      perfectPool = matchedPerfect;
    }
    // Soft — Speak-Strang mit Backtrack
    if (matchedSpeak.length >= 2) {
      pool = matchedSpeak;
      checklist.push({
        key: stage.key,
        label: stage.label,
        status: 'pass',
        remaining: pool.length,
      });
    } else if (matchedSpeak.length === 1) {
      // Eine Perfect-Option reicht — vorschlagen, zweite ggf. aus breiterem Pool
      pool = matchedSpeak;
      checklist.push({
        key: stage.key,
        label: stage.label,
        status: 'only_one',
        remaining: 1,
      });
    } else {
      // 0 Treffer → Schritt zurück: Soft-Filter weglassen
      relaxedLabels.push(stage.label);
      checklist.push({
        key: stage.key,
        label: stage.label,
        status: 'soft_miss',
        remaining: pool.length,
      });
    }
  }

  // Wenn Perfect nur 1 und Speak auch nur 1: ok.
  // Wenn Perfect 0 Soft-Passes aber Speak hat Kandidaten aus Hard: ok.
  // Zweite Option: wenn Speak nur 1 und Input hatte mehr → optional zweiten aus Vor-Soft
  // (bereits via soft_miss Backtrack im Pool der letzten Hard-Stufe).
  if (pool.length === 1 && poolIn.length > 1 && relaxedLabels.length) {
    const ids = new Set(
      pool.map((c) => c.placeId || c.name.toLowerCase()),
    );
    for (const c of poolIn) {
      if (pool.length >= 2) break;
      const id = c.placeId || c.name.toLowerCase();
      if (ids.has(id)) continue;
      // Nur Kandidaten die alle Hard-Stufen der Checklist passieren würden
      const hardOk = checklist
        .filter((s) => s.status === 'pass' || s.status === 'only_one')
        .every((s) => {
          const stage = stagesFromRequest(req).find((x) => x.key === s.key);
          if (!stage || stage.mode !== 'hard') return true;
          return stage.test(c);
        });
      if (!hardOk) continue;
      pool.push(c);
      ids.add(id);
    }
  }

  const honestyLine = buildHonestyLine({
    checklist,
    pool,
    perfectPool,
    relaxedLabels,
  });

  return { pool, perfectPool, checklist, honestyLine, relaxedLabels };
}

export function formatCascadeForPrompt(checklist: CascadeStepResult[]): string {
  if (!checklist.length) return '';
  return [
    'CRITERIA_CHECKLIST (Zwei-Strang — Perfect vs Backtrack):',
    ...checklist.map(
      (s) => `- ${s.label}: ${s.status} (übrig ${s.remaining})`,
    ),
    'Speech: Soft-Miss/only_one kurz (Preis/Blick); dann finale Option(en). VERBOTEN: km-Ringe, Expand/Datensatz-Meta, „weiter suchen?“.',
  ].join('\n');
}

/** Unused import guard — criteria type used via PitchRequest */
export type { PitchCall1Criterion };
