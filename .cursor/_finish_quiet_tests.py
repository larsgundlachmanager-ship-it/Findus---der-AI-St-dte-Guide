# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

src = ROOT / ".cursor/_planConflictResolve.smoke.test.ts"
dst = ROOT / "src/module2/planning/planConflictResolve.smoke.test.ts"
tmp = dst.with_suffix(".ts.tmp_quiet")
tmp.write_bytes(src.read_bytes())
tmp.replace(dst)
print("smoke copied", dst.stat().st_size)

dom = ROOT / "src/module2/planning/planDominoMath.test.ts"
t = dom.read_text(encoding="utf-8")
if "resolveOverlapsQuietlyOnStops" in t:
    print("domino already has quiet")
else:
    add = """
{
  const { resolveOverlapsQuietlyOnStops } = require('./planQuietOverlap') as typeof import('./planQuietOverlap');
  const bfStart = Date.UTC(2026, 7, 24, 10, 0, 0);
  const bfEnd = Date.UTC(2026, 7, 24, 10, 45, 0);
  const prefer = Date.UTC(2026, 7, 24, 9, 30, 0);
  const quiet = resolveOverlapsQuietlyOnStops([
    stop({
      id: 'wish_bf_q',
      title: 'Frühstück',
      kind: 'wish',
      plannedStartMs: bfStart,
      plannedEndMs: bfEnd,
      planPriority: 5,
      notes: 'Frühstück',
    }),
    stop({
      id: 'tour_q',
      title: 'Tour',
      plannedStartMs: prefer,
      plannedEndMs: prefer + 90 * 60_000,
      planPriority: 6,
    }),
  ]);
  const tourQ = quiet.stops.find((s) => s.id === 'tour_q');
  assert(tourQ?.plannedStartMs != null && tourQ.plannedStartMs >= bfEnd, 'quiet OnStops: Tour nach Frühstück');
  assert(!quiet.stillOverlapping, 'quiet OnStops: no banner overlap');
  console.log('planDominoMath quiet-resolve: OK');
}

"""
    marker = "console.log('planDominoMath.test.ts OK');"
    if marker not in t:
        raise SystemExit("domino console.log not found")
    t2 = t.replace(marker, add + marker, 1)
    tmp2 = dom.with_suffix(".ts.tmp_quiet")
    tmp2.write_text(t2, encoding="utf-8", newline="\n")
    tmp2.replace(dom)
    print("domino quiet appended")
