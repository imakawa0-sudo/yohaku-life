#!/usr/bin/env bash
set -euo pipefail
comparison_dir=$(cd "$(dirname "$0")" && pwd)
comparison_repo=$(cd "$comparison_dir/../../.." && pwd)
comparison_output=${1:-$(mktemp -d)}
mkdir -p "$comparison_output"
"$comparison_repo/node_modules/.bin/esbuild" "$comparison_dir/compare-room-use.ts" --bundle --format=cjs --platform=node --alias:@reform="$comparison_repo/src/reform" --loader:.png=dataurl --outfile="$comparison_output/comparison.cjs" --log-level=warning
node "$comparison_output/comparison.cjs" > "$comparison_output/comparison.json"
realpath "$comparison_output/comparison.json"
