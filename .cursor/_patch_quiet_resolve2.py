# -*- coding: utf-8 -*-
"""Patch gapFillTravel + mirrorTourToTimeline for quiet overlap resolve."""
from pathlib import Path
import shutil
import tempfile
import os

ROOT = Path(__file__).resolve().parents[1]


def patch_gap_fill() -> None:
    src = ROOT / "src/module2/timeline/gapFillTravel.ts"
    text = src.read_text(encoding="utf-8")
    old_sig = (
        "export function applyGapFillTravelLegs(opts?: {\n"
        "  preferredTransport?: FuturePlanTransport | null;\n"
        "}): {\n"
        "  legs: number;\n"
        "  speech: string;\n"
        "} {"
    )
    new_sig = (
        "export function applyGapFillTravelLegs(opts?: {\n"
        "  preferredTransport?: FuturePlanTransport | null;\n"
        "  /** Nach Quiet-Shift einmal ohne Quiet-Reentry neu bauen. */\n"
        "  skipQuietResolve?: boolean;\n"
        "}): {\n"
        "  legs: number;\n"
        "  speech: string;\n"
        "} {"
    )
    if old_sig not in text:
        if "skipQuietResolve?" in text:
            print("gapFill already patched (sig)")
        else:
            raise SystemExit("gapFill sig not found")
    else:
        text = text.replace(old_sig, new_sig, 1)

    marker = (
        "  useFuturePlanStore.getState().setPlan({\n"
        "    ...current,\n"
        "    stops: merged,\n"
        "  });\n\n"
        "  const speech ="
    )
    if "skipQuietResolve" in text and "resolveOverlapsQuietly" in text:
        print("gapFill already patched (body)")
    elif marker not in text:
        raise SystemExit("gapFill marker not found")
    else:
        insert = (
            "  useFuturePlanStore.getState().setPlan({\n"
            "    ...current,\n"
            "    stops: merged,\n"
            "  });\n\n"
            "  // Soft-Overlaps nach Legs still lösen — einmal, dann Legs ggf. neu\n"
            "  if (!opts?.skipQuietResolve) {\n"
            "    try {\n"
            "      const snap = useFuturePlanStore\n"
            "        .getState()\n"
            "        .plan.stops.map((s) => `${s.id}:${s.plannedStartMs ?? ''}`)\n"
            "        .join('|');\n"
            "      const { resolveOverlapsQuietly } = require('../planning/planConflictResolve') as {\n"
            "        resolveOverlapsQuietly: (o?: { speakIfStuck?: boolean }) => boolean;\n"
            "      };\n"
            "      resolveOverlapsQuietly({ speakIfStuck: false });\n"
            "      const snap2 = useFuturePlanStore\n"
            "        .getState()\n"
            "        .plan.stops.map((s) => `${s.id}:${s.plannedStartMs ?? ''}`)\n"
            "        .join('|');\n"
            "      if (snap !== snap2) {\n"
            "        return applyGapFillTravelLegs({\n"
            "          ...opts,\n"
            "          skipQuietResolve: true,\n"
            "        });\n"
            "      }\n"
            "    } catch {\n"
            "      /* soft — circular/RN */\n"
            "    }\n"
            "  }\n\n"
            "  const speech ="
        )
        text = text.replace(marker, insert, 1)

    atomic_write(src, text)
    print("gapFillTravel OK")


def patch_mirror() -> None:
    src = ROOT / "src/module2/tour/mirrorTourToTimeline.ts"
    text = src.read_text(encoding="utf-8")
    if "resolveOverlapsQuietly" in text:
        print("mirror already patched")
        return
    old_m = (
        "  try {\n"
        "    const { applyGapFillTravelLegs } = require('../timeline/gapFillTravel') as {\n"
        "      applyGapFillTravelLegs: () => unknown;\n"
        "    };\n"
        "    applyGapFillTravelLegs();\n"
        "  } catch {\n"
        "    /* soft */\n"
        "  }\n\n"
        "  try {\n"
        "    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);"
    )
    new_m = (
        "  try {\n"
        "    const { applyGapFillTravelLegs } = require('../timeline/gapFillTravel') as {\n"
        "      applyGapFillTravelLegs: (opts?: {\n"
        "        skipQuietResolve?: boolean;\n"
        "      }) => unknown;\n"
        "    };\n"
        "    applyGapFillTravelLegs();\n"
        "  } catch {\n"
        "    /* soft */\n"
        "  }\n\n"
        "  // Soft-Overlaps vor Kalender-Open still schieben\n"
        "  try {\n"
        "    const { resolveOverlapsQuietly, speakUnresolvedPlanConflict } =\n"
        "      require('../planning/planConflictResolve') as {\n"
        "        resolveOverlapsQuietly: (o?: { speakIfStuck?: boolean }) => boolean;\n"
        "        speakUnresolvedPlanConflict: () => void;\n"
        "      };\n"
        "    const still = resolveOverlapsQuietly({ speakIfStuck: false });\n"
        "    if (still) speakUnresolvedPlanConflict();\n"
        "  } catch {\n"
        "    /* soft */\n"
        "  }\n\n"
        "  try {\n"
        "    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);"
    )
    if old_m not in text:
        raise SystemExit("mirror block not found")
    text = text.replace(old_m, new_m, 1)
    atomic_write(src, text)
    print("mirrorTourToTimeline OK")


def patch_handoff() -> None:
    src = ROOT / "src/module2/planning/planConflictHandoff.ts"
    text = src.read_text(encoding="utf-8")
    if "softTimedIntervalsFromStops" in text:
        print("handoff already patched")
        return
    old = (
        "  const hard = plan.stops.filter(\n"
        "    (s) =>\n"
        "      s.kind !== 'nav_leg' &&\n"
        "      s.plannedStartMs != null &&\n"
        "      (s.hardAnchor ||\n"
        "        s.userFixedTime ||\n"
        "        (s.planPriority != null && s.planPriority <= 2)),\n"
        "  );\n\n"
        "  for (const s of hard) {\n"
    )
    new = (
        "  const hard = plan.stops.filter(\n"
        "    (s) =>\n"
        "      s.kind !== 'nav_leg' &&\n"
        "      s.plannedStartMs != null &&\n"
        "      (s.hardAnchor ||\n"
        "        s.userFixedTime ||\n"
        "        (s.planPriority != null && s.planPriority <= 2)),\n"
        "  );\n\n"
        "  // Soft-timed (Frühstück/Ankunft) blockieren denselben Slot wie Hard\n"
        "  let softTimed: typeof plan.stops = [];\n"
        "  try {\n"
        "    const { softTimedIntervalsFromStops } = require('./planHardLock') as {\n"
        "      softTimedIntervalsFromStops: (\n"
        "        stops: typeof plan.stops,\n"
        "      ) => Array<{ start: number; end: number }>;\n"
        "    };\n"
        "    const ivs = softTimedIntervalsFromStops(plan.stops);\n"
        "    softTimed = plan.stops.filter((s) => {\n"
        "      if (s.kind === 'nav_leg' || s.plannedStartMs == null) return false;\n"
        "      if (hard.some((h) => h.id === s.id)) return false;\n"
        "      const end = s.plannedEndMs ?? s.plannedStartMs + 45 * 60_000;\n"
        "      return ivs.some((iv) => s.plannedStartMs! < iv.end && end > iv.start);\n"
        "    });\n"
        "  } catch {\n"
        "    softTimed = [];\n"
        "  }\n\n"
        "  const blockers = [...hard, ...softTimed];\n"
        "  for (const s of blockers) {\n"
    )
    if old not in text:
        raise SystemExit("handoff block not found")
    text = text.replace(old, new, 1)
    atomic_write(src, text)
    print("planConflictHandoff OK")


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        # Replace even if target is stubborn on Windows
        bak = path.with_suffix(path.suffix + ".bak_quiet")
        try:
            if bak.exists():
                bak.unlink()
            if path.exists():
                path.replace(bak)
            Path(tmp_name).replace(path)
            if bak.exists():
                bak.unlink()
        except OSError:
            # Fallback: copy over
            shutil.copyfile(tmp_name, path)
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            if bak.exists():
                try:
                    bak.unlink()
                except OSError:
                    pass
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


if __name__ == "__main__":
    patch_gap_fill()
    patch_mirror()
    patch_handoff()
    print("all patches done")
