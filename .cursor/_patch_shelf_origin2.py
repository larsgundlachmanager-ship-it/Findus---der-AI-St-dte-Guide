from pathlib import Path

src = Path(r"src/reisebuero/originDefaults.ts")
dst = Path(r"src/reisebuero/originDefaults._shelf.ts")
t = src.read_text(encoding="utf-8")
if "applyShelfPrefsToLedger" not in t:
    t = t.replace(
        "from './timelineMustHavePrefs';",
        "from './timelineMustHavePrefs';\nimport { applyShelfPrefsToLedger, hydrateShelfAsked } from './shelfAskedPrefs';",
    )
    old = """  if (!opts?.skipTimelinePrefs) {
    try {
      next = applyTimelineMustHavePrefs(next, { savedTrips: opts?.savedTrips });
    } catch {
      /* soft */
    }
  }
  return next;
}"""
    new = """  if (!opts?.skipTimelinePrefs) {
    try {
      next = applyTimelineMustHavePrefs(next, { savedTrips: opts?.savedTrips });
    } catch {
      /* soft */
    }
  }
  try {
    void hydrateShelfAsked();
    next = applyShelfPrefsToLedger(next).ledger;
  } catch {
    /* soft */
  }
  return next;
}"""
    if old not in t:
        raise SystemExit("block not found")
    t = t.replace(old, new)
dst.write_text(t, encoding="utf-8")
print("wrote", dst, "bytes", dst.stat().st_size)
