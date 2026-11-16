"""Silhouette post-process + mechanical QA + contact sheet. Re-runnable.  (local developer tool; CI never runs it)

Run: uv run --no-project --python 3.11 --with pillow --with numpy --with scipy postprocess.py [options]

  --work DIR    working dir holding raw/ and receiving qa-meta*.json, contact-sheet*.png, rejected/, qa-preview/
                default: $SILHOUETTES_WORK, else <repo>/.cache/silhouettes-raw  (git-ignored)
  --raw DIR     raw PNG source dir (default: <work>/raw)
  --out DIR     published output dir (default: <repo>/src/assets/silhouettes)
  --batch N     selection table: 1 (default), 2, 3 (children's figures) or 4 (fig-salute)
  --preview     also write gold-on-dark previews to <work>/qa-preview/

The pass/fail gate is scripts/qi/silhouette-qa.ts (run by tests/unit/silhouette-assets.test.ts on the published
.png and .webp). Only its haze measure is the same as the QA block inside process(); size/edge/stray/area are the
gate's own rules. process() just cleans (removes specks < 16 px, or < 300 px and > 40 px from the main body) and
reports metrics into qa-meta*.json, it never decides pass/fail.
"""
import argparse, io, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
GOLD = (0xB3, 0x92, 0x4F)
PAD = 8

# name -> (chosen raw version, kind, options)
#   close: closing radius (px) to bridge hairline white strokes inside the shape
#   fill:  fill enclosed holes smaller than this area (px); bigger holes are kept as design cut-outs
#   crop:  'bbox' (trim all sides) | 'rows' (keep full width, trim empty rows only)
#   min_w: (optional, figures) pad the canvas symmetrically to at least this width, e.g. 500 = the gate's minimum side
SEL = {
    "fig-dingzhou":  ("v3", "fig",   dict(close=3, fill=400,  crop="bbox")),
    "fig-zhenjiao":  ("v1", "fig",   dict(close=3, fill=400,  crop="bbox")),
    "fig-chengchui": ("v1", "fig",   dict(close=2, fill=400,  crop="bbox")),
    "fig-jian":      ("v1", "fig",   dict(close=0, fill=60,   crop="bbox")),
    "fig-miaodao":   ("v2", "fig",   dict(close=2, fill=400,  crop="bbox")),
    "fig-daqiang":   ("v1", "fig",   dict(close=0, fill=60,   crop="bbox")),
    "bg-far-roofs":  ("v1", "scene", dict(close=0, fill=600,  crop="rows")),
    "bg-mid-rack":   ("v1", "scene", dict(close=3, fill=0,    crop="rows")),
    "bg-mid-gate":   ("v2", "scene", dict(close=0, fill=3000, crop="rows")),
    "fg-pillars":    ("v2", "scene", dict(close=0, fill=0,    crop="rows")),
    "fg-lattice":    ("v1", "scene", dict(close=0, fill=0,    crop="bbox")),  # exception: trim white margin so the lattice is full-bleed
    # fg-steps batch-1 (v3) was QA-rejected and deleted; superseded by SEL2["fg-steps"].
}

# Batch 2 (run with --batch 2). fg-steps here supersedes the rejected batch-1 version.
SEL2 = {
    "fig-zhenjiao-land": ("b2v1", "fig",   dict(close=3, fill=400, crop="bbox")),
    "fig-kao":           ("b2v2", "fig",   dict(close=2, fill=400, crop="bbox")),
    "mid-drum":          ("b2v3", "scene", dict(close=0, fill=300, crop="rows")),
    "mid-dummy":         ("b2v3", "scene", dict(close=0, fill=300, crop="rows")),
    "mid-stonelock":     ("b2v2", "scene", dict(close=0, fill=300, crop="rows")),
    "mid-banner":        ("b2v1", "scene", dict(close=0, fill=20,  crop="rows")),
    "fg-eave":           ("b2v1", "scene", dict(close=0, fill=0,   crop="rows")),
    "fg-rack-close":     ("b2v1", "scene", dict(close=0, fill=0,   crop="rows")),
    "fg-steps":          ("b2v1", "scene", dict(close=0, fill=0,   crop="rows")),
}
# Batch 3 (run with --batch 3): the four children's figures (Task 6).
SEL3 = {
    "fig-kid-wushu":     ("v2", "fig", dict(close=3, fill=400, crop="bbox")),
    "fig-kid-defense-a": ("v2", "fig", dict(close=3, fill=400, crop="bbox")),
    "fig-kid-defense-b": ("v2", "fig", dict(close=3, fill=400, crop="bbox")),
    "fig-kid-weapon":    ("v2", "fig", dict(close=3, fill=400, crop="bbox")),
}
# Batch 4 (run with --batch 4): the adult fist-and-palm salute (Task 7).
SEL4 = {
    "fig-salute": ("v3", "fig", dict(close=3, fill=400, crop="bbox", min_w=500)),
}
SELECTIONS = {"1": SEL, "2": SEL2, "3": SEL3, "4": SEL4}


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def to_alpha(img):
    L = np.asarray(img.convert("L"), dtype=np.float32)
    lo, hi = 40.0, 215.0  # <=lo opaque, >=hi transparent, linear ramp between keeps AA edges
    return (np.clip((hi - L) / (hi - lo), 0, 1) * 255).round().astype(np.uint8)


def process(name, sel, raw, out_dir, work, preview):
    ver, kind, o = sel[name]
    src = os.path.join(raw, f"{name}-{ver}.png")
    a = to_alpha(Image.open(src))
    H, W = a.shape
    notes = []
    mask = a > 127

    # 1. remove stray specks: tiny components, or small ones far from the main body
    lab, n = ndi.label(mask, structure=np.ones((3, 3)))
    removed = 0
    if n > 1:
        areas = ndi.sum(mask, lab, index=np.arange(1, n + 1))
        main = int(np.argmax(areas)) + 1
        dist = ndi.distance_transform_edt(lab != main)
        for i in range(1, n + 1):
            if i == main:
                continue
            comp = lab == i
            far = dist[comp].min()
            if areas[i - 1] < 16 or (areas[i - 1] < 300 and far > 40):
                a[ndi.binary_dilation(comp, disk(3))] = 0
                removed += 1
        mask = a > 127
    # 2. bridge hairline white strokes (figures), then fill small enclosed holes
    if o["close"]:
        closed = ndi.binary_closing(np.pad(mask, 8), disk(o["close"]))[8:-8, 8:-8]
        add = closed & ~mask
        a[add] = 255
        mask = a > 127
        notes.append(f"closing r={o['close']} added {int(add.sum())}px")
    filled = 0
    if o["fill"]:
        hl, hn = ndi.label(~mask)
        border = set(np.unique(np.concatenate([hl[0], hl[-1], hl[:, 0], hl[:, -1]])))
        hareas = ndi.sum(~mask, hl, index=np.arange(1, hn + 1))
        for i in range(1, hn + 1):
            if i not in border and hareas[i - 1] < o["fill"]:
                a[ndi.binary_dilation(hl == i, disk(2))] = 255
                filled += 1
        mask = a > 127
    # 3. kill haze: partial alpha is only allowed within 2px of the binary edge
    band = ndi.binary_dilation(mask, disk(2)) & ~ndi.binary_erosion(mask, disk(2), border_value=1)
    semi = (a > 0) & (a < 255) & ~band
    a[semi & mask] = 255
    a[semi & ~mask] = 0
    mask = a > 127

    # ---- geometry
    ys, xs = np.where(a > 0)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    touches = dict(left=bool(x0 == 0), right=bool(x1 == W - 1), top=bool(y0 == 0), bottom=bool(y1 == H - 1))
    if o["crop"] == "bbox":
        if kind == "fig":
            sw, sh = x1 - x0 + 1, y1 - y0 + 1
            cw = max(sw + 2 * PAD, o.get("min_w", 0))  # a narrow figure is padded (never scaled) to min_w so it keeps its native resolution
            ox = (cw - sw) // 2
            canvas = np.zeros((sh + 2 * PAD, cw), np.uint8)
            canvas[PAD:-PAD, ox:ox + sw] = a[y0:y1 + 1, x0:x1 + 1]
            out = canvas
        else:
            out = a[y0:y1 + 1, x0:x1 + 1]
    else:  # rows: keep full width; pad top a little, bottom flush so layers can sit on a baseline
        top = max(0, y0 - PAD)
        out = a[top:y1 + 1, :]
    oh, ow = out.shape

    # ---- mechanical QA on the final alpha
    m = out > 127
    band = ndi.binary_dilation(m, disk(2)) & ~ndi.binary_erosion(m, disk(2), border_value=0)
    haze = int((((out > 8) & (out < 247)) & ~band).sum())
    lab, ncomp = ndi.label(m, structure=np.ones((3, 3)))
    hl, hn = ndi.label(~m)
    border = set(np.unique(np.concatenate([hl[0], hl[-1], hl[:, 0], hl[:, -1]])))
    holes = sorted((int(v) for i, v in enumerate(ndi.sum(~m, hl, index=np.arange(1, hn + 1)), 1) if i not in border), reverse=True)
    # background residue hugging the frame of the raw image (not connected to subject)
    edge_residue = 0
    if kind == "fig":
        edge_residue = int(a[0].astype(bool).sum() + a[-1].astype(bool).sum() + a[:, 0].astype(bool).sum() + a[:, -1].astype(bool).sum())

    rgba = np.zeros((oh, ow, 4), np.uint8)
    rgba[..., 3] = out
    im = Image.fromarray(rgba, "RGBA")
    outdir = out_dir if o.get("publish", True) else os.path.join(work, "rejected")
    os.makedirs(outdir, exist_ok=True)
    png = os.path.join(outdir, name + ".png")
    webp = os.path.join(outdir, name + ".webp")
    im.save(png, optimize=True)
    wim = im
    for attempt in range(3):
        buf = io.BytesIO()
        wim.save(buf, "WEBP", quality=85, alpha_quality=100, method=6, exact=False)
        if buf.tell() <= 120_000:
            break
        long = max(wim.size)
        target = 1400 if attempt == 0 else int(long * 0.85)
        s = target / long
        wim = im.resize((round(ow * s), round(oh * s)), Image.LANCZOS)
        notes.append(f"webp downscaled to long edge {target}")
    with open(webp, "wb") as f:
        f.write(buf.getvalue())

    if preview:
        os.makedirs(os.path.join(work, "qa-preview"), exist_ok=True)
        pv = Image.new("RGB", im.size, (14, 12, 11))
        pv.paste(Image.new("RGB", im.size, GOLD), (0, 0), im.getchannel("A"))
        pv.save(os.path.join(work, "qa-preview", name + ".png"))
    info = dict(
        published=o.get("publish", True), name=name, raw=f"{name}-{ver}.png", kind=kind, raw_size=[W, H], out_size=[ow, oh], webp_size=list(wim.size),
        png_kb=round(os.path.getsize(png) / 1024, 1), webp_kb=round(os.path.getsize(webp) / 1024, 1),
        raw_bbox=dict(x0=int(x0), y0=int(y0), x1=int(x1), y1=int(y1)), touches_raw_edges=touches,
        specks_removed=removed, holes_filled=filled, components=int(ncomp), holes_remaining=len(holes), hole_areas_top=holes[:8],
        haze_px=haze, edge_residue_px=edge_residue, notes=notes,
    )
    if kind == "fig":
        info.update(foot_y_raw=int(y1), subject_height_px=int(y1 - y0 + 1), subject_width_px=int(x1 - x0 + 1),
                    foot_y_out=int(oh - PAD - 1), pad=PAD)
    return info, im


def contact_sheet(items, path):
    cols, cw, ch = 4, 480, 440
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch), (14, 12, 11))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 18)
    except Exception:
        font = ImageFont.load_default()
    for i, (info, im) in enumerate(items):
        cx, cy = (i % cols) * cw, (i // cols) * ch
        d.rectangle([cx + 4, cy + 4, cx + cw - 5, cy + ch - 5], outline=(48, 40, 30))
        t = im.copy()
        t.thumbnail((cw - 40, ch - 70), Image.LANCZOS)
        gold = Image.new("RGB", t.size, GOLD)
        sheet.paste(gold, (cx + (cw - t.width) // 2, cy + 20 + (ch - 70 - t.height) // 2), t.getchannel("A"))
        d.text((cx + 14, cy + ch - 34), f"{info['name']}  {info['out_size'][0]}x{info['out_size'][1]}", fill=(200, 180, 140), font=font)
    sheet.save(path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Silhouette post-process + mechanical QA.")
    ap.add_argument("--work", default=os.environ.get("SILHOUETTES_WORK") or os.path.join(REPO, ".cache", "silhouettes-raw"))
    ap.add_argument("--raw", default=None)
    ap.add_argument("--out", default=os.path.join(REPO, "src", "assets", "silhouettes"))
    ap.add_argument("--batch", choices=sorted(SELECTIONS), default="1")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    work = os.path.abspath(args.work)
    raw = os.path.abspath(args.raw) if args.raw else os.path.join(work, "raw")
    out_dir = os.path.abspath(args.out)
    sel = SELECTIONS[args.batch]
    suffix = "" if args.batch == "1" else "-" + args.batch
    os.makedirs(work, exist_ok=True)
    items = [process(n, sel, raw, out_dir, work, args.preview) for n in sel]
    with open(os.path.join(work, f"qa-meta{suffix}.json"), "w", encoding="utf-8") as f:
        json.dump([i for i, _ in items], f, indent=1)
    contact_sheet(items, os.path.join(work, f"contact-sheet{suffix}.png"))
    for i, _ in items:
        fy = f" footRaw={i['foot_y_raw']} footOut={i['foot_y_out']} h={i['subject_height_px']}" if i["kind"] == "fig" else ""
        print(f"{i['name']:14s} out={i['out_size']} png={i['png_kb']}KB webp={i['webp_kb']}KB comps={i['components']} holes={i['holes_remaining']}{i['hole_areas_top'][:4]} haze={i['haze_px']} edgeRes={i['edge_residue_px']} specks-={i['specks_removed']} filled={i['holes_filled']} touch={[k for k,v in i['touches_raw_edges'].items() if v]}{fy} {i['notes']}")
