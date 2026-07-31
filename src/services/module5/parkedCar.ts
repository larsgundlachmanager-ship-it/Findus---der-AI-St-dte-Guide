/**
 * Geparktes Auto merken — Kosten, Startzeit, Mindest-/Max-Dauer.
 */

import * as FileSystem from 'expo-file-system';
import { useDayPlanStore } from '../../store/useDayPlanStore';
import { clockLabel, todayDateKey, uid } from '../../types/dayPlan';

export type ParkedCarSession = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  parkedAtMs: number;
  /** €/h wenn bekannt */
  pricePerHourEur: number | null;
  /** Mindestparkdauer (Min), z. B. Ticket */
  minDurationMin: number | null;
  /** Ticket/Max bis (absolut) */
  paidUntilMs: number | null;
  notes?: string;
  active: boolean;
};

const PATH = `${FileSystem.documentDirectory}findus-parked-car.json`;
let session: ParkedCarSession | null = null;
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    session = JSON.parse(raw) as ParkedCarSession;
  } catch {
    session = null;
  }
}

function persist(): void {
  void FileSystem.writeAsStringAsync(
    PATH,
    JSON.stringify(session),
  ).catch(() => {});
}

export async function getParkedCar(): Promise<ParkedCarSession | null> {
  await hydrate();
  return session?.active ? session : null;
}

export function getParkedCarSync(): ParkedCarSession | null {
  void hydrate();
  return session?.active ? session : null;
}

export function rememberParkedCar(opts: {
  lat: number;
  lng: number;
  name?: string;
  pricePerHourEur?: number | null;
  minDurationMin?: number | null;
  paidUntilMs?: number | null;
  notes?: string;
}): ParkedCarSession {
  void hydrate();
  session = {
    id: uid('park'),
    lat: opts.lat,
    lng: opts.lng,
    name: opts.name?.trim() || 'Mein Auto',
    parkedAtMs: Date.now(),
    pricePerHourEur: opts.pricePerHourEur ?? null,
    minDurationMin: opts.minDurationMin ?? null,
    paidUntilMs: opts.paidUntilMs ?? null,
    notes: opts.notes,
    active: true,
  };
  persist();
  syncParkedCarIntoDayPlan();
  return session;
}

export function clearParkedCar(): void {
  if (session) {
    session = { ...session, active: false };
    persist();
  }
  const dateKey = todayDateKey();
  const day = useDayPlanStore.getState().getDay(dateKey);
  for (const it of day.items.filter((i) => i.kind === 'parking')) {
    useDayPlanStore.getState().markItemDone(dateKey, it.id);
  }
}

export function syncParkedCarIntoDayPlan(dateKey = todayDateKey()): void {
  void hydrate();
  if (!session?.active) return;
  const store = useDayPlanStore.getState();
  const day = store.ensureDay(dateKey);
  const existing = day.items.find(
    (i) => i.kind === 'parking' && i.status === 'planned',
  );
  const cost =
    session.pricePerHourEur != null
      ? ` · ~${session.pricePerHourEur.toFixed(2)} €/h`
      : '';
  const min =
    session.minDurationMin != null
      ? ` · min. ${session.minDurationMin} Min`
      : '';
  const until = session.paidUntilMs
    ? ` · bezahlt bis ${clockLabel(session.paidUntilMs)}`
    : '';
  const item = {
    id: existing?.id ?? uid('park'),
    kind: 'parking' as const,
    title: `Auto geparkt: ${session.name}${cost}`,
    startMs: session.parkedAtMs,
    endMs: session.paidUntilMs,
    timed: true,
    status: 'planned' as const,
    lat: session.lat,
    lng: session.lng,
    placeName: session.name,
    source: 'module5' as const,
    carryOver: true,
    sortOrder: 50,
    notes: `Seit ${clockLabel(session.parkedAtMs)}${min}${until}. Vor Ablauf zurück / verlängern.`,
    meta: {
      pricePerHourEur: session.pricePerHourEur,
      minDurationMin: session.minDurationMin,
      paidUntilMs: session.paidUntilMs,
      parkedAtMs: session.parkedAtMs,
    },
  };
  store.upsertItem(dateKey, item);

  // Reminder-Punkt 20 Min vor Ticket-Ende
  if (session.paidUntilMs && session.paidUntilMs > Date.now()) {
    const remindAt = session.paidUntilMs - 20 * 60_000;
    store.upsertItem(dateKey, {
      id: uid('parkrem'),
      kind: 'buffer',
      title: 'Parkticket prüfen / zurück zum Auto',
      startMs: remindAt,
      endMs: session.paidUntilMs,
      timed: true,
      status: 'planned',
      lat: session.lat,
      lng: session.lng,
      hardDeadline: true,
      source: 'module5',
      sortOrder: 55,
      notes: 'Damit du nichts verpasst — Ticket läuft ab.',
    });
  }
}

/** Parse aus User-Text: „Auto geparkt, 2 Euro die Stunde, Ticket bis 16 Uhr“ */
export function ingestParkedCarFromText(
  text: string,
  coords?: { lat: number; lng: number } | null,
): boolean {
  if (
    !/\b(auto\s+geparkt|parker?\s+(?:das\s+)?auto|parkplatz|habe\s+(?:das\s+)?auto\s+geparkt|parken\s+hier)\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  // GPS optional — ohne Koordinaten trotzdem merken (Kosten/Ticket)
  const lat = coords?.lat ?? 0;
  const lng = coords?.lng ?? 0;

  const priceM = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:€|euro)\s*(?:pro|\/|die\s+)?\s*(?:h|std|stunde)/iu,
  );
  const pricePerHourEur = priceM
    ? Number(priceM[1].replace(',', '.'))
    : null;

  const minM = text.match(
    /(?:mindestens|mind\.?|min(?:imal)?)\s*(\d{1,3})\s*min/iu,
  );
  const minDurationMin = minM ? Number(minM[1]) : null;

  const untilM = text.match(
    /(?:bis|bezahlt\s+bis|ticket\s+bis)\s*(?:um\s+)?(\d{1,2})[:.](\d{2})/iu,
  );
  let paidUntilMs: number | null = null;
  if (untilM) {
    const d = new Date();
    d.setHours(Number(untilM[1]), Number(untilM[2]), 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    paidUntilMs = d.getTime();
  }

  rememberParkedCar({
    lat,
    lng,
    pricePerHourEur,
    minDurationMin,
    paidUntilMs,
    notes: text.slice(0, 120),
  });
  return true;
}

/** Leave-by: rechtzeitig zum Auto zurück (Ticket / Mindestzeit). */
export function parkedCarConstraintMs(now = Date.now()): {
  mustReturnByMs: number | null;
  minStayUntilMs: number | null;
  speechHint: string | null;
} {
  const p = getParkedCarSync();
  if (!p) {
    return { mustReturnByMs: null, minStayUntilMs: null, speechHint: null };
  }
  const minStayUntilMs =
    p.minDurationMin != null
      ? p.parkedAtMs + p.minDurationMin * 60_000
      : null;
  const mustReturnByMs = p.paidUntilMs
    ? p.paidUntilMs - 15 * 60_000
    : null;
  let speechHint: string | null = null;
  if (mustReturnByMs && mustReturnByMs - now < 45 * 60_000) {
    speechHint = `Dein Parkticket läuft um ${clockLabel(p.paidUntilMs!)} ab — spätestens ${clockLabel(mustReturnByMs)} zurück zum Auto.`;
  } else if (minStayUntilMs && now < minStayUntilMs) {
    speechHint = `Mindestparkdauer bis ${clockLabel(minStayUntilMs)} — früher wegholen lohnt oft nicht.`;
  }
  return { mustReturnByMs, minStayUntilMs, speechHint };
}
