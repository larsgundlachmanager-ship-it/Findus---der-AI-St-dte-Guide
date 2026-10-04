# -*- coding: utf-8 -*-
"""Force-write locked TS files via temp+replace with long retries."""
from __future__ import annotations

import os
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
MODAL = ROOT / "src/components/PlanCalendarModal.tsx"


def force_write(path: Path, text: str, tries: int = 24) -> None:
    tmp = path.with_name(path.name + ".tmpwrite")
    last: OSError | None = None
    tmp.write_text(text, encoding="utf-8", newline="\n")
    for i in range(tries):
        try:
            os.replace(str(tmp), str(path))
            print("replaced", path.name)
            return
        except OSError as e:
            last = e
            time.sleep(0.5 + i * 0.15)
    # last resort: copy bytes over
    try:
        with open(tmp, "rb") as src, open(path, "r+b") as dst:
            data = src.read()
            dst.seek(0)
            dst.write(data)
            dst.truncate(len(data))
        print("overwrote-in-place", path.name)
        try:
            tmp.unlink()
        except OSError:
            pass
        return
    except OSError as e:
        last = e
    raise SystemExit(f"write failed {path}: {last}")


def sub(text: str, old: str, new: str) -> str:
    if old not in text:
        raise SystemExit(f"MISSING:\n{old[:220]!r}")
    return text.replace(old, new, 1)


def main() -> None:
    text = MODAL.read_text(encoding="utf-8")

    text = sub(
        text,
        """import {
  reorderUpcomingTourStops,
  skipUpcomingTourStop,
} from '../services/navigation/multiStopTour';""",
        """import {
  applyUpcomingVisitOrder,
  reorderUpcomingTourStops,
  skipUpcomingTourStop,
} from '../services/navigation/multiStopTour';""",
    )

    text = sub(
        text,
        """          n.kind !== 'nav_leg' &&
          n.groupId !== 'live_journey' &&
          n.isProposal !== true,""",
        """          n.kind !== 'nav_leg' &&
          n.isProposal !== true &&
          (!n.groupId || n.groupId === 'live_journey'),""",
    )

    text = sub(
        text,
        """  const applyTimelineReorder = useCallback(
    (from: number, to: number) => {
      const node = timelineReorderable[from];
      const dest = timelineReorderable[to];
      if (!node || !dest) return;
      const fromId = planStopIdFromTimelineNodeId(node.id) ?? node.id;
      const toId = planStopIdFromTimelineNodeId(dest.id) ?? dest.id;
      const fromLive = isLiveNavLegId(fromId) && fromId !== LIVE_NAV_LEG_ID;
      const toLive = isLiveNavLegId(toId) && toId !== LIVE_NAV_LEG_ID;
      if (fromLive && toLive) {
        const live = timelineReorderable.filter((n) => {
          const id = planStopIdFromTimelineNodeId(n.id) ?? n.id;
          return isLiveNavLegId(id) && id !== LIVE_NAV_LEG_ID;
        });
        const a = live.findIndex((n) => n.id === node.id);
        const b = live.findIndex((n) => n.id === dest.id);
        if (a >= 0 && b >= 0 && a !== b) {
          reorderUpcomingTourStops(a, b);
          upsertLiveNavFromStore({ force: true });
        }
        return;
      }
      if (!fromLive && !toLive) {
        const planish = timelineReorderable.filter((n) => {
          const id = planStopIdFromTimelineNodeId(n.id) ?? n.id;
          return !(isLiveNavLegId(id) && id !== LIVE_NAV_LEG_ID);
        });
        const b = planish.findIndex((n) => n.id === dest.id);
        if (b >= 0) reorderTimedPlanStops(fromId, b);
      }
    },
    [timelineReorderable],
  );""",
        """  const applyTimelineReorder = useCallback(
    (from: number, to: number) => {
      const node = timelineReorderable[from];
      const dest = timelineReorderable[to];
      if (!node || !dest) return;
      const next = [...timelineReorderable];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      const visits = next
        .map((n) => {
          const id = planStopIdFromTimelineNodeId(n.id) ?? n.id;
          const stop = useFuturePlanStore
            .getState()
            .plan.stops.find((s) => s.id === id);
          const lat = stop?.lat;
          const lng = stop?.lng;
          if (typeof lat !== 'number' || typeof lng !== 'number') return null;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return {
            lat,
            lng,
            name: (stop?.title ?? n.title ?? '').replace(/^\\d+\\s*·\\s*/, ''),
          };
        })
        .filter((v): v is { lat: number; lng: number; name: string } => v != null);
      if (visits.length >= 2) {
        try {
          applyUpcomingVisitOrder(visits);
          upsertLiveNavFromStore({ force: true });
        } catch {
          /* soft */
        }
      }
      const fromId = planStopIdFromTimelineNodeId(node.id) ?? node.id;
      const toId = planStopIdFromTimelineNodeId(dest.id) ?? dest.id;
      const fromLive = isLiveNavLegId(fromId) && fromId !== LIVE_NAV_LEG_ID;
      const toLive = isLiveNavLegId(toId) && toId !== LIVE_NAV_LEG_ID;
      if (!fromLive && !toLive) {
        const planish = timelineReorderable.filter((n) => {
          const id = planStopIdFromTimelineNodeId(n.id) ?? n.id;
          return !(isLiveNavLegId(id) && id !== LIVE_NAV_LEG_ID);
        });
        const b = planish.findIndex((n) => n.id === dest.id);
        if (b >= 0) reorderTimedPlanStops(fromId, b);
      }
    },
    [timelineReorderable],
  );""",
    )

    text = sub(
        text,
        """            onMoveShouldSetPanResponder: (_e, g) =>
              Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
            onMoveShouldSetPanResponderCapture: (_e, g) =>
              Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,""",
        """            onMoveShouldSetPanResponder: (_e, g) =>
              Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
            onMoveShouldSetPanResponderCapture: (_e, g) =>
              Math.abs(g.dx) > 36 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,""",
    )

    # second swipe pan (TimelineRow) — replace_all remaining old thresholds if any
    if "Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy)" in text:
        text = text.replace(
            """            onMoveShouldSetPanResponder: (_e, g) =>
              Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
            onMoveShouldSetPanResponderCapture: (_e, g) =>
              Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,""",
            """            onMoveShouldSetPanResponder: (_e, g) =>
              Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
            onMoveShouldSetPanResponderCapture: (_e, g) =>
              Math.abs(g.dx) > 36 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,""",
        )

    text = sub(
        text,
        """  const canSwipeDelete =
    Boolean(onSwipeDelete) &&
    !isChoice &&
    node.kind !== 'reality' &&
    node.lane !== 'now' &&""",
        """  const canSwipeDelete =
    Boolean(onSwipeDelete) &&
    !isLiveNav &&
    !isChoice &&
    node.kind !== 'reality' &&
    node.lane !== 'now' &&""",
    )

    text = sub(
        text,
        """                                {collapsed ? '▸' : '▾'} Erinnerung · ÖPNV
                              </Text>
                              <Text style={styles.routeStripTitle} numberOfLines={2}>
                                {liveRouteLabel}
                                {liveLeaveArrive ? ` · ${liveLeaveArrive}` : ''}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={endLiveJourney}
                              style={styles.routeStripBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Route beenden"
                            >
                              <Text style={styles.routeStripBtnText}>Beenden</Text>
                            </Pressable>""",
        """                                {collapsed ? '▸' : '▾'}{' '}
                                {liveLeaveArrive
                                  ? 'Erinnerung · ÖPNV'
                                  : liveRouteLabel.startsWith('Fahrt') ||
                                      liveRouteLabel.startsWith('Reise')
                                    ? 'Fahrt'
                                    : 'Aktive Route'}
                              </Text>
                              <Text style={styles.routeStripTitle} numberOfLines={2}>
                                {liveRouteLabel}
                                {liveLeaveArrive ? ` · ${liveLeaveArrive}` : ''}
                              </Text>
                              <View style={[styles.navModeRow, { marginTop: 8 }]}>
                                {(
                                  [
                                    ['walk', '🚶'],
                                    ['bike', '🚲'],
                                    ['transit', '🚌'],
                                  ] as const
                                ).map(([mode, emoji]) => (
                                  <Pressable
                                    key={mode}
                                    hitSlop={6}
                                    style={styles.navModeBtn}
                                    onPress={() => setNavLegTransport(n, mode)}
                                  >
                                    <Text style={styles.navModeBtnText}>{emoji}</Text>
                                  </Pressable>
                                ))}
                              </View>
                            </Pressable>
                            <Pressable
                              onPress={endLiveJourney}
                              style={styles.routeStripBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Route beenden"
                            >
                              <Text style={styles.routeStripBtnText}>Beenden</Text>
                            </Pressable>""",
    )

    text = sub(
        text,
                                """                            style={[
                              styles.card,
                              styles.routeStrip,
                              styles.routeStripReminder,
                              { marginHorizontal: 0, marginBottom: 0, flex: 1 },
                            ]}""",
        """                            style={[
                              styles.card,
                              styles.routeStrip,
                              liveLeaveArrive ? styles.routeStripReminder : null,
                              { marginHorizontal: 0, marginBottom: 0, flex: 1 },
                            ]}""",
    )

    force_write(MODAL, text)

    # homeMapNavStart duplicate plan stop
    home = ROOT / "src/services/homeMap/homeMapNavStart.ts"
    ht = home.read_text(encoding="utf-8")
    ht2 = ht.replace(
        """        const { appendTourStop } = await import('../navigation/multiStopTour');
        const { addPlanStop } = await import(
          '../../module2/timeline/planLiveEdits'
        );
        const added = await appendTourStop(""",
        """        const { appendTourStop } = await import('../navigation/multiStopTour');
        const added = await appendTourStop(""",
        1,
    )
    ht2 = ht2.replace(
        """        if (added) {
          try {
            addPlanStop({
              title: dest.name,
              lat: dest.lat,
              lng: dest.lng,
              kind: 'stop',
            });
          } catch {
            /* soft */
          }
          notifyNavRouteGeometryChanged();""",
        """        if (added) {
          notifyNavRouteGeometryChanged();""",
        1,
    )
    if ht2 != ht:
        force_write(home, ht2)
    else:
        print("homeMapNavStart already patched or signature mismatch")

    print("done")


if __name__ == "__main__":
    main()
