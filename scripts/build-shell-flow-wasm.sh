#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/wasm
(cd tools/shell-flow && GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o ../../public/wasm/shell-flow.wasm .)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" public/wasm/wasm_exec.js 2>/dev/null || cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" public/wasm/wasm_exec.js
echo "Built shell-flow.wasm"
