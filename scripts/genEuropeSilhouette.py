"""Generate dark Europe silhouette for Akt-3 ResearchTheater."""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

W, H = 900, 1400
img = Image.new("RGB", (W, H), (8, 28, 24))
draw = ImageDraw.Draw(img)

for x in range(0, W, 48):
    draw.line([(x, 0), (x, H)], fill=(14, 42, 36), width=1)
for y in range(0, H, 48):
    draw.line([(0, y), (W, y)], fill=(14, 42, 36), width=1)


def xy(lat: float, lng: float) -> tuple[float, float]:
    # Muss REGION_BOUNDS.europe in sparkGeo.ts matchen
    x = (lng - (-12)) / (38 - (-12)) * W
    y = (62 - lat) / (62 - 32.5) * H
    return (x, y)


land = (18, 58, 46)
edge = (72, 160, 120)

polys = [
    [(43.8, -9.2), (43.5, -1.5), (41.8, 3.2), (36.0, -5.5), (37.0, -9.0), (43.8, -9.2)],
    [
        (51.1, -4.5),
        (51.5, 1.5),
        (53.5, 7.0),
        (54.9, 8.5),
        (54.5, 14.0),
        (50.0, 19.0),
        (48.5, 17.0),
        (46.5, 16.0),
        (45.5, 13.5),
        (43.5, 7.5),
        (43.2, 3.0),
        (43.5, -1.5),
        (48.5, -4.5),
        (51.1, -4.5),
    ],
    [(58.6, -5.0), (58.0, 2.0), (54.0, 0.0), (50.5, -1.5), (51.5, -5.5), (56.0, -6.0), (58.6, -5.0)],
    [(55.3, -7.5), (53.0, -6.0), (51.5, -10.0), (53.5, -10.0), (55.3, -7.5)],
    [(60.0, 5.0), (61.5, 11.0), (60.5, 18.0), (58.0, 12.0), (57.5, 8.0), (60.0, 5.0)],
    [
        (46.5, 8.5),
        (46.0, 13.5),
        (45.5, 13.5),
        (41.9, 16.5),
        (38.1, 15.6),
        (37.5, 15.0),
        (38.2, 13.0),
        (40.0, 15.5),
        (41.0, 14.0),
        (42.5, 11.0),
        (44.0, 10.0),
        (45.5, 9.0),
        (46.5, 8.5),
    ],
    [(38.3, 12.5), (38.2, 15.5), (36.7, 15.1), (37.0, 12.5), (38.3, 12.5)],
    [
        (46.5, 13.5),
        (46.0, 16.5),
        (44.0, 22.5),
        (41.0, 26.5),
        (40.0, 24.0),
        (36.5, 23.0),
        (35.0, 24.5),
        (35.2, 26.5),
        (36.5, 28.0),
        (38.5, 26.5),
        (40.5, 27.0),
        (41.5, 28.5),
        (42.5, 27.5),
        (44.5, 22.0),
        (46.5, 16.0),
        (46.5, 13.5),
    ],
    [
        (41.5, 28.0),
        (42.0, 35.0),
        (39.0, 37.5),
        (36.0, 36.0),
        (36.2, 30.0),
        (36.8, 28.5),
        (38.5, 27.0),
        (40.0, 26.5),
        (41.5, 28.0),
    ],
    # Maghreb nur als dünner Saum — klarer Mittelmeer-Streifen unter den Balearen
    [
        (35.8, -9.0),
        (35.6, -5.5),
        (35.4, 0.0),
        (35.8, 10.0),
        (33.0, 11.0),
        (32.5, -8.0),
        (34.5, -10.0),
        (35.8, -9.0),
    ],
    [(54.5, 14.0), (54.8, 19.5), (52.0, 23.5), (49.0, 22.5), (48.0, 17.0), (50.0, 14.5), (54.5, 14.0)],
    [(57.7, 8.0), (57.5, 12.5), (55.0, 15.0), (54.5, 12.0), (54.8, 8.5), (57.7, 8.0)],
    # Balearen — groß genug, dass Palma-Pin klar auf der Insel sitzt (nicht über Maghreb)
    [(40.05, 2.15), (40.05, 3.55), (39.15, 3.55), (39.15, 2.15), (40.05, 2.15)],
    [(39.15, 1.15), (39.15, 1.65), (38.85, 1.65), (38.85, 1.15), (39.15, 1.15)],  # Ibiza
    [(42.5, 8.5), (43.0, 9.5), (41.3, 9.5), (41.2, 8.6), (42.5, 8.5)],
    [(41.2, 8.2), (41.2, 9.8), (38.8, 9.8), (38.9, 8.2), (41.2, 8.2)],
    [(35.6, 23.5), (35.6, 26.3), (34.9, 26.3), (34.9, 23.5), (35.6, 23.5)],
]

for poly in polys:
    pts = [xy(lat, lng) for lat, lng in poly]
    draw.polygon(pts, fill=land, outline=edge)

dots = [
    (52.52, 13.4),
    (48.85, 2.35),
    (41.39, 2.17),
    (40.42, -3.70),
    (41.9, 12.5),
    (48.2, 16.37),
    (52.37, 4.90),
    (50.08, 14.44),
    (47.5, 19.04),
    (39.57, 2.65),
    (41.0, 28.97),
    (36.9, 30.7),
    (38.72, -9.14),
    (43.71, 7.26),
    (43.51, 16.44),
]
for lat, lng in dots:
    x, y = xy(lat, lng)
    r = 2.5
    draw.ellipse([x - r, y - r, x + r, y + r], fill=(120, 190, 140))

vignette = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vignette)
for i in range(40):
    a = int(i * 4.5)
    vd.rectangle([i * 3, i * 3, W - 1 - i * 3, H - 1 - i * 3], outline=a)
vignette = vignette.filter(ImageFilter.GaussianBlur(28))
dark = Image.new("RGB", (W, H), (4, 14, 12))
img = Image.composite(dark, img, vignette)
img = img.filter(ImageFilter.GaussianBlur(0.6))

out_png = Path(__file__).resolve().parents[1] / "src" / "assets" / "reisebuero" / "europeSilhouette.png"
out_jpg = Path(__file__).resolve().parents[1] / "src" / "assets" / "reisebuero" / "europeSilhouette.jpg"
out_png.parent.mkdir(parents=True, exist_ok=True)
img.save(out_png, "PNG", optimize=True)
img.convert("RGB").save(out_jpg, "JPEG", quality=88, optimize=True)
print("saved", out_png, out_jpg, img.size)
