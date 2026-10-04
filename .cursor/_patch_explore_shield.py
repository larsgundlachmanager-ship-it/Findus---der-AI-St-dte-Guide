import os
from pathlib import Path

p = Path(r"c:/Users/larsf/Findus 2.0/src/components/homeMap/HomePresenceMap.tsx")
t = p.read_text(encoding="utf-8")
if "exploreShield" in t:
    print("explore shield exists")
else:
    old = """      <HomeMapExploreChip
        line={exploreLine}
        top={12}
        onRecenter={onRecenter}
        onRecenterLock={onRecenterLock}
        onNorthUp={onNorthUp}
        onNorthLongPress={onNorthLongPress}
        onCalibrate={onCalibrateCompass}
        locationFollow={locationFollow}
        headingFollow={headingFollow}
        needsCalibration={needsCalibration}
        calibrating={calibrateOpen}
      />"""
    new = """      <View
        pointerEvents="box-none"
        collapsable={false}
        style={styles.exploreShield}
      >
        <HomeMapExploreChip
          line={exploreLine}
          top={12}
          onRecenter={onRecenter}
          onRecenterLock={onRecenterLock}
          onNorthUp={onNorthUp}
          onNorthLongPress={onNorthLongPress}
          onCalibrate={onCalibrateCompass}
          locationFollow={locationFollow}
          headingFollow={headingFollow}
          needsCalibration={needsCalibration}
          calibrating={calibrateOpen}
        />
      </View>"""
    if old not in t:
        raise SystemExit("explore chip block missing")
    t = t.replace(old, new, 1)
    style_old = """  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 28,
    backgroundColor: 'transparent',
  },"""
    style_new = """  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 28,
    backgroundColor: 'transparent',
  },
  exploreShield: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud + 60,
  },"""
    if style_old not in t:
        raise SystemExit("topFade style missing")
    t = t.replace(style_old, style_new, 1)
    tmp = p.with_suffix(".tsx.tmpwrite")
    tmp.write_text(t, encoding="utf-8")
    os.replace(tmp, p)
    print("explore shield ok")
