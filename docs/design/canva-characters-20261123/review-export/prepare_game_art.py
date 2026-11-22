#!/usr/bin/env python3
"""Preserve original crops and fit every requested size directly from them.

No painting, background removal, colour substitution, or automatic subject
detection is performed. This script does not modify the game repository.
"""

from __future__ import annotations

import argparse
from contextlib import ExitStack
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

from PIL import Image, __version__ as PILLOW_VERSION


PROFILES = {
    "portrait": {
        "targets": ((192, 224, "detail"), (96, 112, "standard"), (48, 56, "existing_size_check")),
        "anchor": "center",
    },
    "full_body": {
        "targets": ((104, 240, "detail"), (26, 60, "existing_size_check")),
        "anchor": "bottom_center",
    },
}
ANCHORS = {"center": (0.5, 0.5), "top_center": (0.5, 0.0), "bottom_center": (0.5, 1.0)}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def alpha_info(image: Image.Image) -> dict:
    low, high = image.getchannel("A").getextrema() if image.mode == "RGBA" else (255, 255)
    return {
        "mode": image.mode,
        "has_alpha_channel": image.mode == "RGBA",
        "has_transparent_pixels": low < 255,
        "is_fully_opaque": low == 255,
        "alpha_extrema": [low, high],
    }


def resolve_box(cell: dict, default_space: str, width: int, height: int) -> tuple[int, int, int, int]:
    values = cell.get("crop")
    require(isinstance(values, list) and len(values) == 4, f"{cell['id']}: crop must contain four coordinates")
    space = cell.get("coordinate_space", default_space)
    require(space in ("pixels", "normalized"), f"{cell['id']}: unsupported coordinate_space")
    if space == "pixels":
        require(all(type(v) is int for v in values), f"{cell['id']}: pixel coordinates must be integers")
        box = tuple(values)
    else:
        require(all(type(v) in (int, float) for v in values), f"{cell['id']}: normalized coordinates must be numbers")
        normalized = [Decimal(str(v)) for v in values]
        require(all(v.is_finite() and 0 <= v <= 1 for v in normalized), f"{cell['id']}: normalized coordinates must be between 0 and 1")
        require(normalized[0] < normalized[2] and normalized[1] < normalized[3], f"{cell['id']}: empty normalized crop")
        box = tuple(
            int((value * extent).to_integral_value(rounding=ROUND_FLOOR if index < 2 else ROUND_CEILING))
            for index, (value, extent) in enumerate(zip(normalized, (width, height, width, height)))
        )
    x0, y0, x1, y1 = box
    require(0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height, f"{cell['id']}: crop is outside the source or empty: {box}")
    return box


def contain(image: Image.Image, target: tuple[int, int], anchor: str) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Fit without cropping; integer rounding is less than one destination pixel."""
    width, height = image.size
    target_width, target_height = target
    if target_width * height <= target_height * width:
        scaled_width = target_width
        scaled_height = max(1, (height * target_width + width // 2) // width)
    else:
        scaled_height = target_height
        scaled_width = max(1, (width * target_height + height // 2) // height)
    require(scaled_width <= target_width and scaled_height <= target_height, "Contain rounding overflow")
    ax, ay = ANCHORS[anchor]
    left = int((target_width - scaled_width) * ax + 0.5)
    top = int((target_height - scaled_height) * ay + 0.5)
    scaled = image.convert("RGBA").resize((scaled_width, scaled_height), Image.Resampling.NEAREST)
    result = Image.new("RGBA", target, (0, 0, 0, 0))
    # No mask argument: copy the source alpha once rather than multiplying it.
    result.paste(scaled, (left, top))
    return result, (left, top, left + scaled_width, top + scaled_height)


def save_png(image: Image.Image, path: Path, icc_profile: bytes | None) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    options = {"icc_profile": icc_profile} if icc_profile else {}
    image.save(path, format="PNG", **options)
    with Image.open(path) as check:
        check.load()
        require(check.mode == image.mode and check.size == image.size and check.tobytes() == image.tobytes(), f"PNG pixel round-trip mismatch: {path.name}")
    return {
        "size": list(image.size),
        "sha256": digest(path.read_bytes()),
        "pixel_sha256": digest(image.tobytes()),
        **alpha_info(image),
    }


def validate_source(source: Image.Image, source_bytes: bytes, expected: dict, source_id: str) -> None:
    require(isinstance(expected, dict), f"{source_id}: source metadata is required")
    require(type(expected.get("width")) is int and type(expected.get("height")) is int, "Set source width and height from the final PNG")
    require([expected["width"], expected["height"]] == list(source.size), "Source dimensions do not match the crop plan")
    sha = expected.get("sha256")
    require(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{64}", sha) is not None, "Set the exact source SHA-256 in lowercase")
    require(digest(source_bytes) == sha, f"{source_id}: SHA-256 mismatch; the plan belongs to a different image")
    require(source.format == "PNG" and source.mode in ("RGB", "RGBA"), "Input must be an RGB or RGBA PNG; other modes need an explicit conversion decision")
    require(source.getexif().get(274, 1) == 1, "Oriented input is not supported: coordinates must refer to the physical PNG grid")


def validate_cells(cells: list[dict], sources: dict, default_space: str) -> list[dict]:
    require(default_space in ("pixels", "normalized"), "Invalid default coordinate_space")
    seen: set[str] = set()
    resolved = []
    for cell in cells:
        require(isinstance(cell, dict), "Each cell must be an object")
        cell_id = cell.get("id")
        require(isinstance(cell_id, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", cell_id) is not None, "Cell ids must be short lowercase filename-safe identifiers")
        require(cell_id not in seen, f"Duplicate cell id: {cell_id}")
        seen.add(cell_id)
        role = cell.get("role")
        require(isinstance(role, str) and role in PROFILES, f"{cell_id}: role must be portrait or full_body")
        anchor = cell.get("anchor", PROFILES[role]["anchor"])
        require(isinstance(anchor, str) and anchor in ANCHORS, f"{cell_id}: invalid anchor")
        source = sources[cell["source"]]["image"]
        box = resolve_box(cell, default_space, *source.size)
        # Preserve review status, identity caveats and per-person provenance.
        # Geometry fields are resolved separately; metadata is never promoted
        # from review-only to adopted by this conversion.
        resolved.append({**cell, "id": cell_id, "source": cell["source"], "label": cell.get("label", cell_id), "role": role, "anchor": anchor, "box": box, "requested": cell})
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Single PNG for a legacy version-1 crop plan")
    parser.add_argument("--cells", required=True, type=Path, help="Explicit crop plan JSON")
    parser.add_argument("--source-root", type=Path, help="Version-2 source file root; defaults to the crop plan's directory")
    parser.add_argument("--output", required=True, type=Path, help="New output directory; must not already exist")
    parser.add_argument("--check-only", action="store_true", help="Validate metadata and crop boxes without writing files")
    args = parser.parse_args()
    plan_bytes = args.cells.read_bytes()
    plan = json.loads(plan_bytes)
    require(isinstance(plan, dict), "Crop plan must be a JSON object")
    version = plan.get("version")
    require(type(version) is int and version in (1, 2), "Crop plan version must be 1 or 2")
    if version == 1:
        require(args.input is not None, "Version-1 plans require --input")
        specifications = {"source": plan.get("source")}
    else:
        require(args.input is None, "Version-2 plans use sources[].file; omit --input")
        specifications = plan.get("sources")
        require(isinstance(specifications, dict) and specifications, "Version-2 plans require a sources object")
    raw_cells = plan.get("cells")
    require(isinstance(raw_cells, list) and raw_cells, "Provide explicit cells for the final source images")
    prepared_cells, used_ids = [], []
    for cell in raw_cells:
        require(isinstance(cell, dict), "Each cell must be an object")
        source_id = cell.get("source", "source" if version == 1 else None)
        require(isinstance(source_id, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", source_id) is not None, "Each cell must reference a filename-safe source id")
        require(source_id in specifications, f"Unknown source: {source_id}")
        if source_id not in used_ids:
            used_ids.append(source_id)
        prepared_cells.append({**cell, "source": source_id})
    source_root = (args.source_root or args.cells.parent).resolve()
    with ExitStack() as stack:
        sources, source_records = {}, {}
        for source_id in used_ids:
            specification = specifications[source_id]
            require(isinstance(specification, dict), f"{source_id}: source metadata is required")
            if version == 1:
                source_path = args.input
            else:
                filename = specification.get("file")
                require(isinstance(filename, str) and filename, f"{source_id}: set a source file path")
                relative = Path(filename)
                require(not relative.is_absolute() and ".." not in relative.parts, f"{source_id}: source file must be relative to --source-root without '..'")
                source_path = source_root / relative
            source_bytes = source_path.read_bytes()
            # Decode the exact bytes that are hashed and copied to the output.
            source = stack.enter_context(Image.open(BytesIO(source_bytes)))
            source.load()
            validate_source(source, source_bytes, specification, source_id)
            sources[source_id] = {"image": source, "bytes": source_bytes}
            source_records[source_id] = {**specification, "file": f"sources/{source_id}.png", "sha256": digest(source_bytes), "size": list(source.size), **alpha_info(source)}
        cells = validate_cells(prepared_cells, sources, plan.get("coordinate_space", "pixels"))
        if args.check_only:
            print(json.dumps({"status": "validated_only", "sources": source_records, "cells": cells, "background_removal": False}, ensure_ascii=False, indent=2))
            return 0
        output = args.output.resolve()
        require(not output.exists(), f"Output already exists; choose a new directory: {output}")
        output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
        try:
            (staging / "sources").mkdir()
            for source_id, record in source_records.items():
                (staging / record["file"]).write_bytes(sources[source_id]["bytes"])
            (staging / "crop-plan.input.json").write_bytes(plan_bytes)
            # A rebased integer plan makes the output directory self-contained
            # and reproducible without its original input paths.
            resolved_plan = {
                **plan,
                "version": 2,
                "sources": {
                    source_id: {**specifications[source_id], "file": record["file"], "width": record["size"][0], "height": record["size"][1], "sha256": record["sha256"]}
                    for source_id, record in source_records.items()
                },
                "coordinate_space": "pixels",
                "cells": [
                    {**cell["requested"], "id": cell["id"], "source": cell["source"], "label": cell["label"], "role": cell["role"], "anchor": cell["anchor"], "coordinate_space": "pixels", "crop": list(cell["box"])}
                    for cell in cells
                ],
            }
            resolved_bytes = (json.dumps(resolved_plan, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            (staging / "crop-plan.json").write_bytes(resolved_bytes)
            manifest = {
                "version": 2,
                "tool": "prepare_game_art.py",
                "pillow_version": PILLOW_VERSION,
                "sources": source_records,
                "input_crop_plan": {"file": "crop-plan.input.json", "sha256": digest(plan_bytes)},
                "resolved_crop_plan": {"file": "crop-plan.json", "sha256": digest(resolved_bytes)},
                "background_removal": False,
                "redrawing": False,
                "resize": "nearest; every target is fitted directly from the unmodified original crop",
                "primary_art": "unmodified original crops; small outputs are not used to generate larger outputs",
                "transparency_policy": "Preserve source alpha; only newly added padding is transparent. An opaque source background remains opaque.",
                "plan_metadata": {key: value for key, value in plan.items() if key not in ("sources", "source", "cells", "version", "coordinate_space")},
                "cells": [],
            }
            for key in ("purpose", "overall_status", "review_export_allowed", "game_adoption_allowed", "known_issues"):
                if key in plan:
                    manifest[key] = plan[key]
            for cell in cells:
                cell_id, role, box = cell["id"], cell["role"], cell["box"]
                source = sources[cell["source"]]["image"]
                icc = source.info.get("icc_profile")
                crop = source.crop(box)
                crop_path = Path("crops") / f"{cell_id}.png"
                crop_record = {"file": crop_path.as_posix(), **save_png(crop, staging / crop_path, icc)}
                outputs = []
                for width, height, purpose in PROFILES[role]["targets"]:
                    size = (width, height)
                    # Always use the full-resolution crop, never another output.
                    image, bounds = contain(crop, size, cell["anchor"])
                    path = Path(role) / f"{cell_id}-{size[0]}x{size[1]}.png"
                    padding_pixels = size[0] * size[1] - (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
                    outputs.append({
                        "file": path.as_posix(),
                        "purpose": purpose,
                        "derived_directly_from_original_crop": True,
                        "source_rectangle_px": list(bounds),
                        "transparent_padding_pixels": padding_pixels,
                        "source_background_removed": False,
                        **save_png(image, staging / path, icc),
                    })
                manifest["cells"].append({
                    **cell["requested"],
                    "id": cell_id,
                    "source": cell["source"],
                    "label": cell["label"],
                    "role": role,
                    "anchor": cell["anchor"],
                    "requested_crop": cell["requested"],
                    "crop_px_half_open": list(box),
                    "crop_normalized": [box[0] / source.width, box[1] / source.height, box[2] / source.width, box[3] / source.height],
                    "unmodified_crop": crop_record,
                    "outputs": outputs,
                })
            (staging / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            require(not output.exists(), "Output was created by another process; no overwrite performed")
            staging.rename(output)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    print(json.dumps({"status": "complete", "output": str(output), "sources": len(sources), "cells": len(cells), "background_removal": False}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        print(f"Conversion stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
