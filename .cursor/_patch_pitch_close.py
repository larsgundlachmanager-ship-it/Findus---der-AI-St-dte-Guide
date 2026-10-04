from pathlib import Path
import os
import time

p = Path("src/components/PitchChoiceSlot.tsx")
tmp = p.with_suffix(".tsx.tmp")
t = p.read_text(encoding="utf-8")
old = "onPress={clear}"
if old not in t:
    raise SystemExit("marker missing")
new = """onPress={() => {
              clear();
              void import('../services/actionHandlerService')
                .then(({ dismissConciergeCard }) => dismissConciergeCard())
                .catch(() => undefined);
            }}"""
t2 = t.replace(old, new, 1)
tmp.write_text(t2, encoding="utf-8")
for i in range(8):
    try:
        os.replace(tmp, p)
        print("ok")
        break
    except OSError as e:
        print("retry", i, e)
        time.sleep(0.4)
else:
    raise SystemExit("replace failed")
