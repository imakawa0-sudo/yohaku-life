#!/usr/bin/env bash
set -euo pipefail
comparison_dir=$(cd "$(dirname "$0")" && pwd)
comparison_repo=$(cd "${1:?repository path required}" && pwd)
comparison_output=${2:?output directory required}
mkdir -p "$comparison_output"
comparison_output=$(cd "$comparison_output" && pwd)
case "$comparison_output/" in
  "$comparison_repo/"*) printf '%s\n' 'Use an output directory outside the product repository.' >&2; exit 2 ;;
esac
"$comparison_repo/node_modules/.bin/esbuild" "$comparison_dir/compare-shared-use.ts" --bundle --format=cjs --platform=node --alias:@reform="$comparison_repo/src/reform" --loader:.png=dataurl --outfile="$comparison_output/comparison.cjs" --log-level=warning
COMPARISON_SOURCE_COMMIT=$(git -C "$comparison_repo" rev-parse HEAD) COMPARISON_SOURCE_ROOT="$comparison_repo" COMPARISON_OUTPUT_DIR="$comparison_output" node "$comparison_output/comparison.cjs" > "$comparison_output/comparison.json"
python "$comparison_dir/summarize-comparison.py" "$comparison_output" "$comparison_repo"
