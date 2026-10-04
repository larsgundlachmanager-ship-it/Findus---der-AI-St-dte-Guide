from pathlib import Path

# OnboardingNavigator: homeMicClearancePx
p = Path(r"C:\Users\larsf\Findus 2.0\src\onboarding\OnboardingNavigator.tsx")
tmp = Path(str(p) + ".new")
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    """import {
  HOME_DOCK_BAR_H,
  HOME_MIC_DOCK_GAP,
  HOME_MIC_HINT_RESERVE,
} from '../components/liveStage';""",
    """import {
  HOME_DOCK_BAR_H,
  HOME_MIC_DOCK_GAP,
  HOME_MIC_HINT_RESERVE,
  homeMicClearancePx,
} from '../components/liveStage';""",
)
old = """            bottom:
              HOME_DOCK_BAR_H +
              safePad.bottom +
              HOME_MIC_DOCK_GAP +
              HOME_MIC_HINT_RESERVE +
              88,"""
new = """            bottom:
              HOME_DOCK_BAR_H +
              safePad.bottom +
              homeMicClearancePx(1),"""
if old not in t2:
    raise SystemExit("tourSubtitles bottom not found")
t2 = t2.replace(old, new)
tmp.write_text(t2, encoding="utf-8")
print("navigator new ok", t2 != t)

# userProfileService cityMobilityModes
up = Path(r"C:\Users\larsf\Findus 2.0\src\services\userProfileService.ts")
ut = up.read_text(encoding="utf-8")
if "cityMobilityModes" not in ut:
    needle = """  merged.travelModes = Array.isArray(parsed.travelModes)
    ? parsed.travelModes
        .map(String)
        .filter((id): id is import('../constants/conciergePrefs').TravelModeId =>
          travelModeAllowed.has(id),
        )
    : base.travelModes ?? [];"""
    insert = """  const cityMobAllowed = new Set(['foot', 'bike', 'public_transit', 'car']);
  merged.cityMobilityModes = Array.isArray(parsed.cityMobilityModes)
    ? parsed.cityMobilityModes
        .map(String)
        .filter((id): id is import('../types/userProfile').MobilityMode =>
          cityMobAllowed.has(id),
        )
    : base.cityMobilityModes ?? [];
  merged.travelModes = Array.isArray(parsed.travelModes)
    ? parsed.travelModes
        .map(String)
        .filter((id): id is import('../constants/conciergePrefs').TravelModeId =>
          travelModeAllowed.has(id),
        )
    : base.travelModes ?? [];"""
    if needle not in ut:
        raise SystemExit("travelModes merge not found")
    ut2 = ut.replace(needle, insert)
    utmp = Path(str(up) + ".new")
    utmp.write_text(ut2, encoding="utf-8")
    print("profileService new ok")
else:
    print("profileService skip")
