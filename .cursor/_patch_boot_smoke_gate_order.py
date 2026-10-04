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
            print("unlink try", i, e)
            time.sleep(0.35)
    else:
        dead = p.with_suffix(p.suffix + ".locked")
        try:
            if dead.exists():
                dead.unlink()
        except Exception:
            pass
        p.rename(dead)
    p.write_bytes(tmp.read_bytes())
    print("force wrote", p)


p = Path("src/services/boot/interactiveBootGate.smoke.test.ts")
t = p.read_text(encoding="utf-8")
block = """  assert(
    gate.includes('Interactive Window gilt auch wenn settle zu früh') ||
      /splashInteractiveAt[\\s\\S]{0,120}INTERACTIVE_WINDOW_MS/.test(gate),
    'Hydrate/Idle hart hinter Interactive Window',
  );
  assert(
    /INTERACTIVE_WINDOW_MS\\s*=\\s*3_?500/.test(gate) ||
      /INTERACTIVE_WINDOW_MS\\s*=\\s*3500/.test(gate),
    'Interactive Window ≥3.5s für Chrome/Mic',
  );

"""
if block not in t:
    raise SystemExit("gate early block missing")
t2 = t.replace(block, "", 1)
anchor = "  assert(\n    gate.includes('defer polish/idle — user gesturing'),\n    'Drain weicht Finger aus',\n  );\n"
if anchor not in t2:
    raise SystemExit("anchor missing")
t2 = t2.replace(anchor, anchor + "\n" + block, 1)
force_write(str(p), t2)
print("moved gate asserts")
