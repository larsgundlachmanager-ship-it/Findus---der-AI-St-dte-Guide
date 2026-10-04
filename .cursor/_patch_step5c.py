# -*- coding: utf-8 -*-
from pathlib import Path
import os, time

root = Path(r"c:\Users\larsf\Findus 2.0")
p = root / "src/module2/planning/planConflictResolve.ts"
t = p.read_text(encoding="utf-8")

fn = '''
/**
 * Soft overlaps silently shift — no speech, no ask.
 * Banner / conflict tone only if this leaves remaining overlap.
 */
export function resolveOverlapsQuietly(): {
  shifted: string[];
  remaining: boolean;
} {
  const shifted: string[] = [];
  let guard = 0;
  while (hasTimeOverlap() && guard < 16) {
    guard += 1;
    const pair = findOverlapPair(useFuturePlanStore.getState().plan.stops);
    if (!pair) break;
    const soft = softerOf(pair[0], pair[1]);
    const hard = harderOf(pair[0], pair[1]);
    if (isHardFixedStop(soft) || !isSoftMovableStop(soft)) break;
    const p = prioOf(soft);
    if (p <= 2) break;
    if (shiftStopPastHarder(soft, hard, 'Verschoben (auto)')) {
      shifted.push(soft.title);
      continue;
    }
    break;
  }
  return { shifted, remaining: hasTimeOverlap() };
}

'''

if "export function resolveOverlapsQuietly" in t:
    print("resolveOverlapsQuietly already present")
else:
    anchor = "export async function resolveOverlapsInteractive"
    if anchor not in t:
        raise SystemExit("anchor missing")
    t = t.replace(anchor, fn + anchor, 1)
    tmp = p.with_suffix(".ts.tmpwrite")
    tmp.write_text(t, encoding="utf-8")
    for i in range(10):
        try:
            os.replace(tmp, p)
            print("planConflictResolve patched")
            break
        except Exception as e:
            print("retry", i, e)
            time.sleep(0.5)
    else:
        raise SystemExit("replace failed")