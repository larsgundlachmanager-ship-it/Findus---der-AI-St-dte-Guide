# -*- coding: utf-8 -*-
from pathlib import Path
import os, time

root = Path(r"c:\Users\larsf\Findus 2.0")
p = root / "src/components/PlanCalendarModal.tsx"
t = p.read_text(encoding="utf-8")
orig = t

# 1) Import resolveOverlapsQuietly
old_imp = "import { hasTimeOverlap } from '../module2/planning/planConflictResolve';"
new_imp = "import {\n  hasTimeOverlap,\n  resolveOverlapsQuietly,\n} from '../module2/planning/planConflictResolve';"
if "resolveOverlapsQuietly" not in t.split("planConflictResolve")[0] + t.split("planConflictResolve")[1][:200]:
    pass
if old_imp in t:
    t = t.replace(old_imp, new_imp, 1)
    print("import updated")
elif "resolveOverlapsQuietly" in t and "from '../module2/planning/planConflictResolve'" in t:
    print("import already ok")
else:
    raise SystemExit("import anchor missing")

# 2) Harden isCardBoundPlaceLinkAction
old_bound = """/** Maps / Speisekarte / Website gehören auf die Stop-Karte, nicht ins Top-Chrome. */
function isCardBoundPlaceLinkAction(a: QuickAction): boolean {
  if (isMapsQuickAction(a)) return true;
  if (a.type !== 'OPEN_URL') return false;
  const label = String(a.label ?? '');
  return /speisekarte|🍽|🌐|\\bwebsite\\b|\\bmenu\\b|lageplan/i.test(label);
}
"""

new_bound = """/** Maps / Speisekarte / Website gehören auf die Stop-Karte, nicht ins Top-Chrome. */
function isCardBoundPlaceLinkAction(a: QuickAction): boolean {
  if (isMapsQuickAction(a)) return true;
  if (a.type !== 'OPEN_URL') return false;
  const label = String(a.label ?? '');
  const url = String(a.payload?.url ?? '');
  if (
    /speisekarte|🍽|🌐|\\bwebsite\\b|\\bmenu\\b|lageplan|maps|reservier|tisch\\s*buch/i.test(
      label,
    )
  ) {
    return true;
  }
  // URL-Heuristik: Place-Links nie im Top-Strip
  if (
    /google\\.[^/]*\\/maps|maps\\.google|maps\\.app\\.goo\\.gl|speisekarte|\\/menu\\b|tripadvisor|opentable|quandoo/i.test(
      url,
    )
  ) {
    return true;
  }
  return false;
}
"""

if "tripadvisor|opentable|quandoo" in t:
    print("isCardBound already hardened")
elif old_bound in t:
    t = t.replace(old_bound, new_bound, 1)
    print("isCardBound hardened")
else:
    # try looser match
    if "function isCardBoundPlaceLinkAction" in t:
        print("WARNING: isCardBound present but exact match failed — skip")
    else:
        raise SystemExit("isCardBound missing")

# 3) isFallback: never stale ? for journey-group members
old_fb = "  const isFallback = node.routeEstimate === 'fallback' || routeComputing;"
new_fb = """  // Journey-Gruppe = geroutet — kein dauerhaftes „?“ / „~ unterwegs“
  const isFallback =
    !node.groupId &&
    (node.routeEstimate === 'fallback' || Boolean(routeComputing));"""
if "!node.groupId &&" in t and "isFallback" in t[t.find("const isFallback"):t.find("const isFallback")+120]:
    print("isFallback already gated")
elif old_fb in t:
    t = t.replace(old_fb, new_fb, 1)
    print("isFallback gated")
else:
    raise SystemExit("isFallback missing")

# 4) Banner: only hasTimeOverlap after quiet resolve
old_banner = """  const conflictCount = nodes.filter((n) => n.tone === 'conflict').length;
  const openConflictCount = visibleOpenPlans.filter(
    (p) => p.status === 'conflict',
  ).length;
  const hasOverlapConflict =
    showPlanningChrome &&
    (conflictCount + openConflictCount > 0 || hasTimeOverlap());
"""

new_banner = """  // Banner nur nach quiet resolve — Tone/Status allein reichen nicht
  const hasOverlapConflict = showPlanningChrome && hasTimeOverlap();
  const conflictCount = nodes.filter((n) => n.tone === 'conflict').length;
  const openConflictCount = visibleOpenPlans.filter(
    (p) => p.status === 'conflict',
  ).length;
  void conflictCount;
  void openConflictCount;
"""

# Prefer keeping counts for banner text if still used
# Check banner text usage
if "conflictCount + openConflictCount" in t[t.find("hasOverlapConflict"):t.find("hasOverlapConflict")+400]:
    # keep counts for label
    new_banner = """  // Banner nur nach quiet resolve — Tone/Status allein reichen nicht
  const hasOverlapConflict = showPlanningChrome && hasTimeOverlap();
  const conflictCount = nodes.filter((n) => n.tone === 'conflict').length;
  const openConflictCount = visibleOpenPlans.filter(
    (p) => p.status === 'conflict',
  ).length;
"""

if "Banner nur nach quiet resolve" in t:
    print("banner already gated")
elif old_banner in t:
    t = t.replace(old_banner, new_banner, 1)
    print("banner gated")
else:
    raise SystemExit("banner block missing")

# 5) Quiet resolve on open / plan update
marker = "  const routeComputingIds = usePlanCalendarUiStore((s) => s.routeComputingIds);"
quiet_effect = """  const routeComputingIds = usePlanCalendarUiStore((s) => s.routeComputingIds);

  // Soft-Overlaps vor Banner still lösen (Schritt 4/5)
  useEffect(() => {
    if (!visible) return;
    try {
      resolveOverlapsQuietly({ speakIfStuck: false });
    } catch {
      /* soft */
    }
  }, [visible, dateKey, planUpdated, plansRevision]);
"""

# plansRevision may not be in scope yet at that line — check
# Look for where plansRevision is defined
if "resolveOverlapsQuietly({ speakIfStuck: false })" in t and "Soft-Overlaps vor Banner" in t:
    print("quiet effect already present")
else:
    # Insert near other effects after planUpdated is available
    # Find a safe spot: after `const planUpdated = ...`
    anchor = "  const planUpdated = useFuturePlanStore((s) => s.plan.updatedAtMs);"
    if "Soft-Overlaps vor Banner" in t:
        print("quiet effect marker present")
    elif anchor not in t:
        raise SystemExit("planUpdated anchor missing")
    else:
        insert = """  const planUpdated = useFuturePlanStore((s) => s.plan.updatedAtMs);

  useEffect(() => {
    if (!visible) return;
    try {
      resolveOverlapsQuietly({ speakIfStuck: false });
    } catch {
      /* soft */
    }
  }, [visible, dateKey, planUpdated]);
"""
        t = t.replace(anchor, insert, 1)
        print("quiet effect inserted")

# 6) routeComputing: skip when group already routed
old_rc = """                      routeComputing={(() => {
                        const nid =
                          planStopIdFromTimelineNodeId(n.id) ?? n.id;
                        if (routeComputingIds[nid]) return true;
                        const m = /^ft:([^:]+):/i.exec(nid);
                        if (!m) return false;
                        return Object.keys(routeComputingIds).some((k) =>
                          k.startsWith(`ft:${m[1]}:`),
                        );
                      })()}
"""

new_rc = """                      routeComputing={(() => {
                        // Echte Journey-Gruppe: kein Spinner/„?“ mehr
                        if (
                          n.groupId &&
                          n.routeEstimate === 'routed'
                        ) {
                          return false;
                        }
                        if (n.groupId && n.routeEstimate !== 'fallback') {
                          return false;
                        }
                        const nid =
                          planStopIdFromTimelineNodeId(n.id) ?? n.id;
                        if (routeComputingIds[nid]) return true;
                        if (
                          n.groupId &&
                          routeComputingIds[n.groupId]
                        ) {
                          // Gruppe schon geroutet → Computing-Flag stale
                          return n.routeEstimate === 'fallback';
                        }
                        const m = /^ft:([^:]+):/i.exec(nid);
                        if (!m) return false;
                        return Object.keys(routeComputingIds).some((k) =>
                          k.startsWith(`ft:${m[1]}:`),
                        );
                      })()}
"""

if "Echte Journey-Gruppe: kein Spinner" in t:
    print("routeComputing already gated")
elif old_rc in t:
    t = t.replace(old_rc, new_rc, 1)
    print("routeComputing gated")
else:
    print("WARNING: routeComputing block exact match failed")

if t == orig:
    print("NO CHANGES")
else:
    tmp = p.with_suffix(".tsx.tmpwrite")
    tmp.write_text(t, encoding="utf-8")
    for i in range(12):
        try:
            os.replace(tmp, p)
            print("PlanCalendarModal written")
            break
        except Exception as e:
            print("retry", i, e)
            time.sleep(0.5)
    else:
        raise SystemExit("could not write PlanCalendarModal")