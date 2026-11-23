#!/usr/bin/env python3
"""Extract palette-indexed parts from the archived character art.

This is an offline conversion step, not a build-time dependency. Original PNGs
are immutable. Masks, nearest sampling and palette indexing make the layers
small, synchronous, recolourable and usable in the offline single-file game.
Python 3, Pillow and NumPy are needed to regenerate the checked-in atlas.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/design/chatgpt-characters-20261123/originals"
OUTPUT = ROOT / "src/reform/art/characters/layers.json"
RECORD = ROOT / "docs/design/character-runtime-20261123/layer-inventory.json"
ALPHABET = {
    "skin": "abcdefgh", "hair": "ijklmnop", "cloth": "qrstuvwx",
    "linen": "ABCDEFGH", "trim": "IJKLMNOP", "trousers": "QRSTUVWX",
    "leather": "01234567", "ink": "8", "white": "9",
}


def normalized(name, crop=None):
    im = Image.open(SOURCE / (name + ".png")).convert("RGBA")
    a = np.array(im)
    a[a[:, :, 3] < 128] = 0
    a[a[:, :, 3] >= 128, 3] = 255
    im = Image.fromarray(a)
    crop = crop or im.getbbox()
    im = im.crop(crop)
    size = (26, 60) if name.startswith("walker") else (48, 56)
    im.thumbnail((size[0] - 2, size[1] - 2), Image.Resampling.NEAREST)
    out = Image.new("RGBA", size)
    out.alpha_composite(im, ((size[0] - im.width) // 2, size[1] - im.height))
    return np.array(out)


def polygon(points, size=(48, 56)):
    im = Image.new("1", size)
    ImageDraw.Draw(im).polygon(points, fill=1)
    return np.array(im, dtype=bool)


def warm(a):
    r, g, b = (a[:, :, i].astype(int) for i in range(3))
    return (r > g + 18) & (g > b + 8)


def ramp(a, mask, count=8):
    colors = a[mask & (a[:, :, 3] > 0), :3]
    if not len(colors):
        raise ValueError("Empty palette sample")
    luminance = colors @ np.array([0.2126, 0.7152, 0.0722])
    # Equal luminance bands keep the eight shade meanings aligned across skin
    # tones. Equal population bins over-weight large flat cheeks and would turn
    # their tiny source noise into harsh freckles after a palette change.
    low, high = np.quantile(luminance, [0.02, 0.98])
    edges = np.linspace(low, high, count + 1)
    result = []
    for i in range(count):
        selected = colors[(luminance >= edges[i]) & (luminance <= edges[i + 1])]
        if not len(selected):
            selected = colors[[np.argmin(abs(luminance - (edges[i] + edges[i + 1]) / 2))]]
        c = np.median(selected, axis=0).round().astype(int)
        result.append("#" + "".join(f"{v:02x}" for v in c))
    return result


def rgb(hexes):
    return np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in hexes])


def encode(a, masks, palettes):
    out = np.full(a.shape[:2], ".", dtype="<U1")
    for role, mask in masks:
        mask = mask & (a[:, :, 3] > 0)
        colors = a[mask, :3].astype(float)
        nearest = ((colors[:, None, :] - rgb(palettes[role])[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
        out[mask] = np.array(list(ALPHABET[role]))[nearest]
    return ["".join(row) for row in out]


def masked_rows(rows, mask):
    return ["".join(c if mask[y, x] else "." for x, c in enumerate(row)) for y, row in enumerate(rows)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    names = ["portrait-" + c for c in "ahibcdef"] + ["clothing-" + c for c in ("shirt", "apron", "wrap", "coat")] + ["walker-kaya", "walker-sui"]
    sources = {name: normalized(name, (80, 35, 1070, 1313) if name in ("portrait-a", "portrait-h", "portrait-i") else (43, 34, 1045, 1415) if name.startswith("clothing-") else None) for name in names}
    yy, xx = np.indices((56, 48))
    head_region = (yy < 38)
    # Spatial masks exclude the face/neck, so dark eyes or dyed clothing cannot
    # accidentally become hair. Hair colour never controls the silhouette.
    hair_masks = {
        "crop": polygon([(6, 0), (44, 0), (44, 21), (39, 21), (37, 18), (36, 13), (34, 18), (32, 13), (30, 18), (28, 13), (25, 17), (22, 19), (19, 23), (18, 25), (17, 22), (14, 22), (13, 26), (15, 29), (17, 31), (12, 31), (6, 28)]),
        "bob": polygon([(3, 0), (43, 0), (43, 38), (31, 38), (34, 34), (37, 32), (38, 27), (38, 20), (36, 17), (35, 14), (33, 18), (31, 14), (30, 17), (27, 14), (24, 17), (22, 21), (19, 23), (19, 32), (21, 35), (22, 37), (3, 38)]),
        "wave": polygon([(5, 0), (43, 0), (43, 47), (31, 43), (31, 35), (35, 32), (37, 28), (38, 21), (37, 16), (35, 12), (33, 11), (30, 14), (28, 16), (24, 18), (22, 20), (20, 21), (19, 25), (21, 27), (23, 29), (23, 35), (19, 41), (15, 49), (6, 53), (1, 51)]),
        "knot": polygon([(2, 0), (44, 0), (44, 22), (39, 22), (38, 17), (36, 14), (33, 11), (31, 11), (27, 14), (24, 16), (22, 19), (20, 22), (18, 24), (17, 22), (15, 22), (14, 26), (16, 28), (18, 30), (15, 31), (9, 29), (3, 20)]),
        "braid": polygon([(3, 0), (43, 0), (43, 22), (39, 22), (38, 18), (35, 15), (32, 12), (29, 13), (26, 15), (23, 16), (20, 19), (19, 22), (17, 24), (16, 27), (19, 32), (19, 38), (17, 42), (15, 49), (12, 53), (7, 53), (7, 30), (3, 28)]),
    }
    hair_sources = dict(zip(hair_masks, ("portrait-a", "portrait-b", "portrait-c", "portrait-d", "portrait-e")))
    hair_sources_palette = dict(zip(("ink", "chestnut", "ash", "silver", "honey"), hair_sources.values()))
    hair_palettes = {}
    for (style, mask), (color, name) in zip(hair_masks.items(), hair_sources_palette.items()):
        # Crown samples contain only hair; the full mask retains curls/braids.
        hair_palettes[color] = ramp(sources[name], mask & (yy < 11))
    skin_palettes = {}
    for color, name in zip(("ivory", "peach", "wheat", "bronze", "umber"), ("portrait-a", "clothing-shirt", "portrait-c", "portrait-d", "portrait-e")):
        a = sources[name]
        skin_palettes[color] = ramp(a, warm(a) & (xx > 19) & (xx < 39) & (yy > 23) & (yy < 37))
    cloth_sources = {"moss": "clothing-shirt", "brick": "clothing-apron", "indigo": "clothing-wrap", "plum": "clothing-coat"}
    cloth_palettes = {}
    for color, name in cloth_sources.items():
        a = sources[name]
        sample = (yy > 42) & (xx < 18)
        r, g, b = (a[:, :, i].astype(int) for i in range(3))
        if color == "brick":
            sample &= r - g > 40
        elif color == "indigo":
            sample &= (b > r) & (b > g)
        elif color == "moss":
            sample &= (g > r) & (g > b)
        elif color == "plum":
            sample &= (r > g) & (b > g)
        cloth_palettes[color] = ramp(a, sample)
    wy, wx = np.indices((60, 26))
    for color, name in (("rust", "walker-kaya"), ("flax", "walker-sui")):
        cloth_palettes[color] = ramp(sources[name], (wy > 17) & (wy < 29) & (wx < 9))
    apron = sources["clothing-apron"]
    linen = ramp(apron, (yy > 46) & (xx > 21) & (xx < 36) & (apron[:, :, 1] > 130) & ((apron[:, :, 0].astype(int) - apron[:, :, 1].astype(int)) < 60))
    trousers = ramp(sources["walker-kaya"], (wy > 37) & (wy < 50))
    leather = ramp(sources["walker-kaya"], (wy > 53))
    palettes = {"skin": skin_palettes, "hair": hair_palettes, "cloth": cloth_palettes, "linen": linen, "trousers": trousers, "leather": leather, "ink": ["#393038"], "white": ["#fff0d2"]}
    faces = {}
    for face, name in (("oval", "portrait-a"), ("round", "portrait-h"), ("angular", "portrait-i")):
        a = sources[name]
        mask = head_region & warm(a) & ((yy >= 24) | ((xx < 22) & (yy >= 21)) | ((xx >= 38) & (yy >= 18)))
        # Features are drawn on the native grid by the renderer so every eye,
        # age and mark setting remains independently selectable.
        mask &= ~((yy >= 18) & (yy <= 24) & (xx >= 22) & (xx <= 38))
        faces[face] = encode(a, [("skin", mask)], {"skin": skin_palettes["ivory"]})
    hair = {}
    for style, name in hair_sources.items():
        color = dict(crop="ink", bob="chestnut", wave="ash", knot="silver", braid="honey")[style]
        a = sources[name]
        mask = hair_masks[style]
        if style == "crop":
            mask &= ~warm(a)
        if style == "knot":
            r, g, b = (a[:, :, i].astype(int) for i in range(3))
            mask &= (r - g < 35) | (yy < 12)
        rows = encode(a, [("hair", mask)], {"hair": hair_palettes[color]})
        hair[style] = rows
    clothes = {}
    for outfit, color in (("shirt", "moss"), ("apron", "brick"), ("wrap", "indigo"), ("coat", "plum")):
        a = sources["clothing-" + outfit]
        active = (yy >= 34)
        skin = active & warm(a) & (xx > 18) & (xx < 34) & (yy < 43)
        # Cream apron/lining are material layers, not dyed fabric.
        r, g, b = (a[:, :, i].astype(int) for i in range(3))
        pale = active & (r > 135) & (g > 115) & (b < g) & ((r - g) < 60) & ~skin
        if outfit in ("shirt", "coat"):
            pale &= (r > 165) & (g > 145)
        roles = [("cloth", active), ("skin", skin), ("linen", pale)]
        clothes[outfit] = encode(a, roles, {"cloth": cloth_palettes[color], "skin": skin_palettes["peach"], "linen": linen})
    bodies = {}
    for build, name, color in (("medium", "walker-kaya", "rust"), ("broad", "walker-sui", "flax")):
        a = sources[name]
        r, g, b = (a[:, :, i].astype(int) for i in range(3))
        active = wy >= 14
        # Garment ochre/cream shares the skin hue: only the neck and the two
        # exposed forearm/hand regions may become skin. Never tint the stomach.
        neck = (wy < 17) & (wx > 10) & (wx < 17)
        if build == "medium":
            hands = ((wy >= 29) & (wy <= 35) & (wx <= 6)) | ((wy >= 24) & (wy <= 27) & (wx >= 16))
        else:
            hands = ((wy >= 30) & (wy <= 37) & (wx <= 6)) | ((wy >= 26) & (wy <= 30) & (wx >= 17))
        skin = active & warm(a) & (r > 170) & (g > 90) & (neck | hands)
        pants = active & (wy >= (36 if build == "broad" else 34)) & (r - g < 20) & (g - b < 15)
        boots = active & (wy >= 51)
        cuffs = boots & (wy <= 53) & (g > 100)
        if build == "medium":
            trim = active & (wy < 34) & (((r - g) < 28) & (g > 90) & ~skin)
            lining = active & (wy < 35) & (r > 165) & (g > 140) & (b > 100) & ~skin
        else:
            trim = active & (wy < 36) & ((g >= r - 15) & (g > b + 15))
            lining = np.zeros_like(active)
        roles = [("cloth", active), ("trousers", pants), ("leather", boots), ("linen", cuffs), ("skin", skin), ("trim", trim), ("linen", lining)]
        palette = {"cloth": cloth_palettes[color], "skin": skin_palettes["peach"], "trousers": trousers, "leather": leather, "linen": linen, "trim": cloth_palettes["moss"]}
        bodies[build] = encode(a, roles, palette)
    atlas = {"version": 1, "alphabet": ALPHABET, "palettes": palettes, "faces": faces, "hair": hair, "clothes": clothes, "bodies": bodies}
    encoded = (json.dumps(atlas, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    metadata = {
        "source_folder": "docs/design/chatgpt-characters-20261123/originals",
        "method": "alpha >=128; common A/H/I and garment crops; nearest sampling; spatial masks; 8-shade material palettes",
        "portrait_grid": [48, 56], "walker_grid": [26, 60],
        "note": "The direct native references and runtime compositing atlas are separate. Features, missing covered forehead and outfit variants are completed on the native grid by characterArt.ts.",
        "sources": {name + ".png": hashlib.sha256((SOURCE / (name + ".png")).read_bytes()).hexdigest() for name in names},
        "atlas": {"path": str(OUTPUT.relative_to(ROOT)), "bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()},
    }
    record = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode()
    for path, data in ((OUTPUT, encoded), (RECORD, record)):
        if args.check:
            if not path.exists() or path.read_bytes() != data:
                raise SystemExit("Stale generated output: " + str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    print(("Verified" if args.check else "Generated") + f" compositing atlas: {len(encoded):,} bytes; 3 faces, 5 hair styles, 4 clothes, 2 body masters")


if __name__ == "__main__":
    main()
