"""Surgical cleanup v3 — stronger middle clear, keep outer DNA."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "icon.png"
OUT = ROOT / "icon-clean-draft.png"
AFTER = ROOT / "_icon-crops" / "after-full-top.png"
COMPARE = ROOT / "_icon-crops" / "compare-top.png"

BIG_BEN = (330, 120, 445, 370)
EIFFEL = (525, 120, 640, 380)
# wider valley coverage
DOME = (410, 270, 540, 440)
COLOSSEUM = (480, 300, 620, 450)
TREES = (385, 375, 475, 510)
# protect outer keep zones from accidental erase
ESB = (200, 120, 330, 390)
CHURCH = (640, 170, 770, 370)
HOUSES = (760, 190, 900, 410)


def is_gold(rgb: np.ndarray) -> np.ndarray:
    return (rgb[:, :, 0] > 90) & (rgb[:, :, 1] > 60) & (rgb[:, :, 2] < 150)


def is_black(rgb: np.ndarray) -> np.ndarray:
    return (rgb[:, :, 0] < 50) & (rgb[:, :, 1] < 50) & (rgb[:, :, 2] < 50)


def rect_mask(shape: tuple[int, int], box: tuple[int, int, int, int], blur: float = 0.5) -> np.ndarray:
    h, w = shape
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).rectangle(box, fill=255)
    if blur > 0:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return np.array(img).astype(np.float32) / 255.0


def poly_mask(shape: tuple[int, int], pts: list[tuple[int, int]], blur: float = 0.5) -> np.ndarray:
    h, w = shape
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).polygon(pts, fill=255)
    if blur > 0:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return np.array(img).astype(np.float32) / 255.0


def protect(mask: np.ndarray, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    mask[y0:y1, x0:x1] = 0.0


def erase_gold(arr: np.ndarray, mask: np.ndarray) -> None:
    g = is_gold(arr.astype(np.uint8)).astype(np.float32)
    s = mask * g
    for c in range(3):
        arr[:, :, c] *= 1.0 - s


def fill_gold(arr: np.ndarray, mask: np.ndarray, gold_rgb: np.ndarray) -> None:
    g = is_gold(arr.astype(np.uint8)).astype(np.float32)
    s = mask * g
    for c in range(3):
        arr[:, :, c] = arr[:, :, c] * (1.0 - s) + gold_rgb[c] * s
    # also fill black cutouts that were originally gold
    cut = mask * is_black(arr.astype(np.uint8)).astype(np.float32)
    for c in range(3):
        arr[:, :, c] = arr[:, :, c] * (1.0 - cut) + gold_rgb[c] * cut


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    arr = np.array(src).astype(np.float32)
    h, w = arr.shape[:2]
    gold0 = is_gold(arr.astype(np.uint8)).astype(np.float32)
    stem = gold0[580:700, 470:560]
    ys, xs = np.where(stem > 0.5)
    gold_rgb = arr[580 + int(ys[0]), 470 + int(xs[0])].copy()

    # 1) Big Ben — erase almost all distinctive tower to black; keep only bottom shoulder as solid gold
    bb = rect_mask((h, w), BIG_BEN, 0.4)
    bx0, by0, bx1, by1 = BIG_BEN
    split = by0 + int((by1 - by0) * 0.72)  # most of tower gone
    upper = bb.copy()
    upper[split:, :] = 0.0
    lower = bb.copy()
    lower[:split, :] = 0.0
    erase_gold(arr, upper)
    fill_gold(arr, lower, gold_rgb)

    # 2) Eiffel — erase all gold strokes (lattice already black). No gold fill.
    ef = rect_mask((h, w), EIFFEL, 0.4)
    protect(ef, CHURCH)
    protect(ef, HOUSES)
    erase_gold(arr, ef)

    # 3) Center valley polygon — clear ALL gold islands in the V (dome, colosseum leftovers)
    # Approximate open V between Y arms
    valley = poly_mask(
        (h, w),
        [
            (455, 250),  # top of V
            (520, 250),
            (610, 360),
            (620, 450),
            (540, 470),
            (460, 470),
            (400, 430),
            (400, 340),
        ],
        blur=0.6,
    )
    # also force the rect targets
    valley = np.maximum(valley, rect_mask((h, w), DOME, 0.5))
    valley = np.maximum(valley, rect_mask((h, w), COLOSSEUM, 0.5))
    protect(valley, TREES)
    protect(valley, ESB)
    protect(valley, CHURCH)
    protect(valley, HOUSES)
    erase_gold(arr, valley)

    out = Image.fromarray(arr.astype(np.uint8), "RGB")
    out.save(OUT, "PNG")
    AFTER.parent.mkdir(exist_ok=True)
    top = out.crop((150, 80, 900, 520))
    top.save(AFTER)
    before = src.crop((150, 80, 900, 520))
    canvas = Image.new("RGB", (before.width * 2 + 24, before.height + 40), (15, 15, 15))
    canvas.paste(before, (0, 40))
    canvas.paste(top, (before.width + 24, 40))
    d = ImageDraw.Draw(canvas)
    d.text((10, 10), "ORIGINAL", fill=(200, 200, 200))
    d.text((before.width + 34, 10), "APP ICON CLEAN", fill=(200, 200, 200))
    canvas.save(COMPARE)
    print("wrote", OUT)

    # stats
    b = np.array(out)
    a = np.array(src)
    def g(x0,y0,x1,y1, img):
        sl = img[y0:y1, x0:x1]
        return int(is_gold(sl).sum())
    for name, box in [("bb", BIG_BEN), ("ef", EIFFEL), ("dome", DOME), ("col", COLOSSEUM), ("esb", ESB), ("church", CHURCH), ("trees", TREES)]:
        print(name, g(*box, a), "->", g(*box, b))


if __name__ == "__main__":
    main()
