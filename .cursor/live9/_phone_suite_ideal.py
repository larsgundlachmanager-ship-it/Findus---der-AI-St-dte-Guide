"""Phone suite after Ideal build — Metro reload + Live-Fail asks."""
import subprocess
import time
import re
from pathlib import Path

ADB = Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor/live9"


def adb(*args):
    return subprocess.run(
        [str(ADB), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )


def ask(q: str) -> str:
    r = subprocess.run(
        ["node", str(ROOT / "scripts/deviceQa/ask.mjs"), q],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    return (r.stdout or "") + (r.stderr or "")


def dump_texts(name: str) -> list[str]:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    adb("pull", "/sdcard/ui.xml", str(OUT / f"{name}.xml"))
    t = (OUT / f"{name}.xml").read_text(encoding="utf-8", errors="ignore")
    texts = [x for x in re.findall(r'text="([^"]+)"', t) if len(x) > 2]
    (OUT / f"{name}-texts.txt").write_text("\n".join(texts), encoding="utf-8")
    return texts


def main():
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("reverse", "tcp:8081", "tcp:8081")
    adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
    time.sleep(2)
    # Dev reload (double R) — Expo/RN
    adb("shell", "input", "text", "RR")
    time.sleep(8)

    results = []

    print("ASK1 AYCE")
    print(ask("Ich moechte heute Abend all you can eat essen, aber kein Asiatisch. Was empfiehlst du?"))
    time.sleep(75)
    t1 = dump_texts("phone-ayce")
    blob1 = "\n".join(t1).lower()
    gold = "goldsch" in blob1
    events = any(k in blob1 for k in ["event heute", "party", "konzert"])
    results.append(("ayce_no_goldsch", not gold, blob1[:500]))
    results.append(("ayce_not_events", not events, ""))

    print("ASK2 Hotel")
    print(ask("Ich brauche schnell noch ein Hotel fuer heute Abend."))
    time.sleep(55)
    t2 = dump_texts("phone-hotel")
    blob2 = "\n".join(t2).lower()
    results.append(
        (
            "hotel_ui",
            any(k in blob2 for k in ["hotel", "zimmer", "uebernacht", "übernacht", "buchen", "stay"]),
            blob2[:400],
        )
    )

    print("ASK3 Taxi")
    print(ask("Kannst du mir ein Taxi zum Bahnhof bestellen?"))
    time.sleep(45)
    t3 = dump_texts("phone-taxi")
    blob3 = "\n".join(t3).lower()
    results.append(
        (
            "taxi_ui",
            any(k in blob3 for k in ["taxi", "uber", "bahn", "bestell", "fahren"]),
            blob3[:400],
        )
    )

    lines = []
    ok_all = True
    for name, ok, sample in results:
        lines.append(f"{'PASS' if ok else 'FAIL'} {name}")
        if sample:
            lines.append(sample[:300])
        if not ok:
            ok_all = False
    report = "\n".join(lines)
    (OUT / "phone-suite-report.txt").write_text(report, encoding="utf-8")
    print(report)
    print("ALL_OK" if ok_all else "HAS_FAILS")
    return 0 if ok_all else 1


if __name__ == "__main__":
    raise SystemExit(main())
