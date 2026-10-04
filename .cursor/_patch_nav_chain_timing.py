from pathlib import Path

# --- cueScheduler: extend buildFinalCueText + pickCue chain ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\handsFreeNav\cueScheduler.ts")
t = p.read_text(encoding="utf-8")
t = t.replace(
    " * Time-based nav cues: finish speaking 2s before the maneuver.\n",
    " * Time-based nav cues: finish ~2.5s before the maneuver (prefer early).\n",
    1,
)

old_build = """export function buildFinalCueText(opts: {
  maneuver: string | null;
  landmark: string | null;
  roadName: string | null;
  distanceM: number;
  isComplexTurn?: boolean;
  /** Letzte Abbiegung / Ankunftsseite — Ziel links|rechts */
  isFinalApproach?: boolean;
  destSide?: 'left' | 'right' | null;
}): string {
  const turn = turnWord(opts.maneuver);
  if (opts.isFinalApproach) {
"""
new_build = """export function buildFinalCueText(opts: {
  maneuver: string | null;
  landmark: string | null;
  roadName: string | null;
  distanceM: number;
  isComplexTurn?: boolean;
  /** Letzte Abbiegung / Ankunftsseite — Ziel links|rechts */
  isFinalApproach?: boolean;
  destSide?: 'left' | 'right' | null;
  /** Nahe Folgekurb: eine Ansage statt zwei. */
  chainNext?: { maneuver: string | null; gapM: number } | null;
}): string {
  if (
    opts.chainNext &&
    opts.chainNext.gapM > 0 &&
    opts.chainNext.gapM <= 45 &&
    !opts.isFinalApproach
  ) {
    try {
      const { buildChainedTurnCue } = require('../chainedTurnCue') as {
        buildChainedTurnCue: (o: {
          firstManeuver: string | null;
          secondManeuver: string | null;
          gapM: number;
          landmark?: string | null;
        }) => string;
      };
      return scrubRoboticNavSpeak(
        buildChainedTurnCue({
          firstManeuver: opts.maneuver,
          secondManeuver: opts.chainNext.maneuver,
          gapM: opts.chainNext.gapM,
          landmark: opts.landmark,
        }),
      );
    } catch {
      /* soft → Einzel-Cue */
    }
  }
  const turn = turnWord(opts.maneuver);
  if (opts.isFinalApproach) {
"""
if old_build not in t:
    raise SystemExit("buildFinalCueText missing")
t = t.replace(old_build, new_build, 1)

# In pickCueForTick, when building finalText, attach chain
old_final = """  const finalText = buildFinalCueText({
    maneuver: opts.nextTurnManeuver,
    landmark: opts.nextTurnLandmark,
    roadName: opts.nextTurnRoadName,
    distanceM: dist,
    isComplexTurn: opts.isComplexTurn,
    isFinalApproach: finalApproach,
    destSide: destSideFromManeuver(opts.nextTurnManeuver),
  });
"""
new_final = """  let chainNext: { maneuver: string | null; gapM: number } | null = null;
  if (Array.isArray(opts.waypoints) && turnIdx >= 0) {
    try {
      const { findChainedNextTurn } = require('../chainedTurnCue') as {
        findChainedNextTurn: (
          wps: NavWaypoint[],
          idx: number,
        ) => { index: number; wp: NavWaypoint; gapM: number } | null;
      };
      const chained = findChainedNextTurn(opts.waypoints, turnIdx);
      if (chained) {
        chainNext = { maneuver: chained.wp.maneuver ?? null, gapM: chained.gapM };
      }
    } catch {
      /* soft */
    }
  }
  const finalText = buildFinalCueText({
    maneuver: opts.nextTurnManeuver,
    landmark: opts.nextTurnLandmark,
    roadName: opts.nextTurnRoadName,
    distanceM: dist,
    isComplexTurn: opts.isComplexTurn,
    isFinalApproach: finalApproach,
    destSide: destSideFromManeuver(opts.nextTurnManeuver),
    chainNext,
  });
"""
if old_final not in t:
    raise SystemExit("finalText block missing")
t = t.replace(old_final, new_final, 1)

# Skip early warn when final is close (overlap) OR when we have chain (one cue later)
old_early = """    if (
      dist <= earlyM &&
      dist > startM + 6 &&
      lastSpokenPhaseKey !== key &&
      !lastSpokenPhaseKey?.startsWith('final:')
    ) {
"""
new_early = """    // Kein Early, wenn Final gleich dran — sonst Überlappung Warn+Final.
    if (
      dist <= earlyM &&
      dist > startM + 12 &&
      lastSpokenPhaseKey !== key &&
      !lastSpokenPhaseKey?.startsWith('final:')
    ) {
"""
if old_early not in t:
    raise SystemExit("early gate missing")
t = t.replace(old_early, new_early, 1)

tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_cueSched_chain.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
try:
    p.unlink()
except Exception as e:
    print("unlink sched", e)
p.write_bytes(tmp.read_bytes())
print("cueScheduler ok")

# --- tickCoach ---
tc = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\handsFreeNav\tickCoach.ts")
tt = tc.read_text(encoding="utf-8")
old_draft = """  const draft = turnWp
    ? buildFinalCueText({
        maneuver: turnWp.maneuver,
        landmark,
        roadName: turnWp.roadName ?? null,
        distanceM: distToTurnM ?? 20,
        isComplexTurn: turnWp.turnComplexity === 'complex',
      })
    : buildPredictiveTurnCue({
"""
new_draft = """  let chainNext: { maneuver: string | null; gapM: number } | null = null;
  let chainThroughIdx: number | null = null;
  if (turnWp && turnIdx >= 0) {
    try {
      const { findChainedNextTurn } = require('../chainedTurnCue') as {
        findChainedNextTurn: (
          wps: typeof ctx.waypoints,
          idx: number,
        ) => { index: number; wp: (typeof ctx.waypoints)[0]; gapM: number } | null;
      };
      const chained = findChainedNextTurn(ctx.waypoints, turnIdx);
      if (chained) {
        chainNext = {
          maneuver: chained.wp.maneuver ?? null,
          gapM: chained.gapM,
        };
        chainThroughIdx = chained.index;
      }
    } catch {
      /* soft */
    }
  }
  const draft = turnWp
    ? buildFinalCueText({
        maneuver: turnWp.maneuver,
        landmark,
        roadName: turnWp.roadName ?? null,
        distanceM: distToTurnM ?? 20,
        isComplexTurn: turnWp.turnComplexity === 'complex',
        chainNext,
      })
    : buildPredictiveTurnCue({
"""
if old_draft not in tt:
    raise SystemExit("tick draft missing")
tt = tt.replace(old_draft, new_draft, 1)

old_fire = """  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    session.lastSpokenTurnIdx = turnIdx;
    session.lastSpokenAt = now;
"""
new_fire = """  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    // Zweite enge Kurve mitabgedeckt → nicht nochmal einzeln ansagen.
    session.lastSpokenTurnIdx =
      chainThroughIdx != null ? chainThroughIdx : turnIdx;
    session.lastSpokenAt = now;
"""
if old_fire not in tt:
    raise SystemExit("tick fire missing")
tt = tt.replace(old_fire, new_fire, 1)

tmp2 = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_tick_chain.ts")
tmp2.write_text(tt, encoding="utf-8", newline="\n")
try:
    tc.unlink()
except Exception as e:
    print("unlink tick", e)
tc.write_bytes(tmp2.read_bytes())
print("tickCoach ok")

# --- navPredictiveCue FINISH align ---
np = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\navPredictiveCue.ts")
nt = np.read_text(encoding="utf-8")
nt = nt.replace(
    " * Finish speaking 2s before the maneuver (aligned with handsFreeNav/cueScheduler).\n",
    " * Finish speaking ~2.5s before the maneuver (prefer early; aligned with speakStartDistance).\n",
    1,
)
nt = nt.replace(
    "export const FINISH_BEFORE_TURN_SEC = 2;",
    "export const FINISH_BEFORE_TURN_SEC = 2.5;",
    1,
)
# speakStartM in this file uses FINISH_BEFORE_TURN_SEC
tmp3 = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_npc.ts")
tmp3.write_text(nt, encoding="utf-8", newline="\n")
try:
    np.unlink()
except Exception as e:
    print("unlink npc", e)
np.write_bytes(tmp3.read_bytes())
print("navPredictive ok")
