from pathlib import Path

p = Path("src/services/homeMap/splashReadyGate.smoke.test.ts")
t = p.read_text(encoding="utf-8")
if "from \"node:fs\"" not in t and "from 'node:fs'" not in t:
    t = t.replace(
        "import {\n  SPLASH_HARD_FAILSAFE_MS",
        "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport {\n  SPLASH_HARD_FAILSAFE_MS",
    )
    p.write_text(t, encoding="utf-8")
    print("splash imports added")
else:
    print("splash imports ok")

p2 = Path("src/services/ui/uiInstant.smoke.test.ts")
s = p2.read_text(encoding="utf-8")
needle = (
    "assert(home.includes('HomeChromeLayer'), 'Mic/Dock eigener Layer');\n"
    "assert(\n"
    "  home.includes('HomeChromeLayer = React.memo'),\n"
    "  'Chrome memoisiert',\n"
    ");"
)
add = (
    needle
    + "\nconst liveStage = readFileSync(\n"
    + "  join(root, 'src/components/liveStage/LiveStage.tsx'),\n"
    + "  'utf8',\n"
    + ");\n"
    + "assert(\n"
    + "  liveStage.includes('HOME_DOCK_BAR_H + Math.max(0, safeBottom)'),\n"
    + "  'Map endet über Dock — Timeline-Taps nicht unter TextureView',\n"
    + ");\n"
    + "assert(!/homeMapBottomChromePx[\\s\\S]{0,120}return 0/.test(liveStage), 'kein Full-Bleed unter Dock');"
)
if "Map endet über Dock" not in s:
    if needle not in s:
        raise SystemExit("needle missing")
    p2.write_text(s.replace(needle, add, 1), encoding="utf-8")
    print("uiInstant patched")
else:
    print("uiInstant already")
