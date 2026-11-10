"""Build the site's logo files from the three transparent cutouts (run brand/cutout.py first):
header mark (embedded in the page), favicon, home-screen icon, and the 1200x630 link-preview image."""
import base64, io
from PIL import Image, ImageDraw

mark = Image.open("brand/shiftscore-mark.png")
lockup = Image.open("brand/shiftscore-lockup.png")

def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)

def square(im, size, bg=None, pad=0.08):
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    m = fit(im, int(size * (1 - 2 * pad)), int(size * (1 - 2 * pad)))
    canvas.paste(m, ((size - m.width) // 2, (size - m.height) // 2), m)
    return canvas

header = fit(mark, 400, 300)
header.save("brand/header-mark.png", optimize=True)
square(mark, 64, pad=0.02).save("brand/favicon.png")
square(mark, 180, bg=(10, 31, 61, 255), pad=0.1).convert("RGB").save("brand/apple-touch-icon.png")
square(mark, 512, pad=0.04).save("brand/logo-mark-512.png")

W, H = 1200, 630
og = Image.new("RGB", (W, H), (10, 31, 61))
px = og.load()
for y in range(H):
    for x in range(W):
        t = min(1.0, max(0.0, (x / W) * 0.55 + (y / H) * 0.45))
        px[x, y] = (int(10 + 20 * t), int(31 + 50 * t), int(61 + 90 * t))
l = fit(lockup, 700, 470)
px0, py0 = (W - l.width) // 2, (H - l.height) // 2
ImageDraw.Draw(og).rounded_rectangle((px0 - 60, py0 - 36, px0 + l.width + 60, py0 + l.height + 36), radius=44, fill=(243, 248, 253))
og.paste(l, (px0, py0), l)
og.save("brand/og-image.png")
print("header-mark", header.size, len(open("brand/header-mark.png", "rb").read()) // 1024, "KB")
