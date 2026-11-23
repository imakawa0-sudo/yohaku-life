#!/usr/bin/env python3
"""Create native-size reference images without modifying the generated masters.

Python 3 and Pillow are required. Run from any directory:
    python scripts/convert-character-originals.py
    python scripts/convert-character-originals.py --check

The native references preserve each original composition. They are separate from
the parameterized character renderer and its compositing layers.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DEFAULT = REPO_ROOT / "docs/design/chatgpt-characters-20261123"
OUTPUT_DEFAULT = REPO_ROOT / "docs/design/character-runtime-20261123/native"
ALPHA_CUTOFF = 16
NATIVE_MARGIN = 1
CASE_ORDER = [
    *[f"portrait-{letter}" for letter in "ABCDEFGHI"],
    "clothing-shirt",
    "clothing-apron",
    "clothing-wrap",
    "clothing-coat",
    "portrait-kaya",
    "walker-kaya",
    "walker-sui",
]
SHARED_CROP_GROUPS = {
    "face-shape-comparison": ["portrait-A", "portrait-G", "portrait-H", "portrait-I"],
    "clothing-comparison": [
        "clothing-shirt",
        "clothing-apron",
        "clothing-wrap",
        "clothing-coat",
    ],
}
METHODS = {"nearest": Image.Resampling.NEAREST, "area": Image.Resampling.BOX}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=9, optimize=False)
    return buffer.getvalue()


def recorded_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def clean_low_alpha(image: Image.Image) -> Image.Image:
    """Clear nearly transparent RGB residue in a derived image, never the file."""
    source = image.convert("RGBA")
    alpha = source.getchannel("A")
    keep = alpha.point(lambda value: 255 if value >= ALPHA_CUTOFF else 0)
    cleaned = Image.new("RGBA", source.size)
    cleaned.paste(source, (0, 0), keep)
    return cleaned


def union_box(boxes: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def native_image(
    source: Image.Image,
    crop: tuple[int, int, int, int],
    target: tuple[int, int],
    method: str,
) -> tuple[Image.Image, dict]:
    cropped = source.crop(crop)
    available = (target[0] - 2 * NATIVE_MARGIN, target[1] - 2 * NATIVE_MARGIN)
    factor = min(available[0] / cropped.width, available[1] / cropped.height)
    # Integer rounding is unavoidable at the target resolution; no separate
    # horizontal/vertical stretch is applied to force the crop to fill the frame.
    fitted = (
        max(1, round(cropped.width * factor)),
        max(1, round(cropped.height * factor)),
    )
    resized = cropped.resize(fitted, METHODS[method])
    # Area averaging can create tiny alpha values at new boundary pixels.
    # Apply the same explicit threshold after resampling for either method.
    resized = clean_low_alpha(resized)
    offset = ((target[0] - fitted[0]) // 2, target[1] - NATIVE_MARGIN - fitted[1])
    native = Image.new("RGBA", target)
    native.alpha_composite(resized, offset)
    return native, {"fit_scale": factor, "fitted_size": list(fitted), "offset": list(offset)}


def alpha_stats(image: Image.Image) -> dict:
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    core = alpha.point(lambda value: 255 if value >= 128 else 0)
    rgba = image.tobytes()
    return {
        "mode": image.mode,
        "size": list(image.size),
        "alpha_extrema": list(alpha.getextrema()),
        "fully_transparent_pixels": histogram[0],
        "partially_transparent_pixels": sum(histogram[1:255]),
        "opaque_pixels": histogram[255],
        "nontransparent_bbox": list(alpha.getbbox()) if alpha.getbbox() else None,
        "visible_bbox_alpha_128": list(core.getbbox()) if core.getbbox() else None,
        "rgba_sha256": sha256(rgba),
        "transparent_pixels_have_zero_rgb": all(
            rgba[index : index + 3] == b"\0\0\0"
            for index in range(0, len(rgba), 4)
            if rgba[index + 3] == 0
        ),
    }


def make_review(images: dict[str, Image.Image]) -> Image.Image:
    """Make a four-times nearest-neighbor sheet with a subtle alpha checker."""
    cell_width, cell_height, header_height = 72, 84, 18
    sheet = Image.new("RGBA", (4 * cell_width, 4 * cell_height + header_height), "#f3eddf")
    draw = ImageDraw.Draw(sheet)
    draw.text((5, 3), "Native references / 16 cases / 4x", fill="#28382d")
    short_names = {
        "clothing-shirt": "Shirt",
        "clothing-apron": "Apron",
        "clothing-wrap": "Wrap",
        "clothing-coat": "Coat",
        "portrait-kaya": "Kaya face",
        "walker-kaya": "Kaya full",
        "walker-sui": "Sui full",
    }
    for index, case_id in enumerate(CASE_ORDER):
        left = (index % 4) * cell_width
        top = (index // 4) * cell_height + header_height
        label = short_names.get(case_id, case_id.removeprefix("portrait-"))
        draw.text((left + 3, top + 2), label, fill="#28382d")
        for y in range(top + 16, top + 79, 4):
            for x in range(left + 2, left + cell_width - 2, 4):
                color = "#f8f5ed" if ((x - left) // 4 + (y - top) // 4) % 2 else "#e0dfd3"
                draw.rectangle((x, y, min(x + 3, left + cell_width - 3), min(y + 3, top + 78)), fill=color)
        image = images[case_id]
        sheet.alpha_composite(image, (left + (cell_width - image.width) // 2, top + 77 - image.height))
    return sheet.convert("RGB").resize((sheet.width * 4, sheet.height * 4), Image.Resampling.NEAREST)


def build(source_dir: Path, output_dir: Path, method: str) -> tuple[dict[Path, bytes], dict]:
    source_dir = source_dir.resolve()
    output_dir = output_dir.resolve()
    if output_dir == source_dir or source_dir in output_dir.parents:
        raise ValueError("Output must be outside the immutable source-art directory")
    source_manifest_path = source_dir / "manifest.json"
    source_manifest_data = source_manifest_path.read_bytes()
    source_manifest = json.loads(source_manifest_data)
    cases = {case["case_id"]: case for case in source_manifest["cases"]}
    if set(cases) != set(CASE_ORDER):
        raise ValueError("The source manifest must contain exactly the expected 16 cases")

    sources: dict[str, Image.Image] = {}
    source_info: dict[str, dict] = {}
    crops: dict[str, tuple[int, int, int, int]] = {}
    group_for: dict[str, str] = {}
    for case_id in CASE_ORDER:
        case = cases[case_id]
        path = (source_dir / case["asset_path"]).resolve()
        if source_dir not in path.parents:
            raise ValueError(f"Source path escapes its directory: {case_id}")
        data = path.read_bytes()
        digest = sha256(data)
        if digest != case["sha256"]:
            raise ValueError(f"Source hash differs from the source manifest: {case_id}")
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            if image.format != "PNG" or image.mode != "RGBA":
                raise ValueError(f"Expected an RGBA PNG: {case_id}")
            sources[case_id] = clean_low_alpha(image)
            source_info[case_id] = {
                "path": recorded_path(path),
                "sha256": digest,
                "bytes": len(data),
                "size": list(image.size),
                "alpha_extrema": list(image.getchannel("A").getextrema()),
            }
        bbox = sources[case_id].getchannel("A").getbbox()
        if bbox is None:
            raise ValueError(f"No visible subject remains: {case_id}")
        crops[case_id] = bbox

    for group, members in SHARED_CROP_GROUPS.items():
        common = union_box([crops[member] for member in members])
        for member in members:
            crops[member] = common
            group_for[member] = group

    outputs: dict[Path, bytes] = {}
    images: dict[str, Image.Image] = {}
    records = []
    for case_id in CASE_ORDER:
        target = (26, 60) if case_id.startswith("walker-") else (48, 56)
        native, fit = native_image(sources[case_id], crops[case_id], target, method)
        images[case_id] = native
        data = png_bytes(native)
        destination = output_dir / Path(cases[case_id]["asset_path"]).name
        outputs[destination] = data
        records.append({
            "case_id": case_id,
            "source": source_info[case_id],
            "crop_left_top_right_bottom_exclusive": list(crops[case_id]),
            "shared_crop_group": group_for.get(case_id),
            "method": method,
            **fit,
            "output": recorded_path(destination),
            "bytes": len(data),
            "sha256": sha256(data),
            **alpha_stats(native),
            "same_output_as": "portrait-A" if case_id == "portrait-G" else None,
        })

    if images["portrait-A"].tobytes() != images["portrait-G"].tobytes():
        raise ValueError("A and G must have identical pixels")
    if outputs[output_dir / "portrait-a.png"] != outputs[output_dir / "portrait-g.png"]:
        raise ValueError("A and G must have identical PNG bytes")

    review_path = output_dir.parent / "native-review-4x.png"
    review = png_bytes(make_review(images))
    outputs[review_path] = review
    inventory = {
        "schema_version": 1,
        "recipe_version": 1,
        "purpose": "原画16条件の機械的な小サイズ変換。全選択肢を再合成するランタイム用レイヤーとは別の参照画像。",
        "source_manifest": recorded_path(source_manifest_path),
        "source_manifest_sha256": sha256(source_manifest_data),
        "pillow_version": PILLOW_VERSION,
        "source_originals_modified": False,
        "counts": {"cases": 16, "portrait_files": 14, "walker_files": 2, "independent_images": 15},
        "recipe": {
            "source_alpha_cutoff": ALPHA_CUTOFF,
            "alpha_rule": "派生画像のalphaが16未満の画素をRGBA=(0,0,0,0)へ。16以上の元色とalphaは維持。原本は変更しない。縮小後にも同じ閾値を適用。",
            "crop_rule": "alphaが16以上の全画素を囲む矩形。A/G/H/Iと衣装4種はそれぞれ共通の外接矩形を使用。右端・下端は含まない。",
            "fit_rule": "縦横比を保って縦横各2px小さい枠へ収める。寸法だけ整数へ丸め、横は中央、下端は1px余白で揃える。",
            "native_margin_pixels": NATIVE_MARGIN,
            "resampling": method,
            "decision": (
                "48×56・26×60の4倍表示でnearestとarea(BOX)を比較。nearestが目・輪郭・服の細部を明瞭に保ったため、最終変換はnearestを選択。"
                if method == "nearest"
                else "比較候補としてarea(BOX)を指定。目視比較後の標準変換はnearest。"
            ),
            "no_manual_retouch_or_feature_addition": True,
            "no_palette_quantization": True,
            "png_encoding": {"compress_level": 9, "optimize": False},
        },
        "limits": [
            "小さい顔では傷・そばかす・年齢の細線・目の差が弱くなる。全身26×60では特に判別しにくい。",
            "この直接縮小画像は原画全体の参照用。10項目の全選択肢を表現するランタイムは別のレイヤーと小ドットの部品で構成する。",
            "RGBを描き足したり形を変更したりしていない。完全な二値alphaへ変換していない。",
        ],
        "review": {"path": recorded_path(review_path), "scale": 4, "method": "nearest", "sha256": sha256(review)},
        "files": records,
    }
    inventory_path = output_dir.parent / "native-inventory.json"
    outputs[inventory_path] = (json.dumps(inventory, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    # Re-read the source bytes as a guard against accidental input mutation.
    for case_id in CASE_ORDER:
        original = source_dir / cases[case_id]["asset_path"]
        if sha256(original.read_bytes()) != source_info[case_id]["sha256"]:
            raise ValueError(f"Source changed during conversion: {case_id}")
    return outputs, inventory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=SOURCE_DEFAULT)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DEFAULT)
    parser.add_argument("--method", choices=METHODS, default="nearest")
    parser.add_argument("--check", action="store_true", help="Reproduce in memory and compare existing outputs without writing")
    args = parser.parse_args()
    outputs, inventory = build(args.source_dir, args.output_dir, args.method)
    if args.check:
        failures = [str(path) for path, data in outputs.items() if not path.is_file() or path.read_bytes() != data]
        if failures:
            raise SystemExit("Missing or non-reproducible outputs:\n" + "\n".join(failures))
        print(f"Verified {len(outputs)} outputs; all source hashes unchanged; A/G identical.")
        return
    for path, data in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    print(f"Created {len(inventory['files'])} native PNGs, one 4x review, and one inventory.")
    print(f"Output: {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
