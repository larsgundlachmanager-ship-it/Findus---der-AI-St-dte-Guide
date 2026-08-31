"""Draw clean larger ORRO geometrically onto cleared v6 Y."""
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

STEM_HALF = 50
GOLD = (217, 157, 2)
# Larger than v6 (~185 tall, ~502 wide span)
LETTER_H = 230
STROKE = 24
O_W = 78
R_STEM = 24
R_BOWL_W = 64
GAP = 16  # between O and R
EDGE_GAP = 12  # between R and stem
TOP = 615


def is_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 100) & (a[:, :, 1] > 70) & (a[:, :, 2] < 140)


def near_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 45) & (a[:, :, 1] > 25) & (a[:, :, 2] < 180)


def clear_letters(arr: np.ndarray) -> np.ndarray:
    h, w = arr.shape[:2]
    cx = w // 2
    gold = is_gold(arr)
    zone = gold.copy()
    zone[:590, :] = False
    zone[870:, :] = False
    zone[:, cx - STEM_HALF : cx + STEM_HALF] = False
    labeled, n = ndimage.label(zone)
    letters = np.zeros_like(zone)
    for i in range(1, n + 1):
        if int((labeled == i).sum()) >= 300:
            letters |= labeled == i
    clear = ndimage.binary_dilation(letters, iterations=5)
    soft = near_gold(arr)
    soft[:590, :] = False
    soft[870:, :] = False
    soft[:, cx - STEM_HALF : cx + STEM_HALF] = False
    soft &= ndimage.binary_dilation(letters, iterations=10)
    clear |= soft
    out = arr.copy()
    out[clear] = 0
    # restore stem core
    stem = np.zeros((h, w), dtype=bool)
    stem[:, cx - STEM_HALF : cx + STEM_HALF] = True
    out[stem & gold] = arr[stem & gold]
    return out


def draw_O(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, stroke: int, fill) -> None:
    # outer rounded rect
    draw.rounded_rectangle((x, y, x + w - 1, y + h - 1), radius=w // 2, fill=fill)
    # inner hole
    pad = stroke
    draw.rounded_rectangle(
        (x + pad, y + pad, x + w - 1 - pad, y + h - 1 - pad),
        radius=max(2, (w - 2 * pad) // 2),
        fill=(0, 0, 0),
    )


def draw_R(draw: ImageDraw.ImageDraw, x: int, y: int, h: int, stem: int, bowl_w: int, stroke: int, fill, mirror: bool = False) -> int:
    """Draw stylized R; returns total width."""
    # Layout: [stem][gap][bowl] for normal; mirrored flips
    gap = 8
    total = stem + gap + bowl_w
    if not mirror:
        sx = x
        bx = x + stem + gap
        # stem
        draw.rectangle((sx, y, sx + stem - 1, y + h - 1), fill=fill)
        # bowl (upper half rounded)
        bowl_h = int(h * 0.55)
        draw.rounded_rectangle((bx, y, bx + bowl_w - 1, y + bowl_h - 1), radius=bowl_w // 2, fill=fill)
        ix0, iy0 = bx + stroke, y + stroke
        ix1, iy1 = bx + bowl_w - 1 - stroke, y + bowl_h - 1 - stroke
        if ix1 > ix0 and iy1 > iy0:
            draw.rounded_rectangle(
                (ix0, iy0, ix1, iy1),
                radius=max(2, (ix1 - ix0) // 2),
                fill=(0, 0, 0),
            )
        # close bowl to stem side (left of bowl) with gold bar so it reads as R
        draw.rectangle((bx, y, bx + stroke - 1, y + bowl_h - 1), fill=fill)
        # leg
        leg_top = y + bowl_h - stroke
        # diagonal-ish leg as thick bar
        for i in range(h - (bowl_h - stroke)):
            yy = leg_top + i
            xx = bx + int(i * (bowl_w * 0.55) / max(1, h - bowl_h))
            draw.rectangle((xx, yy, xx + stroke - 1, min(y + h - 1, yy + stroke // 2)), fill=fill)
    else:
        # mirrored: bowl then gap then stem
        bx = x
        sx = x + bowl_w + gap
        draw.rectangle((sx, y, sx + stem - 1, y + h - 1), fill=fill)
        bowl_h = int(h * 0.55)
        draw.rounded_rectangle((bx, y, bx + bowl_w - 1, y + bowl_h - 1), radius=bowl_w // 2, fill=fill)
        ix0, iy0 = bx + stroke, y + stroke
        ix1, iy1 = bx + bowl_w - 1 - stroke, y + bowl_h - 1 - stroke
        if ix1 > ix0 and iy1 > iy0:
            draw.rounded_rectangle(
                (ix0, iy0, ix1, iy1),
                radius=max(2, (ix1 - ix0) // 2),
                fill=(0, 0, 0),
            )
        draw.rectangle((bx + bowl_w - stroke, y, bx + bowl_w - 1, y + bowl_h - 1), fill=fill)
        leg_top = y + bowl_h - stroke
        for i in range(h - (bowl_h - stroke)):
            yy = leg_top + i
            xx = bx + bowl_w - stroke - int(i * (bowl_w * 0.55) / max(1, h - bowl_h))
            draw.rectangle((xx, yy, xx + stroke - 1, min(y + h - 1, yy + stroke // 2)), fill=fill)
    return total


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    arr = np.array(src)
    h, w = arr.shape[:2]
    cx = w // 2
    base = clear_letters(arr)
    img = Image.fromarray(base)
    draw = ImageDraw.Draw(img)

    # Left OR: O then R, right-aligned toward stem
    r_w = R_STEM + 8 + R_BOWL_W
    left_block = O_W + GAP + r_w
    left_x1 = cx - STEM_HALF - EDGE_GAP
    left_x0 = left_x1 - left_block
    draw_O(draw, left_x0, TOP, O_W, LETTER_H, STROKE, GOLD)
    draw_R(draw, left_x0 + O_W + GAP, TOP, LETTER_H, R_STEM, R_BOWL_W, STROKE, GOLD, mirror=False)

    # Right RO: mirrored R then O
    right_x0 = cx + STEM_HALF + EDGE_GAP
    draw_R(draw, right_x0, TOP, LETTER_H, R_STEM, R_BOWL_W, STROKE, GOLD, mirror=True)
    draw_O(draw, right_x0 + r_w + GAP, TOP, O_W, LETTER_H, STROKE, GOLD)

    final = img.convert("RGB")
    final.save(OUT)

    comp = Image.new("RGB", (w * 2 + 24, int(h * 0.48) + 36), (8, 8, 8))
    comp.paste(src.crop((0, int(h * 0.52), w, h)), (0, 36))
    comp.paste(final.crop((0, int(h * 0.52), w, h)), (w + 24, 36))
    d = ImageDraw.Draw(comp)
    d.text((12, 10), "JETZT (klar)", fill=(200, 200, 200))
    d.text((w + 36, 10), "NEU gezeichnet (groesser)", fill=(200, 200, 200))
    COMPARE.parent.mkdir(exist_ok=True)
    comp.save(COMPARE)

    cm = Image.new("L", (w, h), 0)
    dd = ImageDraw.Draw(cm)
    inset = int(w * 0.08)
    dd.ellipse((inset, inset, w - inset, h - inset), fill=255)
    circled = Image.new("RGB", (w, h), (0, 0, 0))
    circled.paste(final, mask=cm)
    ImageDraw.Draw(circled).ellipse((inset, inset, w - inset, h - inset), outline=(70, 70, 70), width=2)
    CIRCLE_PREVIEW.parent.mkdir(exist_ok=True)
    circled.save(CIRCLE_PREVIEW)
    final.crop((150, 560, 874, 870)).save(ROOT / "_icon-crops" / "orro-tight-circ.png")
    print("left_x0", left_x0, "right end", right_x0 + r_w + GAP + O_W, "->", OUT)


if __name__ == "__main__":
    main()
