import subprocess, time, cv2, hashlib, numpy as np, re

def shot(n):
    subprocess.check_call(["adb", "shell", "screencap", "-p", "/sdcard/t.png"])
    subprocess.check_call(
        ["adb", "pull", "/sdcard/t.png", f".phone-check/{n}"],
        stdout=subprocess.DEVNULL,
    )
    return cv2.imread(f".phone-check/{n}")

def md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()[:12]

b = shot("mid-0.png")
print("0", md5(".phone-check/mid-0.png"), round(float(b.mean()), 2))
for i in range(8):
    subprocess.check_call(
        [
            "adb",
            "shell",
            "input",
            "swipe",
            "540",
            str(1400 - i * 80),
            "540",
            str(1320 - i * 80),
            "80",
        ]
    )
    time.sleep(0.05)
a = shot("mid-1.png")
print("1", md5(".phone-check/mid-1.png"), round(float(a.mean()), 2))
print("meanAbsDiff", float(np.mean(np.abs(a.astype(float) - b.astype(float)))))

subprocess.check_call(["adb", "shell", "uiautomator", "dump", "/sdcard/u.xml"])
subprocess.check_call(
    ["adb", "pull", "/sdcard/u.xml", ".phone-check/u-mid.xml"],
    stdout=subprocess.DEVNULL,
)
xml = open(".phone-check/u-mid.xml", encoding="utf-8", errors="ignore").read()
m = re.search(r'content-desc="(Showing a Map[^"]*)"', xml)
print("mapDesc", m.group(1) if m else None)
m2 = re.search(r"Showing a Map.*?scrollable=\"(true|false)\"", xml)
print("scrollable", m2.group(1) if m2 else "?")

subprocess.check_call(["adb", "shell", "input", "tap", "733", "350"])
time.sleep(0.8)
c = shot("mid-2-recenter.png")
print("recenterDiff", float(np.mean(np.abs(c.astype(float) - a.astype(float)))))

# long-press via swipe same point
subprocess.check_call(
    ["adb", "shell", "input", "swipe", "700", "1000", "700", "1000", "1000"]
)
time.sleep(0.4)
d = shot("mid-3-longpress.png")
print("longpressDiff", float(np.mean(np.abs(d.astype(float) - c.astype(float)))))
print("DONE")
