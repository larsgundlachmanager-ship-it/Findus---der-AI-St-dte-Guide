from pathlib import Path
import re

src = Path(r"C:\Users\larsf\Findus 2.0\src\module2\router\managerWarmup.ts")
text = src.read_text(encoding="utf-8")

old_imports = """import { analyzeManagerTurn, enrichAnalysisWithBlueprint } from './analyzeTurn';
import type { ManagerAnalysis } from './types';
"""
new_imports = """import { analyzeManagerTurn, enrichAnalysisWithBlueprint } from './analyzeTurn';
import type { ManagerAnalysis } from './types';
import {
  isTrivialWarmupRevision,
  warmupMatchesFinalUtterance,
} from './managerWarmupMatch';

export {
  normalizeWarmupText,
  warmupMatchesFinalUtterance,
  WARMUP_MAX_DELTA,
} from './managerWarmupMatch';
"""
if old_imports not in text:
    raise SystemExit("imports block not found")
text = text.replace(old_imports, new_imports, 1)

text = text.replace(
    """const MIN_CHARS = 10;
/** Nur fast-identisch — Prefix eines 10-Min-Satzes darf Call-1 nicht ersetzen. */
export const WARMUP_MAX_DELTA = 24;

""",
    "const MIN_CHARS = 10;\n\n",
    1,
)

text2, n = re.subn(
    r"/\*\* Match-Normalisierung:.*?^export function warmupMatchesFinalUtterance\([\s\S]*?^}\n\n",
    "",
    text,
    count=1,
    flags=re.M,
)
if n != 1:
    raise SystemExit(f"match block remove failed n={n}")

text2 = text2.replace("isTrivialRevision", "isTrivialWarmupRevision")

tmp = src.with_suffix(".ts.new")
tmp.write_text(text2, encoding="utf-8", newline="\n")
tmp.replace(src)
print("ok", src.stat().st_size)
print("has match import", "managerWarmupMatch" in text2)
print("still has normalize fn", "export function normalizeWarmupText" in text2)
