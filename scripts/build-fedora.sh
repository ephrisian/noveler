#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Linux ]] || fail 'This build script supports Fedora-family Linux only.'
[[ -r /etc/os-release ]] || fail 'Cannot identify this Linux distribution.'
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  fedora|nobara) ;;
  *) fail "Expected Fedora or Nobara; detected '${PRETTY_NAME:-unknown}'." ;;
esac

command -v cargo >/dev/null 2>&1 || fail 'Cargo is missing. Run npm run setup:linux first.'
command -v npm >/dev/null 2>&1 || fail 'npm is missing. Install Node.js and npm first.'

printf 'Building native Fedora/Nobara RPM and AppImage for %s\n' "${PRETTY_NAME:-Fedora-family Linux}"
npm run tauri -- build --bundles rpm,appimage

printf '\nBuild output:\n  %s/src-tauri/target/release/bundle/rpm\n  %s/src-tauri/target/release/bundle/appimage\n' "$PWD" "$PWD"
printf '\nInstall the RPM with: sudo dnf install ./src-tauri/target/release/bundle/rpm/*.rpm\n'
printf 'On affected Wayland sessions, launch the AppImage with WEBKIT_DISABLE_DMABUF_RENDERER=1 if needed.\n'
