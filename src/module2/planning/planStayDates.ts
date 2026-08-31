/**
 * Hotel-Daten aus Plan-Kontext (Wunsch + Zieltag + Session).
 */

import { parseHotelStayDates, hasExplicitStayDates } from '../../services/concierge/hotelAvailabilityService';
import { offsetDateKey } from '../../utils/dateKeys';
import { usePlanSessionStore } from './planSessionState';

const WEEKDAYS_DE: Record<string, number> = {
  mo: 1,
  montag: 1,
  di: 2,
  dienstag: 2,
  mi: 3,
  mittwoch: 3,
  do: 4,
  donnerstag: 4,
  fr: 5,
  freitag: 5,
  sa: 6,
  samstag: 6,
  so: 0,
  sonntag: 0,
};

function nextWeekdayIso(fromMs: number, weekday: number): string {
  const d = new Date(fromMs);
  d.setHours(12, 0, 0, 0);
  const cur = d.getDay();
  let add = (weekday - cur + 7) % 7;
  if (add === 0 && d.getTime() < fromMs) add = 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

export function planContextBlob(extra?: string | null): string {
  const plan = usePlanSessionStore.getState().plan;
  const parts: string[] = [];
  if (plan?.targetDate) parts.push(`Plan-Tag ${plan.targetDate}`);
  if (plan) {
    for (const w of plan.openWishesQueue) {
      parts.push(`${w.title} ${w.context}`);
    }
    for (const n of plan.fixedNodes) {
      parts.push(
        `${n.title} ${n.location ?? ''} ${n.time ?? ''} ${n.endTime ?? ''}`,
      );
    }
  }
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join(' | ');
}

/**
 * Turnier / Mehrtages-Event: Check-in am Plan-Tag, Checkout = Morgen nach letztem Event-Tag.
 * „bis Samstag“ bei Turnier Do–Sa → Checkout Sonntag.
 */
function inferEventStayWindow(
  blob: string,
  target: string,
): { checkin: string; checkout: string } | null {
  const t = blob.toLowerCase();
  const isEvent =
    /\b(turnier|tennis|wettkampf|meisterschaft|championship|open\b|cup\b)\b/i.test(
      t,
    );
  if (!isEvent) return null;

  const toWd = t.match(
    /\bbis\s+(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\w*/i,
  );
  if (!toWd?.[1]) return null;
  const key =
    Object.keys(WEEKDAYS_DE).find((k) => toWd[1]!.toLowerCase().startsWith(k)) ??
    toWd[1]!.toLowerCase();
  const wd = WEEKDAYS_DE[key];
  if (wd == null) return null;

  const targetMs = new Date(target + 'T12:00:00').getTime();
  if (!Number.isFinite(targetMs)) return null;
  const lastEventDay = nextWeekdayIso(targetMs, wd);
  // Letzte Event-Nacht mitübernachten → Checkout = Tag danach
  const checkout = offsetDateKey(1, new Date(lastEventDay + 'T12:00:00').getTime());
  if (checkout <= target) return null;
  return { checkin: target, checkout };
}

export function parseHotelStayDatesForPlan(
  blob: string,
  dayKey?: string | null,
): { checkin: string; checkout: string } {
  const merged = planContextBlob(blob);
  const parsed = parseHotelStayDates(merged);
  const target =
    dayKey ?? usePlanSessionStore.getState().plan?.targetDate ?? null;
  if (!target) return parsed;

  const eventStay = inferEventStayWindow(merged, target);
  if (eventStay) return eventStay;

  // Kein expliziter Zeitraum vom User → Plan-Tag (nicht Wanduhr-heute)
  if (!hasExplicitStayDates(merged)) {
    return {
      checkin: target,
      checkout: offsetDateKey(1, new Date(target + 'T12:00:00').getTime()),
    };
  }

  // Wenn nur generischer Default (heute→morgen) aber Plan-Tag liegt in der Zukunft → Plan-Tag nutzen
  const today = new Date().toISOString().slice(0, 10);
  const planAhead = target > today;
  const genericTonight =
    parsed.checkin === today && parsed.checkout === offsetDateKey(1);
  if (planAhead && genericTonight) {
    return {
      checkin: target,
      checkout: offsetDateKey(1, new Date(target + 'T12:00:00').getTime()),
    };
  }

  // Lone-Wochentag (= Plan-Tag, 1 Nacht) aber Kontext nennt „bis …“ → Event-Fenster bevorzugen
  const oneNightOnTarget =
    parsed.checkin === target &&
    parsed.checkout ===
      offsetDateKey(1, new Date(target + 'T12:00:00').getTime());
  if (oneNightOnTarget && /\bbis\s+(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/i.test(merged)) {
    const again = inferEventStayWindow(
      `turnier ${merged}`,
      target,
    );
    if (again) return again;
  }

  return parsed;
}
