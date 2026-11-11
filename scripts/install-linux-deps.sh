#!/usr/bin/env bash
set -euo pipefail

# Install native Tauri build dependencies and Rust for supported Linux hosts.
# Run from the repository root: bash scripts/install-linux-deps.sh

log() { printf '\n==> %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Linux ]] || fail 'This installer supports Linux only.'

if ! command -v sudo >/dev/null 2>&1; then
  fail 'sudo is required to install system packages. Install the listed packages with your distribution package manager, then rerun this script.'
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  fail 'Cannot identify this Linux distribution (/etc/os-release is missing).'
fi

case "${ID:-}" in
  fedora|nobara)
    log "Installing Tauri/Rust native dependencies for ${PRETTY_NAME:-Fedora-family Linux}"
    sudo dnf install -y \
      clang curl file gcc gcc-c++ libappindicator-gtk3-devel \
      libsecret-devel librsvg2-devel libxdo-devel make openssl-devel \
      pkgconf-pkg-config webkit2gtk4.1-devel wget
    ;;
  ubuntu|debian|linuxmint|pop)
    log "Installing Tauri/Rust native dependencies for ${PRETTY_NAME:-Debian-family Linux}"
    sudo apt-get update
    sudo apt-get install -y \
      build-essential clang curl file libayatana-appindicator3-dev \
      libsecret-1-dev librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev \
      libxdo-dev pkg-config wget
    ;;
  *)
    fail "Automatic package installation is not configured for '${ID:-unknown}'. See https://v2.tauri.app/start/prerequisites/ and install Rust stable plus Tauri's Linux packages manually."
    ;;
esac

if ! command -v rustup >/dev/null 2>&1; then
  log 'Installing Rust using the official rustup installer (user-local; no sudo)'
  command -v curl >/dev/null 2>&1 || fail 'curl is required to install Rust.'
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/noveler-rustup.sh
  sh /tmp/noveler-rustup.sh -y --profile minimal --default-toolchain stable
  rm -f /tmp/noveler-rustup.sh
fi

if [[ -r "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi

if ! command -v rustc >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
  rustup toolchain install stable --profile minimal
  rustup default stable
  if [[ -r "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
fi

command -v rustc >/dev/null 2>&1 || fail 'Rust was installed but rustc is not on PATH. Open a new terminal and rerun this script.'
command -v cargo >/dev/null 2>&1 || fail 'Rust was installed but cargo is not on PATH. Open a new terminal and rerun this script.'

log 'Installed versions'
rustc --version
cargo --version

log 'Checking Node.js version'
command -v node >/dev/null 2>&1 || fail 'Node.js is not installed. Install Node.js 22 LTS (or 20.19+), then rerun this script.'
node --version

log 'Installing locked frontend dependencies'
npm ci

log 'Linux development prerequisites are ready. Next run: npm run tauri:build:linux'
