#!/usr/bin/env python3
"""Adapt a reviewed selection plan to the converter without discarding caveats."""

import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to overwrite an existing adapted plan")
    original_bytes = args.input.read_bytes()
    original = json.loads(original_bytes)
    root = args.source_root.resolve()
    if original.get("game_adoption_allowed") is not False:
        raise ValueError("This export must remain review-only")
    sources = {}
    for source_id, source in original["sources"].items():
        relative = Path(source["path"]).resolve().relative_to(root)
        sources[source_id] = {**source, "file": relative.as_posix()}
    cells = []
    for cell in original["cells"]:
        if cell.get("review_export_allowed") is not True or cell.get("game_adoption_allowed") is not False:
            raise ValueError("Every cell must be explicitly allowed for review and not for game adoption")
        kind = cell["kind"]
        if kind not in ("portrait", "walker"):
            raise ValueError(f"Unknown kind: {kind}")
        cells.append({
            **cell,
            "id": cell["case_id"].lower(),
            "label": cell["case_id"],
            "source": cell["source_id"],
            "source_label": cell.get("source"),
            "role": "full_body" if kind == "walker" else "portrait",
            "coordinate_space": "pixels",
            "crop": cell.get("crop_box_xyxy", cell.get("crop_box")),
            "anchor": "bottom_center" if kind == "walker" else "center",
            "known_issues": cell.get("known_issues", cell.get("notes", [])),
        })
    converted = {
        **original,
        "version": 2,
        "coordinate_space": "pixels",
        "selection_plan_sha256": hashlib.sha256(original_bytes).hexdigest(),
        "selection_plan_original_filename": args.input.name,
        "sources": sources,
        "cells": cells,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(converted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"cells": len(cells), "sources_declared": len(sources), "review_only": True, "output": str(args.output)}))


if __name__ == "__main__":
    main()
