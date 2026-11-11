# Desktop release and platform checklist

## Build workflow

The GitHub Actions workflow at `.github/workflows/desktop-build.yml` runs on a
manual dispatch or a `v*` tag. It builds unsigned Linux (`deb`, `rpm`, AppImage),
Windows (`msi`, NSIS), and macOS (`.app`, DMG) artifacts on native runners and
uploads them as workflow artifacts. It runs frontend typecheck, lint, tests,
production build, Rust formatting, and Rust backend tests before packaging.
Artifact uploads are not signed releases and are not published automatically to
a release page.

Local aliases are available through `npm run tauri:build` and the
`tauri:build:linux`, `tauri:build:windows`, and `tauri:build:macos` scripts.
Cross-OS builds are not guaranteed; use the matching OS runner for reliable
native installers.

## Prerequisites

- **All platforms:** Node.js 22 (or a supported current LTS), npm, and stable
  Rust via rustup. Use `npm ci` for lockfile-reproducible frontend dependencies.
- **Fedora/Nobara and Debian/Ubuntu:** `npm run setup:linux` installs the
  supported Linux build packages, Rust stable if missing, and runs `npm ci`.
  It requires `sudo` for system packages and downloads the official rustup
  installer if necessary. Other distributions need manual dependency setup.
- **Linux:** GTK 3, WebKitGTK 4.1, build tools, and the Tauri development
  packages listed in the current Tauri v2 prerequisites. Install desktop
  integration libraries required by the chosen distribution. Build each Linux
  package on a compatible distribution; AppImage runtime compatibility varies.
- **Windows:** Microsoft Visual Studio C++ Build Tools with the MSVC toolchain,
  Windows SDK, and WebView2 Runtime. The workflow builds MSI and NSIS installers.
- **macOS:** Xcode and Command Line Tools. Build on the intended architecture;
  the workflow builds separate arm64 and Intel app/DMG artifacts, not a single
  universal binary.

## Signing and publishing

- **Windows:** unsigned MSI/NSIS artifacts can show SmartScreen warnings. For
  public distribution, configure an Authenticode signing certificate and
  timestamp service in a protected release workflow.
- **macOS:** public distribution should use a Developer ID Application
  certificate, sign the app and DMG, enable hardened runtime, submit for Apple
  notarization, and staple the ticket. No signing or notarization secrets are
  configured by this repository workflow.
- **Linux:** packages are unsigned by default. Sign repository/package metadata
  or publish checksums and provenance through the chosen distribution channel.

Never commit signing certificates, passwords, notarization credentials, or API
keys. Configure secrets only in protected CI environments. This project has not
configured a release publisher or signing pipeline yet.

## MVP implementation checklist

- [x] Local projects and ordered chapters/scenes with SQLite persistence.
- [x] Writing workspace, autosave state, focus mode, word counts, and Codex.
- [x] BYOK settings, explicit AI context review, response preview, and metadata-only history.
- [x] OpenAI-compatible, OpenRouter, and local Ollama provider choices; Ollama is restricted to loopback and does not require a key.
- [x] Local search, Markdown/plain-text export, and versioned backup/restore.
- [x] Destructive action confirmation, save retry, and unsaved browser-exit warning.
- [x] Keyboard-accessible global search (`Ctrl/Cmd+K`, arrows, Enter, Escape) and save (`Ctrl/Cmd+S`).
- [x] AI dialog focus trap, Escape close, and focus restoration.
- [x] Light/dark choice and adjustable text scale.
- [x] Native build workflow definition for Linux, Windows, and macOS.
- [x] Rust backend tests and Linux desktop packages verified on Nobara Linux x86_64 (18 backend tests pass; DEB, RPM, and AppImage built).
- [x] Fedora/Nobara build script packages the native RPM and AppImage; generated RPM declares GTK 3 and WebKitGTK 4.1 runtime dependencies.
- [ ] Signed, notarized, end-user release artifacts.
- [ ] Manual accessibility verification with screen readers and high-contrast system settings.

## Commands and evidence

Run `npm ci`, `npm run format`, `npm run format:check`, `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build`, and `npm run tauri:build` on a
machine provisioned for its target OS. Run `cargo fmt --manifest-path
src-tauri/Cargo.toml -- --check` and `cargo test --manifest-path
src-tauri/Cargo.toml` when Rust is installed. Record the actual OS, command, and
result for each platform; frontend checks alone do not establish native bundle
success.

## Known limitations and next steps

- The global search supports keyboard selection but requires manual review with
  screen readers. A full automated accessibility scan and platform screen-reader
  pass remain outstanding.
- Browser `beforeunload` protects unsaved work, but native window close-request
  interception is not explicitly registered. Add a minimal Tauri close-request
  handler and a user-facing save/discard/stay decision before shipping.
- The CI workflow produces unsigned artifacts only. Add protected signing and
  notarization jobs before public distribution.
- The local Linux build used Nobara Linux x86_64 with WebKitGTK 4.1. The first
  compile exposed an AI settings type mismatch and stale test fixtures; both
  were fixed before all 18 Rust tests and DEB/RPM/AppImage bundles passed. The
  GitHub Actions workflow has been configured but has not yet run in CI.
- This machine did not have `rustfmt`, so `cargo fmt` could not run; install the
  rustfmt component and format-check the Rust sources before merging.
- On this Nobara Wayland session, launching the initial AppImage emitted a GDK
  Wayland protocol error; forcing X11 reported a GBM buffer error. Linux
  Wayland startup now applies WebKitGTK's DMA-BUF renderer fallback unless the
  user explicitly sets `WEBKIT_DISABLE_DMABUF_RENDERER`. After rebuilding, the
  AppImage stayed running for a 12-second smoke test without GDK/GBM diagnostics;
  visual interaction and RPM installation still require manual verification.
- Validate package installation, upgrades, file handling, and OS credential-store
  behavior independently on Linux, Windows, and macOS.
- Confirm minimum supported Linux distributions and whether universal macOS
  builds are required before the first release.
