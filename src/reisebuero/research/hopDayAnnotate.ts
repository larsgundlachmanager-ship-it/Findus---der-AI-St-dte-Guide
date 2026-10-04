/**
 * Multi-City: Tag-Titel + Zug-Legs zwischen Hop-Städten.
 */
import type { DayPlan, DayBlock } from '../types';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

function weekdayForDayKey(dayKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dayKey)) return null;
  return WD[new Date(`${dayKey.slice(0, 10)}T12:00:00`).getDay()] ?? null;
}

/** Nächte → Tag-Index-Zuordnung (letzte Stadt füllt Rest). */
export function assignHopCitiesToDays(
  dayCount: number,
  hopStops: { city: string; nights?: number | null }[] | null | undefined,
): string[] {
  if (!hopStops?.length || dayCount <= 0) return [];
  const assignment: string[] = [];
  for (const stop of hopStops) {
    const n = Math.max(1, stop.nights ?? 1);
    for (let i = 0; i < n; i++) assignment.push(stop.city);
  }
  while (assignment.length < dayCount) {
    assignment.push(hopStops[hopStops.length - 1]!.city);
  }
  return assignment.slice(0, dayCount);
}

export function annotateDayPlansWithHopStops(
  days: DayPlan[],
  hopStops: { city: string; nights?: number | null }[] | null | undefined,
): DayPlan[] {
  if (!hopStops?.length || !days?.length) return days;
  const assignment = assignHopCitiesToDays(days.length, hopStops);
  return days.map((d, i) => {
    const city = assignment[i];
    const prev = i > 0 ? assignment[i - 1] : null;
    const wd = d.weekdayLabel || weekdayForDayKey(d.dayKey);
    let blocks: DayBlock[] = [...(d.blocks ?? [])];

    // Stadtwechsel → Zug-Block vorne, falls noch keiner da
    if (prev && city && prev !== city) {
      const hasRail = blocks.some((b) => /^(zug|bahn|ice|rail)/i.test(b.title));
      if (!hasRail) {
        blocks = [
          {
            id: `hop_rail_${i}_${prev}_${city}`.replace(/\s+/g, '_').slice(0, 48),
            title: 'Zug',
            detail: `${prev} → ${city}`,
            time: '10:00',
          },
          ...blocks,
        ];
      }
    }

    // Titel: Wochentag · Stadt · Rest (ohne doppelte Stadt)
    const headBits = [wd, city].filter(Boolean);
    const restTitle = (d.title || '')
      .split('·')
      .map((s) => s.trim())
      .filter((s) => s && s !== wd && s !== city && !(city && s.includes(city)))
      .join(' · ');
    const title = [...headBits, restTitle].filter(Boolean).join(' · ') || d.title;

    return {
      ...d,
      weekdayLabel: wd ?? d.weekdayLabel ?? null,
      title,
      blocks,
    };
  });
}
