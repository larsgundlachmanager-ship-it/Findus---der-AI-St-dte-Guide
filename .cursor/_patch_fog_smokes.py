from pathlib import Path
import os, tempfile

def replace(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"FAIL {label}: needle not found")
    text = text.replace(old, new, 1)
    fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=str(p.parent))
    os.close(fd)
    Path(tmp).write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)
    print("OK", label)

replace(
    r"src/components/homeMap/nativeHomeMap.smoke.test.ts",
    """assert(
  view.includes('fogRevealFrozenRef') && view.includes('fogMaskFrozenRef'),
  'Fog nach Erkundung einfrieren (kein ShapeSource-Snap)',
);
""",
    """assert(
  view.includes('fogRevealFrozenRef') && view.includes('fogMaskFrozenRef'),
  'Fog-Snapshot nur während Geste',
);
assert(
  view.includes('midGesture') &&
    view.includes('Freie Erkundung: User besitzt die Kamera'),
  'Fog live nachziehen ohne Kamera-Snap',
);
""",
    "native fog smoke",
)

replace(
    r"src/services/homeMap/mapIdleGate.smoke.test.ts",
    """assert(fog.includes('isMapUserGesturing'), 'Fog: defer während Geste');
assert(
  fog.includes('FOG_BIKE_FULL_EVERY_MS') || fog.includes('GPS_FOG_MIN_BIKE_M'),
  'Fog: bike soft lane',
);
""",
    """assert(fog.includes('isMapUserGesturing'), 'Fog: defer während Geste');
assert(
  fog.includes('FOG_BIKE_FULL_EVERY_MS') || fog.includes('GPS_FOG_MIN_BIKE_M'),
  'Fog: bike soft lane',
);
assert(fog.includes('runMapIdleWhenFree'), 'Fog Full-Merge nur mapIdle');
assert(fog.includes('FOG_WALK_FULL_EVERY_MS'), 'Fog walk tip + throttled full');
assert(fog.includes('fogShouldYield') || fog.includes('isVoiceLaneBusy'), 'Fog weicht Voice');
""",
    "mapIdle fog smoke",
)

replace(
    r"src/services/ui/uiInstant.smoke.test.ts",
    """assert(
  fogEng.includes('FOG_BIKE_FULL_EVERY_MS') &&
    fogEng.includes('GPS_FOG_MIN_BIKE_M'),
  'Fog softer on bike',
);
""",
    """assert(
  fogEng.includes('FOG_BIKE_FULL_EVERY_MS') &&
    fogEng.includes('GPS_FOG_MIN_BIKE_M'),
  'Fog softer on bike',
);
assert(
  fogEng.includes('runMapIdleWhenFree') && fogEng.includes('FOG_WALK_FULL_EVERY_MS'),
  'Fog full merge lowest priority (mapIdle) + walk tip',
);
""",
    "uiInstant fog smoke",
)

print("smokes updated")
