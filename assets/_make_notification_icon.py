"""Build Android-safe white-on-transparent Y notification icon from mono mark."""
from __future__ import annotations

import os
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
SRC = os.path.join(ROOT, "brand", "yorro-v2-mono-y.png")


def to_white_silhouette(src: Image.Image) -> Image.Image:
    src = src.convert("RGBA")
    w, h = src.size
    pixels = src.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    kept = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            luminance = 0.299 * r + 0.587 * g + 0.114 * b
            # Gold/yellow glyph → opaque white; dark bg → transparent
            if a > 20 and luminance > 80 and (r > 120 or (r > 80 and g > 60)):
                op[x, y] = (255, 255, 255, 255)
                kept += 1
    print(f"source={w}x{h} kept={kept}")
    return out


def fit_square(img: Image.Image, pad_ratio: float = 0.14) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        raise SystemExit("no opaque pixels — silhouette empty")
    cropped = img.crop(bbox)
    cw, ch = cropped.size
    pad = int(max(cw, ch) * pad_ratio)
    side = max(cw, ch) + pad * 2
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - cw) // 2, (side - ch) // 2), cropped)
    return canvas


def main() -> None:
    silhouette = fit_square(to_white_silhouette(Image.open(SRC)))

    expo = silhouette.resize((96, 96), Image.Resampling.LANCZOS)
    expo_path = os.path.join(ROOT, "notification-icon.png")
    expo.save(expo_path, "PNG")
    print("wrote", expo_path)

    master = silhouette.resize((192, 192), Image.Resampling.LANCZOS)
    master.save(os.path.join(ROOT, "notification-icon-192.png"), "PNG")

    densities = {
        "drawable-mdpi": 24,
        "drawable-hdpi": 36,
        "drawable-xhdpi": 48,
        "drawable-xxhdpi": 72,
        "drawable-xxxhdpi": 96,
    }
    base = os.path.join(REPO, "android", "app", "src", "main", "res")
    for folder, size in densities.items():
        path = os.path.join(base, folder)
        os.makedirs(path, exist_ok=True)
        outp = os.path.join(path, "notification_icon.png")
        silhouette.resize((size, size), Image.Resampling.LANCZOS).save(outp, "PNG")
        print("wrote", outp, size)

    print("done")


if __name__ == "__main__":
    main()
