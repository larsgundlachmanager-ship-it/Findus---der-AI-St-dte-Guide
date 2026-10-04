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
    """assert(host.includes('Gespeicherter GPS-Lock nach Boot'), 'HUD-Follow Prefs werden angewandt');
""",
    """assert(
  host.includes('Gespeicherte HUD-Locks nicht auto-reaktivieren') ||
    host.includes('Cold start: Karte immer frei'),
  'Cold start ohne auto GPS-Lock',
);
""",
    "native hud smoke",
)

replace(
    r"src/services/boot/interactiveBootGate.smoke.test.ts",
    """  assert(
    idle.includes('CHROME_PREMOUNT_AFTER_SPLASH_MS') &&
      idle.includes('prefetchOverlayBundles()'),
    'Bundle früh; Chrome-Premount verzögert nach Splash',
  );
  assert(
    /CHROME_PREMOUNT_AFTER_SPLASH_MS\\s*=\\s*(1\\d{2}|2\\d{2}|3\\d{2}|4\\d{2}|500)\\b/.test(idle),
    'Chrome-Premount 300–500 ms',
  );
""",
    """  assert(
    idle.includes('CHROME_PREMOUNT_AFTER_SETTLED_MS') &&
      idle.includes('prefetchOverlayBundles()'),
    'Bundle früh; Chrome-Premount verzögert nach Splash',
  );
  assert(
    /CHROME_PREMOUNT_AFTER_SETTLED_MS\\s*=\\s*(8\\d{2}|9\\d{2}|1\\d{3})\\b/.test(idle),
    'Chrome-Premount ≥800 ms nach Interactive-Settle',
  );
""",
    "boot chrome smoke",
)

print("done")
