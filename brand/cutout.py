"""Turn the supplied logo images (checkerboard or white baked into the pixels) into transparent PNGs.
The logos all have a closed navy outline, so the background is the low-saturation (gray / white) region connected to the
image border; the white stroke inside the outline can't be reached from outside and stays."""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

def cutout(src, dst, pad=12):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(int)
    sat = a.max(axis=2) - a.min(axis=2)
    neutral = (sat < 28) & (a.min(axis=2) > 95)          # gray / white checker squares and the white backdrop
    lab, n = ndimage.label(neutral)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    bg = ndimage.binary_dilation(bg, iterations=1)         # eat the antialiased gray fringe
    alpha = Image.fromarray(((~bg) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.7))
    out = im.convert("RGBA"); out.putalpha(alpha)
    box = out.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    box = (max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, out.width), min(box[3] + pad, out.height))
    out = out.crop(box)
    out.save(dst)
    return out.size

if __name__ == "__main__":
    for name in ("mark", "wordmark", "lockup"):
        print(name, cutout(f"brand/source/logo-{name}-original.webp", f"brand/shiftscore-{name}.png"))
