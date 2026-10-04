from pathlib import Path

chip = Path(r"c:/Users/larsf/Findus 2.0/src/components/homeMap/HomeMapExploreChip.tsx")
t = chip.read_text(encoding="utf-8")
if "elevation: UI_LAYER.hud + 40" not in t:
    for old, new in [
        (
            "zIndex: UI_LAYER.hud,\n    flexDirection: 'row',",
            "zIndex: UI_LAYER.hud,\n    elevation: UI_LAYER.hud + 40,\n    flexDirection: 'row',",
        ),
        (
            "zIndex: UI_LAYER.hud,\r\n    flexDirection: 'row',",
            "zIndex: UI_LAYER.hud,\r\n    elevation: UI_LAYER.hud + 40,\r\n    flexDirection: 'row',",
        ),
    ]:
        if old in t:
            t = t.replace(old, new, 1)
            break
    else:
        raise SystemExit("wrap pattern not found")
    # btn elevation
    old_btn = "borderColor: colors.border,\n  },\n  btnLocked:"
    new_btn = "borderColor: colors.border,\n    elevation: 28,\n  },\n  btnLocked:"
    if "elevation: 28" not in t and old_btn in t:
        t = t.replace(old_btn, new_btn, 1)
    tmp = chip.with_suffix(".tsx.tmp")
    tmp.write_text(t, encoding="utf-8")
    tmp.replace(chip)
    print("explore chip patched via replace")
else:
    print("explore chip already elevated")

# OnboardingNavigator mapBottomChrome
nav = Path(r"c:/Users/larsf/Findus 2.0/src/onboarding/OnboardingNavigator.tsx")
nt = nav.read_text(encoding="utf-8")
if "HOME_MIC_BTN" not in nt.split("mapBottomChrome")[0][-500:]:
    # ensure imports
    if "HOME_MIC_BTN" not in nt:
        nt = nt.replace(
            "HOME_MIC_HINT_RESERVE,",
            "HOME_MIC_HINT_RESERVE,\n  HOME_MIC_BTN,\n  HOME_MIC_HIT_PAD,",
            1,
        )
    old = "const mapBottomChrome = HOME_DOCK_BAR_H + safePad.bottom;"
    new = (
        "const mapBottomChrome =\n"
        "    HOME_DOCK_BAR_H +\n"
        "    safePad.bottom +\n"
        "    HOME_MIC_BTN +\n"
        "    Math.round(HOME_MIC_HIT_PAD / 2) +\n"
        "    HOME_MIC_DOCK_GAP +\n"
        "    HOME_MIC_HINT_RESERVE;"
    )
    if old not in nt:
        raise SystemExit("onboarding mapBottomChrome not found")
    nt = nt.replace(old, new, 1)
    tmp = nav.with_suffix(".tsx.tmp")
    tmp.write_text(nt, encoding="utf-8")
    tmp.replace(nav)
    print("onboarding mapBottomChrome patched")
else:
    print("onboarding already has mic inset")

# bump version
app = Path(r"c:/Users/larsf/Findus 2.0/app.json")
at = app.read_text(encoding="utf-8")
at = at.replace('"version": "2.0.78"', '"version": "2.0.79"', 1)
at = at.replace('"versionCode": 105', '"versionCode": 106', 1)
app.write_text(at, encoding="utf-8")
print("app.json -> 2.0.79 / 106")

gradle = Path(r"c:/Users/larsf/Findus 2.0/android/app/build.gradle")
gt = gradle.read_text(encoding="utf-8")
gt = gt.replace("versionCode 105", "versionCode 106", 1)
gt = gt.replace('versionName "2.0.78"', 'versionName "2.0.79"', 1)
gradle.write_text(gt, encoding="utf-8")
print("gradle -> 2.0.79 / 106")

# release notes
rel = Path(r"c:/Users/larsf/Findus 2.0/releases/2.0.79")
rel.mkdir(parents=True, exist_ok=True)
(rel / "whatsnew-de-DE-v106.txt").write_text(
    "Touch-Fix: Mikrofon, Dock (Timeline/Orte/Einstellungen), Kompass und Karten-Icons "
    "reagieren wieder — die Karte überdeckt die Bedienelemente nicht mehr.\n",
    encoding="utf-8",
)
print("release notes ok")
