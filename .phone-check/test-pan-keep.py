import subprocess, time, cv2, re

pkg = subprocess.check_output(
    ["adb", "shell", "dumpsys", "package", "de.findus.app"],
    text=True,
    errors="ignore",
)
print(
    "v",
    re.search(r"versionName=(\S+)", pkg).group(1),
    re.search(r"versionCode=(\d+)", pkg).group(1),
)

def shot(n):
    subprocess.check_call(["adb", "shell", "screencap", "-p", "/sdcard/t.png"])
    subprocess.check_call(
        ["adb", "pull", "/sdcard/t.png", f".phone-check/{n}"],
        stdout=subprocess.DEVNULL,
    )
    return cv2.imread(f".phone-check/{n}")

def find_blue(im):
    import numpy as np

    crop = im[400:1700, 80:1000]
    b, g, r = cv2.split(crop)
    mask = ((b > 140) & (r < 80) & (g < 120) & (b > g + 40) & (b > r + 40)).astype(
        np.uint8
    )
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    return (float(xs.mean()) + 80, float(ys.mean()) + 400)

def d(a, b):
    return None if not a or not b else (round(b[0] - a[0], 1), round(b[1] - a[1], 1))

time.sleep(14)
b0 = find_blue(shot("p60-0.png"))
print("0", b0)
subprocess.check_call(
    ["adb", "shell", "input", "swipe", "540", "1550", "540", "550", "450"]
)
time.sleep(0.55)
b1 = find_blue(shot("p60-1.png"))
print("1", b1, d(b0, b1))
time.sleep(4.2)
b2 = find_blue(shot("p60-2.png"))
print("2", b2, "vs1", d(b1, b2), "vs0", d(b0, b2))
subprocess.check_call(
    ["adb", "shell", "input", "swipe", "950", "1100", "150", "1100", "450"]
)
time.sleep(0.55)
b3 = find_blue(shot("p60-3.png"))
print("3", b3, d(b2, b3))
time.sleep(4.2)
b4 = find_blue(shot("p60-4.png"))
print("4", b4, "vs3", d(b3, b4), "vs2", d(b2, b4))

v_moved = b0 and b1 and abs(b1[1] - b0[1]) > 80
v_kept = b1 and b2 and abs(b2[1] - b1[1]) < 60 and v_moved
h_moved = b2 and b3 and abs(b3[0] - b2[0]) > 80
h_kept = b3 and b4 and abs(b4[0] - b3[0]) < 60 and h_moved
print("V_MOVED", v_moved, "V_KEPT", v_kept, "H_MOVED", h_moved, "H_KEPT", h_kept)
print("PASS" if v_moved and v_kept and h_moved and h_kept else "FAIL")
