#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/wasm
# Resolve transitive package checksums in clean CI environments until go.sum is committed.
# go mod download alone may only record the module's go.mod hash, not its package zip hash.
(cd tools/shell-flow && go mod tidy && go mod verify)
(cd tools/shell-flow && GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o ../../public/wasm/shell-flow.wasm .)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" public/wasm/wasm_exec.js 2>/dev/null || cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" public/wasm/wasm_exec.js
echo "Built shell-flow.wasm"
