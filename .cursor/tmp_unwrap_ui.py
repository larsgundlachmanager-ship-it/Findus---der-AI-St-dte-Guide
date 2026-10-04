from pathlib import Path

p = Path(
    r"c:\Users\larsf\Findus 2.0\android\app\src\main\java\de\findus\app\FindusAlarmModule.kt"
)
t = p.read_text(encoding="utf-8")

# Unwrap runOnUiQueueThread — call sync on bridge thread (avoids RN deadlock)
import re

def unwrap_method(src: str, method: str) -> str:
    # Replace runOnUiQueueThread blocks in the named method with direct body
    pattern = rf'(  @ReactMethod\n  fun {method}\([^\)]*\) \{{)\n    reactContext\.runOnUiQueueThread \{{\n([\s\S]*?)\n    \}}\n  \}}'
    m = re.search(pattern, src)
    if not m:
        raise SystemExit(f"method {method} pattern not found")
    body = m.group(2)
    # unindent body by 2 spaces and fix return@runOnUiQueueThread
    lines = []
    for line in body.splitlines():
        if line.startswith("      "):
            line = line[2:]
        lines.append(line)
    body2 = "\n".join(lines).replace(
        "return@runOnUiQueueThread", "return"
    )
    repl = m.group(1) + "\n" + body2 + "\n  }"
    return src[: m.start()] + repl + src[m.end() :]

t2 = unwrap_method(t, "setAlarmClockIntent")
t2 = unwrap_method(t2, "setAlarm")
p.write_text(t2, encoding="utf-8")
print("unwrapped", "runOnUiQueueThread" in t2)
