"""Enlarge ORRO cleanly for circular app icon — no double-print."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "icon-clean-draft-v6.png"
OUT = ROOT / "icon-clean-draft-orro-circle.png"
COMPARE = ROOT / "_icon-crops" / "orro-circle-compare.png"


def is_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 100) & (a[:, :, 1] > 70) & (a[:, :, 2] < 140)


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    arr = np.array(src)
    h, w = arr.shape[:2]
    cx = w // 2
    gold = is_gold(arr)

    zone = gold.copy()
    zone[:668, :] = False
    gap = 36
    zone[:, cx - gap : cx + gap] = False
    labeled, _ = ndimage.label(zone)
    struct = np.ones((3, 3), dtype=bool)

    letter_ids = [
        i
        for i in range(1, int(labeled.max()) + 1)
        if int((labeled == i).sum()) >= 2000
    ]

    def side(side_name: str):
        ids = []
        for i in letter_ids:
            ys, xs = np.where(labeled == i)
            mid = (int(xs.min()) + int(xs.max())) / 2
            if side_name == "left" and mid < cx:
                ids.append(i)
            if side_name == "right" and mid >= cx:
                ids.append(i)
        m = np.zeros((h, w), dtype=bool)
        for i in ids:
            m |= labeled == i
        m_d = ndimage.binary_dilation(m, structure=struct, iterations=1)
        ys, xs = np.where(m_d)
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, y0 = max(0, x0 - 1), max(0, y0 - 1)
        x1, y1 = min(w, x1 + 1), min(h, y1 + 1)
        sub = arr[y0:y1, x0:x1]
        mm = m_d[y0:y1, x0:x1]
        keep = mm & (sub[:, :, 0] > 40) & (sub[:, :, 1] > 20) & (sub[:, :, 2] < 180)
        p = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        p[:, :, :3] = sub
        p[:, :, 3] = np.where(keep, 255, 0)
        return Image.fromarray(p, "RGBA"), (x0, y0, x1, y1), m

    lp, lb, lm = side("left")
    rp, rb, rm = side("right")

    # Hard-clear letters from a fresh copy (prevents ghosting)
    y_only = arr.copy()
    clear = ndimage.binary_dilation(lm | rm, structure=struct, iterations=3)
    y_only[clear] = 0  # clear all channels in letter footprint

    # Fill circle: ~1.28 scale, keep readable proportions
    scale = 1.28
    ls = lp.resize((int(lp.width * scale), int(lp.height * scale)), Image.Resampling.LANCZOS)
    rs = rp.resize((int(rp.width * scale), int(rp.height * scale)), Image.Resampling.LANCZOS)

    # Bottom-align near original bottoms, centers preserved
    lx = int(round((lb[0] + lb[2]) / 2 - ls.width / 2))
    rx = int(round((rb[0] + rb[2]) / 2 - rs.width / 2))
    bottom = max(lb[3], rb[3]) + 8
    ly = bottom - ls.height
    ry = bottom - rs.height

    # Keep away from stem core
    if lx + ls.width > cx - gap + 8:
        lx = cx - gap + 8 - ls.width
    if rx < cx + gap - 8:
        rx = cx + gap - 8

    print("scale", scale, "L", lx, ly, ls.size, "R", rx, ry, rs.size)

    base = Image.fromarray(y_only).convert("RGBA")
    ba = np.array(base)

    def paste(base_a: np.ndarray, patch: Image.Image, x: int, y: int) -> np.ndarray:
        pw, ph = patch.size
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(w, x + pw), min(h, y + ph)
        sc = np.array(patch)[y0 - y : y0 - y + (y1 - y0), x0 - x : x0 - x + (x1 - x0)]
        a = sc[:, :, 3] > 90
        region = base_a[y0:y1, x0:x1]
        for ch in range(3):
            chn = region[:, :, ch]
            chn[a] = sc[:, :, ch][a]
            region[:, :, ch] = chn
        region[:, :, 3][a] = 255
        base_a[y0:y1, x0:x1] = region
        return base_a

    ba = paste(ba, ls, lx, ly)
    ba = paste(ba, rs, rx, ry)
    final = Image.fromarray(ba, "RGBA").convert("RGB")
    final.save(OUT)

    # Compare bottoms
    comp = Image.new("RGB", (w * 2 + 24, int(h * 0.48) + 36), (8, 8, 8))
    comp.paste(src.crop((0, int(h * 0.52), w, h)), (0, 36))
    comp.paste(final.crop((0, int(h * 0.52), w, h)), (w + 24, 36))
    d = ImageDraw.Draw(comp)
    d.text((12, 10), "JETZT (klar)", fill=(200, 200, 200))
    d.text((w + 36, 10), "GROESSER (+28%)", fill=(200, 200, 200))
    COMPARE.parent.mkdir(exist_ok=True)
    comp.save(COMPARE)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
