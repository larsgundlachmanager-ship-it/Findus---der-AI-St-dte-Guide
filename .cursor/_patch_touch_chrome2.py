from pathlib import Path

# 1) Add homeMapBottomChromePx helper in LiveStage.tsx
live = Path(r"c:/Users/larsf/Findus 2.0/src/components/liveStage/LiveStage.tsx")
lt = live.read_text(encoding="utf-8")
helper = '''
/** Unterkante MapLibre: Dock + Mic-Hit inkl. Pad — sonst frisst TextureView Touches (Nothing). */
export function homeMapBottomChromePx(safeBottom: number, buttonMul = 1): number {
  const mul = Math.max(1, buttonMul);
  const btn = Math.round(HOME_MIC_BTN * mul);
  return (
    HOME_DOCK_BAR_H +
    Math.max(0, Math.round(safeBottom)) +
    HOME_MIC_DOCK_GAP +
    HOME_MIC_HINT_RESERVE +
    btn +
    HOME_MIC_HIT_PAD +
    16
  );
}
'''
if "homeMapBottomChromePx" not in lt:
    anchor = "export function homeMicClearancePx(buttonMul = 1): number {"
    if anchor not in lt:
        raise SystemExit("homeMicClearancePx not found")
    lt = lt.replace(anchor, helper + "\n" + anchor, 1)
    tmp = live.with_suffix(".tsx.tmp")
    tmp.write_text(lt, encoding="utf-8")
    tmp.replace(live)
    print("LiveStage helper added")
else:
    print("LiveStage helper exists")

# 2) export from index
idx = Path(r"c:/Users/larsf/Findus 2.0/src/components/liveStage/index.ts")
it = idx.read_text(encoding="utf-8")
if "homeMapBottomChromePx" not in it:
    it = it.replace(
        "  homeMicClearancePx,\n} from './LiveStage';",
        "  homeMicClearancePx,\n  homeMapBottomChromePx,\n} from './LiveStage';",
        1,
    )
    idx.write_text(it, encoding="utf-8")
    print("index export ok")
else:
    print("index export exists")

# 3) HomeScreen use helper + buttonMul
hs = Path(r"c:/Users/larsf/Findus 2.0/src/screens/HomeScreen.tsx")
ht = hs.read_text(encoding="utf-8")
# imports
if "homeMapBottomChromePx" not in ht:
    ht = ht.replace(
        """import {
  LiveStage,
  HOME_DOCK_BAR_H,
  HOME_MIC_DOCK_GAP,
  HOME_MIC_HINT_RESERVE,
  HOME_MIC_BTN,
  HOME_MIC_HIT_PAD,
} from '../components/liveStage';""",
        """import {
  LiveStage,
  HOME_DOCK_BAR_H,
  HOME_MIC_DOCK_GAP,
  HOME_MIC_HINT_RESERVE,
  homeMapBottomChromePx,
} from '../components/liveStage';""",
        1,
    )
if "useUiScaleStore" not in ht:
    # add import near other stores
    needle = "import { usePlanCalendarUiStore } from '../module2/timeline/planCalendarUiStore';"
    if needle not in ht:
        raise SystemExit("plan calendar import missing")
    ht = ht.replace(
        needle,
        needle
        + "\nimport { useUiScaleStore } from '../services/ui/uiScale';",
        1,
    )

old_chrome = """  const mapBottomChrome =
    HOME_DOCK_BAR_H +
    safePad.bottom +
    // MapLibre-Touchfläche darf Mic nicht überdecken (Nothing: sonst nur Pan).
    HOME_MIC_BTN +
    Math.round(HOME_MIC_HIT_PAD / 2) +
    HOME_MIC_DOCK_GAP +
    HOME_MIC_HINT_RESERVE;"""
new_chrome = """  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  const mapBottomChrome = homeMapBottomChromePx(safePad.bottom, buttonMul);"""
if old_chrome in ht:
    ht = ht.replace(old_chrome, new_chrome, 1)
elif "homeMapBottomChromePx(safePad.bottom" not in ht:
    raise SystemExit("HomeScreen chrome block not found")
tmp = hs.with_suffix(".tsx.tmp")
tmp.write_text(ht, encoding="utf-8")
tmp.replace(hs)
print("HomeScreen chrome ok")

# 4) OnboardingNavigator
nav = Path(r"c:/Users/larsf/Findus 2.0/src/onboarding/OnboardingNavigator.tsx")
nt = nav.read_text(encoding="utf-8")
if "homeMapBottomChromePx" not in nt:
    # fix imports - may have HOME_MIC_BTN etc.
    if "homeMapBottomChromePx" not in nt:
        nt = nt.replace(
            "HOME_MIC_HINT_RESERVE,\n  HOME_MIC_BTN,\n  HOME_MIC_HIT_PAD,",
            "HOME_MIC_HINT_RESERVE,\n  homeMapBottomChromePx,",
            1,
        )
        if "homeMapBottomChromePx" not in nt.split("from '../components/liveStage'")[0][-400:]:
            # alternate import shape
            nt = nt.replace(
                "} from '../components/liveStage';",
                "  homeMapBottomChromePx,\n} from '../components/liveStage';",
                1,
            )
    old = """  const mapBottomChrome =
    HOME_DOCK_BAR_H +
    safePad.bottom +
    HOME_MIC_BTN +
    Math.round(HOME_MIC_HIT_PAD / 2) +
    HOME_MIC_DOCK_GAP +
    HOME_MIC_HINT_RESERVE;"""
    new = "  const mapBottomChrome = homeMapBottomChromePx(safePad.bottom);"
    if old not in nt:
        raise SystemExit("onboarding chrome not found")
    nt = nt.replace(old, new, 1)
    tmp = nav.with_suffix(".tsx.tmp")
    tmp.write_text(nt, encoding="utf-8")
    tmp.replace(nav)
    print("Onboarding chrome ok")
else:
    print("Onboarding already uses helper")

# 5) Dock bar elevation
dock = Path(r"c:/Users/larsf/Findus 2.0/src/components/HomeDockBar.tsx")
dt = dock.read_text(encoding="utf-8")
if "elevation: UI_LAYER.hud" not in dt:
    dt = dt.replace(
        """  bar: {
    zIndex: UI_LAYER.hud,
    flexDirection: 'row',""",
        """  bar: {
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud + 40,
    flexDirection: 'row',""",
        1,
    )
    tmp = dock.with_suffix(".tsx.tmp")
    tmp.write_text(dt, encoding="utf-8")
    tmp.replace(dock)
    print("dock elevation ok")
else:
    print("dock elevation exists")

# verify explore chip
chip = Path(r"c:/Users/larsf/Findus 2.0/src/components/homeMap/HomeMapExploreChip.tsx")
ct = chip.read_text(encoding="utf-8")
print("explore elev", "elevation: UI_LAYER.hud + 40" in ct)
