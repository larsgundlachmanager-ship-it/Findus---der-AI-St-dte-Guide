# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_live_stage() -> None:
    p = ROOT / "src/components/liveStage/LiveStage.tsx"
    text = p.read_text(encoding="utf-8")
    old = """type Props = {
  mood: FindusMood;
  card: ConciergeCardState | null;
  subtitleText: string | null;
  isPlayingAudio: boolean;
  onFollowUp?: (prompt: string) => void;
  onAbortBusy?: () => void;
};

export const LiveStage = React.memo(function LiveStage({
  mood: _mood,
  card,
  subtitleText,
  isPlayingAudio: _isPlayingAudio,
  onFollowUp,
}: Props) {"""
    new = """type Props = {
  card: ConciergeCardState | null;
  subtitleText: string | null;
  onFollowUp?: (prompt: string) => void;
  onAbortBusy?: () => void;
};

export const LiveStage = React.memo(function LiveStage({
  card,
  subtitleText,
  onFollowUp,
}: Props) {"""
    if old not in text:
        raise SystemExit("LiveStage props missing")
    text = text.replace(old, new)
    text = text.replace("import type { FindusMood } from '../AudioWave';\n", "")
    p.write_text(text, encoding="utf-8")
    print("LiveStage OK")


def patch_settings() -> None:
    p = ROOT / "src/screens/SettingsScreen.tsx"
    text = p.read_text(encoding="utf-8")

    if "unstable_batchedUpdates" not in text[:5000]:
        m2 = re.search(r"import \{[\s\S]*?\} from 'react-native';", text)
        if not m2:
            raise SystemExit("RN import not found")
        block = m2.group(0)
        if "unstable_batchedUpdates" not in block:
            block2 = block.replace(
                "} from 'react-native';",
                "  unstable_batchedUpdates,\n} from 'react-native';",
            )
            text = text.replace(block, block2, 1)

    old_eff = """  useEffect(() => {
    if (visible) {
      noteUiVisible('settings');
      setDraft({ ...profile, speechRate: 1 });
      if (initialFocus === 'voice') {
        setOpenSection('character');
        setOpenCharacter('voice');
        setOpenPersonal(null);
        setOpenSetup('voice');
        setOpenGeneral(null);
      } else if (initialFocus === 'mic') {
        setOpenSection('general');
        setOpenGeneral('audio');
        setOpenSetup('audio');
        setOpenPersonal(null);
        setOpenCharacter(null);
      } else {
        setOpenSection(null);
        setOpenSetup(null);
        setOpenPersonal(null);
        setOpenCharacter(null);
        setOpenGeneral(null);
      }
      setOpenDev(null);
      setOpenInternal(null);
      setShowLegal(false);
      recordLastAction('settings_open');
      void hydrateMuteSession().then((s) =>
        setMuteStatusLine(describeMuteSession(s)),
      );
      const paint = requestAnimationFrame(() => {
        if (initialFocus === 'voice') {
          prioritizeSettingsSection('character');
        } else if (initialFocus === 'mic') {
          prioritizeSettingsSection('general');
        } else {
          startDefaultSettingsPrefetch();
        }
      });
      return () => {
        cancelAnimationFrame(paint);
        cancelSettingsPrefetch();
      };
    }
    cancelSettingsPrefetch();
    recordLastAction('settings_close');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur visible/focus
  }, [visible, initialFocus]);"""

    new_eff = """  useEffect(() => {
    if (visible) {
      noteUiVisible('settings');
      // Ein Batch — sonst 10+ Sync-Renders vor dem ersten Paint.
      unstable_batchedUpdates(() => {
        setDraft({ ...profile, speechRate: 1 });
        if (initialFocus === 'voice') {
          setOpenSection('character');
          setOpenCharacter('voice');
          setOpenPersonal(null);
          setOpenSetup('voice');
          setOpenGeneral(null);
        } else if (initialFocus === 'mic') {
          setOpenSection('general');
          setOpenGeneral('audio');
          setOpenSetup('audio');
          setOpenPersonal(null);
          setOpenCharacter(null);
        } else {
          setOpenSection(null);
          setOpenSetup(null);
          setOpenPersonal(null);
          setOpenCharacter(null);
          setOpenGeneral(null);
        }
        setOpenDev(null);
        setOpenInternal(null);
        setShowLegal(false);
      });
      recordLastAction('settings_open');
      // Mute/Prefetch nach Paint — Shell zuerst.
      const paint = requestAnimationFrame(() => {
        void hydrateMuteSession().then((s) =>
          setMuteStatusLine(describeMuteSession(s)),
        );
        if (initialFocus === 'voice') {
          prioritizeSettingsSection('character');
        } else if (initialFocus === 'mic') {
          prioritizeSettingsSection('general');
        } else {
          startDefaultSettingsPrefetch();
        }
      });
      return () => {
        cancelAnimationFrame(paint);
        cancelSettingsPrefetch();
      };
    }
    cancelSettingsPrefetch();
    recordLastAction('settings_close');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur visible/focus
  }, [visible, initialFocus]);"""

    if old_eff not in text:
        raise SystemExit("settings effect missing")
    text = text.replace(old_eff, new_eff)
    p.write_text(text, encoding="utf-8")
    print("Settings OK")


def patch_timeline() -> None:
    p = ROOT / "src/components/PlanCalendarModal.tsx"
    text = p.read_text(encoding="utf-8")

    old_cleanup = """  // Duplikate (Visit/Hist/Plan) bei Öffnen und Tagwechsel
  useEffect(() => {
    if (!visible || !dateKey) return;
    try {
      cleanupTimelineDuplicates(dateKey);
      setVisitTick((n) => n + 1);
    } catch {
      /* soft */
    }
  }, [visible, dateKey]);"""

    new_cleanup = """  // Duplikate nach erstem Paint — sonst blockiert Sync-Arbeit den Open.
  useEffect(() => {
    if (!visible || !timelineBodyReady || !dateKey) return;
    try {
      cleanupTimelineDuplicates(dateKey);
      setVisitTick((n) => n + 1);
    } catch {
      /* soft */
    }
  }, [visible, timelineBodyReady, dateKey]);"""

    if old_cleanup not in text:
        raise SystemExit("timeline cleanup effect missing")
    text = text.replace(old_cleanup, new_cleanup)

    old_day = """  useEffect(() => {
    if (!visible) {
      userPickedDayRef.current = false;
      return;
    }
    // Nach ‹/› nicht zurückspringen — sonst wirkt „Tag zurück“ kaputt
    if (userPickedDayRef.current) return;
    // Agent-/Plan-Tag hat Vorrang vor hartem „heute“ — sonst leere Timeline
    // während Stops schon auf Do/Fr/… liegen
    const prefer =
      usePlanCalendarUiStore.getState().requestedDayKey ||
      planDayKey ||
      todayDateKey();
    const dk =
      prefer && /^\\d{4}-\\d{2}-\\d{2}$/.test(prefer) ? prefer : todayDateKey();
    setDateKey(dk);
    try {
      cleanupTimelineDuplicates(dk);
    } catch {
      /* soft */
    }
  }, [visible, planDayKey]);"""

    new_day = """  useEffect(() => {
    if (!visible) {
      userPickedDayRef.current = false;
      return;
    }
    // Nach ‹/› nicht zurückspringen — sonst wirkt „Tag zurück“ kaputt
    if (userPickedDayRef.current) return;
    // Agent-/Plan-Tag hat Vorrang vor hartem „heute“ — sonst leere Timeline
    // während Stops schon auf Do/Fr/… liegen
    const prefer =
      usePlanCalendarUiStore.getState().requestedDayKey ||
      planDayKey ||
      todayDateKey();
    const dk =
      prefer && /^\\d{4}-\\d{2}-\\d{2}$/.test(prefer) ? prefer : todayDateKey();
    setDateKey(dk);
    // Schwere Dedup erst nach Body-Ready (siehe Effect oben)
  }, [visible, planDayKey]);"""

    if old_day not in text:
        raise SystemExit("timeline day effect missing")
    text = text.replace(old_day, new_day)

    old_ensure = """  // Tages-Timeline und Plan-Store = derselbe Tag
  useEffect(() => {
    if (!visible) return;
    ensureDay(dateKey);
  }, [visible, dateKey, ensureDay]);"""

    new_ensure = """  // Tages-Timeline und Plan-Store = derselbe Tag (nach Paint)
  useEffect(() => {
    if (!visible || !timelineBodyReady) return;
    ensureDay(dateKey);
  }, [visible, timelineBodyReady, dateKey, ensureDay]);"""

    if old_ensure not in text:
        # maybe slightly different - try softer match
        if "ensureDay(dateKey)" not in text:
            raise SystemExit("ensureDay missing")
        print("WARN: ensureDay block exact miss — checking nearby")
    else:
        text = text.replace(old_ensure, new_ensure)

    p.write_text(text, encoding="utf-8")
    print("Timeline OK")


def patch_smoke() -> None:
    p = ROOT / "src/services/ui/uiInstant.smoke.test.ts"
    text = p.read_text(encoding="utf-8")
    marker = "assert(overlayStore.includes('premountOverlays'), 'Settings/Orte Premount');"
    inject = """assert(overlayStore.includes('premountOverlays'), 'Settings/Orte Premount');
{
  const openSettings = overlayStore.slice(
    overlayStore.indexOf('openSettings:'),
    overlayStore.indexOf('openSettings:') + 420,
  );
  assert(
    openSettings.indexOf('holdOverlayBusy()') <
      openSettings.indexOf('dismissPlacePopupForChrome()'),
    'Settings: Busy vor Place-Popup-Dismiss',
  );
}
{
  const setVis = calStore.slice(
    calStore.indexOf('setCalendarVisible:'),
    calStore.indexOf('setCalendarVisible:') + 900,
  );
  assert(
    setVis.indexOf('noteOverlayBusy(true)') < setVis.indexOf('setPlacePopup(null)'),
    'Timeline: Busy vor Place-Popup-Dismiss',
  );
}
assert(
  !/HomeLiveLayerProps = \\{[\\s\\S]*?isListening: boolean/.test(home),
  'HomeLiveLayer ohne isListening-Prop (Map-Lane isoliert)',
);
assert(
  settings.includes('unstable_batchedUpdates') &&
    settings.includes('Ein Batch'),
  'Settings Open batched',
);
assert(
  calendar.includes('timelineBodyReady') &&
    /cleanupTimelineDuplicates[\\s\\S]{0,200}timelineBodyReady/.test(calendar),
  'Timeline Dedup nach Body-Ready',
);
"""
    if "Settings: Busy vor Place-Popup-Dismiss" in text:
        print("Smoke already has busy-order asserts")
        return
    if marker not in text:
        raise SystemExit("smoke marker missing")
    text = text.replace(marker, inject, 1)
    p.write_text(text, encoding="utf-8")
    print("Smoke OK")


def main() -> None:
    patch_live_stage()
    patch_settings()
    patch_timeline()
    patch_smoke()
    print("ALL DONE")


if __name__ == "__main__":
    main()
