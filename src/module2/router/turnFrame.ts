/**
 * Call-1 Turn-Frame — der Polier-Auftrag.
 * Ein kleines JSON: Stadt, Zeiten, Must-Haves, Worker. Kein zweites Gehirn danach.
 */

import { classifyJob } from '../jobs/classifyJob';
import { orchestrateUtterance } from '../reboot/pipeline/orchestrateSlots';
import { classifyUtteranceFamily } from '../kernel/utteranceFamily';
import {
  destinationCityFromUtterance,
  sameFoldedCity,
  userWantsDestinationDay,
} from '../planning/planDestinationCity';
import { looksLikeModul5PlanUtterance } from '../planning/planUtteranceGate';
import type { ManagerSession } from './types';

export type TurnWhenKind = 'now' | 'clock' | 'day';

export type TurnWhen = {
  kind: TurnWhenKind;
  at?: string | null;
  dateKey?: string | null;
  label?: string | null;
};

export type TurnWorker =
  | 'plan'
  | 'dining'
  | 'nav'
  | 'transit'
  | 'flight'
  | 'hotel'
  | 'pitch'
  | 'chat'
  | 'm1'
  | 'weather';

export type TurnWorkTask = {
  id: string;
  worker: TurnWorker;
  brief: string;
  destCity?: string | null;
  startIsGps?: boolean;
  when?: TurnWhen | null;
  mustHaves?: string[];
  blueprint?: string | null;
  dependsOn?: string | null;
};

export type TurnFrame = {
  session: ManagerSession;
  threadId: string | null;
  subject: string | null;
  destCity: string | null;
  startIsGps: boolean;
  when: TurnWhen[];
  mustHaves: string[];
  thinkAhead: string[];
  tasks: TurnWorkTask[];
  bridge: string | null;
};

const WORKERS: TurnWorker[] = [
  'plan',
  'dining',
  'nav',
  'transit',
  'flight',
  'hotel',
  'pitch',
  'chat',
  'm1',
  'weather',
];

function uniq(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const k = x.replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

function asWorker(v: unknown): TurnWorker | null {
  const s = String(v || '').trim().toLowerCase();
  return WORKERS.includes(s as TurnWorker) ? (s as TurnWorker) : null;
}

function asWhenKind(v: unknown): TurnWhenKind | null {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'now' || s === 'clock' || s === 'day') return s;
  return null;
}

function asHm(v: unknown): string | null {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function sanitizeCity(
  raw: string | null | undefined,
  gpsCity?: string | null,
): string | null {
  const named = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!named || named.length < 2) return null;
  if (/^(hier|gps|start|nähe|naehe)$/i.test(named)) return null;
  if (gpsCity && sameFoldedCity(named, gpsCity)) return null;
  return named.slice(0, 48);
}

function parseWhen(raw: unknown): TurnWhen | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = asWhenKind(o.kind);
  if (!kind) return null;
  return {
    kind,
    at: asHm(o.at),
    dateKey:
      typeof o.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dateKey)
        ? o.dateKey
        : null,
    label:
      typeof o.label === 'string' ? o.label.replace(/\s+/g, ' ').trim().slice(0, 40) : null,
  };
}

function parseWorkTask(raw: unknown, i: number): TurnWorkTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const worker = asWorker(o.worker);
  const brief = String(o.brief || '').replace(/\s+/g, ' ').trim();
  if (!worker || brief.length < 3) return null;
  const when = parseWhen(o.when);
  const mustHaves = Array.isArray(o.mustHaves)
    ? uniq(o.mustHaves.map((x) => String(x).slice(0, 48))).slice(0, 6)
    : [];
  return {
    id: String(o.id || `w${i + 1}`).slice(0, 40),
    worker,
    brief: brief.slice(0, 220),
    destCity:
      typeof o.destCity === 'string' ? o.destCity.replace(/\s+/g, ' ').trim().slice(0, 48) : null,
    startIsGps: o.startIsGps !== false,
    when,
    mustHaves,
    blueprint:
      typeof o.blueprint === 'string' ? o.blueprint.slice(0, 40) : null,
    dependsOn:
      typeof o.dependsOn === 'string' ? o.dependsOn.slice(0, 40) : null,
  };
}

export function emptyTurnFrame(partial?: Partial<TurnFrame>): TurnFrame {
  return {
    session: partial?.session ?? 'new',
    threadId: partial?.threadId ?? null,
    subject: partial?.subject ?? null,
    destCity: partial?.destCity ?? null,
    startIsGps: partial?.startIsGps ?? true,
    when: partial?.when ?? [],
    mustHaves: partial?.mustHaves ?? [],
    thinkAhead: partial?.thinkAhead ?? [],
    tasks: partial?.tasks ?? [],
    bridge: partial?.bridge ?? null,
  };
}

export function frameHasWorker(
  frame: TurnFrame | null | undefined,
  worker: TurnWorker,
): boolean {
  return Boolean(frame?.tasks.some((t) => t.worker === worker));
}

export function frameOwnsDayPlan(frame: TurnFrame | null | undefined): boolean {
  if (frameHasWorker(frame, 'flight')) return false;
  return frameHasWorker(frame, 'plan');
}

function heuristicWhen(text: string, nowMs = Date.now()): TurnWhen[] {
  const t = text.replace(/\s+/g, ' ').trim();
  const out: TurnWhen[] = [];
  if (/\bjetzt\b/i.test(t)) out.push({ kind: 'now', label: 'jetzt' });

  // Uhr SSOT — gleiche Parser wie Flug-Backend (HH:mm klar)
  try {
    const { extractClockHm } = require('../../services/flights/flightTripIntent') as {
      extractClockHm: (s: string) => string | null;
    };
    const clock = extractClockHm(t);
    if (clock) {
      out.push({ kind: 'clock', at: clock, label: clock });
    }
  } catch {
    const clocks = [...t.matchAll(/\b(?:um\s+)?(\d{1,2})(?::(\d{2}))?\s*uhr\b/giu)];
    for (const m of clocks.slice(0, 3)) {
      const h = Number(m[1]);
      const min = m[2] != null ? Number(m[2]) : 0;
      if (h > 23 || min > 59) continue;
      const at = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      out.push({ kind: 'clock', at, label: at });
    }
  }

  try {
    const {
      dateKeyFromMs,
      offsetDateKey,
      nextWeekdayDateKey,
    } = require('../../utils/dateKeys') as {
      dateKeyFromMs: (ms: number, tz?: string) => string;
      offsetDateKey: (days: number, nowMs?: number) => string;
      nextWeekdayDateKey: (de: string, nowMs?: number) => string | null;
    };
    if (/\bübermorgen|uebermorgen\b/iu.test(t)) {
      out.push({
        kind: 'day',
        label: 'übermorgen',
        dateKey: offsetDateKey(2, nowMs),
      });
    } else if (
      /\bmorgen\b/iu.test(t) &&
      !/\bguten\s+morgen\b/iu.test(t) &&
      !/\bheut(?:e)?\s+morgen\b/iu.test(t)
    ) {
      out.push({
        kind: 'day',
        label: 'morgen',
        dateKey: offsetDateKey(1, nowMs),
      });
    } else if (/\bheute\b/iu.test(t)) {
      out.push({
        kind: 'day',
        label: 'heute',
        dateKey: dateKeyFromMs(nowMs, 'Europe/Berlin'),
      });
    } else {
      const wd = t.match(
        /\b(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)\b/iu,
      );
      if (wd?.[1]) {
        const key = nextWeekdayDateKey(wd[1], nowMs);
        out.push({
          kind: 'day',
          label: wd[1],
          dateKey: key,
        });
      }
    }
    // Weiches Abend/Mittag ohne Uhr — Tag behalten, kein Fake-HH:mm erfinden
    const softEvening = /\b((heute\s+)?abend|tonight|dinner|abendessen)\b/iu.test(t);
    const softNoon = /\b((heute\s+)?mittag|lunch)\b/iu.test(t);
    const softMorning = /\b((heute\s+)?frühstück|fruehstueck|morgens)\b/iu.test(t);
    const hasClock = out.some((w) => w.kind === 'clock' && w.at);
    const hasDay = out.some((w) => w.kind === 'day' && w.dateKey);
    if (!hasClock && (softEvening || softNoon || softMorning)) {
      const label = softEvening ? 'abend' : softNoon ? 'mittag' : 'früh';
      if (hasDay) {
        out.forEach((w) => {
          if (w.kind === 'day' && w.dateKey && !w.label) w.label = label;
          else if (w.kind === 'day' && w.dateKey && softEvening && !/abend/i.test(String(w.label))) {
            w.label = `${w.label || ''} ${label}`.trim();
          }
        });
      } else {
        out.push({
          kind: 'day',
          label,
          dateKey: dateKeyFromMs(nowMs, 'Europe/Berlin'),
        });
      }
    }
  } catch {
    const day = t.match(
      /\b(morgen|heute|sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)\b/iu,
    );
    if (day) out.push({ kind: 'day', label: day[1] });
  }
  return out.slice(0, 4);
}

/**
 * Zeit-SSOT: LLM-when + Heuristik zusammenführen.
 * - Vorhandene User-Uhr/dateKey behalten
 * - Fehlende dateKey/clock aus Heuristik nachziehen (Pitch/Plan/Flug gleich)
 * - Keine Fake-Uhr erfinden; dateKey auf clock-Einträge spiegeln wenn beides da
 */
export function hardenWhenSlots(
  llmWhen: TurnWhen[],
  heuristicWhenSlots: TurnWhen[],
): TurnWhen[] {
  let when = (llmWhen.length ? llmWhen : heuristicWhenSlots).map((w) => ({
    ...w,
  }));
  if (!when.length && heuristicWhenSlots.length) {
    when = heuristicWhenSlots.map((w) => ({ ...w }));
  }

  const hDate = heuristicWhenSlots.find(
    (w) => typeof w.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.dateKey!),
  );
  const hClock = heuristicWhenSlots.find((w) => w.kind === 'clock' && w.at);
  const hSoftDay = heuristicWhenSlots.find(
    (w) =>
      w.kind === 'day' &&
      w.dateKey &&
      /abend|mittag|früh|frueh/i.test(String(w.label || '')),
  );

  const hasDateKey = when.some(
    (w) => typeof w.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.dateKey!),
  );
  const hasClock = when.some((w) => w.kind === 'clock' && w.at);

  if (!hasDateKey && hDate) {
    when = [...when.filter((w) => !(w.kind === 'day' && !w.at)), hDate];
  }
  if (hClock?.at) {
    // Deterministische Uhr aus Text schlägt LLM-Rätselraten
    when = [
      ...when.filter((w) => w.kind !== 'clock'),
      {
        kind: 'clock' as const,
        at: hClock.at,
        label: hClock.label || hClock.at,
        dateKey: hClock.dateKey ?? hDate?.dateKey ?? null,
      },
    ];
  } else if (!hasClock && heuristicWhenSlots.some((w) => w.kind === 'clock')) {
    when = [...when, ...heuristicWhenSlots.filter((w) => w.kind === 'clock')];
  } else if (!hasClock && hSoftDay && !when.some((w) => w.kind === 'day' && w.dateKey)) {
    when = [...when, hSoftDay];
  }

  // dateKey auf clock spiegeln (visitAtMs / Leave-by brauchen beides oft zusammen)
  const dateKey =
    when.find(
      (w) => typeof w.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.dateKey!),
    )?.dateKey ?? null;
  if (dateKey) {
    when = when.map((w) =>
      w.kind === 'clock' && w.at && !w.dateKey ? { ...w, dateKey } : w,
    );
  }

  // Dedup kind+at/dateKey
  const seen = new Set<string>();
  const out: TurnWhen[] = [];
  for (const w of when) {
    const key = `${w.kind}|${w.at || ''}|${w.dateKey || ''}|${w.label || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= 4) break;
  }
  return out;
}

/** Call-1 → Backend/Call-2: eine klare Abflug-/Termin-Uhr HH:mm. */
export function resolveFrameClockHm(
  frame: TurnFrame | null | undefined,
): string | null {
  if (!frame) return null;
  const taskClock = frame.tasks
    .map((t) => t.when)
    .find((w) => w?.kind === 'clock' && w.at);
  if (taskClock?.at) return taskClock.at;
  const w = frame.when.find((x) => x.kind === 'clock' && x.at);
  return w?.at ?? null;
}

/** Call-1 → Backend/Call-2: Kalendertag YYYY-MM-DD. */
export function resolveFrameDateKey(
  frame: TurnFrame | null | undefined,
): string | null {
  if (!frame) return null;
  const fromTask = frame.tasks
    .map((t) => t.when)
    .find(
      (w) =>
        w &&
        typeof w.dateKey === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(w.dateKey),
    );
  if (fromTask?.dateKey) return fromTask.dateKey;
  const w = frame.when.find(
    (x) =>
      typeof x.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.dateKey),
  );
  return w?.dateKey ?? null;
}

/** Kompakter Slot-Block für Call 2 / Pitch / Plan. */
export function formatCall1WhenSlotsForPrompt(
  frame: TurnFrame | null | undefined,
): string {
  if (!frame) return '';
  const dateKey = resolveFrameDateKey(frame);
  const clockHm = resolveFrameClockHm(frame);
  const dayLabel =
    frame.when.find((w) => w.kind === 'day')?.label ||
    frame.tasks.map((t) => t.when).find((w) => w?.kind === 'day')?.label ||
    null;
  if (!dateKey && !clockHm && !dayLabel) return '';
  return [
    '=== CALL1_WHEN (verbindlich — nicht neu raten) ===',
    dateKey ? `dateKey: ${dateKey}` : 'dateKey: —',
    clockHm ? `clockHm: ${clockHm}` : 'clockHm: —',
    dayLabel ? `dayLabel: ${dayLabel}` : '',
    'Backend und Call 2 nutzen genau diese Werte. Fehlt clockHm → nachfragen, nichts erfinden.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Offline-Fallback, falls Call-1 kein Frame liefert.
 * GPS-Stadt wird nie Ziel, wenn der Satz eine andere Stadt nennt.
 */
export function heuristicTurnFrame(
  userText: string,
  gpsCity?: string | null,
  opts?: { session?: ManagerSession; threadId?: string | null; subject?: string | null; bridge?: string | null },
): TurnFrame {
  const text = userText.replace(/\s+/g, ' ').trim();
  const destCity = sanitizeCity(
    destinationCityFromUtterance(text, gpsCity),
    gpsCity,
  );
  const job = classifyJob(text);
  const flight = classifyUtteranceFamily(text).family === 'flight';
  const dayPlan =
    !flight &&
    (userWantsDestinationDay(text) || looksLikeModul5PlanUtterance(text));
  const hotel = job.jobId === 'stay_search';
  const dining =
    job.jobId === 'dining_hard_match' || job.jobId === 'dining_open';
  const nav = job.jobId === 'nav_route';

  const when = heuristicWhen(text);
  const mustHaves = job.mustHaves.slice(0, 8);
  const tasks: TurnWorkTask[] = [];
  const startIsGps = Boolean(destCity) || nav;

  if (flight) {
    tasks.push({
      id: 'flight',
      worker: 'flight',
      brief: text.slice(0, 160),
      destCity,
      startIsGps: true,
      when: when[0] ?? null,
      mustHaves,
      blueprint: 'flight_leave_by',
    });
  } else if (dayPlan) {
    tasks.push({
      id: 'plan',
      worker: 'plan',
      brief: destCity
        ? `Tagesplan in ${destCity}; GPS nur Start`
        : 'Tagesplan aus dieser Äußerung',
      destCity,
      startIsGps: true,
      when: when[0] ?? null,
      mustHaves,
    });
    if (destCity) {
      tasks.push({
        id: 'anreise',
        worker: 'transit',
        brief: `Anreise vom Standort nach ${destCity}`,
        destCity,
        startIsGps: true,
        when: when.find((w) => w.kind === 'clock') ?? when[0] ?? null,
        dependsOn: null,
      });
    }
    if (dining || /\b(frühstück|fruehstueck|essen|pann(?:en)?fisch|restaurant)\b/iu.test(text)) {
      tasks.push({
        id: 'dining',
        worker: 'dining',
        brief: destCity
          ? `Essen/Frühstück in ${destCity} nach Ankunft`
          : 'Essen laut Must-Haves',
        destCity,
        startIsGps: false,
        mustHaves,
        dependsOn: destCity ? 'anreise' : 'plan',
      });
    }
  } else if (hotel) {
    tasks.push({
      id: 'hotel',
      worker: 'hotel',
      brief: text.slice(0, 160),
      destCity,
      startIsGps: !destCity,
      when: when[0] ?? null,
      mustHaves,
      blueprint: 'hotel',
    });
  } else if (dining) {
    tasks.push({
      id: 'dining',
      worker: 'dining',
      brief: text.slice(0, 160),
      destCity,
      startIsGps: !destCity,
      when: when[0] ?? null,
      mustHaves,
      blueprint: 'dining',
    });
  } else if (nav) {
    tasks.push({
      id: 'nav',
      worker: 'nav',
      brief: text.slice(0, 160),
      destCity,
      startIsGps: true,
      when: when[0] ?? null,
    });
  }

  const thinkAhead: string[] = [];
  if (flight) {
    thinkAhead.push(
      'Uhrzeit fehlt → fragen, wann genau. Nächsten Verkehrsflughafen. Rückwärts vom Abflug: Check-in, Security, Gate. Uber zuerst (Vorbestellen), ÖPNV als zweite Option. Kein aktuell-nachts für morgigen Start. Wecker nur nach Frage. Nach Hinflug-Bestätigung Hotel im Ziel autonom.',
    );
  }
  if (destCity && dayPlan) {
    thinkAhead.push(
      `GPS ist Start; Ziel ist ${destCity}. „Los um …“ = Abfahrt, keine Aktivität am Standort.`,
    );
    if (/\b(frühstück|fruehstueck)\b/iu.test(text)) {
      thinkAhead.push(`Frühstück nach Ankunft in ${destCity}.`);
    }
  }

  const orch = orchestrateUtterance(text);
  if (
    orch.jobs.includes('weather_outfit') &&
    !tasks.some((t) => t.worker === 'weather')
  ) {
    tasks.push({
      id: 'weather',
      worker: 'weather',
      brief: 'Wetter und Outfit, belegt',
      destCity,
    });
  }
  if (
    orch.jobs.includes('nav_route') &&
    !tasks.some((t) => t.worker === 'nav')
  ) {
    tasks.push({
      id: 'nav',
      worker: 'nav',
      brief: 'Fahrzeit / Route',
      destCity,
      startIsGps: true,
    });
  }
  if (
    orch.jobs.includes('fact_number') &&
    !tasks.some((t) => t.id === 'fact')
  ) {
    tasks.push({
      id: 'fact',
      worker: 'm1',
      brief: 'Belegte Zahl, keine Timeline',
    });
  }
  const extra: Array<{ id: string; worker: TurnWorker; brief: string }> = [];
  if (orch.jobs.includes('transit_live')) {
    extra.push({ id: 'transit', worker: 'transit', brief: 'ÖPNV ab GPS' });
  }
  if (orch.jobs.includes('dining_open') || orch.jobs.includes('dining_hard_match')) {
    extra.push({ id: 'dining', worker: 'dining', brief: 'Essen / Pitch' });
  }
  if (orch.jobs.includes('stay_search')) {
    extra.push({ id: 'hotel', worker: 'hotel', brief: 'Unterkunft Must-Haves' });
  }
  if (orch.jobs.includes('poi_identify') || orch.jobs.includes('sight_recommend')) {
    extra.push({ id: 'pitch', worker: 'pitch', brief: 'Ort / Tour' });
  }
  for (const e of extra) {
    if (!tasks.some((t) => t.worker === e.worker || t.id === e.id)) {
      tasks.push({ ...e, destCity });
    }
  }
  for (const h of orch.thinkAhead) {
    if (!thinkAhead.includes(h)) thinkAhead.push(h);
  }

  return emptyTurnFrame({
    session: opts?.session ?? 'new',
    threadId: opts?.threadId ?? null,
    subject: opts?.subject ?? (destCity || job.jobId),
    destCity,
    startIsGps,
    when,
    mustHaves,
    thinkAhead,
    tasks: tasks.slice(0, 8),
    bridge: opts?.bridge ?? null,
  });
}

export function parseTurnFrameFromLlm(
  parsed: Record<string, unknown> | null | undefined,
  gpsCity?: string | null,
): TurnFrame | null {
  if (!parsed) return null;
  const blob =
    parsed.frame && typeof parsed.frame === 'object'
      ? (parsed.frame as Record<string, unknown>)
      : parsed;
  const workRaw = Array.isArray(blob.work)
    ? blob.work
    : Array.isArray(blob.tasks) &&
        blob.tasks.some(
          (x) => x && typeof x === 'object' && 'worker' in (x as object),
        )
      ? blob.tasks
      : [];
  const destCity = sanitizeCity(
    typeof blob.destCity === 'string' ? blob.destCity : null,
    gpsCity,
  );
  const when = Array.isArray(blob.when)
    ? blob.when.map(parseWhen).filter((w): w is TurnWhen => Boolean(w)).slice(0, 4)
    : [];
  const mustHaves = Array.isArray(blob.mustHaves)
    ? uniq(blob.mustHaves.map((x) => String(x).slice(0, 48))).slice(0, 8)
    : [];
  const thinkAhead = Array.isArray(blob.thinkAhead)
    ? blob.thinkAhead.map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 3)
    : [];
  const tasks = workRaw
    .map(parseWorkTask)
    .filter((t): t is TurnWorkTask => Boolean(t))
    .slice(0, 4)
    .map((t) => ({
      ...t,
      destCity: sanitizeCity(t.destCity, gpsCity) || destCity,
    }));
  const hasAny =
    Boolean(destCity) ||
    tasks.length > 0 ||
    mustHaves.length > 0 ||
    when.length > 0 ||
    thinkAhead.length > 0;
  if (!hasAny) return null;
  return emptyTurnFrame({
    destCity,
    startIsGps: blob.startIsGps !== false,
    when,
    mustHaves,
    thinkAhead,
    tasks,
  });
}

/** LLM-Frame ist SSOT — außer Flug-Leave-by vs Plan-Diebstahl / Restflug im Tagesplan. */
export function mergeTurnFrame(
  llm: TurnFrame | null,
  heuristic: TurnFrame,
): TurnFrame {
  if (!llm) return heuristic;
  const destCity = llm.destCity || heuristic.destCity;

  let tasksSource = llm.tasks.length ? llm.tasks : heuristic.tasks;
  // Leave-by: Heuristik-Flug schlägt LLM, das fälschlich nur „plan“ liefert
  if (
    frameHasWorker(heuristic, 'flight') &&
    !frameOwnsDayPlan(heuristic) &&
    !frameHasWorker(llm, 'flight')
  ) {
    tasksSource = heuristic.tasks;
  } else if (
    frameOwnsDayPlan(heuristic) &&
    frameHasWorker(llm, 'flight')
  ) {
    const stripped = tasksSource.filter((t) => t.worker !== 'flight');
    tasksSource = stripped.length ? stripped : heuristic.tasks;
  }

  const tasks = tasksSource.map((t) => ({
    ...t,
    destCity: t.destCity || destCity,
  }));

  // Zeit-SSOT für Pitch/Plan/Flug/alle: Heuristik füllt fehlende dateKey/clock nach
  const when = hardenWhenSlots(
    llm.when.length ? llm.when : [],
    heuristic.when,
  );

  return emptyTurnFrame({
    session: llm.session || heuristic.session,
    threadId: llm.threadId || heuristic.threadId,
    subject: llm.subject || heuristic.subject,
    destCity,
    startIsGps: llm.startIsGps ?? heuristic.startIsGps,
    when,
    mustHaves: llm.mustHaves.length
      ? llm.mustHaves
      : heuristic.mustHaves,
    thinkAhead: llm.thinkAhead.length ? llm.thinkAhead : heuristic.thinkAhead,
    tasks,
    bridge: llm.bridge || heuristic.bridge,
  });
}

export function formatTurnFrameForPlanPrompt(frame: TurnFrame): string {
  const whenSlots = formatCall1WhenSlotsForPrompt(frame);
  const lines = [
    'CALL-1 AUFTRAG (verbindlich — nicht neu auslegen, nur ausführen):',
    `destCity: ${frame.destCity || 'null'}`,
    `startIsGps: ${frame.startIsGps ? 'true' : 'false'}`,
    `mustHaves: ${frame.mustHaves.join(', ') || '—'}`,
    `when: ${
      frame.when
        .map((w) => {
          const parts = [
            w.kind,
            w.dateKey || null,
            w.at || null,
            w.label || null,
          ].filter(Boolean);
          return parts.join('/');
        })
        .join(', ') || '—'
    }`,
    whenSlots,
    `thinkAhead: ${frame.thinkAhead.join(' | ') || '—'}`,
    'work:',
    ...frame.tasks.map(
      (t) =>
        `- ${t.id} worker=${t.worker} dest=${t.destCity || frame.destCity || '—'} gpsStart=${t.startIsGps ? 'yes' : 'no'} :: ${t.brief}`,
    ),
    'GPS-Pack ist NUR Start. destinationCity MUSS destCity sein, wenn gesetzt.',
    '„Los um …“ = Abfahrt vom GPS, keine Aktivität in der Startstadt.',
  ];
  return lines.filter(Boolean).join('\n');
}
