from pathlib import Path
import os
import tempfile
import time


def force_write(path: str, content: str) -> None:
    p = Path(path)
    tmp = Path(tempfile.gettempdir()) / (p.name + ".patched")
    tmp.write_text(content, encoding="utf-8")
    for i in range(10):
        try:
            if p.exists():
                os.chmod(p, 0o666)
                p.unlink()
            break
        except Exception as e:
            print("unlink", i, e)
            time.sleep(0.3)
    else:
        dead = p.with_suffix(p.suffix + ".locked")
        try:
            if dead.exists():
                dead.unlink()
        except Exception:
            pass
        p.rename(dead)
    p.write_bytes(tmp.read_bytes())
    print("wrote", p)


# boot gate smoke: 3500 -> 10000
p = Path("src/services/boot/interactiveBootGate.smoke.test.ts")
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    "/INTERACTIVE_WINDOW_MS\\s*=\\s*3_?500/.test(gate) ||\n"
    "      /INTERACTIVE_WINDOW_MS\\s*=\\s*3500/.test(gate),\n"
    "    'Interactive Window ≥3.5s für Chrome/Mic',",
    "/INTERACTIVE_WINDOW_MS\\s*=\\s*10_?000/.test(gate) ||\n"
    "      /INTERACTIVE_WINDOW_MS\\s*=\\s*10000/.test(gate),\n"
    "    'Interactive Window ≥10s für Chrome/Mic',",
)
if t2 == t:
    # try alternate quote style already in file
    t2 = t.replace(
        "/INTERACTIVE_WINDOW_MS\\s*=\\s*3_?500/.test(gate) ||\n"
        "      /INTERACTIVE_WINDOW_MS\\s*=\\s*3500/.test(gate),\n"
        "    'Interactive Window ≥3.5s für Chrome/Mic',",
        "/INTERACTIVE_WINDOW_MS\\s*=\\s*10_?000/.test(gate) ||\n"
        "      /INTERACTIVE_WINDOW_MS\\s*=\\s*10000/.test(gate),\n"
        "    'Interactive Window ≥10s für Chrome/Mic',",
    )
if "10000" not in t2 and "10_000" not in t2:
    # read current assert
    idx = t.find("INTERACTIVE_WINDOW_MS")
    print("snippet:", repr(t[idx : idx + 200]))
    raise SystemExit("could not patch boot smoke window assert")
force_write(str(p), t2)

# nativeHomeMap / uiInstant: assert placesPaintMustYield
host_smoke = Path("src/components/homeMap/nativeHomeMap.smoke.test.ts")
ht = host_smoke.read_text(encoding="utf-8")
needle = "assert(view.includes('GpsLockCenterPuck'), 'GPS-Lock: Pfeil fest Bildschirmmitte');"
# actually host file uses HomePresenceMap - check
hp = Path("src/components/homeMap/nativeHomeMap.smoke.test.ts")
ht = hp.read_text(encoding="utf-8")
if "placesPaintMustYield" not in ht:
    insert_at = "assert(host.includes('runMapLightPinsWhenFree')"
    # find a good anchor in host asserts
    anchor = "assert(host.includes('armPostSplashLadder'), 'Leiter erst nach Splash-Interactive');"
    if anchor not in ht:
        # try from boot smoke host section - different file
        print("anchor missing in nativeHomeMap smoke - skip host assert")
    else:
        extra = (
            anchor
            + "\nassert(host.includes('placesPaintMustYield'), "
            + "'Orte-Paint weicht Interactive Window / Mic');\n"
            + "assert(host.includes('Immer über Polish-Lane') || "
            + "host.includes('runMapPolishWhenFree'), "
            + "'Heavy Overlays über Polish-Lane');\n"
        )
        # simpler:
        extra = (
            anchor
            + "\nassert(\n  host.includes('placesPaintMustYield'),\n"
            + "  'Orte-Paint weicht Interactive Window / Mic',\n);\n"
        )
        force_write(str(hp), ht.replace(anchor, extra, 1))
else:
    print("host already has placesPaintMustYield")

print("done")
