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


p = Path("src/services/boot/interactiveBootGate.smoke.test.ts")
t = p.read_text(encoding="utf-8")
anchor = "  assert(host.includes('armPostSplashLadder'), 'Leiter erst nach Splash-Interactive');\n"
extra = (
    anchor
    + "  assert(\n"
    + "    host.includes('placesPaintMustYield'),\n"
    + "    'Orte-Paint weicht Interactive Window / Mic',\n"
    + "  );\n"
    + "  assert(\n"
    + "    host.includes('Immer über Polish-Lane'),\n"
    + "    'Heavy Overlays nie sync gegen Chrome',\n"
    + "  );\n"
)
if "placesPaintMustYield" in t:
    print("already present")
else:
    if anchor not in t:
        raise SystemExit("anchor missing")
    force_write(str(p), t.replace(anchor, extra, 1))
    print("patched")
