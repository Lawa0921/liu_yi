"""Render the 朱印「六藝」 alpha mask.  (local developer tool; CI never runs it)

Run (from the repo root):
  uv run --no-project --python 3.11 --with pillow --with numpy --with fonttools python tools/seal/render-seal.py \
      --font C:/Users/bag57/.cache/liu_yi-fonts/chongxi_seal.otf --out src/assets/seal/seal-liuyi.png

  --font PATH   崇羲篆體 (Chong Xi Small Seal) .otf.  Default: ~/.cache/liu_yi-fonts/chongxi_seal.otf
                The font is CC BY-ND 3.0 TW: it lives OUTSIDE the repo and must never be committed
                (tests/unit/seal-asset.test.ts scans the repo for *.otf / *.ttf / "chongxi").
  --out PATH    output mask PNG.  Default: <repo>/src/assets/seal/seal-liuyi.png
  --size N      output edge in px (default 512; the test gate expects 512)

Output: 512x512 grayscale+alpha PNG.  朱文 (zhuwen): the square frame and the two characters are opaque
(L=255, A=255), everything else is fully transparent.  Right column 「六」, left column 「藝」 (read right to left).
The alpha is binary: the characters are drawn at 4x supersampling, box-downsampled, then thresholded at 50%.
The mask is the only artifact that enters the repo; at runtime it is sampled into particles and tinted by the shader.

Prints a JSON summary on stdout (font sha256, mask sha256, layout, ink ratio) for src/assets/silhouettes/provenance.json.
Exits non-zero, without writing, if the font is missing or lacks 六 or 藝 in its cmap.
"""
import argparse, hashlib, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_FONT = os.path.join(os.path.expanduser("~"), ".cache", "liu_yi-fonts", "chongxi_seal.otf")
DEFAULT_OUT = os.path.join(REPO, "src", "assets", "seal", "seal-liuyi.png")

# Characters in reading order: right column first (六), then left column (藝).
CHARS = ("六", "藝")

SS = 4                 # supersampling factor
# Layout, in output pixels (SIZE = 512).  Frame outer edge sits FRAME_INSET px from the canvas edge, which keeps the
# whole 8-14 px band opaque (test gate) and leaves a clear transparent margin outside the frame.
FRAME_INSET = 8
FRAME_THICK = 18
PAD = 18               # clear space between the frame's inner edge and a character
COL_GAP = 14           # clear space between the two columns
# Optional vertical shift of the glyph block (px, + is down); the font's own ink box is centred on the frame centre.
SHIFT_Y = 0
# Extra stroke weight (px per side at 512).  The font's strokes are thin next to the frame and the 藝 glyph breaks into
# separate parts; a little extra weight closes the hairline gaps and makes a chunkier, more seal-like (and easier to
# sample) impression.
EMBOLDEN = 2.0


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_cmap(font_path):
    """Abort unless every character in CHARS has a real glyph in the font's cmap."""
    cmap = TTFont(font_path, lazy=True).getBestCmap()
    missing = [ch for ch in CHARS if ord(ch) not in cmap]
    if missing:
        sys.exit("font lacks glyphs for: " + " ".join(f"{ch} (U+{ord(ch):04X})" for ch in missing))


def glyph_ink(font, ch, stroke=0):
    """Render one character on a scratch canvas; return its ink as an 'L' image cropped to the ink bbox.
    `stroke` (supersampled px) thickens every stroke by that much on each side (FreeType stroker, round joins)."""
    em = font.size
    pad = em // 2
    canvas = Image.new("L", (em + 2 * pad, em + 2 * pad), 0)
    ImageDraw.Draw(canvas).text((pad, pad), ch, font=font, fill=255, stroke_width=stroke, stroke_fill=255)
    bbox = canvas.getbbox()
    if bbox is None:
        sys.exit(f"font rendered nothing for {ch}")
    return canvas.crop(bbox)


def render(font_path, size, embolden):
    scale = size / 512.0
    inset, thick, pad, gap = (round(v * scale) for v in (FRAME_INSET, FRAME_THICK, PAD, COL_GAP))
    inner = inset + thick                      # frame inner edge, distance from the canvas edge
    col_w = (size - 2 * inner - 2 * pad - gap) // 2
    stroke = round(embolden * scale * SS)      # extra stroke per side, supersampled px

    # Probe at a reference size to get the glyph ink boxes, then pick one font size for BOTH characters
    # (same scale keeps the stroke weight consistent) so the widest glyph, including the extra stroke,
    # exactly fills its column.
    ref = ImageFont.truetype(font_path, 400)
    ref_boxes = {ch: glyph_ink(ref, ch).size for ch in CHARS}
    widest = max(w for w, _ in ref_boxes.values())
    em_px = round(400 * (col_w * SS - 2 * stroke) / widest)   # font size in supersampled px
    font = ImageFont.truetype(font_path, em_px)

    big = size * SS
    ink = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(ink)

    # Square frame: outer edge at `inset`, `thick` wide.
    o, t = inset * SS, thick * SS
    d.rectangle([o, o, big - 1 - o, big - 1 - o], fill=255)
    d.rectangle([o + t, o + t, big - 1 - o - t, big - 1 - o - t], fill=0)

    # Columns: 六 on the right, 藝 on the left; each ink box is centred in its column and on the frame centre.
    col_centres = {CHARS[0]: size - inner - pad - col_w / 2, CHARS[1]: inner + pad + col_w / 2}
    layout = {}
    for ch in CHARS:
        g = glyph_ink(font, ch, stroke)
        gw, gh = g.size
        x = round(col_centres[ch] * SS - gw / 2)
        y = round((size / 2 + SHIFT_Y) * SS - gh / 2)
        ink.paste(g, (x, y), g)
        layout[ch] = {"x": round(x / SS, 1), "y": round(y / SS, 1), "w": round(gw / SS, 1), "h": round(gh / SS, 1)}

    small = ink.resize((size, size), Image.BOX)
    a = (np.asarray(small) >= 128).astype(np.uint8) * 255
    mask = Image.merge("LA", (Image.new("L", (size, size), 255), Image.fromarray(a, "L")))
    return mask, a, {"em_px_ss": em_px, "embolden_px": embolden, "col_w": col_w, "frame_inset": inset, "frame_thick": thick, "pad": pad, "col_gap": gap, "glyphs": layout}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--font", default=DEFAULT_FONT)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--embolden", type=float, default=EMBOLDEN, help="extra stroke per side in px at 512 (default %(default)s)")
    args = ap.parse_args()

    if not os.path.isfile(args.font):
        sys.exit(f"font not found: {args.font}  (the 崇羲篆體 .otf lives outside the repo; pass --font)")
    check_cmap(args.font)

    mask, a, layout = render(args.font, args.size, args.embolden)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    mask.save(args.out, optimize=True)

    summary = {
        "tool": "tools/seal/render-seal.py",
        "fontSha256": sha256_file(args.font),
        "maskSha256": sha256_file(args.out),
        "size": args.size,
        "ink_ratio": round(float((a > 0).mean()), 4),
        "layout": layout,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
