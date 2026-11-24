#!/usr/bin/env bash
set -euo pipefail
fixture_source=$(cd "$(dirname "$0")" && pwd)
fixture_repo=$(cd "$fixture_source/../../.." && pwd)
fixture_output=${1:-$(mktemp -d)}
mkdir -p "$fixture_output"
fixture_output=$(cd "$fixture_output" && pwd)
"$fixture_repo/node_modules/.bin/esbuild" "$fixture_source/make-fixtures.ts" --bundle --format=cjs --platform=node --alias:@reform="$fixture_repo/src/reform" --loader:.png=dataurl --outfile="$fixture_output/fixtures.cjs" --log-level=warning
node "$fixture_output/fixtures.cjs" "$fixture_output"
"$fixture_repo/node_modules/.bin/esbuild" "$fixture_source/make-duplicate-fixture.ts" --bundle --format=cjs --platform=node --alias:@reform="$fixture_repo/src/reform" --loader:.png=dataurl --outfile="$fixture_output/duplicate.cjs" --log-level=warning
node "$fixture_output/duplicate.cjs" "$fixture_output" > "$fixture_output/duplicate-fixture-manifest.json"
realpath "$fixture_output"
