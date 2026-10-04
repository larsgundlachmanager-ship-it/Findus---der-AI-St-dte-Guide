# -*- coding: utf-8 -*-
"""Timeline purge + overlap + prefs smoke."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def patch_once(rel: str, old: str, new: str, label: str, already: str | None = None) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"{label}: already")
        return
    if old not in t:
        raise SystemExit(f"{label}: old block not found ({rel})")
    write_text(p, t.replace(old, new, 1))
    print(f"{label}: OK")


# Insert purgeStaleJourneysForHardNav before clearLiveNavFromPlan
patch_once(
    "src/module2/timeline/syncLiveNavToPlan.ts",
    """/** Live-Leg + Tour-Spiegel entfernen. */
export function clearLiveNavFromPlan(opts?: { abandon?: boolean }): void {
""",
    """/**
 * Hard-Nav (explizit „navigiere zu X“): alte ÖPNV-/Tour-Gruppen am selben Ziel
 * und Live-Spiegel weg — sonst Timeline-Chaos + Fake-Zeitkonflikt.
 */
export function purgeStaleJourneysForHardNav(destHint?: string | null): void {
  clearLiveNavFromPlan();
  const hint = String(destHint || '')
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/giu, ' ')
    .trim();
  const tokens = hint
    .split(/\\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^(der|die|das|zum|zur|nach|mit|tcp|tc)$/i.test(t));
  try {
    const store = useFuturePlanStore.getState();
    const dayKey = todayDateKey();
    store.ensureDay(dayKey);
    const plan = store.getPlanForDay(dayKey);
    const now = Date.now();
    const windowMs = 4 * 60 * 60_000;
    for (const s of [...plan.stops]) {
      if (isLiveNavLegId(s.id) || s.groupId === 'live_journey') {
        store.removeStop(s.id);
        continue;
      }
      const title = String(s.title || '').toLowerCase();
      const nearNow =
        s.plannedStartMs != null &&
        Math.abs(s.plannedStartMs - now) < windowMs;
      const nameHit =
        tokens.length > 0 &&
        tokens.some((tok) => title.includes(tok));
      const gid = String(s.groupId || '');
      const oepnvAuto =
        /^öpnv\\b/i.test(s.title || '') ||
        s.transport === 'transit' ||
        /^live_/i.test(gid) ||
        /journey|oepnv|transit|nav_/i.test(gid);
      // Nur Auto-Reisen rund um jetzt am Ziel räumen — manuelle Termine behalten.
      if (nearNow && nameHit && oepnvAuto) {
        if (s.groupId) {
          try {
            const { removePlanGroup } = require('./planLiveEdits') as {
              removePlanGroup: (g: string) => unknown;
            };
            removePlanGroup(s.groupId);
          } catch {
            store.removeStop(s.id);
          }
        } else {
          store.removeStop(s.id);
        }
      }
    }
  } catch {
    /* soft */
  }
}

/** Live-Leg + Tour-Spiegel entfernen. */
export function clearLiveNavFromPlan(opts?: { abandon?: boolean }): void {
""",
    "purge_stale_fn",
    already="purgeStaleJourneysForHardNav(destHint",
)

# Live mirror never counts as calendar conflict vs leftover plans
patch_once(
    "src/module2/planning/planTimeOverlap.ts",
    """function isCalendarConflictCandidate(s: FuturePlanStop): boolean {
  if (s.kind === 'wish' || s.kind === 'nav_leg') return false;
  if (s.id.startsWith('choice_')) return false;
  if (s.plannedStartMs == null) return false;
  return true;
}
""",
    """function isLiveNavMirrorStop(s: FuturePlanStop): boolean {
  if (s.kind === 'nav_leg') return true;
  if (s.groupId === 'live_journey') return true;
  if (/^live_nav_/i.test(s.id) || /^live_journey_/i.test(s.id)) return true;
  return false;
}

function isCalendarConflictCandidate(s: FuturePlanStop): boolean {
  if (s.kind === 'wish' || s.kind === 'nav_leg') return false;
  if (isLiveNavMirrorStop(s)) return false;
  if (s.id.startsWith('choice_')) return false;
  if (s.plannedStartMs == null) return false;
  return true;
}
""",
    "overlap_skip_live",
    already="isLiveNavMirrorStop",
)

# Prefs smoke: hydrate clears locks, no auto-restore
patch_once(
    "src/services/homeMap/homeMapHudFollowPrefs.smoke.test.ts",
    """assert(host.includes('applyHudFollowPrefs'), 'GPS-/Kompass-Tap nutzt HUD-Follow Prefs');
assert(host.includes('hydrateHomeMapHudFollowPrefs'), 'HUD-Prefs hydrieren');
assert(
  host.includes('noteHomeMapHudFollowPrefs({ locationFollow:'),
  'GPS-Button speichert Pref',
);
""",
    """assert(host.includes('applyHudFollowPrefs'), 'GPS-/Kompass-Tap nutzt HUD-Follow Prefs');
assert(host.includes('hydrateHomeMapHudFollowPrefs'), 'HUD-Prefs hydrieren');
assert(
  host.includes('Cold start: Karte immer frei') ||
    host.includes('locationFollow: false, headingFollow: false'),
  'Cold start ohne Auto-GPS-Lock',
);
assert(
  host.includes('noteHomeMapHudFollowPrefs({ locationFollow:'),
  'GPS-Button speichert Pref',
);
assert(
  host.includes('headingFollowRef.current = false') &&
    host.includes('setHeadingFollow(false)') &&
    host.includes('onNativeUserPan'),
  'Pan löst Standort- und Kompass-Follow',
);
""",
    "prefs_smoke_boot",
    already="Cold start ohne Auto-GPS-Lock",
)

# hardNav fail reply: no sorry tone
patch_once(
    "src/services/navigation/hardNavOverride.ts",
    """      reply:
        result.message ||
        `Ich finde „${name}“ gerade nicht. Sag den Namen nochmal?`,
""",
    """      reply:
        result.message ||
        `„${name}“ hab ich gerade nicht gefunden — sag den Namen nochmal.`,
""",
    "hardnav_no_sorry",
    already="hab ich gerade nicht gefunden",
)

print("batch3 done")
