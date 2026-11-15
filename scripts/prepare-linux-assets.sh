#!/usr/bin/env bash
set -Eeuo pipefail

# Downloads browser v86 artifacts and a pinned Alpine x86 ISO.
# Usage: bash scripts/prepare-linux-assets.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ROOT}/public/v86"
mkdir -p "$DEST"
V86_REF="${V86_REF:-master}"
ALPINE_VERSION="${ALPINE_VERSION:-3.24.4}"
ALPINE_BASE="https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86"
ISO="alpine-virt-${ALPINE_VERSION}-x86.iso"

fetch() {
  local url="$1" target="$2"
  if [[ -s "$target" ]]; then
    printf 'Cached: %s\n' "$target"
    return
  fi
  printf 'Fetching: %s\n' "$url"
  curl --fail --location --retry 3 --connect-timeout 20 --output "${target}.tmp" "$url"
  mv "${target}.tmp" "$target"
}
# Browser bundle and wasm are distributed as release assets, not committed source.
# Resolve the latest release and download its named artifacts.
release_json="$(curl -fsSL 'https://api.github.com/repos/copy/v86/releases/latest')"
release_url() {
  local name="$1"
  printf '%s' "$release_json" | jq -er --arg name "$name" '.assets[] | select(.name == $name) | .browser_download_url' | head -n 1
}
fetch "$(release_url libv86.js)" "$DEST/libv86.js"
fetch "$(release_url v86.wasm)" "$DEST/v86.wasm"
for bios in seabios.bin vgabios.bin; do
  fetch "https://raw.githubusercontent.com/copy/v86/${V86_REF}/bios/${bios}" "$DEST/$bios"
done
fetch "${ALPINE_BASE}/${ISO}" "$DEST/alpine.iso"
fetch "${ALPINE_BASE}/${ISO}.sha256" "$DEST/alpine.iso.sha256"
(
  cd "$DEST"
  # Alpine's checksum lists the upstream filename, not our local alias.
  expected="$(awk '{print $1}' alpine.iso.sha256)"
  printf '%s  alpine.iso\n' "$expected" | sha256sum -c -
)
printf 'Assets prepared in %s\n' "$DEST"
