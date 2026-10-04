/**
 * whenFlex — Prefer vs Soft Zeitfenster (Do ab 13 / Di > Mi).
 * Struktur für Parse + Package-Score. Kein Wortlaut.
 */

import type { ReiseLedger, WeekdayDe, WhenFlexLeg, WhenFlexSpec } from './types';

const WD_FULL: Record<string, WeekdayDe> = {
  montag: 'mo',
  dienstag: 'di',
  mittwoch: 'mi',
  donnerstag: 'do',
  freitag: 'fr',
  samstag: 'sa',
  sonntag: 'so',
};

const WD_FROM_DATE: WeekdayDe[] = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];

export function weekdayFromName(raw: string | null | undefined): WeekdayDe | null {
  if (!raw) return null;
  const k = raw.toLowerCase().trim();
  return WD_FULL[k] ?? null;
}

export function weekdayFromDateKey(dateKey: string | null | undefined): WeekdayDe | null {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}/.test(dateKey)) return null;
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  return WD_FROM_DATE[d.getDay()] ?? null;
}

export function hourFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = String(iso).match(/T(\d{2}):/);
  if (m) return Number(m[1]);
  const clock = String(iso).match(/^(\d{1,2}):/);
  if (clock) return Number(clock[1]);
  return null;
}

/**
 * Score 0–12 für ein Bein: Prefer-Tag > Soft-Tag (mit earliestHour) > sonst.
 * Gleiches Preisniveau: Prefer gewinnt; Soft nur wenn Prefer fehlt.
 */
export function scoreWhenFlexLeg(
  leg: WhenFlexLeg | null | undefined,
  dateKey: string | null | undefined,
  departHour: number | null = null,
): number {
  if (!leg) return 0;
  const wd = weekdayFromDateKey(dateKey);
  if (!wd) return 0;

  if (leg.preferDateKey && dateKey?.slice(0, 10) === leg.preferDateKey.slice(0, 10)) {
    return 12;
  }
  if (leg.preferWeekday && wd === leg.preferWeekday) {
    return 12;
  }

  const softs = leg.softWeekdays ?? [];
  const softDates = leg.softDateKeys ?? [];
  const onSoftDate = softDates.some((d) => dateKey?.slice(0, 10) === d.slice(0, 10));
  const onSoftWd = softs.includes(wd);
  if (onSoftDate || onSoftWd) {
    const earliest = leg.earliestHour;
    if (earliest != null && departHour != null && departHour < earliest) {
      return 2; // Soft-Tag, aber zu früh
    }
    return 7;
  }
  return 0;
}

/**
 * Trade-off: früher Prefer-Rück vs. später Soft mit mehr Zeit am Ziel.
 * Positiv = Soft gewinnt trotz Prefer-Tag (mehr Zielzeit).
 */
export function returnTimeTradeoffBonus(opts: {
  preferHour: number | null;
  softHour: number | null;
  /** Stunden mehr am Ziel durch Soft-Rück. */
  extraHoursAtDest?: number | null;
}): number {
  const pref = opts.preferHour;
  const soft = opts.softHour;
  if (pref == null || soft == null) return 0;
  // Prefer sehr früh (≤7), Soft angenehm (≥12) → Soft belohnen
  if (pref <= 7 && soft >= 12) return 5;
  const extra = opts.extraHoursAtDest ?? soft - pref + 24;
  if (extra >= 8 && pref <= 8) return 4;
  if (extra >= 4 && pref <= 9) return 2;
  return 0;
}

export function scoreOptionWhenFlex(
  ledger: ReiseLedger,
  opts: {
    outboundDateKey?: string | null;
    outboundHour?: number | null;
    returnDateKey?: string | null;
    returnHour?: number | null;
  },
): number {
  const flex = ledger.whenFlex?.value;
  if (!flex) {
    // Legacy: nur departAfterHour
    const after = ledger.departAfterHour?.value;
    if (after != null && opts.outboundHour != null) {
      return opts.outboundHour >= after ? 4 : 0;
    }
    return 0;
  }
  let score = 0;
  score += scoreWhenFlexLeg(flex.outbound, opts.outboundDateKey, opts.outboundHour ?? null);
  score += scoreWhenFlexLeg(flex.return, opts.returnDateKey, opts.returnHour ?? null);
  // Cap 24 = Prefer+Prefer; Soft darf Prefer nicht aufs gleiche Plateau kappen
  return Math.min(24, score);
}

function mergeLeg(a: WhenFlexLeg | null | undefined, b: WhenFlexLeg): WhenFlexLeg {
  const soft = [...new Set([...(a?.softWeekdays ?? []), ...(b.softWeekdays ?? [])])];
  const softDates = [...new Set([...(a?.softDateKeys ?? []), ...(b.softDateKeys ?? [])])];
  return {
    preferWeekday: b.preferWeekday ?? a?.preferWeekday ?? null,
    softWeekdays: soft.length ? soft : undefined,
    earliestHour: b.earliestHour ?? a?.earliestHour ?? null,
    preferDateKey: b.preferDateKey ?? a?.preferDateKey ?? null,
    softDateKeys: softDates.length ? softDates : undefined,
  };
}

export function mergeWhenFlex(
  prev: WhenFlexSpec | null | undefined,
  patch: WhenFlexSpec,
): WhenFlexSpec {
  return {
    outbound:
      patch.outbound || prev?.outbound
        ? mergeLeg(prev?.outbound, patch.outbound || {})
        : null,
    return:
      patch.return || prev?.return
        ? mergeLeg(prev?.return, patch.return || {})
        : null,
  };
}

/**
 * Heuristik aus Freitext — Prefer vs Soft trennen.
 * Beispiele: „am liebsten Freitag; Do ab 13 geht auch“ · „Rück Di schöner als Mi“.
 */
export function parseWhenFlexFromText(t: string): WhenFlexSpec | null {
  const out: WhenFlexSpec = {};
  let hit = false;

  // Prefer outbound: am liebsten / lieber / ideal Freitag (los/hin/fliegen)
  const preferOut = t.match(
    /\b(?:am\s+(?:liebsten|geilsten)|lieber|ideal(?:erweise)?|schön(?:er)?|schoen(?:er)?)\s+(?:am\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?:\s+(?:los|hin|fliegen|fahren|starten|raus))?/iu,
  );
  const preferOut2 = t.match(
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+(?:wäre|waere|wäre\s+schön|waere\s+schoen|am\s+liebsten).{0,24}(?:los|hin|fliegen|fahren|starten)?/iu,
  );
  const po = weekdayFromName(preferOut?.[1] || preferOut2?.[1]);
  if (po) {
    out.outbound = { preferWeekday: po, softWeekdays: [] };
    hit = true;
  }

  // Soft outbound: Do ab 13 geht auch / Donnerstag ab 13 Uhr möglich
  const softOut = t.match(
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+(?:ab\s+(\d{1,2})(?::\d{2})?\s*(?:uhr\s+)?)?(?:geht\s+auch|auch\s+ok|auch\s+okay|möglich|moeglich|wäre\s+auch|waere\s+auch|schaffen\s+wir|könnten\s+wir|koennten\s+wir)/iu,
  );
  if (softOut?.[1]) {
    const wd = weekdayFromName(softOut[1]);
    const hour = softOut[2] != null ? Number(softOut[2]) : null;
    if (wd) {
      out.outbound = mergeLeg(out.outbound, {
        softWeekdays: [wd],
        earliestHour: hour != null && hour >= 0 && hour <= 23 ? hour : null,
      });
      hit = true;
    }
  }

  // Return prefer: zurück / Rück Di schöner als Mi
  const retPrefer = t.match(
    /\b(?:zurück|zurueck|rückreise|rueckreise|heimflug|abreise).{0,40}(?:am\s+)?(?:liebsten\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?:\s+(?:schöner|schoener|besser|lieber))?(?:\s+als\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))?/iu,
  );
  const retPrefer2 = t.match(
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+(?:schöner|schoener|besser|lieber)\s+als\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag).{0,24}(?:zurück|zurueck|rück|heim)?/iu,
  );
  const rp = weekdayFromName(retPrefer?.[1] || retPrefer2?.[1]);
  const softRet = weekdayFromName(retPrefer?.[2] || retPrefer2?.[2]);
  if (rp) {
    out.return = mergeLeg(out.return, {
      preferWeekday: rp,
      softWeekdays: softRet ? [softRet] : [],
    });
    hit = true;
  } else if (softRet) {
    out.return = mergeLeg(out.return, { softWeekdays: [softRet] });
    hit = true;
  }

  // „Versuch Freitag, schauen aber auch Donnerstag“
  const tryAlso = t.match(
    /\b(?:versuch(?:en)?|ziel|planen).{0,24}(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag).{0,48}(?:auch|aber).{0,24}(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/iu,
  );
  if (tryAlso?.[1] && tryAlso[2]) {
    const pref = weekdayFromName(tryAlso[1]);
    const soft = weekdayFromName(tryAlso[2]);
    if (pref) {
      out.outbound = mergeLeg(out.outbound, {
        preferWeekday: pref,
        softWeekdays: soft ? [soft] : [],
      });
      hit = true;
    }
  }

  return hit ? out : null;
}
