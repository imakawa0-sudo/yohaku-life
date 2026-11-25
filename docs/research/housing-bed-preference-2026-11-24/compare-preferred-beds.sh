#!/usr/bin/env bash
set -euo pipefail
usage() {
  printf '%s\n' \
    'Usage: bash compare-preferred-beds.sh REPO_PATH OUTPUT_DIR PUBLIC_INPUT_SLOT_JSON' \
    'OUTPUT_DIR must be outside REPO_PATH.' \
    'PUBLIC_INPUT_SLOT_JSON is the generated-daily-after-night-slot.json from compare-shared-use.sh (see comparison.md).'
}
if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
  usage
  exit 0
fi
if [[ $# -ne 3 ]]; then
  usage >&2
  exit 2
fi
comparison_input=$3
if [[ ! -f "$comparison_input" || ! -r "$comparison_input" ]]; then
  printf 'PUBLIC_INPUT_SLOT_JSON must be a readable file: %s\n' "$comparison_input" >&2
  exit 2
fi
comparison_dir=$(cd "$(dirname "$0")" && pwd)
comparison_repo=$(cd "$1" && pwd)
mkdir -p "$2"
comparison_output=$(cd "$2" && pwd)
case "$comparison_output/" in
  "$comparison_repo/"*) printf '%s\n' 'The research output directory must be outside the product repository.' >&2; exit 2 ;;
esac
"$comparison_repo/node_modules/.bin/esbuild" "$comparison_dir/compare-preferred-beds.ts" --bundle --format=cjs --platform=node --alias:@reform="$comparison_repo/src/reform" --outfile="$comparison_output/compare-preferred-beds.cjs" --log-level=warning
node "$comparison_output/compare-preferred-beds.cjs" --repo "$comparison_repo" --out "$comparison_output" --input "$comparison_input"
