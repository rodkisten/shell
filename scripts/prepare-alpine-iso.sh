#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${LINUX_ASSETS_DIR:-${ROOT}/public/v86}"
VERSION="${ALPINE_VERSION:-3.24.4}"
MINOR="${VERSION%.*}"
ISO="alpine-virt-${VERSION}-x86.iso"
BASE="https://dl-cdn.alpinelinux.org/alpine/v${MINOR}/releases/x86"
mkdir -p "$DEST"
curl -fL --retry 3 --output "$DEST/alpine.iso.tmp" "$BASE/$ISO"
curl -fL --retry 3 --output "$DEST/alpine.iso.sha256" "$BASE/$ISO.sha256"
EXPECTED="$(awk 'NF {print $1; exit}' "$DEST/alpine.iso.sha256")"
[[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Invalid checksum' >&2; exit 1; }
printf '%s  %s\n' "$EXPECTED" "$DEST/alpine.iso.tmp" | sha256sum -c -
mv "$DEST/alpine.iso.tmp" "$DEST/alpine.iso"
echo "Verified $ISO"
