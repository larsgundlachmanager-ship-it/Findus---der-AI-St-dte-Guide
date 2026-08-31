/**
 * Logik-Knoten — Fast-Lane mergen, Euro, Gap/Ripple light, API-Fails.
 */

import type {
  AgentResult,
  LogicNodeOutput,
  Module2ActionButton,
  MoneyAmount,
} from '../types';
import type { FuturePlanState } from '../timeline/futurePlanState';
import { charmForApiFail, type ApiFailKind } from '../safety/hardApiFail';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';

/** Rough FX table — expand later; always output EUR */
const FX_TO_EUR: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.05,
  DKK: 0.134,
};

export function normalizeToEuro(
  amount: number,
  currency: string,
): MoneyAmount {
  const c = (currency || 'EUR').toUpperCase();
  const rate = FX_TO_EUR[c] ?? 1;
  const amountEur = Math.round(amount * rate * 100) / 100;
  return { amount, currency: c, amountEur };
}

function detectCollision(plan: FuturePlanState): string | null {
  const timed = plan.stops
    .filter((s) => s.plannedStartMs != null && s.plannedEndMs != null)
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1]!;
    const cur = timed[i]!;
    if ((cur.plannedStartMs ?? 0) < (prev.plannedEndMs ?? 0)) {
      return `Konflikt: ${prev.title} überlappt mit ${cur.title}. Soll ich ${cur.title} verschieben oder streichen?`;
    }
  }
  return null;
}

export function runLogicNode(opts: {
  results: AgentResult[];
  futurePlan: FuturePlanState;
  offline?: boolean;
}): LogicNodeOutput {
  const warnings: string[] = [];
  const bullets: string[] = [];
  const buttons: Module2ActionButton[] = [];
  const moneyEur: MoneyAmount[] = [];

  const fast = opts.results.filter((r) => !r.slowLane);
  const parts: string[] = [];

  for (const r of fast) {
    if (!r.ok && r.error?.code.startsWith('api_fail_')) {
      const kind = r.error.code.replace('api_fail_', '') as ApiFailKind;
      parts.push(charmForApiFail(kind));
      warnings.push(r.error.code);
    } else {
      parts.push(r.draftText);
    }
    if (r.bullets) bullets.push(...r.bullets);
    if (r.buttons) buttons.push(...r.buttons);
    if (r.money) {
      for (const m of r.money) {
        moneyEur.push(normalizeToEuro(m.amount, m.currency));
      }
    }
  }

  const collision = detectCollision(opts.futurePlan);
  const skipPlanHints = opts.results.some(
    (r) =>
      r.meta?.amenityNav === true ||
      r.meta?.autoStartNav === true ||
      r.meta?.forceAutoNav === true ||
      r.meta?.route_or_nav === true ||
      typeof r.meta?.destLat === 'number',
  );
  if (collision && !skipPlanHints) {
    warnings.push('plan_collision');
    parts.push(collision);
  }

  // Gap-Filler hint bei >45 Min Lücke (soft) — nie bei expliziter Nav/Amenity
  if (!skipPlanHints) {
    const timed = opts.futurePlan.stops
      .filter((s) => s.plannedEndMs != null)
      .sort((a, b) => (a.plannedEndMs ?? 0) - (b.plannedEndMs ?? 0));
    for (let i = 1; i < timed.length; i++) {
      const gapMin =
        ((timed[i]!.plannedStartMs ?? 0) - (timed[i - 1]!.plannedEndMs ?? 0)) /
        60000;
      if (gapMin > 45) {
        warnings.push('gap_over_45');
        parts.push(
          `Zwischen ${timed[i - 1]!.title} und ${timed[i]!.title} sind über fünfundvierzig Minuten frei — ich kann etwas Sinnvolles einfügen.`,
        );
        break;
      }
    }
  }

  let spokenDraft = parts.filter(Boolean).join(' ').trim();
  if (!spokenDraft) {
    spokenDraft =
      'FAKTEN: leer. FLOW: ehrlich knapper Status → Alternative oder gezielte Rückfrage nur bei Blockade.';
    warnings.push('empty_merge');
  }

  // Euro nur als Fakt-Hint ergänzen — Synthese formuliert frei
  if (moneyEur.length > 0 && !/euro|€/i.test(spokenDraft)) {
    const sum = moneyEur.reduce((s, m) => s + m.amountEur, 0);
    spokenDraft = `${spokenDraft} [Preis-Hint: etwa ${Math.round(sum)} Euro]`;
  }

  return {
    spokenDraft,
    bullets: uniqueTrim(bullets, 3),
    buttons: dedupeButtons(buttons).slice(0, 4),
    moneyEur,
    warnings,
    offline: opts.offline,
  };
}

function uniqueTrim(items: string[], max: number): string[] {
  const out: string[] = [];
  for (const b of items) {
    const t = b.replace(/\s+/g, ' ').trim();
    if (!t || out.includes(t)) continue;
    // max 1 Zeile
    out.push(t.length > 42 ? `${t.slice(0, 39).replace(/\s+\S*$/, '').trim()}…` : t);
    if (out.length >= max) break;
  }
  return out;
}

function dedupeButtons(buttons: Module2ActionButton[]): Module2ActionButton[] {
  const seen = new Set<string>();
  const out: Module2ActionButton[] = [];
  for (const b of buttons) {
    if (!b.payload) continue;
    const label = clampButtonLabel(b.label);
    const key = `${label}:${JSON.stringify(b.payload)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...b, label });
  }
  return out;
}

export function clampButtonLabel(label: string): string {
  return shortenActionLabel(label || '• Aktion') || '• OK';
}
