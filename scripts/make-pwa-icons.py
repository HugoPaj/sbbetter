#!/usr/bin/env python3
"""
Generates the PWA icons (needs Pillow): the SBBetter mark, a play on the SBB
double arrow (our own drawing, not the trademark) with a "+" for "better".

    python3 scripts/make-pwa-icons.py

public/icons/icon-{192,512}.png   rounded tile, for the manifest ("any")
public/icons/maskable-512.png     full-bleed, artwork inside the 80 % safe zone ("maskable")
src/app/apple-icon.png            180 px full-bleed; iOS rounds the corners itself
src/app/favicon.ico               16/32/48 px rounded tile, for browser tabs
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RED = (235, 0, 0, 255)  # --color-sbb-red / manifest theme_color

# The mark on a 100×100 grid: a bar with an outward chevron at each end, and a "+".
ARROW = [(x, y + 5) for x, y in [(10, 50), (28, 32), (40, 32), (25, 47), (75, 47), (60, 32), (72, 32), (90, 50), (72, 68), (60, 68), (75, 53), (25, 53), (40, 68), (28, 68)]]
PLUS = [(74, 10), (80, 10), (80, 17), (87, 17), (87, 23), (80, 23), (80, 30), (74, 30), (74, 23), (67, 23), (67, 17), (74, 17)]


def tile(size: int, *, rounded: bool, scale: float) -> Image.Image:
    big = size * 4  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=RED)
    else:
        d.rectangle([0, 0, big, big], fill=RED)
    k = big / 100 * scale
    off = big * (1 - scale) / 2
    for shape in (ARROW, PLUS):
        d.polygon([(off + x * k, off + y * k) for x, y in shape], fill="white")
    return img.resize((size, size), Image.LANCZOS)


(ROOT / "public/icons").mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    tile(size, rounded=True, scale=1).save(ROOT / f"public/icons/icon-{size}.png")
tile(512, rounded=False, scale=0.8).save(ROOT / "public/icons/maskable-512.png")
tile(180, rounded=False, scale=0.9).convert("RGB").save(ROOT / "src/app/apple-icon.png")
tile(256, rounded=True, scale=1).save(ROOT / "src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("icons written")
