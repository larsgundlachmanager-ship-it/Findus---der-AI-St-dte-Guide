"""Widen ORRO cleanly: clear FULL original letter glyphs, then nearest-zoom paint."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "icon-clean-draft-v6.png"
OUT = ROOT / "icon-clean-draft-orro-circle.png"
COMPARE = ROOT / "_icon-crops" / "orro-circle-compare.png"
CIRCLE_PREVIEW = ROOT / "_icon-crops" / "orro-circle-preview.png"

SCALE_X = 1.28
SCALE_Y = 1.16
STEM_HALF = 48
# Full original letter extent (v6 measured ~600–859)
SRC_Y0, SRC_Y1 = 595, 860
PLACE_TOP = 620
CIRCLE_MARGIN = 0.09


def is_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 100) & (a[:, :, 1] > 70) & (a[:, :, 2] < 140)


def near_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 50) & (a[:, :, 1] > 30) & (a[:, :, 2] < 175)


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


def place_zoomed(canvas: np.ndarray, src_mask: np.ndarray, outward: int, bottom: int, side: str) -> None:
    ys, xs = np.where(src_mask)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    crop = src_mask[y0:y1, x0:x1]
    zoomed = ndimage.zoom(crop.astype(np.float32), (SCALE_Y, SCALE_X), order=0) > 0.5
    zh, zw = zoomed.shape
    h, w = canvas.shape
    cx = w // 2

    mid_x = (x0 + x1) / 2.0
    nx = int(round(mid_x - zw / 2))
    nx = nx - outward if side == "left" else nx + outward
    ny = bottom - zh
    if ny < PLACE_TOP:
        # trim top to keep under bridge
        trim = PLACE_TOP - ny
        if trim < zh:
            zoomed = zoomed[trim:, :]
            zh = zoomed.shape[0]
            ny = PLACE_TOP
        else:
            ny = PLACE_TOP

    gap = STEM_HALF - 2
    if side == "left" and nx + zw > cx - gap:
        nx = cx - gap - zw
    if side == "right" and nx < cx + gap:
        nx = cx + gap

    inset = int(w * CIRCLE_MARGIN)
    nx = int(np.clip(nx, inset, w - inset - zw))
    ny = int(np.clip(ny, 0, h - zh))
    canvas[ny : ny + zh, nx : nx + zw] |= zoomed
    print(f"{side}: {zw}x{zh} @ {nx},{ny}")


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    arr = np.array(src)
    h, w = arr.shape[:2]
    cx = w // 2
    gold = is_gold(arr)
    letters = letter_mask(gold)
    print("letter pixels", int(letters.sum()), "y", int(np.where(letters)[0].min()), int(np.where(letters)[0].max()))

    gold_rgb = tuple(int(x) for x in np.median(arr[letters], axis=0))
    left = side_mask(letters, "left")
    right = side_mask(letters, "right")
    bottom = max(int(np.where(left)[0].max()), int(np.where(right)[0].max())) + 1
    outward = int(round((SCALE_X - 1.0) * 130))

    # Clear ALL letter glyphs + soft halo (do NOT exclude stem-adjacent letter pixels)
    clear = ndimage.binary_dilation(letters, iterations=4)
    # also soft gold near letters in band
    band = np.zeros((h, w), dtype=bool)
    band[SRC_Y0 - 5 : SRC_Y1 + 5, :] = True
    stem_core = np.zeros((h, w), dtype=bool)
    stem_core[:, cx - STEM_HALF : cx + STEM_HALF] = True
    soft = near_gold(arr) & band & ndimage.binary_dilation(letters, iterations=8)
    clear |= soft
    # never erase stem core / river body
    clear &= ~stem_core

    out = arr.copy()
    out[clear] = 0
    # ensure stem core restored from original
    out[stem_core & gold] = arr[stem_core & gold]

    new_letters = np.zeros((h, w), dtype=bool)
    place_zoomed(new_letters, left, outward, bottom, "left")
    place_zoomed(new_letters, right, outward, bottom, "right")

    protect = stem_core & is_gold(out)
    paint = new_letters & ~protect
    out[paint] = gold_rgb

    final = Image.fromarray(out, "RGB")
    final.save(OUT)

    comp = Image.new("RGB", (w * 2 + 24, int(h * 0.48) + 36), (8, 8, 8))
    comp.paste(src.crop((0, int(h * 0.52), w, h)), (0, 36))
    comp.paste(final.crop((0, int(h * 0.52), w, h)), (w + 24, 36))
    d = ImageDraw.Draw(comp)
    d.text((12, 10), "JETZT (klar)", fill=(200, 200, 200))
    d.text((w + 36, 10), f"GROESSER x{SCALE_X}", fill=(200, 200, 200))
    COMPARE.parent.mkdir(exist_ok=True)
    comp.save(COMPARE)

    cm = Image.new("L", (w, h), 0)
    dd = ImageDraw.Draw(cm)
    inset = int(w * CIRCLE_MARGIN)
    dd.ellipse((inset, inset, w - inset, h - inset), fill=255)
    circled = Image.new("RGB", (w, h), (0, 0, 0))
    circled.paste(final, mask=cm)
    ImageDraw.Draw(circled).ellipse((inset, inset, w - inset, h - inset), outline=(70, 70, 70), width=2)
    CIRCLE_PREVIEW.parent.mkdir(exist_ok=True)
    circled.save(CIRCLE_PREVIEW)
    final.crop((150, 560, 874, 870)).save(ROOT / "_icon-crops" / "orro-tight-circ.png")

    # verify no leftover original letter mass outside new paint in band
    leftover = letters & ~ndimage.binary_dilation(paint, iterations=2) & ~stem_core
    print("leftover old letter px", int(leftover.sum()), "paint", int(paint.sum()), "gold", gold_rgb)


if __name__ == "__main__":
    main()
