import os
from pathlib import Path

ROOT = Path(r"c:/Users/larsf/Findus 2.0")


def w(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    print("wrote", path.relative_to(ROOT))


# --- LiveStage: helper = dock only (map under mic) ---
live = ROOT / "src/components/liveStage/LiveStage.tsx"
lt = live.read_text(encoding="utf-8")
old_helper = """/** Unterkante MapLibre: Dock + Mic-Hit inkl. Pad — sonst frisst TextureView Touches (Nothing). */
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
}"""
new_helper = """/**
 * Nur Dock-Streifen aus der Map schneiden (Deck-Hintergrund).
 * Mic schwebt auf der Karte — Touches kommen über Chrome-Shield (Elevation), nicht via Map-Ausschnitt.
 */
export function homeMapBottomChromePx(safeBottom: number, _buttonMul = 1): number {
  return HOME_DOCK_BAR_H + Math.max(0, Math.round(safeBottom));
}"""
if old_helper not in lt:
    raise SystemExit("helper block not found")
w(live, lt.replace(old_helper, new_helper, 1))

# --- HomeScreen: chrome shield ---
hs = ROOT / "src/screens/HomeScreen.tsx"
ht = hs.read_text(encoding="utf-8")

# Simplify imports — can keep homeMapBottomChromePx; buttonMul still used? only for chrome calc — can remove useUiScale if unused
if "useUiScaleStore" in ht and "buttonMul" in ht:
    ht = ht.replace(
        "  const buttonMul = useUiScaleStore((s) => s.buttonMul);\n  const mapBottomChrome = homeMapBottomChromePx(safePad.bottom, buttonMul);",
        "  const mapBottomChrome = homeMapBottomChromePx(safePad.bottom);",
        1,
    )
    # remove unused import if no longer referenced
    if "useUiScaleStore" not in ht.split("from '../services/ui/uiScale'")[0][-200:]:
        pass
    if ht.count("useUiScaleStore") == 1:  # only the import left
        ht = ht.replace(
            "import { useUiScaleStore } from '../services/ui/uiScale';\n",
            "",
            1,
        )

old_chrome = """  return (
    <>
      <View
        style={[
          styles.micFloat,
          {
            bottom:
              HOME_DOCK_BAR_H +
              safePadBottom +
              HOME_MIC_DOCK_GAP +
              HOME_MIC_HINT_RESERVE,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.micCenter} pointerEvents="auto">
          <MicButton
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            onSwipeLock={onSwipeLock}
            onSwipeLiveChat={onSwipeLiveChat}
            isListening={isListening}
            isMicLocked={isMicLocked}
            isFinalizing={isFinalizing}
            isGenerating={isGenerating}
            isSpeaking={isAudiblySpeaking}
            mood={phinnosMood}
            onAbortBusy={onAbortBusy}
            partialText={partialText}
          />
        </View>
        {isSimulationMode ? (
          <View style={styles.micSideLeft} pointerEvents="box-none">
            <SimulationPicker pois={pois} visible layout="micFab" />
          </View>
        ) : null}
      </View>

      <View style={styles.dockWrap} pointerEvents="box-none">
        <HomeDockBar
          onTimeline={onOpenPlanCalendar}
          onPlaces={onPlaces}
          onSettings={onSettings}
        />
      </View>
    </>
  );"""

new_chrome = """  return (
    // Fullscreen Elevation-Shield: MapLibre-TextureView sonst frisst Mic/Dock-Touches (Nothing).
    // box-none → Karte darunter weiter pannbar; nur Kinder fangen Taps.
    <View style={styles.chromeShield} pointerEvents="box-none" collapsable={false}>
      <View
        style={[
          styles.micFloat,
          {
            bottom:
              HOME_DOCK_BAR_H +
              safePadBottom +
              HOME_MIC_DOCK_GAP +
              HOME_MIC_HINT_RESERVE,
          },
        ]}
        pointerEvents="box-none"
        collapsable={false}
      >
        <View style={styles.micCenter} pointerEvents="auto" collapsable={false}>
          <MicButton
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            onSwipeLock={onSwipeLock}
            onSwipeLiveChat={onSwipeLiveChat}
            isListening={isListening}
            isMicLocked={isMicLocked}
            isFinalizing={isFinalizing}
            isGenerating={isGenerating}
            isSpeaking={isAudiblySpeaking}
            mood={phinnosMood}
            onAbortBusy={onAbortBusy}
            partialText={partialText}
          />
        </View>
        {isSimulationMode ? (
          <View style={styles.micSideLeft} pointerEvents="box-none">
            <SimulationPicker pois={pois} visible layout="micFab" />
          </View>
        ) : null}
      </View>

      <View style={styles.dockWrap} pointerEvents="box-none" collapsable={false}>
        <HomeDockBar
          onTimeline={onOpenPlanCalendar}
          onPlaces={onPlaces}
          onSettings={onSettings}
        />
      </View>
    </View>
  );"""

if old_chrome not in ht:
    raise SystemExit("chrome return block not found")
ht = ht.replace(old_chrome, new_chrome, 1)

# Add chromeShield style
if "chromeShield:" not in ht:
    ht = ht.replace(
        """const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },""",
        """const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  /** Android/MapLibre: Elevation über TextureView, ohne Karte zuzudecken. */
  chromeShield: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.sheet,
    elevation: UI_LAYER.sheet + 40,
  },""",
        1,
    )

# bump mic/dock elevation further
ht = ht.replace(
    """  micFloat: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: UI_LAYER.sheet - 1,
    elevation: UI_LAYER.sheet - 1,
  },""",
    """  micFloat: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: UI_LAYER.sheet,
    elevation: UI_LAYER.sheet + 8,
  },""",
    1,
)
ht = ht.replace(
    """  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud + 20,
  },""",
    """  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: UI_LAYER.sheet,
    elevation: UI_LAYER.sheet + 8,
  },""",
    1,
)

w(hs, ht)

# ExploreChip: ensure elevation + collapsable on wrap usage — already has elev
# HomePresenceMap: also elevate explore by wrapping — optional

# Bump version 2.0.81 / 108
app = ROOT / "app.json"
at = app.read_text(encoding="utf-8")
at = at.replace('"version": "2.0.80"', '"version": "2.0.81"', 1)
at = at.replace('"versionCode": 107', '"versionCode": 108', 1)
w(app, at)

gradle = ROOT / "android/app/build.gradle"
gt = gradle.read_text(encoding="utf-8")
gt = gt.replace("versionCode 107", "versionCode 108", 1)
gt = gt.replace('versionName "2.0.80"', 'versionName "2.0.81"', 1)
w(gradle, gt)

rel = ROOT / "releases/2.0.81"
rel.mkdir(parents=True, exist_ok=True)
(rel / "whatsnew-de-DE-v108.txt").write_text(
    "Touch-Fix: Mikrofon und Dock wieder über der Karte tippbar — ohne dunklen "
    "Streifen unter dem Mic. Karte liegt wieder unter Mic/Dock.\n",
    encoding="utf-8",
)
print("release notes ok")
print("DONE")
