"""Restore readable ORRO: Y-only + original letters slightly larger."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
V6 = ROOT / "icon-clean-draft-v6.png"


def is_gold(a: np.ndarray) -> np.ndarray:
    return (a[:, :, 0] > 100) & (a[:, :, 1] > 70) & (a[:, :, 2] < 140)


def main() -> None:
    src = Image.open(V6).convert("RGB")
    arr = np.array(src)
    h, w = arr.shape[:2]
    cx = w // 2
    gold = is_gold(arr)

    zone = gold.copy()
    zone[:668, :] = False
    gap = 36
    zone[:, cx - gap : cx + gap] = False
    labeled, _ = ndimage.label(zone)

    letter_ids: list[int] = []
    for i in range(1, int(labeled.max()) + 1):
        if int((labeled == i).sum()) >= 2000:
            letter_ids.append(i)

    letter_mask = np.zeros((h, w), dtype=bool)
    for i in letter_ids:
        letter_mask |= labeled == i

    struct = np.ones((3, 3), dtype=bool)
    letter_mask_d = ndimage.binary_dilation(letter_mask, structure=struct, iterations=2)

    y_only = arr.copy()
    y_only[letter_mask_d & gold] = 0
    Image.fromarray(y_only).save(ROOT / "icon-clean-y-only.png")
    Image.fromarray(y_only).save(ROOT / "_icon-crops" / "y-only.png")

    def side_patch(side: str) -> tuple[Image.Image, tuple[int, int, int, int]]:
        ids = []
        for i in letter_ids:
            ys, xs = np.where(labeled == i)
            mid = (int(xs.min()) + int(xs.max())) / 2
            if side == "left" and mid < cx:
                ids.append(i)
            if side == "right" and mid >= cx:
                ids.append(i)
        m = np.zeros((h, w), dtype=bool)
        for i in ids:
            m |= labeled == i
        m = ndimage.binary_dilation(m, structure=struct, iterations=1)
        ys, xs = np.where(m)
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, y0 = max(0, x0 - 1), max(0, y0 - 1)
        x1, y1 = min(w, x1 + 1), min(h, y1 + 1)
        sub = arr[y0:y1, x0:x1]
        mm = m[y0:y1, x0:x1]
        keep = mm & (sub[:, :, 0] > 40) & (sub[:, :, 1] > 20) & (sub[:, :, 2] < 180)
        p = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        p[:, :, :3] = sub
        p[:, :, 3] = np.where(keep, 255, 0)
        return Image.fromarray(p, "RGBA"), (x0, y0, x1, y1)

    lp, lb = side_patch("left")
    rp, rb = side_patch("right")
    scale = 1.10
    ls = lp.resize((int(lp.width * scale), int(lp.height * scale)), Image.Resampling.LANCZOS)
    rs = rp.resize((int(rp.width * scale), int(rp.height * scale)), Image.Resampling.LANCZOS)

    lx = int(round((lb[0] + lb[2]) / 2 - ls.width / 2))
    rx = int(round((rb[0] + rb[2]) / 2 - rs.width / 2))
    ly = lb[3] - ls.height
    ry = rb[3] - rs.height

    ba = np.array(Image.fromarray(y_only).convert("RGBA"))

    def paste(base: np.ndarray, patch: Image.Image, x: int, y: int) -> np.ndarray:
        pw, ph = patch.size
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(w, x + pw), min(h, y + ph)
        sc = np.array(patch)[y0 - y : y0 - y + (y1 - y0), x0 - x : x0 - x + (x1 - x0)]
        a = sc[:, :, 3] > 80
        region = base[y0:y1, x0:x1]
        for ch in range(3):
            chn = region[:, :, ch]
            chn[a] = sc[:, :, ch][a]
            region[:, :, ch] = chn
        region[:, :, 3][a] = 255
        base[y0:y1, x0:x1] = region
        return base

    ba = paste(ba, ls, lx, ly)
    ba = paste(ba, rs, rx, ry)
    bigger = Image.fromarray(ba, "RGBA").convert("RGB")

    # Primary draft = readable original letterforms (v6)
    src.save(ROOT / "icon-clean-draft.png")
    bigger.save(ROOT / "icon-clean-draft-orro-slightly-bigger.png")

    comp = Image.new("RGB", (w * 3 + 30, h), (0, 0, 0))
    comp.paste(Image.fromarray(y_only), (0, 0))
    comp.paste(src, (w + 15, 0))
    comp.paste(bigger, (2 * w + 30, 0))
    (ROOT / "_icon-crops").mkdir(exist_ok=True)
    comp.save(ROOT / "_icon-crops" / "orro-rebuild-compare.png")
    print("y-only | readable v6 | slightly bigger")
    print("draft = readable v6")


if __name__ == "__main__":
    main()
