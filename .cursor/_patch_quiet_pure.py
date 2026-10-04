# -*- coding: utf-8 -*-
from pathlib import Path
import tempfile
import os

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "src/module2/planning/planConflictResolve.ts"
t = p.read_text(encoding="utf-8")

# 1) Add import
needle = "from './planHardLock';"
insert = """from './planHardLock';
import {
  findQuietOverlapPair,
  resolveOverlapsQuietlyOnStops,
} from './planQuietOverlap';"""
if "planQuietOverlap" not in t:
    if needle not in t:
        raise SystemExit("import needle missing")
    t = t.replace(needle, insert, 1)

# 2) Replace the big quiet block (from isQuietResolveCandidate through resolveOverlapsQuietly)
start = t.find("/**\n * Quiet-Resolve: auch Soft-Wünsche")
if start < 0:
    start = t.find("function isQuietResolveCandidate")
if start < 0:
    raise SystemExit("quiet block start not found")

end_marker = "/**\n * Interaktive Overlap-Auflösung nach Opfer-Hierarchie."
end = t.find(end_marker, start)
if end < 0:
    raise SystemExit("interactive marker not found")

replacement = '''/** Kurzer Ack wenn zwei fixe Zeiten nicht auto-lösbar sind — Struktur, kein Stadt-Skript. */
export function speakUnresolvedPlanConflict(
  a?: FuturePlanStop | null,
  b?: FuturePlanStop | null,
): void {
  const pair =
    a && b
      ? ([a, b] as [FuturePlanStop, FuturePlanStop])
      : findQuietOverlapPair(useFuturePlanStore.getState().plan.stops) ??
        findOverlapPair(useFuturePlanStore.getState().plan.stops);
  if (!pair) {
    enqueueSpeech({
      kind: 'main',
      text: sanitizePlanSpeech(
        'Kurz eng: zwei Zeiten passen so nicht — einer der Slots muss weichen.',
      ),
      turnId: `m5_quiet_cf_${Date.now()}`,
    });
    return;
  }
  const t0 = sanitizePlanSpeech(pair[0].title.replace(/^[🥇🥈📌📍✨🏁🔔]\\s*/u, ''));
  const t1 = sanitizePlanSpeech(pair[1].title.replace(/^[🥇🥈📌📍✨🏁🔔]\\s*/u, ''));
  enqueueSpeech({
    kind: 'main',
    text: sanitizePlanSpeech(
      `Kurz eng: „${t0}“ und „${t1}“ knallen — einer der Slots muss weichen.`,
    ),
    turnId: `m5_quiet_cf_${Date.now()}`,
  });
}

/**
 * Soft-Overlaps vor UI-Paint still schieben (kein Ask, kein Drop).
 * @returns true wenn nach max. Shifts noch Überlappung (Banner-Fall).
 */
export function resolveOverlapsQuietly(opts?: {
  speakIfStuck?: boolean;
  maxShifts?: number;
}): boolean {
  const plan = useFuturePlanStore.getState().plan;
  const result = resolveOverlapsQuietlyOnStops(plan.stops, {
    maxShifts: opts?.maxShifts,
  });

  if (result.shiftedIds.length > 0) {
    const byId = new Map(result.stops.map((s) => [s.id, s]));
    for (const id of result.shiftedIds) {
      const next = byId.get(id);
      if (next) useFuturePlanStore.getState().upsertStop(next);
    }
  }

  if ((result.stillOverlapping || result.stuck) && opts?.speakIfStuck) {
    speakUnresolvedPlanConflict();
  }
  return result.stillOverlapping;
}

'''
# Fix double-escaped regex in replacement
replacement = replacement.replace("\\\\s*", "\\s*")

t = t[:start] + replacement + t[end:]

# 3) Simplify resolveOverlapsInteractive preamble — keep resolveOverlapsQuietly call
# (already there)

fd, tmp = tempfile.mkstemp(suffix=".ts", dir=str(p.parent))
os.close(fd)
Path(tmp).write_text(t, encoding="utf-8", newline="\n")
Path(tmp).replace(p)
print("planConflictResolve refactored OK")
print("has resolveOverlapsQuietlyOnStops", "resolveOverlapsQuietlyOnStops" in t)
print("has isQuietResolveCandidate", "isQuietResolveCandidate" in t)
