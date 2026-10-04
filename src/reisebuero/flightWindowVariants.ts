/**
 * Zweites Magazin / Flugfenster-Varianten: Prefer vs Soft als eigene Optionen.
 */

import type { ReiseLedger, ReiseOption } from './types';
import { weekdayFromDateKey } from './whenFlex';
import { classifyOptionBrief } from './optionPolicy';

function cloneOpt(o: ReiseOption, idSuffix: string, titleBit: string): ReiseOption {
  return {
    ...o,
    id: `${o.id}_${idSuffix}`,
    title: `${o.title} · ${titleBit}`.slice(0, 72),
    decisionNotes: [
      ...(o.decisionNotes ?? []).filter((d) => !/^Fenster:/i.test(d)),
      `Fenster: ${titleBit}`,
    ],
  };
}

function hasSoftFlex(ledger: ReiseLedger): boolean {
  const flex = ledger.whenFlex?.value;
  if (!flex) return false;
  return Boolean(
    (flex.outbound?.softWeekdays?.length ?? 0) > 0 ||
      (flex.outbound?.softDateKeys?.length ?? 0) > 0 ||
      (flex.return?.softWeekdays?.length ?? 0) > 0 ||
      (flex.return?.softDateKeys?.length ?? 0) > 0 ||
      flex.outbound?.earliestHour != null,
  );
}

function hasPreferFlex(ledger: ReiseLedger): boolean {
  const flex = ledger.whenFlex?.value;
  return Boolean(flex?.outbound?.preferWeekday || flex?.return?.preferWeekday);
}

/** Kurzlabel aus decisionNotes für Karten-UI. */
export function flightWindowBadge(opt: ReiseOption): string | null {
  const note = (opt.decisionNotes ?? []).find((d) => /^Fenster:/i.test(d));
  if (!note) return null;
  return note.replace(/^Fenster:\s*/i, '').trim() || 'Flugfenster';
}

/**
 * Wenn whenFlex Prefer+Soft gesetzt:
 * Prefer-Fenster und Soft-Fenster als zwei Pakete anbieten (mind. 2).
 * Spezifischer Brief / nur 1 Stadt → Fenster verdoppeln; offene Briefs behalten Städte dahinter.
 */
export function expandFlightWindowOptions(
  options: ReiseOption[],
  ledger: ReiseLedger,
): ReiseOption[] {
  if (!hasPreferFlex(ledger) || !hasSoftFlex(ledger)) {
    return options;
  }

  // Schon ≥2 Optionen mit Fenster-Notes → nicht nochmal verdoppeln
  const already = options.filter((o) => (o.decisionNotes ?? []).some((d) => /^Fenster:/i.test(d)));
  if (already.length >= 2) return options;

  const base = options[0];
  if (!base) return options;

  const flex = ledger.whenFlex!.value!;
  const preferLabel = [
    flex.outbound?.preferWeekday ? `Los ${flex.outbound.preferWeekday.toUpperCase()}` : null,
    flex.return?.preferWeekday ? `Rück ${flex.return.preferWeekday.toUpperCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const softWd = [
    ...(flex.outbound?.softWeekdays ?? []),
    ...(flex.return?.softWeekdays ?? []),
  ];
  const softHour =
    flex.outbound?.earliestHour != null ? ` ab ${flex.outbound.earliestHour}` : '';
  const softLabel = softWd.length
    ? `Soft ${[...new Set(softWd)].map((w) => w.toUpperCase()).join('/')}${softHour}`.trim()
    : softHour
      ? `Soft${softHour}`
      : 'Soft-Fenster';

  const prefer = cloneOpt(base, 'pref', preferLabel || 'Prefer');
  const soft = cloneOpt(base, 'soft', softLabel);

  // Prefer leicht höher matchen
  prefer.matchScore = Math.min(99, (base.matchScore || 70) + 3);
  soft.matchScore = Math.max(40, (base.matchScore || 70) - 2);

  const grain = classifyOptionBrief(ledger);
  const rest = options.slice(1);

  // Spezifisch / nur eine Stadt: Prefer + Soft sind die beiden Magazin-Karten
  if (options.length === 1 || grain === 'specific') {
    return rest.length ? [prefer, soft, ...rest] : [prefer, soft];
  }

  // Offen/mittel: Prefer + Soft zuerst, dann weitere Städte
  return [prefer, soft, ...rest];
}

/** Ob eine Option zum Prefer-Wochentag passt (für Score/Filter). */
export function optionHitsPreferOutbound(opt: ReiseOption, ledger: ReiseLedger): boolean {
  const prefer = ledger.whenFlex?.value?.outbound?.preferWeekday;
  if (!prefer) return true;
  const tr = opt.transports?.find((t) => t.kind === 'flight' || t.kind === 'train');
  const key = tr?.departDateKey || ledger.dateStart?.value;
  return weekdayFromDateKey(key) === prefer;
}
