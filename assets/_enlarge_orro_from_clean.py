"""Enlarge ORRO on the already-clean AI icon — horizontal only, full clear."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "icon.png"
OUT = ROOT / "icon-clean-draft-orro-circle.png"
BACKUP = ROOT / "icon-clean-draft-orro-before-enlarge.png"

SCALE_X = 1.35
SCALE_Y = 1.08
STEM_HALF = 55


def is_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 100) & (a[:, :, 1] > 70) & (a[:, :, 2] < 140)


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    src.save(BACKUP)
    arr = np.array(src)
    h, w = arr.shape[:2]
    cx = w // 2
    gold = is_gold(arr)

    # Detect letter band by finding lowest gold mass that's not stem
    # Use y range where columns left of stem have gold
    left_cols = gold[:, : cx - STEM_HALF]
    row_sum = left_cols.sum(axis=1)
    # letter rows: significant gold in lower half
    ys = np.where((row_sum > 20) & (np.arange(h) > 500))[0]
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    print("letter band", y0, y1)

    zone = gold.copy()
    zone[:y0, :] = False
    zone[y1:, :] = False
    zone[:, cx - STEM_HALF : cx + STEM_HALF] = False
    labeled, n = ndimage.label(zone)
    letters = np.zeros_like(zone)
    for i in range(1, n + 1):
        if int((labeled == i).sum()) >= 300:
            letters |= labeled == i
    print("letters", int(letters.sum()))

    gold_rgb = tuple(int(x) for x in np.median(arr[letters], axis=0))

    def side(name: str) -> tuple[np.ndarray, tuple[int, int, int, int]]:
        m = letters.copy()
        if name == "left":
            m[:, cx:] = False
        else:
            m[:, : cx + 1] = False
        ys_, xs_ = np.where(m)
        return m, (int(xs_.min()), int(ys_.min()), int(xs_.max()) + 1, int(ys_.max()) + 1)

    lm, lb = side("left")
    rm, rb = side("right")

    # FULL clear of letter glyphs + halo (outside stem)
    clear = ndimage.binary_dilation(letters, iterations=5)
    soft = (arr[:, :, 0] > 40) & (arr[:, :, 1] > 20) & (arr[:, :, 2] < 180)
    soft[: y0 - 5, :] = False
    soft[y1 + 5 :, :] = False
    soft[:, cx - STEM_HALF : cx + STEM_HALF] = False
    soft &= ndimage.binary_dilation(letters, iterations=12)
    clear |= soft
    clear[:, cx - STEM_HALF : cx + STEM_HALF] = False

    out = arr.copy()
    out[clear] = 0

    new_m = np.zeros((h, w), dtype=bool)
    bottom = max(lb[3], rb[3])
    outward = int(round((SCALE_X - 1.0) * 90))

    for m, box, name in ((lm, lb, "left"), (rm, rb, "right")):
        x0, y0b, x1, y1b = box
        crop = m[y0b:y1b, x0:x1]
        zoomed = ndimage.zoom(crop.astype(np.float32), (SCALE_Y, SCALE_X), order=0) > 0.5
        zh, zw = zoomed.shape
        mid = (x0 + x1) / 2
        nx = int(round(mid - zw / 2))
        nx = nx - outward if name == "left" else nx + outward
        ny = bottom - zh
        # keep top from eating bridge: don't go above original top - 8
        ny = max(ny, y0b - 12)
        gap = STEM_HALF - 4
        if name == "left":
            nx = min(nx, cx - gap - zw)
        else:
            nx = max(nx, cx + gap)
        nx = int(np.clip(nx, 20, w - 20 - zw))
        ny = int(np.clip(ny, 0, h - zh))
        new_m[ny : ny + zh, nx : nx + zw] |= zoomed
        print(name, zw, zh, "@", nx, ny)

    stem = np.zeros((h, w), dtype=bool)
    stem[:, cx - STEM_HALF : cx + STEM_HALF] = True
    paint = new_m & ~stem
    out[paint] = gold_rgb

    final = Image.fromarray(out)
    final.save(OUT)
    final.save(ROOT / "icon.png")
    final.save(ROOT / "adaptive-icon.png")

    # verify clear worked
    leftover = letters & is_gold(out) & ~ndimage.binary_dilation(paint, iterations=2)
    print("ghost leftover", int(leftover.sum()), "paint", int(paint.sum()))

    cm = Image.new("L", (w, h), 0)
    ImageDraw.Draw(cm).ellipse((40, 40, w - 40, h - 40), fill=255)
    prev = Image.new("RGB", (w, h), (0, 0, 0))
    prev.paste(final, mask=cm)
    prev.save(ROOT / "_icon-crops" / "orro-circle-preview.png")
    final.crop((80, 480, 944, 940)).save(ROOT / "_icon-crops" / "orro-tight-circ.png")

    v6 = Image.open(BACKUP)
    comp = Image.new("RGB", (w * 2 + 24, int(h * 0.48) + 36), (8, 8, 8))
    comp.paste(v6.crop((0, int(h * 0.52), w, h)), (0, 36))
    comp.paste(final.crop((0, int(h * 0.52), w, h)), (w + 24, 36))
    d = ImageDraw.Draw(comp)
    d.text((12, 10), "VORHER", fill=(200, 200, 200))
    d.text((w + 36, 10), "ORRO +35% breiter", fill=(200, 200, 200))
    comp.save(ROOT / "_icon-crops" / "orro-circle-compare.png")


if __name__ == "__main__":
    main()
