# -*- coding: utf-8 -*-
from pathlib import Path

# --- gapFillTravel.ts ---
p = Path("src/module2/timeline/gapFillTravel.ts")
text = p.read_text(encoding="utf-8")
old_sig = """export function applyGapFillTravelLegs(opts?: {
  preferredTransport?: FuturePlanTransport | null;
}): {
  legs: number;
  speech: string;
} {"""
new_sig = """export function applyGapFillTravelLegs(opts?: {
  preferredTransport?: FuturePlanTransport | null;
  /** Nach Quiet-Shift einmal ohne Quiet-Reentry neu bauen. */
  skipQuietResolve?: boolean;
}): {
  legs: number;
  speech: string;
} {"""
if old_sig not in text:
    raise SystemExit("gapFill sig not found")
text = text.replace(old_sig, new_sig, 1)

marker = "  useFuturePlanStore.getState().setPlan({\n    ...current,\n    stops: merged,\n  });\n\n  const speech ="
if marker not in text:
    raise SystemExit("gapFill marker not found")
insert = """  useFuturePlanStore.getState().setPlan({
    ...current,
    stops: merged,
  });

  // Soft-Overlaps nach Legs still lösen — einmal, dann Legs ggf. neu
  if (!opts?.skipQuietResolve) {
    try {
      const snap = useFuturePlanStore
        .getState()
        .plan.stops.map((s) => `${s.id}:${s.plannedStartMs ?? ''}`)
        .join('|');
      const { resolveOverlapsQuietly } = require('../planning/planConflictResolve') as {
        resolveOverlapsQuietly: (o?: { speakIfStuck?: boolean }) => boolean;
      };
      resolveOverlapsQuietly({ speakIfStuck: false });
      const snap2 = useFuturePlanStore
        .getState()
        .plan.stops.map((s) => `${s.id}:${s.plannedStartMs ?? ''}`)
        .join('|');
      if (snap !== snap2) {
        return applyGapFillTravelLegs({
          ...opts,
          skipQuietResolve: true,
        });
      }
    } catch {
      /* soft — circular/RN */
    }
  }

  const speech ="""
text = text.replace(marker, insert, 1)
p.write_text(text, encoding="utf-8")
print("gapFillTravel OK")

# --- mirrorTourToTimeline.ts ---
p2 = Path("src/module2/tour/mirrorTourToTimeline.ts")
text2 = p2.read_text(encoding="utf-8")
old_m = """  try {
    const { applyGapFillTravelLegs } = require('../timeline/gapFillTravel') as {
      applyGapFillTravelLegs: () => unknown;
    };
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  try {
    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);"""
new_m = """  try {
    const { applyGapFillTravelLegs } = require('../timeline/gapFillTravel') as {
      applyGapFillTravelLegs: (opts?: {
        skipQuietResolve?: boolean;
      }) => unknown;
    };
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  // Soft-Overlaps vor Kalender-Open still schieben
  try {
    const { resolveOverlapsQuietly, speakUnresolvedPlanConflict } =
      require('../planning/planConflictResolve') as {
        resolveOverlapsQuietly: (o?: { speakIfStuck?: boolean }) => boolean;
        speakUnresolvedPlanConflict: () => void;
      };
    const still = resolveOverlapsQuietly({ speakIfStuck: false });
    if (still) speakUnresolvedPlanConflict();
  } catch {
    /* soft */
  }

  try {
    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);"""
if old_m not in text2:
    raise SystemExit("mirror block not found")
text2 = text2.replace(old_m, new_m, 1)
p2.write_text(text2, encoding="utf-8")
print("mirrorTourToTimeline OK")
print("done")
