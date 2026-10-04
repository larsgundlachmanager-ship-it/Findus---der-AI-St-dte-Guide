from pathlib import Path
p = Path("src/services/ui/uiInstant.smoke.test.ts")
s = p.read_text(encoding="utf-8")
old = """assert(home.includes('HomeChromeLayer'), 'Mic/Dock eigener Layer');
assert(
  home.includes('HomeChromeLayer = React.memo'),
  'Chrome memoisiert',
);

assert(calStore.includes('calendarMounted'), 'Timeline keep-alive Flag');"""
new = """assert(home.includes('HomeChromeLayer'), 'Mic/Dock eigener Layer');
assert(
  home.includes('HomeChromeLayer = React.memo'),
  'Chrome memoisiert',
);
const liveStage = readFileSync(
  join(root, 'src/components/liveStage/LiveStage.tsx'),
  'utf8',
);
assert(
  liveStage.includes('HOME_DOCK_BAR_H + Math.max(0, safeBottom)'),
  'Map endet ueber Dock — Timeline-Taps nicht unter TextureView',
);
assert(
  !/homeMapBottomChromePx[\\s\\S]{0,120}return 0/.test(liveStage),
  'kein Full-Bleed unter Dock',
);

assert(calStore.includes('calendarMounted'), 'Timeline keep-alive Flag');"""
if "Map endet ueber Dock" in s or "Map endet über Dock" in s:
    print("already")
elif old not in s:
    print("MISSING")
else:
    p.write_text(s.replace(old, new, 1), encoding="utf-8")
    print("ok")
