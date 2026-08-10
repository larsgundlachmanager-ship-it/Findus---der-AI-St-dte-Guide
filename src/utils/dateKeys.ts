/**
 * Datums-/Uhr-Hilfen (früher types/dayPlan — ohne Tagesplan-Store).
 */

/** Plan-Tag rollt um 02:30 — bis dahin zählt die Nacht noch zum Vortag. */
export const PLAN_DAY_ROLLOVER_HOUR = 2;
export const PLAN_DAY_ROLLOVER_MIN = 30;

export function dateKeyFromMs(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone ?? undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

/**
 * Logischer Plan-Tag: 00:00–02:29 gehört noch zum Vortag
 * (Theater→Heim 01:00 = Montag; Start 04:00 = neuer Tag).
 */
export function planDayKeyFromMs(ms: number, timeZone?: string): string {
  const d = new Date(ms);
  const mins = d.getHours() * 60 + d.getMinutes();
  const rollover =
    PLAN_DAY_ROLLOVER_HOUR * 60 + PLAN_DAY_ROLLOVER_MIN;
  if (mins < rollover) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(12, 0, 0, 0);
  return dateKeyFromMs(d.getTime(), timeZone);
}

export function todayDateKey(): string {
  return planDayKeyFromMs(Date.now());
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

/** Morgen / Übermorgen als YYYY-MM-DD aus Systemzeit (Kalendertag, nicht +24h-UTC). */
export function offsetDateKey(days: number, nowMs = Date.now()): string {
  const d = new Date(nowMs);
  // Mittag vermeidet DST-Kanten beim Tageswechsel
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return dateKeyFromMs(d.getTime());
}

const WEEKDAY_RE =
  /\b(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)\b/iu;

const WEEKDAY_INDEX: Record<string, number> = {
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
};

/** Nächstes Vorkommen eines Wochentags (inkl. heute wenn gleich). */
export function nextWeekdayDateKey(
  weekdayDe: string,
  nowMs = Date.now(),
): string | null {
  const idx = WEEKDAY_INDEX[weekdayDe.toLowerCase()];
  if (idx == null) return null;
  const d = new Date(nowMs);
  d.setHours(12, 0, 0, 0);
  const cur = d.getDay();
  const add = (idx - cur + 7) % 7;
  d.setDate(d.getDate() + add);
  return dateKeyFromMs(d.getTime());
}

/** Absolute Datumsangabe: 3.8. / 03.08.2026 / 3. August */
function tryAbsoluteDateKey(text: string, nowMs = Date.now()): string | null {
  const named = text.match(
    /\b(\d{1,2})\.\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(\d{4}))?\b/iu,
  );
  if (named) {
    const months: Record<string, number> = {
      januar: 0,
      februar: 1,
      märz: 2,
      maerz: 2,
      april: 3,
      mai: 4,
      juni: 5,
      juli: 6,
      august: 7,
      september: 8,
      oktober: 9,
      november: 10,
      dezember: 11,
    };
    const day = Number(named[1]);
    const mon = months[named[2]!.toLowerCase()];
    const year = named[3] ? Number(named[3]) : new Date(nowMs).getFullYear();
    if (Number.isFinite(day) && mon != null && day >= 1 && day <= 31) {
      return dateKeyFromMs(new Date(year, mon, day, 12, 0, 0, 0).getTime());
    }
  }
  const num = text.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (num) {
    const day = Number(num[1]);
    const mon = Number(num[2]);
    let year = new Date(nowMs).getFullYear();
    if (num[3]) {
      const y = Number(num[3]);
      year = y < 100 ? 2000 + y : y;
    }
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return dateKeyFromMs(new Date(year, mon - 1, day, 12, 0, 0, 0).getTime());
    }
  }
  return null;
}

/**
 * Relatives/absolutes Datum aus Text — null wenn kein Tagwort/Datum erkennbar.
 * Für Mehr-Tage-Äußerungen: pro Slot-Kontext aufrufen.
 */
export function tryResolveDateKeyFromUserText(
  text: string,
  nowMs = Date.now(),
): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\b(übermorgen|uebermorgen)\b/iu.test(t)) {
    return offsetDateKey(2, nowMs);
  }
  if (
    /\bmorgen\b/iu.test(t) &&
    !/\bguten\s+morgen\b/iu.test(t) &&
    !/\bheut(?:e)?\s+morgen\b/iu.test(t)
  ) {
    return offsetDateKey(1, nowMs);
  }
  if (/\bheute\b/iu.test(t) && !/\bheut(?:e)?\s+morgen\b/iu.test(t)) {
    return dateKeyFromMs(nowMs);
  }
  const abs = tryAbsoluteDateKey(t, nowMs);
  if (abs) return abs;
  const wd = t.match(WEEKDAY_RE)?.[1];
  if (wd) {
    const key = nextWeekdayDateKey(wd, nowMs);
    if (key) return key;
  }
  return null;
}

/**
 * Relatives Datum aus User-Text → YYYY-MM-DD.
 * Injiziert Systemzeit: heute / morgen / Wochentag / Datum.
 * Kein Treffer → heute (Session-Default).
 */
export function resolveDateKeyFromUserText(
  text: string,
  nowMs = Date.now(),
): string {
  return tryResolveDateKeyFromUserText(text, nowMs) ?? dateKeyFromMs(nowMs);
}

/** Block für LLM-Ingestion: absolute Systemzeit + aufgelöste Tage. */
export function planningClockContextBlock(nowMs = Date.now()): string {
  const tz = localTimeZone();
  const iso = new Date(nowMs).toISOString();
  const local = new Date(nowMs).toLocaleString('de-DE', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return [
    `System-Jetzt (UTC ISO): ${iso}`,
    `System-Jetzt (lokal ${tz}): ${local}`,
    `Heute YYYY-MM-DD (Plan-Tag, Rollover 02:30): ${planDayKeyFromMs(nowMs)}`,
    `Kalendertag YYYY-MM-DD: ${dateKeyFromMs(nowMs)}`,
    `Morgen YYYY-MM-DD: ${offsetDateKey(1, nowMs)}`,
    `Übermorgen YYYY-MM-DD: ${offsetDateKey(2, nowMs)}`,
    'Relative Wörter (heute/morgen/übermorgen/Dienstag/3.8.) MÜSSEN in startDate/dayKey und startIso als echte ISO-Zeiten auf diesen Kalender gemappt werden.',
    'Plan-Tag-Grenze 02:30: Aktivitäten bis 02:29 gehören noch zum Vortag; ab 02:30 neuer Tag.',
    'Mehrere Tage in einer Äußerung: JEDER Task bekommt den Tag aus seinem lokalen Kontext (nicht alle auf denselben Tag).',
  ].join('\n');
}

export function clockLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
