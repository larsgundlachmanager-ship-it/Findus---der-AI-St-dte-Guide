"""Restore clean v6 Y, enlarge only ORRO for circle fit."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "icon-clean-draft-v6.png"
OUT = ROOT / "icon.png"
ADAPTIVE = ROOT / "adaptive-icon.png"
DRAFT = ROOT / "icon-clean-draft-orro-circle.png"
COMPARE = ROOT / "_icon-crops" / "orro-circle-compare.png"
MID = ROOT / "_icon-crops" / "mid-fixed.png"
PREVIEW = ROOT / "_icon-crops" / "orro-circle-preview.png"

SCALE_X = 1.28
SCALE_Y = 1.10
STEM_HALF = 48
SRC_Y0, SRC_Y1 = 595, 860


def is_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 100) & (a[:, :, 1] > 70) & (a[:, :, 2] < 140)


def letter_mask(gold: np.ndarray) -> np.ndarray:
    h, w = gold.shape
    cx = w // 2
    zone = gold.copy()
    zone[:SRC_Y0, :] = False
    zone[SRC_Y1:, :] = False
    zone[:, cx - STEM_HALF : cx + STEM_HALF] = False
    labeled, n = ndimage.label(zone)
    keep = np.zeros_like(zone)
    for i in range(1, n + 1):
        if int((labeled == i).sum()) >= 400:
            keep |= labeled == i
    return keep


def side_mask(letters: np.ndarray, side: str) -> np.ndarray:
    m = letters.copy()
    cx = m.shape[1] // 2
    if side == "left":
        m[:, cx:] = False
    else:
        m[:, : cx + 1] = False
    return m


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    arr = np.array(src)
    h, w = arr.shape[:2]
    cx = w // 2
    gold = is_gold(arr)
    letters = letter_mask(gold)
    gold_rgb = tuple(int(x) for x in np.median(arr[letters], axis=0))

    left = side_mask(letters, "left")
    right = side_mask(letters, "right")
    bottom = max(int(np.where(left)[0].max()), int(np.where(right)[0].max())) + 1
    outward = int(round((SCALE_X - 1.0) * 120))

    # Clear ONLY letter glyphs — never touch Y junction / stem
    clear = ndimage.binary_dilation(letters, iterations=4)
    soft = (arr[:, :, 0] > 45) & (arr[:, :, 1] > 25) & (arr[:, :, 2] < 180)
    soft[: SRC_Y0 - 4, :] = False
    soft[SRC_Y1 + 4 :, :] = False
    soft[:, cx - STEM_HALF : cx + STEM_HALF] = False
    soft &= ndimage.binary_dilation(letters, iterations=10)
    clear |= soft
    clear[:, cx - STEM_HALF : cx + STEM_HALF] = False

    out = arr.copy()
    out[clear] = 0
    # restore stem core from original (bridge/river untouched)
    stem = np.zeros((h, w), dtype=bool)
    stem[:, cx - STEM_HALF : cx + STEM_HALF] = True
    out[stem & gold] = arr[stem & gold]

    new_m = np.zeros((h, w), dtype=bool)
    for m, name in ((left, "left"), (right, "right")):
        ys, xs = np.where(m)
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        crop = m[y0:y1, x0:x1]
        zoomed = ndimage.zoom(crop.astype(np.float32), (SCALE_Y, SCALE_X), order=0) > 0.5
        zh, zw = zoomed.shape
        mid = (x0 + x1) / 2.0
        nx = int(round(mid - zw / 2))
        nx = nx - outward if name == "left" else nx + outward
        ny = bottom - zh
        # keep below bridge
        ny = max(ny, 620)
        gap = STEM_HALF - 2
        if name == "left":
            nx = min(nx, cx - gap - zw)
        else:
            nx = max(nx, cx + gap)
        nx = int(np.clip(nx, 24, w - 24 - zw))
        ny = int(np.clip(ny, 0, h - zh))
        new_m[ny : ny + zh, nx : nx + zw] |= zoomed
        print(name, f"{zw}x{zh} @{nx},{ny}")

    paint = new_m & ~stem
    out[paint] = gold_rgb

    leftover = letters & is_gold(out) & ~ndimage.binary_dilation(paint, iterations=2) & ~stem
    print("ghost", int(leftover.sum()), "paint", int(paint.sum()))

    final = Image.fromarray(out, "RGB")
    final.save(DRAFT)
    final.save(OUT)
    final.save(ADAPTIVE)

    # mid crop for QA
    final.crop((280, 280, 744, 700)).save(MID)
    final.crop((140, 560, 884, 900)).save(ROOT / "_icon-crops" / "orro-tight-circ.png")

    cm = Image.new("L", (w, h), 0)
    ImageDraw.Draw(cm).ellipse((48, 48, w - 48, h - 48), fill=255)
    prev = Image.new("RGB", (w, h), (0, 0, 0))
    prev.paste(final, mask=cm)
    ImageDraw.Draw(prev).ellipse((48, 48, w - 48, h - 48), outline=(70, 70, 70), width=2)
    prev.save(PREVIEW)

    comp = Image.new("RGB", (w * 2 + 24, int(h * 0.5) + 36), (8, 8, 8))
    comp.paste(src.crop((0, int(h * 0.5), w, h)), (0, 36))
    comp.paste(final.crop((0, int(h * 0.5), w, h)), (w + 24, 36))
    d = ImageDraw.Draw(comp)
    d.text((12, 10), "v6 Y + ORRO", fill=(200, 200, 200))
    d.text((w + 36, 10), "Y-Mitte restored + ORRO bigger", fill=(200, 200, 200))
    COMPARE.parent.mkdir(exist_ok=True)
    comp.save(COMPARE)
    print("applied", OUT)


if __name__ == "__main__":
    main()
