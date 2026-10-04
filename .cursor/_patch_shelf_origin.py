from pathlib import Path

p = Path(r"src/reisebuero/originDefaults.ts")
t = p.read_text(encoding="utf-8")
if "applyShelfPrefsToLedger" in t:
    print("already")
else:
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
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("originDefaults patched")
