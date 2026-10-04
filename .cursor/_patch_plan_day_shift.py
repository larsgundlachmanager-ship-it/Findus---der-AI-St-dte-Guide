from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\timeline\planLiveEdits.ts")
text = p.read_text(encoding="utf-8")

old = """import { resolveDateKeyFromUserText, todayDateKey, dateKeyFromMs } from '../../utils/dateKeys';
import { isPastMs } from './planNowGuard';
import {
  describeExistingStop,
  detectExistingPlanEditIntent,
  findStopByTitleHint,
  resolveExistingPlanReference,
  resolvePlanStopsFromUtterance,
} from './planStopResolve';
import { isLiveNavLegId } from './liveTourSchedule';
import { retireCommitmentsForStop } from './retireTimelineCommitments';
import { looksLikeClearDayPlan } from '../planning/planEditDetect';
"""

new = """import {
  resolveDateKeyFromUserText,
  todayDateKey,
  dateKeyFromMs,
  tryResolveDateKeyFromUserText,
  formatSpeechRelativeDate,
} from '../../utils/dateKeys';
import { isPastMs } from './planNowGuard';
import {
  describeExistingStop,
  detectExistingPlanEditIntent,
  findStopByTitleHint,
  resolveExistingPlanReference,
  resolvePlanStopsFromUtterance,
} from './planStopResolve';
import { isLiveNavLegId } from './liveTourSchedule';
import { retireCommitmentsForStop } from './retireTimelineCommitments';
import {
  looksLikeClearDayPlan,
  looksLikeWholePlanDayShift,
} from '../planning/planEditDetect';
import { shiftPlanDayStops } from '../planning/planDayShift';
"""

if old not in text:
    raise SystemExit("import block not found")
text = text.replace(old, new, 1)

fn = '''
/** Ganzen Plan-Tag auf neuen dayKey legen (Stops + Session, alte Legs weg). */
export function shiftWholePlanDay(opts: {
  fromDay: string;
  toDay: string;
  utterance?: string;
}): PlanEditResult {
  const fromDay = (opts.fromDay || "").trim();
  const toDay = (opts.toDay || "").trim();
  if (!fromDay || !toDay) {
    return { handled: false, speech: "" };
  }
  if (fromDay === toDay) {
    return {
      handled: true,
      speech: "Der Plan liegt schon auf diesem Tag.",
    };
  }

  const store = useFuturePlanStore.getState();
  store.ensureDay(fromDay);
  const fromPlan = store.getPlanForDay(fromDay);
  const { moved, droppedNavIds } = shiftPlanDayStops({
    fromDay,
    toDay,
    stops: fromPlan.stops,
  });
  if (!moved.length && !droppedNavIds.length && !fromPlan.stops.length) {
    return {
      handled: true,
      speech: "Auf dem aktuellen Tag ist nichts zum Verschieben.",
    };
  }

  // Zieltag leeren falls schon Artefakte — dann Stops nur einmal
  store.ensureDay(toDay);
  const existingTo = store.getPlanForDay(toDay).stops;
  for (const s of [...existingTo]) {
    if (moved.some((m) => m.id === s.id)) continue;
    // Nur Travel-Artefakte am Zieltag wegräumen, User-Stops behalten
    if (
      s.kind === "nav_leg" ||
      s.id.startsWith("nav_remind_") ||
      s.id.startsWith("leave_") ||
      s.id.startsWith("choice_")
    ) {
      store.removeStop(s.id);
    }
  }

  // Quelltag komplett leeren (keine Duplikate), dann Stops auf Zieltag
  const snapshot = [...fromPlan.stops];
  store.clearDay(fromDay);
  for (const s of moved) {
    store.upsertStopOnDay(toDay, s);
  }

  // Basis/Origin mitziehen wenn vorhanden
  try {
    if (fromPlan.base) store.setDayBase(toDay, fromPlan.base);
    if (fromPlan.originBase) store.setDayOriginBase(toDay, fromPlan.originBase);
  } catch {
    /* soft */
  }

  store.ensureDay(toDay);
  try {
    usePlanCalendarUiStore.getState().requestDayKey(toDay);
  } catch {
    /* soft */
  }

  try {
    const { usePlanSessionStore } = require("../planning/planSessionState") as {
      usePlanSessionStore: {
        getState: () => {
          plan: { targetDate: string } | null;
          setPlan: (p: unknown) => void;
        };
      };
    };
    const session = usePlanSessionStore.getState();
    if (session.plan) {
      session.setPlan({ ...session.plan, targetDate: toDay });
    }
  } catch {
    /* soft */
  }

  try {
    for (const s of snapshot) {
      if (s.kind === "nav_leg" || s.id.startsWith("nav_remind_") || s.id.startsWith("leave_")) {
        continue;
      }
      // Commitments auf neuen Tag — retire alte Ghosts soft
      retireCommitmentsForStop(s);
    }
  } catch {
    /* soft */
  }

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  const ids = moved.map((m) => m.id);
  if (ids.length) markFresh(ids, { openCalendar: true });
  else openLive();

  const label = formatSpeechRelativeDate(toDay);
  const n = moved.length;
  return {
    handled: true,
    speech:
      n > 0
        ? `Alles klar — der ganze Plan liegt jetzt auf ${label} (${n} Stopps).`
        : `Kalender steht auf ${label}.`,
  };
}

function resolveWholePlanShiftTarget(
  utterance: string,
  fromDay: string,
): string | null {
  const t = utterance.replace(/\\s+/g, " ").trim();
  if (!t) return null;
  try {
    const { normalizeTargetDate } = require("../planning/planningLlmIngestion") as {
      normalizeTargetDate: (raw: unknown, utterance: string) => string;
    };
    const next = normalizeTargetDate(fromDay, t);
    if (next && next !== fromDay) return next;
  } catch {
    /* soft */
  }
  const key = tryResolveDateKeyFromUserText(t);
  if (key && key !== fromDay) return key;
  return null;
}
'''

# Insert function before applyPlanEditFromUtterance
marker = "export function applyPlanEditFromUtterance(utterance: string): PlanEditResult {"
if marker not in text:
    raise SystemExit("applyPlanEditFromUtterance not found")
if "export function shiftWholePlanDay" not in text:
    text = text.replace(marker, fn + "\n" + marker, 1)

# Early whole-day branch inside applyPlanEditFromUtterance
old_gate = """  if (
    !wantsDelete &&
    !wantsMove &&
    !wantsAdd &&
    !wantsTransport &&
    !wantsClearAll
  ) {
    return { handled: false, speech: '' };
  }

  if (wantsClearAll) {
    return clearDayPlan(plan.dayKey);
  }
"""

new_gate = """  const wantsWholeDayShift = looksLikeWholePlanDayShift(u);

  if (
    !wantsDelete &&
    !wantsMove &&
    !wantsAdd &&
    !wantsTransport &&
    !wantsClearAll &&
    !wantsWholeDayShift
  ) {
    return { handled: false, speech: '' };
  }

  if (wantsClearAll) {
    return clearDayPlan(plan.dayKey);
  }

  if (wantsWholeDayShift) {
    const fromDay =
      plan.dayKey ||
      usePlanCalendarUiStore.getState().requestedDayKey ||
      todayDateKey();
    let sessionFrom = fromDay;
    try {
      const { usePlanSessionStore } = require('../planning/planSessionState') as {
        usePlanSessionStore: {
          getState: () => { plan: { targetDate?: string } | null };
        };
      };
      const td = usePlanSessionStore.getState().plan?.targetDate;
      if (td && /^\\d{4}-\\d{2}-\\d{2}$/.test(td)) sessionFrom = td;
    } catch {
      /* soft */
    }
    // Prefer the day that still has stops (session may already have flipped)
    const store = useFuturePlanStore.getState();
    const fromCandidates = [fromDay, sessionFrom].filter(Boolean);
    let bestFrom = fromDay;
    let bestCount = -1;
    for (const dk of fromCandidates) {
      const n = store
        .getPlanForDay(dk)
        .stops.filter(
          (s) =>
            s.kind !== 'nav_leg' &&
            !s.id.startsWith('choice_') &&
            !s.id.startsWith('nav_remind_'),
        ).length;
      if (n > bestCount) {
        bestCount = n;
        bestFrom = dk;
      }
    }
    // Scan all days if active day already empty after naive switch
    if (bestCount <= 0) {
      for (const dk of Object.keys(store.plansByDay || {})) {
        const n = store
          .getPlanForDay(dk)
          .stops.filter(
            (s) =>
              s.kind !== 'nav_leg' &&
              !s.id.startsWith('choice_') &&
              !s.id.startsWith('nav_remind_'),
          ).length;
        if (n > bestCount) {
          bestCount = n;
          bestFrom = dk;
        }
      }
    }
    const toDay = resolveWholePlanShiftTarget(u, bestFrom);
    if (!toDay) {
      return {
        handled: true,
        speech: 'Auf welchen Tag soll der ganze Plan? Sag z. B. Donnerstag.',
      };
    }
    return shiftWholePlanDay({ fromDay: bestFrom, toDay, utterance: u });
  }
"""

if old_gate not in text:
    raise SystemExit("gate block not found")
text = text.replace(old_gate, new_gate, 1)

# Gap-fill after add
old_add = """    addPlanStop({
      title: clean,
      plannedStartMs: clock,
      transport: t ?? undefined,
      kind: clock != null ? 'stop' : 'wish',
    });
    void syncPlanAddToTourMap(clean);
    return {
      handled: true,
      speech: `„${clean}“ kommt dazu — ohne den Rest neu zu rechnen.`,
    };
"""

new_add = """    addPlanStop({
      title: clean,
      plannedStartMs: clock,
      transport: t ?? undefined,
      kind: clock != null ? 'stop' : 'wish',
    });
    try {
      applyGapFillTravelLegs();
    } catch {
      /* soft */
    }
    void syncPlanAddToTourMap(clean);
    return {
      handled: true,
      speech: `„${clean}“ kommt dazu — ohne den Rest neu zu rechnen.`,
    };
"""

if old_add not in text:
    raise SystemExit("add block not found")
text = text.replace(old_add, new_add, 1)

tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_planLiveEdits_patched.ts")
tmp.write_text(text, encoding="utf-8")
print("wrote temp", tmp.stat().st_size)
import shutil

shutil.copyfile(tmp, p)
print("planLiveEdits patched ok")
