from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\transit\liveJourneyAdapt.ts")
t = p.read_text(encoding="utf-8")
t = t.replace(
    "timelineHint: ${waitMin} Min · GPS unsicher,",
    "timelineHint: `${waitMin} Min · GPS unsicher`,",
)
t = t.replace(
    "timelineHint: waitMin > 0 ? ${waitMin} Min · GPS unsicher : 'Einstieg · GPS unsicher',",
    "timelineHint: waitMin > 0 ? `${waitMin} Min · GPS unsicher` : 'Einstieg · GPS unsicher',",
)
for i, line in enumerate(t.splitlines(), 1):
    if "GPS unsicher" in line:
        print(i, repr(line))
tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_lja_fix.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
try:
    p.unlink()
except Exception as e:
    print("unlink", e)
p.write_bytes(tmp.read_bytes())
print("lja fixed")

bp = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\boardingDetector.smoke.test.ts")
bt = bp.read_text(encoding="utf-8")
bt = bt.replace(
    """import {
  ALIGHT_DWELL_MS,
  assessAlightReady,
  resetBoardingDetector,
  takeAlightAdvancePending,
  tickBoardingDetector,
} from './boardingDetector';""",
    """import {
  ALIGHT_DWELL_MS,
  ALIGHT_TIME_GRACE_MS,
  BOARD_TIME_GRACE_MS,
  assessAlightReady,
  resetBoardingDetector,
  takeAlightAdvancePending,
  tickBoardingDetector,
} from './boardingDetector';""",
)
bp.write_text(bt, encoding="utf-8", newline="\n")
print("smoke import fixed", "ALIGHT_TIME_GRACE_MS" in bt)
