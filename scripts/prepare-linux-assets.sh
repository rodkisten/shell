#!/usr/bin/env bash
set -Eeuo pipefail

# Prepare v86 browser artifacts and a verified Alpine x86 (32-bit) ISO.
# Requires curl, jq, sha256sum, git and make (only for source-build fallback).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${LINUX_ASSETS_DIR:-${ROOT}/public/v86}"
ALPINE_VERSION="${ALPINE_VERSION:-3.24.4}"
ALPINE_MINOR="${ALPINE_VERSION%.*}"
ALPINE_BASE="https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_MINOR}/releases/x86"
ISO="alpine-virt-${ALPINE_VERSION}-x86.iso"
V86_REF="${V86_REF:-master}"
mkdir -p "$DEST"

fetch() {
  local url="$1" target="$2"
  if [[ -s "$target" ]]; then printf 'Cached: %s\n' "$target"; return; fi
  printf 'Fetching: %s\n' "$url"
  curl -fL --retry 3 --connect-timeout 20 --output "${target}.tmp" "$url"
  mv "${target}.tmp" "$target"
}
cleanup() { rm -f "$DEST"/*.tmp; }
trap cleanup EXIT

fetch "$ALPINE_BASE/$ISO" "$DEST/alpine.iso"
fetch "$ALPINE_BASE/$ISO.sha256" "$DEST/alpine.iso.sha256"
expected="$(awk 'NF {print $1; exit}' "$DEST/alpine.iso.sha256")"
if [[ ! "$expected" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Invalid Alpine SHA256 metadata" >&2; exit 1
fi
printf '%s  %s\n' "$expected" "$DEST/alpine.iso" | sha256sum -c -

# v86 release asset names vary by release. Prefer the published build artifacts
# when present; fail with an actionable message rather than silently deploying
# incomplete or mismatched assets.
release_json="$(curl -fsSL 'https://api.github.com/repos/copy/v86/releases/latest' || true)"
release_url() {
  local name="$1"
  printf '%s' "$release_json" | jq -er --arg name "$name" '.assets[]? | select(.name == $name) | .browser_download_url' 2>/dev/null | head -n 1 || true
}
for asset in libv86.js v86.wasm; do
  url="$(release_url "$asset")"
  if [[ -z "$url" && ! -s "$DEST/$asset" ]]; then
    echo "Missing v86 release asset: $asset" >&2
    echo "Build v86 from https://github.com/copy/v86 and copy build/$asset into $DEST, then rerun." >&2
    exit 1
  fi
  if [[ -n "$url" ]]; then fetch "$url" "$DEST/$asset"; fi
done
for bios in seabios.bin vgabios.bin; do
  fetch "https://raw.githubusercontent.com/copy/v86/${V86_REF}/bios/$bios" "$DEST/$bios"
done
for asset in libv86.js v86.wasm seabios.bin vgabios.bin alpine.iso; do
  test -s "$DEST/$asset" || { echo "Missing/empty: $DEST/$asset" >&2; exit 1; }
done
printf 'Prepared Linux assets in %s\n' "$DEST"
