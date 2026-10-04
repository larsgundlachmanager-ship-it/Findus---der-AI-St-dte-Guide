from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\homeMapNavStart.ts")
t = p.read_text(encoding="utf-8")
old = """      try {
        // Wie Speech/Pitch: kürzeste Reihenfolge, nicht hinten anhängen.
        const { addOptimizedTourStop, appendTourStop } = await import(
          '../navigation/multiStopTour'
        );
        const stop = {
          poiId: dest.poiId ?? -1,
          name: dest.name,
          lat: dest.lat,
          lng: dest.lng,
          done: false as const,
          priority: 'high' as const,
          remindMinBefore: null,
        };
        const optimized = await addOptimizedTourStop(stop, { startNow: true });
        const added = optimized ?? (await appendTourStop(stop, { startNow: true }));
        if (added) {
          try {
            const { addPlanStop } = await import(
              '../../module2/timeline/planLiveEdits'
            );
            addPlanStop({
              title: dest.name,
              lat: dest.lat,
              lng: dest.lng,
              kind: 'stop',
            });
          } catch {
            /* soft */
          }
          notifyNavRouteGeometryChanged();
          try {
            useFinnusStore.getState().setNavRouteLoading(false);
            useFinnusStore.getState().setIsGenerating(false);
          } catch {
            /* soft */
          }
          return { ok: true, mode: 'walk' };
        }
      } catch (err) {
        console.warn('[nav] addStop failed', err);
      }
"""
new = """      try {
        // Wie Speech: Tour = SSOT; Timeline nur Live-Spiegel (kein addPlanStop).
        const { addOptimizedTourStop, appendTourStop } = await import(
          '../navigation/multiStopTour'
        );
        const stop = {
          poiId: dest.poiId ?? -1,
          name: dest.name,
          lat: dest.lat,
          lng: dest.lng,
          done: false as const,
          priority: 'high' as const,
          remindMinBefore: null,
        };
        const optimized = await addOptimizedTourStop(stop, { startNow: true });
        const added = optimized ?? (await appendTourStop(stop, { startNow: true }));
        if (added) {
          notifyNavRouteGeometryChanged();
          try {
            useFinnusStore.getState().setNavRouteLoading(false);
            useFinnusStore.getState().setIsGenerating(false);
          } catch {
            /* soft */
          }
          return { ok: true, mode: 'walk' };
        }
      } catch (err) {
        console.warn('[nav] addStop failed', err);
      }
"""
if old not in t:
    # maybe already partially patched
    if 'addPlanStop' in t and 'addOptimizedTourStop' in t:
        # strip addPlanStop block
        import re
        t2 = re.sub(
            r"try \{\s*const \{ addPlanStop \} = await import\(\s*'../../module2/timeline/planLiveEdits'\s*\);\s*addPlanStop\(\{[^}]+\}\);\s*\} catch \{\s*/\* soft \*/\s*\}\s*",
            "",
            t,
            count=1,
        )
        if t2 == t:
            raise SystemExit('homeMap pattern missing')
        t = t2
        print('stripped addPlanStop via regex')
    else:
        raise SystemExit('homeMap already clean or unexpected')
else:
    t = t.replace(old, new, 1)
    print('homeMap replaced')

tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_home_map_ssot.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
try:
    p.unlink()
except Exception as e:
    print("unlink", e)
p.write_bytes(tmp.read_bytes())
print("home ok", "addPlanStop" in p.read_text(encoding="utf-8"))

# also patch planLiveEdits comment
ed = Path(r"c:\Users\larsf\Findus 2.0\src\module2\timeline\planLiveEdits.ts")
et = ed.read_text(encoding="utf-8")
et2 = et.replace(
    "/** Timeline-Add → Multi-Stop-Tour (gleiche Koordinaten, Append hinten). */",
    "/** Timeline-Add → Multi-Stop-Tour (gleiche Koordinaten, optimierte Reihenfolge). */",
    1,
)
if et2 != et:
    tmp2 = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_plan_edits.ts")
    tmp2.write_text(et2, encoding="utf-8", newline="\n")
    try:
        ed.unlink()
    except Exception as e:
        print("unlink ed", e)
    ed.write_bytes(tmp2.read_bytes())
    print("planLiveEdits comment ok")
