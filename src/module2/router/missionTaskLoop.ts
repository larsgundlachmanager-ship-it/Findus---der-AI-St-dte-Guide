/**
 * Mission Task-Loop SSOT
 *
 * Ziel → inventiere Tasks → herleiten → nur Blocker fragen → Tasks später nachlegen.
 *
 * Struktur-Blaupause — kein Dialog-Skript. Wortlaut frei.
 */

import type { Call1WorkItem } from './call1TaskBrief';
import type { AuftragMemory } from './missionAuftragMemory';

export type MissionTaskLoopInput = {
  userText: string;
  wish?: string | null;
  work: Call1WorkItem[];
  /** Sticky Auftrag (optional) */
  auftrag?: AuftragMemory | null;
  /** Schon gesetzte Ask (Taxi-Blocker etc.) */
  existingAskBack?: string | null;
  /** Slots aus Follow-through */
  flightTime?: string | null;
  luggage?: string | null;
  accessLeg?: string | null;
};

export type MissionTaskLoopResult = {
  wish: string;
  work: Call1WorkItem[];
  /** Was ohne Nachfrage aus Kontext/Text sitzt */
  derived: string[];
  /** Echte Blocker — max. einer wird Ask */
  blockers: string[];
  askBack: string | null;
  /** Für Author-Intent / Call-1 */
  loopIntent: string;
  promotedIds: string[];
  deferredIds: string[];
};

function extractClockFromText(text: string): string | null {
  try {
    const { extractClockHm } = require('../../services/flights/flightTripIntent') as {
      extractClockHm: (s: string) => string | null;
    };
    return extractClockHm(text);
  } catch {
    const m = text.match(/\b(?:um\s+)?(\d{1,2}(?::\d{2})?)\s*uhr\b/iu);
    return m?.[1] ? `${m[1]}` : null;
  }
}

function extractDestHint(text: string): string | null {
  const m = text.match(
    /\b(?:nach|zum|zur)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+)?)/u,
  );
  return m?.[1]?.slice(0, 40) ?? null;
}

function extractDateHint(text: string): string | null {
  if (/\b(morgen|übermorgen|uebermorgen)\b/iu.test(text)) return 'morgen/übermorgen';
  if (/\b(heute|heute\s+abend)\b/iu.test(text)) return 'heute';
  if (/\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu.test(text)) {
    return 'Wochentag genannt';
  }
  return null;
}

function looksLikeFlightTaxiGoal(text: string, wish: string): boolean {
  const blob = `${text} ${wish}`;
  return (
    /\b(flug|fliegen|flieger|abflug|flughafen|airport)\b/iu.test(blob) &&
    /\b(taxi|uber|bolt|pünktlich|puenktlich|vorbestell)\b/iu.test(blob)
  );
}

function isFlightish(w: Call1WorkItem): boolean {
  return (
    w.worker === 'flight' ||
    /^ft_taxi_flight|chain_flight|origin_access$/i.test(w.id) ||
    /\bflug|leave-?by|abflug\b/iu.test(w.brief)
  );
}

function isTaxiish(w: Call1WorkItem): boolean {
  return (
    w.worker === 'taxi' ||
    w.worker === 'transit' ||
    /taxi|uber|transfer|ft_taxi/i.test(w.id) ||
    /\btaxi|uber|deep-?link\b/iu.test(w.brief)
  );
}

/**
 * Abhängige Tasks → later solange Pflicht-Slot fehlt; Slot da → promote now.
 */
export function applyLaterPromote(opts: {
  work: Call1WorkItem[];
  flightTimeReady: boolean;
  accessPending: boolean;
}): {
  work: Call1WorkItem[];
  promotedIds: string[];
  deferredIds: string[];
} {
  const promotedIds: string[] = [];
  const deferredIds: string[] = [];
  const byId = new Map(opts.work.map((w) => [w.id, w]));

  const work = opts.work.map((w) => {
    const next = { ...w };
    // Anreise vor Taxi wenn nötig
    if (opts.accessPending && isTaxiish(next) && next.id !== 'origin_access') {
      if (next.executeWhen !== 'later' && next.executeWhen !== 'on_confirm') {
        deferredIds.push(next.id);
      }
      next.executeWhen = 'later';
      if (!next.dependsOn && byId.has('origin_access')) {
        next.dependsOn = 'origin_access';
      } else if (!next.dependsOn) {
        const flight = opts.work.find((x) => isFlightish(x));
        if (flight) next.dependsOn = flight.id;
      }
      return next;
    }

    if (isTaxiish(next) && looksLikeDependsOnFlight(next, opts.work)) {
      if (opts.flightTimeReady) {
        if (next.executeWhen === 'later' || next.executeWhen === 'on_confirm') {
          promotedIds.push(next.id);
        }
        next.executeWhen = 'now';
      } else {
        if (next.executeWhen === 'now') deferredIds.push(next.id);
        next.executeWhen = 'later';
      }
    }
    return next;
  });

  return { work, promotedIds, deferredIds };
}

function looksLikeDependsOnFlight(
  w: Call1WorkItem,
  all: Call1WorkItem[],
): boolean {
  if (w.dependsOn) {
    const dep = all.find((x) => x.id === w.dependsOn);
    if (dep && isFlightish(dep)) return true;
  }
  return isTaxiish(w) && all.some((x) => isFlightish(x));
}

/**
 * Nur echte Blocker — Gepäck = Chips (kein Text-Ask), Origin = herleiten.
 */
export function pickLoopBlockers(opts: {
  userText: string;
  wish: string;
  flightTime?: string | null;
  luggage?: string | null;
  accessLeg?: string | null;
  auftrag?: AuftragMemory | null;
  flightTaxiGoal: boolean;
}): string[] {
  const out: string[] = [];
  const clock =
    opts.flightTime ||
    extractClockFromText(opts.userText) ||
    opts.auftrag?.known?.find((k) => /Abflugzeit=/i.test(k));

  if (opts.flightTaxiGoal && !clock) {
    out.push('Abflugzeit oder Flugnummer');
  }

  if (
    opts.flightTaxiGoal &&
    opts.accessLeg === 'needed'
  ) {
    out.push('Anreise zum Abflugort (schon da / Bahn / Hotel)');
  }

  // Auftrag stillNeed — Gepäck/Link rausfiltern (Chips / Kontrolldistanz)
  for (const n of opts.auftrag?.stillNeed ?? []) {
    if (/gepäck|gepaeck|hand|aufgabe/i.test(n)) continue;
    if (/buchungs|deep-?link|belegen/i.test(n)) continue;
    if (/startflughafen|origin|abflugstadt herleiten/i.test(n)) continue;
    if (!out.some((x) => x.slice(0, 20) === n.slice(0, 20))) out.push(n);
  }

  return out.slice(0, 3);
}

/** Struktureller Ask — eine Frage, kein Skript-Zwang. */
export function askBackForBlockers(blockers: string[]): string | null {
  if (!blockers.length) return null;
  const first = blockers[0]!;
  if (/Abflugzeit|Flugnummer/i.test(first)) {
    return 'Wann geht dein Flug — Uhrzeit oder Flugnummer?';
  }
  if (/Anreise/i.test(first)) {
    return 'Bist du schon am Abflugort, oder Bahn/Hotel Vornacht?';
  }
  if (/wo\/was essen|Richtung/i.test(first)) {
    return 'Wonach soll die Reservierung gehen — Richtung oder Ort?';
  }
  // Generisch strukturiert, nicht Ambiguity-Meta
  return `Kurz noch: ${first}?`;
}

export function formatTaskLoopIntent(opts: {
  wish: string;
  derived: string[];
  blockers: string[];
  deferredIds: string[];
  promotedIds: string[];
}): string {
  return [
    'Task-Loop: Ziel → inventiere Tasks → herleiten → nur Blocker fragen → Tasks später nachlegen',
    `Ziel=${opts.wish.slice(0, 120)}`,
    opts.derived.length
      ? `Hergeleitet=${opts.derived.join('; ')}`
      : 'Hergeleitet=noch offen — selbst versuchen',
    opts.blockers.length
      ? `NurBlocker=${opts.blockers.join('; ')}`
      : 'NurBlocker=keine — weiterarbeiten',
    opts.deferredIds.length
      ? `Später=${opts.deferredIds.join(',')}`
      : null,
    opts.promotedIds.length
      ? `JetztNachgelegt=${opts.promotedIds.join(',')}`
      : null,
    'Nie Permission/Ambiguity; Root behalten bis Musts sitzen',
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 520);
}

/**
 * Kanonische Schleife auf inventierter Work anwenden.
 */
export function runMissionTaskLoop(
  input: MissionTaskLoopInput,
): MissionTaskLoopResult {
  const t = (input.userText || '').replace(/\s+/g, ' ').trim();
  const wish = (
    input.wish ||
    input.auftrag?.wish ||
    t.slice(0, 160) ||
    'offener Auftrag'
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

  const derived: string[] = [];
  const clock = input.flightTime || extractClockFromText(t);
  if (clock) derived.push(`Abflugzeit=${clock}`);
  const dest = extractDestHint(t);
  if (dest) derived.push(`Ziel=${dest}`);
  const dateH = extractDateHint(t);
  if (dateH) derived.push(`Tag=${dateH}`);
  // Startflughafen immer herleiten — nie Blocker
  if (looksLikeFlightTaxiGoal(t, wish)) {
    derived.push('Startflughafen=selbst herleiten');
  }
  for (const k of input.auftrag?.known ?? []) {
    if (!derived.some((d) => d.slice(0, 24) === k.slice(0, 24))) {
      if (/^(Abflugzeit|Ziel|Tag|Abflugstadt|GPS)=/i.test(k)) derived.push(k);
    }
  }

  const flightTaxiGoal = looksLikeFlightTaxiGoal(t, wish);
  const flightTimeReady = Boolean(clock);
  const accessPending =
    input.accessLeg === 'needed' || input.accessLeg === 'unknown';

  const { work, promotedIds, deferredIds } = applyLaterPromote({
    work: input.work.map((w) => ({ ...w })),
    flightTimeReady,
    accessPending: Boolean(accessPending && flightTaxiGoal),
  });

  const blockers = pickLoopBlockers({
    userText: t,
    wish,
    flightTime: clock,
    luggage: input.luggage,
    accessLeg: input.accessLeg,
    auftrag: input.auftrag,
    flightTaxiGoal,
  });

  // Ask nur wenn kein Flight-Worker die Slot-Frage übernimmt
  let askBack: string | null = null;
  if (blockers.length) {
    const flightHandlesAsk = input.work.some(
      (w) =>
        w.worker === 'flight' ||
        /flight/i.test(w.id || '') ||
        /\b(flug|leave-?by|abflug)\b/iu.test(w.brief || ''),
    );
    if (!flightHandlesAsk) {
      askBack = askBackForBlockers(blockers);
    }
  }
  // Bestehenden echten Taxi-Blocker behalten (kein Flug im Satz)
  if (!askBack && input.existingAskBack) {
    askBack = input.existingAskBack;
  }

  const loopIntent = formatTaskLoopIntent({
    wish,
    derived: derived.slice(0, 6),
    blockers,
    deferredIds,
    promotedIds,
  });

  return {
    wish,
    work,
    derived: derived.slice(0, 8),
    blockers,
    askBack,
    loopIntent,
    promotedIds,
    deferredIds,
  };
}
