from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\components\CitySwitchPrompt.tsx")
t = p.read_text(encoding="utf-8")
old = "{soft ? 'Hier bleiben' : 'Wechseln'}"
new = "{research ? 'Wechseln' : soft ? 'Hier nutzen' : 'Wechseln'}"
if old not in t:
    print("pattern missing; current snippet:")
    for i, line in enumerate(t.splitlines(), 1):
        if "Hier bleiben" in line or "Wechseln" in line:
            print(f"{i}: {line}")
else:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("ok")
